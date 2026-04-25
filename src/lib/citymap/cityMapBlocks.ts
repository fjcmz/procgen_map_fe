// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — blocks / districts (PR 4 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module lands the "blocks" slice of the spec's PR 4 (line 63):
//
//   "Flood-fill interior tiles bounded by roads/streets/river/walls →
//    CityBlock[] with role assignment
//    (civic/market/harbor/residential/slum/agricultural)."
//
// Polygon-graph translation of that one spec sentence:
//
//   BLOCK  := a connected component in the polygon adjacency graph where
//             two polygons are in the same component iff their SHARED
//             Voronoi edge is NOT a wall / river / road / street edge.
//
// Every polygon ends up in exactly one block (including `isEdge` polygons,
// which naturally collect into the outside-walls clusters PR 5 will render
// as sprawl). A "role" is then assigned from the block's geometry plus the
// already-computed `openSpaces` (civic square and market polygons mark
// their containing blocks as `civic` / `market`).
//
// Every primitive this module consumes comes from the `CityPolygon`
// contract:
//   • `polygon.id`         — block membership / output identity
//   • `polygon.neighbors`  — BFS adjacency during the flood
//   • `polygon.vertices`   — polygon-edge keys for barrier tests
//   • `polygon.isEdge`     — exterior-cluster detection (slum / agricultural)
//   • `polygon.site`       — centroid-based harbor / residential split
//
// NO tile lattice. NO `Math.random`. RNG: dedicated `_blocks_names` stream
// for the V1-ported medieval name combiner (prefix + suffix).
//
// IMPORTANT SEMANTIC INVERSION vs. `cityMapOpenSpaces.ts`:
//   Open-space eligibility intentionally EXCLUDES streets from the blocked
//   edge set (plazas want to front streets). Blocks MUST include streets
//   in the barrier set — streets are the primary boundary between urban
//   districts. Do not copy-paste the openSpaces `blockedEdgeKeys` pattern
//   without adding street edges.
//
// Reference patterns:
//   • cityMapOpenSpaces.ts        — polygon eligibility + BFS-cluster shape
//   • cityMapRiver.ts             — polygon-graph flood with edge barriers
//   • cityMapEdgeGraph.ts         — canonical edge keys + edge ownership
//   • cityMapGenerator.ts:956-969 — V1 medieval name prefix/suffix lists
//     (pure text flavor data, ported verbatim; the tile-based V1 flood
//      algorithm is discarded).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityBlockNewV2,
  CityEnvironment,
  CityPolygon,
  DistrictRole,
  DistrictType,
} from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';
import { buildEdgeOwnership, canonicalEdgeKey, type Point } from './cityMapEdgeGraph';
import type { WallGenerationResult } from './cityMapWalls';
import type { RiverGenerationResult } from './cityMapRiver';

import type { OpenSpaceEntry } from './cityMapOpenSpaces';

// ─── Per-tier block tuning ──────────────────────────────────────────────────

// Edge-polygon blocks smaller or equal to this threshold are tagged `slum`;
// larger exterior clusters become `agricultural`. Ported from V1's
// `slumThreshold = Math.max(6, Math.round(gridW / 4))` then scaled down
// because Voronoi polygons are coarser than tiles — megalopolis has ~60–80
// edge polygons total, not ~180.
const SLUM_SIZE_THRESHOLD: Record<CitySize, number> = {
  small: 2,
  medium: 3,
  large: 4,
  metropolis: 5,
  megalopolis: 6,
};

// Harbor-detection band — a centroid within this fraction of the canvas
// edge (on the matching `env.waterSide`) qualifies as a waterfront block.
// Mirrors V1's `gridW * 0.3` (cityMapGenerator.ts:913) in canvas-pixel space.
const HARBOR_BAND_FRACTION = 0.30;

// Cities of these tiers may sport `dock` blocks sitting on water polygons
// adjacent to the city footprint (spec: "Cities that are large or larger
// can have dock blocks covering up to 10% of their total city polygon
// count"). Smaller coastal cities only get harbor blocks on the landward
// side of the coast.
const DOCK_ELIGIBLE_SIZES: ReadonlySet<CitySize> = new Set<CitySize>([
  'large', 'metropolis', 'megalopolis',
]);
// Cap on dock-block water-polygon coverage as a fraction of cityPolygonCount.
const DOCK_MAX_FRACTION_OF_CITY = 0.10;
// Maximum BFS depth into water from the shoreline. Dock polygons more than
// this many Delaunay steps from interior-adjacent water are excluded so piers
// don't extend unrealistically far offshore.
const DOCK_MAX_DEPTH = 3;
// Maximum dock cluster width (in estimated polygon diameters) along the
// coastline axis. Clusters wider than this are split into narrower piers.
const DOCK_MAX_WIDTH_CELLS = 5;

// Cap on mountain polygons absorbed into city blocks as a fraction of
// cityPolygonCount. Spec: "City blocks can expand to mountain polygons but
// no more than 10% of the total city polygons." Polygons beyond this budget
// stay as pure mountain terrain.
const MOUNTAIN_MAX_FRACTION_OF_CITY = 0.10;

// Name combiner: retry attempts before falling back to a numeric DISTRICT N.
const NAME_MAX_ATTEMPTS = 12;
// Probability of inserting a space between prefix + suffix (else concatenate).
const NAME_SPACE_JOINER_PROB = 0.35;

/**
 * Generate the city's block list.
 *
 * Polygon-graph algorithm in three steps:
 *
 *   1. Build a `Set<string>` of canonical edge keys that act as block
 *      barriers — every wall / river / road / street polygon edge.
 *   2. BFS over `polygon.neighbors` in polygon-id order, refusing to cross
 *      any barrier edge. Each flood-fill component is one raw block.
 *   3. Classify each block by role (civic/market/harbor/residential/
 *      slum/agricultural) using the already-computed `openSpaces` + the
 *      `isEdge` membership + `env.waterSide` geometry, then generate a
 *      deduplicated medieval name per block via the prefix+suffix combiner.
 *
 * Returns `[]` on degenerate input (too few polygons). Otherwise every
 * polygon in `polygons` appears in exactly one `block.polygonIds` — the
 * partition invariant the PR 5 renderer / labeler will rely on.
 *
 * Wired into `cityMapGeneratorV2.ts` AFTER `generateOpenSpaces` so the role
 * assignment can look up civic / market polygons.
 */
export function generateBlocks(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  wall: WallGenerationResult,
  river: RiverGenerationResult | null,
  roads: Point[][],
  streets: Point[][],
  openSpaces: OpenSpaceEntry[],
  canvasSize: number,
  waterPolygonIds?: Set<number>,
  cityPolygonCount?: number,
  mountainPolygonIds?: Set<number>,
): CityBlockV2[] {
  if (polygons.length < 4) return [];

  const water = waterPolygonIds ?? new Set<number>();
  const mountain = mountainPolygonIds ?? new Set<number>();

  // Pick up to MOUNTAIN_MAX_FRACTION_OF_CITY × cityPolygonCount mountain
  // polygons that sit adjacent to the city footprint to be absorbed into
  // neighboring blocks (spec: "City blocks can expand to mountain polygons
  // but no more than 10% of the total city polygons."). Unabsorbed mountain
  // polygons stay out of the flood and remain pure terrain.
  const absorbedMountain = pickAbsorbedMountainPolygons(
    polygons,
    mountain,
    wall.interiorPolygonIds,
    cityPolygonCount ?? 0,
  );

  // ── Step 1: barrier edge keys ────────────────────────────────────────────
  // [Voronoi-polygon] Every wall / river / road / street segment is a
  // polygon edge (PR 2 / PR 3 produced them that way). We key each segment
  // with `canonicalEdgeKey` so float-drift between generators collapses —
  // same keying every other V2 module uses.
  //
  // Note the semantic inversion vs. `cityMapOpenSpaces.ts`: streets ARE
  // in this barrier set because blocks are bounded BY streets (plazas, by
  // contrast, want to front streets, so openSpaces leaves streets out of
  // its blocked set).
  const barrierEdgeKeys = new Set<string>();
  for (const seg of wall.wallSegments) {
    for (let i = 0; i < seg.length - 1; i++) {
      barrierEdgeKeys.add(canonicalEdgeKey(seg[i], seg[i + 1]));
    }
  }
  if (river) {
    for (const [a, b] of river.edges) {
      barrierEdgeKeys.add(canonicalEdgeKey(a, b));
    }
  }
  for (const path of roads) {
    for (let i = 0; i < path.length - 1; i++) {
      barrierEdgeKeys.add(canonicalEdgeKey(path[i], path[i + 1]));
    }
  }
  for (const path of streets) {
    for (let i = 0; i < path.length - 1; i++) {
      barrierEdgeKeys.add(canonicalEdgeKey(path[i], path[i + 1]));
    }
  }

  // [Voronoi-polygon] `buildEdgeOwnership` maps each canonical edge key to
  // the 1 or 2 polygons that share it. We use it to resolve "what's the
  // shared-edge key between polygon A and polygon B?" during the flood,
  // so we don't have to re-walk vertex rings inside the hot loop.
  const edgeOwnership = buildEdgeOwnership(polygons);

  // ── Step 2: flood the polygon graph ──────────────────────────────────────
  // [Voronoi-polygon] Iterate polygons by `id` ascending so block ordering
  // is seed-stable across runs. For each unvisited polygon, BFS via
  // `polygon.neighbors`, refusing to cross any neighbor whose shared edge
  // is in `barrierEdgeKeys`, AND refusing to cross the footprint boundary
  // (a polygon in `wall.interiorPolygonIds` never floods into a polygon
  // outside it, and vice versa). The footprint-boundary barrier is an
  // O(1) membership test independent of the wall path — it's what lets
  // unwalled cities still produce a clean interior/exterior partition
  // so downstream buildings / landmarks / sprawl classify correctly.
  // For walled cities the wall edges already block the same seam, so
  // this is a no-op on the flood result.
  // Absorbed mountain polygons are treated as interior for the flood so
  // the city's residential/civic/etc. blocks can extend into foothills.
  // Unabsorbed mountains stay excluded.
  const interior = new Set<number>(wall.interiorPolygonIds);
  for (const id of absorbedMountain) interior.add(id);
  // Water polygons are excluded from the standard flood — they cannot be
  // part of civic / residential / harbor / slum / agricultural blocks.
  // Dock blocks (large+ cities) are synthesized in a separate pass below.
  // Non-absorbed mountain polygons are also excluded — they remain pure
  // terrain (rendered on a dedicated mountain layer).
  const visited = new Set<number>();
  for (const p of polygons) {
    if (water.has(p.id)) visited.add(p.id);
    if (mountain.has(p.id) && !absorbedMountain.has(p.id)) visited.add(p.id);
  }
  const rawBlocks: number[][] = [];
  for (const seedPoly of polygons) {
    if (visited.has(seedPoly.id)) continue;
    const component: number[] = [];
    const queue: number[] = [seedPoly.id];
    visited.add(seedPoly.id);
    while (queue.length > 0) {
      const currId = queue.shift()!;
      component.push(currId);
      const curr = polygons[currId];
      for (const nbId of curr.neighbors) {
        if (visited.has(nbId)) continue;
        if (water.has(nbId)) continue; // water polygons are never part of land blocks
        if (mountain.has(nbId) && !absorbedMountain.has(nbId)) continue; // pure mountain — not floodable
        if (interior.has(currId) !== interior.has(nbId)) continue; // footprint boundary
        const sharedKey = findSharedEdgeKey(curr, nbId, edgeOwnership);
        if (sharedKey === null) continue; // no shared Voronoi edge (very rare clip edge case)
        if (barrierEdgeKeys.has(sharedKey)) continue; // blocked by infrastructure
        visited.add(nbId);
        queue.push(nbId);
      }
    }
    rawBlocks.push(component);
  }

  // ── Step 3a: precompute openSpaces polygon lookups ───────────────────────
  // [Voronoi-polygon] The `openSpaces` result already stamped one polygon
  // per civic square / market. We mark blocks containing those polygons
  // as civic / market without touching the open-space entries themselves
  // (parks are deliberately NOT a role — they're open space, not a
  // district, and the containing block inherits its role from geometry).
  const civicPolygonIds = new Set<number>();
  const marketPolygonIds = new Set<number>();
  for (const entry of openSpaces) {
    if (entry.kind === 'square') {
      for (const pid of entry.polygonIds) civicPolygonIds.add(pid);
    } else if (entry.kind === 'market') {
      for (const pid of entry.polygonIds) marketPolygonIds.add(pid);
    }
  }

  // ── Step 3b: role assignment + naming ───────────────────────────────────
  const nameRng = seededPRNG(`${seed}_city_${cityName}_blocks_names`);
  const usedNames = new Set<string>();
  const slumThreshold = SLUM_SIZE_THRESHOLD[env.size];
  const harborBand = canvasSize * HARBOR_BAND_FRACTION;

  const blocks: CityBlockV2[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const polygonIds = rawBlocks[i];
    const role = classifyBlock(
      polygonIds,
      polygons,
      interior,
      civicPolygonIds,
      marketPolygonIds,
      env,
      slumThreshold,
      canvasSize,
      harborBand,
    );
    const name = generateBlockName(i, role, nameRng, usedNames);
    blocks.push({ polygonIds, role, name });
  }

  // ── Dock block synthesis (large+ coastal cities only) ────────────────────
  // [Voronoi-polygon] Select up to `DOCK_MAX_FRACTION_OF_CITY × cityPolygonCount`
  // water polygons that sit Delaunay-adjacent to the city footprint. They
  // become `dock` blocks — the only exception to the "no blocks on water"
  // rule. Large / metropolis cities get exactly 1 dock; megalopolis cities
  // have a 50% chance of 2 docks. Small / medium cities don't emit docks
  // (harbor land blocks already cover their waterfront).
  if (
    water.size > 0
    && DOCK_ELIGIBLE_SIZES.has(env.size)
    && cityPolygonCount && cityPolygonCount > 0
  ) {
    const dockBudget = Math.floor(cityPolygonCount * DOCK_MAX_FRACTION_OF_CITY);
    if (dockBudget > 0) {
      const dockPolygonIds = pickDockPolygons(polygons, water, interior, dockBudget);
      if (dockPolygonIds.length > 0) {
        const rawClusters = clusterAdjacentPolygons(polygons, dockPolygonIds);
        // Split clusters that are too wide along the coastline axis.
        const allClusters = env.waterSide
          ? splitDocksToWidth(rawClusters, polygons, env.waterSide, canvasSize)
          : rawClusters;
        // Limit to 1 dock cluster (2 for megalopolis at 50% chance). Uses a
        // dedicated RNG sub-stream so this roll doesn't perturb block names.
        const docksRng = seededPRNG(`${seed}_city_${cityName}_docks`);
        const maxDocks = env.size === 'megalopolis' && docksRng() < 0.5 ? 2 : 1;
        // Prefer larger clusters (more prominent piers); stable id tie-break.
        const dockClusters = allClusters
          .slice()
          .sort((a, b) => b.length - a.length || Math.min(...a) - Math.min(...b))
          .slice(0, maxDocks);
        for (const cluster of dockClusters) {
          const name = generateBlockName(blocks.length, 'dock', nameRng, usedNames);
          blocks.push({ polygonIds: cluster, role: 'dock', name });
        }
      }
    }
  }

  return blocks;
}

// ─── Mountain absorption helpers ───────────────────────────────────────────

// [Voronoi-polygon] Pick mountain polygons adjacent to the city footprint
// to be absorbed into neighboring blocks as foothill terrain. Cap at
// MOUNTAIN_MAX_FRACTION_OF_CITY × cityPolygonCount. Deterministic: sorts
// by number of interior-footprint neighbors (more contact = more central
// to city), then by polygon id. No RNG.
function pickAbsorbedMountainPolygons(
  polygons: CityPolygon[],
  mountain: Set<number>,
  interior: Set<number>,
  cityPolygonCount: number,
): Set<number> {
  if (mountain.size === 0 || cityPolygonCount <= 0) return new Set();
  const budget = Math.floor(cityPolygonCount * MOUNTAIN_MAX_FRACTION_OF_CITY);
  if (budget <= 0) return new Set();

  type Candidate = { id: number; score: number };
  const candidates: Candidate[] = [];
  for (const pid of mountain) {
    const poly = polygons[pid];
    if (!poly) continue;
    let interiorTouches = 0;
    for (const nb of poly.neighbors) {
      if (interior.has(nb)) interiorTouches++;
    }
    if (interiorTouches === 0) continue; // must touch the city footprint
    // Lower score = pick first. More interior contact ranks first.
    candidates.push({ id: pid, score: -interiorTouches * 10 });
  }
  candidates.sort((a, b) => (a.score - b.score) || (a.id - b.id));

  const picked = new Set<number>();
  for (const c of candidates) {
    if (picked.size >= budget) break;
    picked.add(c.id);
  }
  return picked;
}

// ─── Dock block helpers ─────────────────────────────────────────────────────

// [Voronoi-polygon] Pick water polygons to become docks. Eligibility:
//   - polygon must be within DOCK_MAX_DEPTH BFS steps from the shoreline
//     (interior-adjacent water polygons = depth 1, each step deeper adds 1)
//   - depth-1 polygons are preferred; deeper ones fill remaining budget
// Shallower (closer to shore) polygons rank first; ties broken by id.
function pickDockPolygons(
  polygons: CityPolygon[],
  water: Set<number>,
  interior: Set<number>,
  budget: number,
): number[] {
  // BFS from shore: seed with water polygons adjacent to interior (depth 1),
  // then expand up to DOCK_MAX_DEPTH steps further into open water.
  const depthMap = new Map<number, number>();
  const bfsQueue: number[] = [];
  for (const pid of water) {
    const poly = polygons[pid];
    if (!poly) continue;
    for (const nb of poly.neighbors) {
      if (interior.has(nb)) {
        depthMap.set(pid, 1);
        bfsQueue.push(pid);
        break;
      }
    }
  }
  let head = 0;
  while (head < bfsQueue.length) {
    const pid = bfsQueue[head++];
    const d = depthMap.get(pid)!;
    if (d >= DOCK_MAX_DEPTH) continue;
    for (const nb of polygons[pid].neighbors) {
      if (water.has(nb) && !depthMap.has(nb)) {
        depthMap.set(nb, d + 1);
        bfsQueue.push(nb);
      }
    }
  }

  type Candidate = { id: number; score: number };
  const candidates: Candidate[] = [];
  for (const [pid, depth] of depthMap) {
    const poly = polygons[pid];
    if (!poly) continue;
    let interiorTouches = 0;
    let landTouches = 0;
    for (const nb of poly.neighbors) {
      if (interior.has(nb)) interiorTouches++;
      if (!water.has(nb)) landTouches++;
    }
    // Lower depth + more shoreline contact = picked first.
    candidates.push({ id: pid, score: depth * 100 - interiorTouches * 10 - landTouches });
  }
  candidates.sort((a, b) => (a.score - b.score) || (a.id - b.id));

  const picked: number[] = [];
  for (const c of candidates) {
    if (picked.length >= budget) break;
    picked.push(c.id);
  }
  return picked;
}

// [Voronoi-polygon] Group picked polygons into connected clusters over
// `polygon.neighbors`. Two picked polygons end up in the same cluster iff
// they're Delaunay-adjacent (direct or transitive). Deterministic — no RNG.
function clusterAdjacentPolygons(
  polygons: CityPolygon[],
  picked: number[],
): number[][] {
  const pickedSet = new Set(picked);
  const visited = new Set<number>();
  const clusters: number[][] = [];
  for (const pid of picked) {
    if (visited.has(pid)) continue;
    const cluster: number[] = [];
    const queue: number[] = [pid];
    visited.add(pid);
    while (queue.length > 0) {
      const id = queue.shift()!;
      cluster.push(id);
      for (const nb of polygons[id].neighbors) {
        if (pickedSet.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    cluster.sort((a, b) => a - b);
    clusters.push(cluster);
  }
  return clusters;
}

// [Voronoi-polygon] Split any cluster that is wider than DOCK_MAX_WIDTH_CELLS
// polygon-diameters along the coastline axis. Each resulting band is then
// re-split by Delaunay connectivity so every dock block is contiguous.
// Deterministic — no RNG; sort is stable via id tie-break.
function splitDocksToWidth(
  clusters: number[][],
  polygons: CityPolygon[],
  waterSide: NonNullable<CityEnvironment['waterSide']>,
  canvasSize: number,
): number[][] {
  // Approximate polygon cell diameter as sqrt(canvas area / polygon count).
  const cellDiam = canvasSize / Math.sqrt(polygons.length);
  const maxWidth = DOCK_MAX_WIDTH_CELLS * cellDiam;

  // Return the polygon's coordinate along the shoreline axis.
  const coastCoord = (pid: number): number => {
    const [x, y] = polygons[pid].site;
    return (waterSide === 'north' || waterSide === 'south') ? x : y;
  };

  const result: number[][] = [];
  for (const cluster of clusters) {
    const sorted = cluster.slice().sort((a, b) => coastCoord(a) - coastCoord(b) || a - b);
    const span = coastCoord(sorted[sorted.length - 1]) - coastCoord(sorted[0]);
    if (span <= maxWidth) {
      result.push(cluster);
      continue;
    }
    // Split into sequential bands of width ≤ maxWidth, then re-cluster each
    // band so disconnected fragments (after the positional cut) become
    // separate pier blocks rather than one discontiguous block.
    let bandStart = coastCoord(sorted[0]);
    let band: number[] = [];
    for (const pid of sorted) {
      const c = coastCoord(pid);
      if (c - bandStart > maxWidth && band.length > 0) {
        result.push(...clusterAdjacentPolygons(polygons, band));
        band = [];
        bandStart = c;
      }
      band.push(pid);
    }
    if (band.length > 0) result.push(...clusterAdjacentPolygons(polygons, band));
  }
  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Walk `polygon.vertices` as consecutive ring pairs and
// return the first canonical edge key whose `EdgeRecord.polyIds` contains
// `neighborId`. Voronoi cells share their edges one-to-one with Delaunay
// neighbors, so this either finds exactly one match or (for clip-edge
// pathologies) finds none — we return `null` in that case and the flood
// treats it as a non-crossable seam.
function findSharedEdgeKey(
  polygon: CityPolygon,
  neighborId: number,
  edgeOwnership: Map<string, { polyIds: number[]; a: Point; b: Point }>,
): string | null {
  const verts = polygon.vertices;
  const n = verts.length;
  if (n < 3) return null;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const key = canonicalEdgeKey(a, b);
    const rec = edgeOwnership.get(key);
    if (rec && rec.polyIds.indexOf(neighborId) !== -1) return key;
  }
  return null;
}

// [Voronoi-polygon] Return the mean `polygon.site` across every polygon in
// `polygonIds`. Used for harbor-band detection (is the block's centroid
// close to the matching canvas edge?).
function blockCentroid(polygonIds: number[], polygons: CityPolygon[]): Point {
  let sx = 0;
  let sy = 0;
  for (const pid of polygonIds) {
    const [x, y] = polygons[pid].site;
    sx += x;
    sy += y;
  }
  const n = polygonIds.length;
  return [sx / n, sy / n];
}

// [Voronoi-polygon] A block is "exterior" iff its polygons sit OUTSIDE the
// city footprint (`wall.interiorPolygonIds`). The footprint boundary is
// enforced as an implicit flood barrier in Step 2, so every block is either
// fully inside or fully outside — checking any one polygon is sufficient.
// This deliberately decouples "outside the city" from `polygon.isEdge`
// (which is the canvas-bbox marker): unwalled cities still need their
// outside-footprint polygons tagged as sprawl territory even though walls
// don't draw the boundary.
function isExteriorBlock(polygonIds: number[], interior: Set<number>): boolean {
  return polygonIds.length > 0 && !interior.has(polygonIds[0]);
}

// [Voronoi-polygon] True iff the block centroid sits within `harborBand`
// pixels of the `env.waterSide` canvas edge. `env.waterSide` may be null
// (no coast / no lake neighbor), in which case no block is ever harbor.
function isHarborBlock(
  centroid: Point,
  env: CityEnvironment,
  canvasSize: number,
  harborBand: number,
): boolean {
  if (!env.isCoastal || !env.waterSide) return false;
  switch (env.waterSide) {
    case 'north': return centroid[1] < harborBand;
    case 'south': return centroid[1] > canvasSize - harborBand;
    case 'west':  return centroid[0] < harborBand;
    case 'east':  return centroid[0] > canvasSize - harborBand;
    default:      return false;
  }
}

// [Voronoi-polygon] Assign a `DistrictRole` to a block from its polygon
// geometry + the already-computed open-space anchors. Order matters:
// exterior clusters short-circuit first because they must never be tagged
// civic/market even if an open-space polygon somehow landed on the edge;
// civic > market so a hypothetical block containing both still reads as
// civic (the spec's "central civic square" is the stronger signal).
function classifyBlock(
  polygonIds: number[],
  polygons: CityPolygon[],
  interior: Set<number>,
  civicPolygonIds: Set<number>,
  marketPolygonIds: Set<number>,
  env: CityEnvironment,
  slumThreshold: number,
  canvasSize: number,
  harborBand: number,
): DistrictRole {
  if (isExteriorBlock(polygonIds, interior)) {
    return polygonIds.length <= slumThreshold ? 'slum' : 'agricultural';
  }

  for (const pid of polygonIds) {
    if (civicPolygonIds.has(pid)) return 'civic';
  }
  for (const pid of polygonIds) {
    if (marketPolygonIds.has(pid)) return 'market';
  }

  const centroid = blockCentroid(polygonIds, polygons);
  if (isHarborBlock(centroid, env, canvasSize, harborBand)) return 'harbor';

  return 'residential';
}

// ─── Medieval name combiner ────────────────────────────────────────────────
// Ported verbatim from V1 `cityMapGenerator.ts:956-969`. Pure text flavor
// data — the tile-based V1 flood algorithm is NOT ported; only the
// word lists and the attempt-retry-fallback naming shape carry over.

const NAME_PREFIXES = [
  'ELM', 'OAK', 'ASH', 'ROSE', 'BRIAR', 'THORN',
  'BLUE', 'RED', 'GOLD', 'GREEN', 'WHITE', 'BLACK', 'SILVER', 'COPPER', 'IRON',
  'OLD', 'NEW', 'HIGH', 'LOW', 'FAR',
  'STONE', 'BRICK', 'GLASS', 'BREAD', 'SALT', 'WINE', 'CORN',
  'KING', 'QUEEN', 'BISHOP', 'ABBEY', 'GUILD',
];

const SUFFIXES_CIVIC = ['CROSS', 'COURT', 'SQUARE', 'GATE'];
const SUFFIXES_MARKET = ['MARKET', 'CROSS', 'SQUARE', 'ROW'];
const SUFFIXES_HARBOR = ['DOCKS', 'QUAY', 'WHARF', 'BANK'];
const SUFFIXES_DOCK = ['DOCKS', 'PIER', 'WHARF', 'LANDING', 'JETTY'];
const SUFFIXES_RESIDENTIAL = ['LANE', 'ROW', 'END', 'HOLM', 'SIDE', 'YARD', 'HILL', 'HEATH', 'GATE'];
const SUFFIXES_SLUM = ['ROW', 'END', 'HEATH', 'LANE', 'SIDE'];
const SUFFIXES_AGRI = ['FIELDS', 'CROFT', 'MEADOW', 'ACRES'];

function suffixesForRole(role: DistrictRole): string[] {
  switch (role) {
    case 'civic':        return SUFFIXES_CIVIC;
    case 'market':       return SUFFIXES_MARKET;
    case 'harbor':       return SUFFIXES_HARBOR;
    case 'dock':         return SUFFIXES_DOCK;
    case 'slum':         return SUFFIXES_SLUM;
    case 'agricultural': return SUFFIXES_AGRI;
    default:             return SUFFIXES_RESIDENTIAL;
  }
}

// [V1 port] Same shape as `cityMapGenerator.ts:982-1002`: prefix + optional
// space + role-specific suffix, with up to 12 attempts to avoid duplicates,
// falling back to `DISTRICT ${i+1}`. RNG comes from the caller so all block
// names share one deterministic stream.
function generateBlockName(
  index: number,
  role: DistrictRole,
  rng: () => number,
  used: Set<string>,
): string {
  const suffixes = suffixesForRole(role);
  for (let attempt = 0; attempt < NAME_MAX_ATTEMPTS; attempt++) {
    const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const suffix = suffixes[Math.floor(rng() * suffixes.length)];
    const joiner = rng() < NAME_SPACE_JOINER_PROB ? ' ' : '';
    const name = prefix + joiner + suffix;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `DISTRICT ${index + 1}`;
  used.add(fallback);
  return fallback;
}

// ─── Craft & Industry Quarter assignment ────────────────────────────────────
// Post-pass over the block list that extracts individual polygons from
// `residential` blocks and re-wraps each as a new 1-polygon craft / industry
// block. A single craft assignment is always exactly one polygon. Adjacent
// assignments of the same type will naturally read as one contiguous quarter,
// but the block list always represents them as separate 1-polygon entries.
//
// Algorithm:
//   1. Walk all residential block polygons (excluding isEdge ones that belong
//      to sprawl territory). Compute each polygon's outskirt score.
//   2. Sort candidates outskirt-first (farthest from canvas centre first).
//   3. For each craft slot, pick one polygon (river-adjacent preferred for
//      river-requiring types), remove it from its residential block, and
//      push a new CityBlockV2 { polygonIds: [pid], role, name } to the array.
//
// Invariants:
//   • Block partition preserved — stolen polygons move from residential block
//     to new craft block; every polygon still appears in exactly one block.
//   • Residential blocks that lose all their polygons become empty (harmless
//     for downstream consumers that iterate polygonIds).
//   • No extra RNG after count + shuffle — names are deterministic by index.
//   • RNG stream: `${seed}_city_${cityName}_craft` — independent of
//     `_blocks_names` so adding craft roles doesn't shift existing names.

type CraftRole = 'forge' | 'tannery' | 'textile' | 'potters' | 'mill';

const CRAFT_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [1, 3],
  medium:      [2, 5],
  large:       [3, 7],
  metropolis:  [5, 10],
  megalopolis: [8, 16],
};

// Medieval-flavour names per craft role. Picked deterministically by
// `(craftBlockCount % names.length)` — no RNG consumed for naming.
const CRAFT_NAMES: Record<CraftRole, string[]> = {
  forge:   ['SMITHS QUARTER', 'FORGE ROW', 'IRONMONGERS LANE', 'ARMORERS CLOSE', 'FOUNDRY YARD'],
  tannery: ['TANNERS ROW', 'HIDE MARKET', 'LEATHER CLOSE', 'FELLMONGERS YARD', 'BARK YARD'],
  textile: ['CLOTH ROW', 'WEAVERS LANE', 'DYE QUARTER', 'FULLERS CLOSE', 'LOOM YARD'],
  potters: ['POTTERS CLOSE', 'KILNS YARD', 'CLAY QUARTER', 'TILEWORKS ROW', 'CROCKERS LANE'],
  mill:    ['MILL ROW', 'GRAIN QUARTER', 'MILLSTONE CLOSE', 'GRINDERS YARD', 'FLOUR LANE'],
};

// Craft roles that must sit adjacent to the river.
const RIVER_REQUIRING: ReadonlySet<CraftRole> = new Set<CraftRole>([
  'tannery', 'textile', 'mill',
]);

/**
 * Extract individual polygons from `residential` blocks and re-wrap each as
 * a new 1-polygon craft / industry block. Mutates the `blocks` array in-place
 * (shrinks affected residential blocks, appends new craft blocks). The overall
 * block partition invariant is preserved.
 *
 * Eligibility rules (environment proxies, no resource plumbing):
 *   potters  — any size, any terrain
 *   forge    — medium+ cities
 *   mill     — hasRiver
 *   tannery  — hasRiver && medium+
 *   textile  — hasRiver && medium+
 */
export function assignCraftRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  river: RiverGenerationResult | null,
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_craft`);

  // ── River edge set for adjacency checks ────────────────────────────────
  // [Voronoi-polygon] Index all canonical edge keys along the river strand so
  // we can cheaply test whether a polygon shares an edge with the river.
  const riverEdgeKeys = new Set<string>();
  if (river) {
    for (const [a, b] of river.edges) {
      riverEdgeKeys.add(canonicalEdgeKey(a, b));
    }
  }

  const riverAdjacentPolygonIds = new Set<number>();
  if (riverEdgeKeys.size > 0) {
    for (const polygon of polygons) {
      const verts = polygon.vertices;
      const n = verts.length;
      for (let i = 0; i < n; i++) {
        const key = canonicalEdgeKey(verts[i], verts[(i + 1) % n]);
        if (riverEdgeKeys.has(key)) {
          riverAdjacentPolygonIds.add(polygon.id);
          break;
        }
      }
    }
  }

  // ── Eligible craft types from env ───────────────────────────────────────
  const eligibleTypes: CraftRole[] = ['potters'];
  if (env.size !== 'small') eligibleTypes.push('forge');
  if (env.hasRiver) {
    eligibleTypes.push('mill');
    if (env.size !== 'small') {
      eligibleTypes.push('tannery');
      eligibleTypes.push('textile');
    }
  }
  if (eligibleTypes.length === 0) return;

  // ── Count ───────────────────────────────────────────────────────────────
  const [minCount, maxCount] = CRAFT_COUNT_RANGE[env.size];
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));

  // ── Shuffle eligible types (seeded Fisher-Yates) ────────────────────────
  const shuffled = eligibleTypes.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Build type assignment list — cycle if count > eligible types.
  const typeList: CraftRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(shuffled[i % shuffled.length]);
  }

  // ── Build polygon candidate list (one entry per polygon in residential blocks)
  // [Voronoi-polygon] We work at the polygon level, not the block level.
  // Each candidate tracks which block index owns it so we can remove it.
  // isEdge polygons are skipped — they belong to outside-walls sprawl.
  type Candidate = {
    polygonId: number;
    blockIndex: number;
    outskirtScore: number;  // distance from canvas centre (500, 500)
    isRiverAdjacent: boolean;
  };
  const CANVAS_CX = 500;
  const CANVAS_CY = 500;
  const candidates: Candidate[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.role !== 'residential') continue;
    for (const pid of block.polygonIds) {
      const p = polygons[pid];
      if (!p || p.isEdge) continue; // skip canvas-border polygons (sprawl territory)
      const [px, py] = p.site;
      candidates.push({
        polygonId: pid,
        blockIndex: bi,
        outskirtScore: Math.hypot(px - CANVAS_CX, py - CANVAS_CY),
        isRiverAdjacent: riverAdjacentPolygonIds.has(pid),
      });
    }
  }

  // Sort outskirt-first (farthest from centre first), stable id tie-break.
  candidates.sort((a, b) => b.outskirtScore - a.outskirtScore || a.polygonId - b.polygonId);

  // ── Assign craft roles — one polygon per slot ───────────────────────────
  const usedPolygonIds = new Set<number>();
  let craftBlockCount = 0;

  for (const type of typeList) {
    const needsRiver = RIVER_REQUIRING.has(type);

    let picked: Candidate | null = null;

    // Prefer river-adjacent polygons for river-requiring types.
    if (needsRiver && riverAdjacentPolygonIds.size > 0) {
      for (const c of candidates) {
        if (!usedPolygonIds.has(c.polygonId) && c.isRiverAdjacent) {
          picked = c;
          break;
        }
      }
    }

    // Fall back to any available outskirt polygon.
    if (!picked) {
      for (const c of candidates) {
        if (!usedPolygonIds.has(c.polygonId)) {
          picked = c;
          break;
        }
      }
    }

    if (!picked) break; // pool exhausted

    usedPolygonIds.add(picked.polygonId);

    // Remove the polygon from its residential block. The block may become
    // empty — that is harmless (downstream consumers iterate polygonIds).
    const srcBlock = blocks[picked.blockIndex];
    srcBlock.polygonIds = srcBlock.polygonIds.filter(pid => pid !== picked!.polygonId);

    // Push a new 1-polygon craft block.
    const names = CRAFT_NAMES[type];
    blocks.push({
      polygonIds: [picked.polygonId],
      role: type,
      name: names[craftBlockCount % names.length],
    });
    craftBlockCount++;
  }
}

// ─── Phase 6: DistrictType-keyed block builder ─────────────────────────────
// specs/City_districts_redux.md Phase 6 — "Slim cityMapBlocks.ts to
// buildBlocksFromDistricts plus exported pickProceduralName."
//
// Takes `_districtsNew: DistrictType[]` (one entry per polygon, from Phase 5's
// `assignDistricts`) and groups polygons into connected same-district components.
// Water and unabsorbed-mountain polygon ids are excluded: `assignDistricts`
// writes the sentinel `'residential_medium'` for them, and that sentinel must
// never produce a named block.
//
// RNG stream: `${seed}_city_${cityName}_blocks_districts_names` — independent
// from `_blocks_names` so these new blocks don't shift existing block names.

const SUFFIXES_DISTRICT: Record<DistrictType, string[]> = {
  civic:              SUFFIXES_CIVIC,
  market:             SUFFIXES_MARKET,
  harbor:             SUFFIXES_HARBOR,
  dock:               ['WHARF', 'QUAY', 'DOCK', 'PIER', 'BERTH'],
  residential_high:   [...SUFFIXES_RESIDENTIAL, 'HEIGHTS', 'MANOR', 'COURT'],
  residential_medium: SUFFIXES_RESIDENTIAL,
  residential_low:    [...SUFFIXES_SLUM, 'ROW', 'END'],
  industry:           ['WORKS', 'YARD', 'FORGE', 'MILL', 'TANNERY', 'QUARTER'],
  education_faith:    ['ABBEY', 'COLLEGE', 'QUARTER', 'CLOSE', 'PRIORY'],
  military:           ['KEEP', 'BARRACKS', 'QUARTER', 'FORT', 'GARRISON'],
  trade:              ['EXCHANGE', 'WHARF', 'QUARTER', 'ROW', 'BAZAAR'],
  entertainment:      ['WALK', 'GARDENS', 'QUARTER', 'CIRCUS', 'ARCADE'],
  excluded:           [...SUFFIXES_SLUM, 'YARD', 'CLOSE'],
  slum:               SUFFIXES_SLUM,
  agricultural:       SUFFIXES_AGRI,
};

/**
 * Pick a procedural medieval name for a block whose district type is `role`.
 *
 * Same shape as the private `generateBlockName` (prefix + optional space +
 * suffix, up to 12 retries, `DISTRICT N` fallback) but keyed on `DistrictType`
 * so Phase 6 `_blocksNew` blocks get district-appropriate flavour names.
 *
 * @param role  - District type that selects the suffix list.
 * @param rng   - Seeded PRNG; caller owns the stream.
 * @param used  - Set of already-used names; updated in-place on success.
 * @param index - Block index used only in the `DISTRICT N` fallback.
 */
export function pickProceduralName(
  role: DistrictType,
  rng: () => number,
  used: Set<string>,
  index: number,
): string {
  const suffixes = SUFFIXES_DISTRICT[role];
  for (let attempt = 0; attempt < NAME_MAX_ATTEMPTS; attempt++) {
    const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const suffix = suffixes[Math.floor(rng() * suffixes.length)];
    const joiner = rng() < NAME_SPACE_JOINER_PROB ? ' ' : '';
    const name = prefix + joiner + suffix;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `DISTRICT ${index + 1}`;
  used.add(fallback);
  return fallback;
}

/**
 * Build `CityBlockNewV2[]` by flood-filling the polygon adjacency graph and
 * grouping polygons that share the same `DistrictType` into connected
 * components. Each component becomes one named block.
 *
 * Water and unabsorbed-mountain polygons are skipped entirely: they carry the
 * sentinel district `'residential_medium'` from `assignDistricts` and must
 * not appear in any block.
 *
 * Called in `cityMapGeneratorV2.ts` after `assignDistricts`. Output lands in
 * `_blocksNew` on the return literal; `generateBuildings` and `generateSprawl`
 * consume it in Phase 6, and Phase 7 promotes it over `blocks`.
 */
export function buildBlocksFromDistricts(
  seed: string,
  cityName: string,
  polygons: CityPolygon[],
  districtsNew: DistrictType[],
  waterPolygonIds: Set<number>,
  mountainPolygonIds: Set<number>,
): CityBlockNewV2[] {
  if (polygons.length < 4 || districtsNew.length === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_blocks_districts_names`);
  const usedNames = new Set<string>();
  const visited = new Set<number>();
  const blocks: CityBlockNewV2[] = [];

  for (let startId = 0; startId < polygons.length; startId++) {
    if (visited.has(startId)) continue;
    if (waterPolygonIds.has(startId) || mountainPolygonIds.has(startId)) {
      visited.add(startId);
      continue;
    }

    const role = districtsNew[startId];
    const component: number[] = [];
    const queue: number[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const nb of polygons[curr].neighbors) {
        if (visited.has(nb)) continue;
        if (waterPolygonIds.has(nb) || mountainPolygonIds.has(nb)) {
          visited.add(nb);
          continue;
        }
        if (districtsNew[nb] === role) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    blocks.push({
      polygonIds: component,
      role,
      name: pickProceduralName(role, rng, usedNames, blocks.length),
    });
  }

  return blocks;
}
