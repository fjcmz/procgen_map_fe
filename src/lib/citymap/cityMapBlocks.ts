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
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
  DistrictRole,
} from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';
import { buildEdgeOwnership, canonicalEdgeKey, type Point } from './cityMapEdgeGraph';
import type { WallGenerationResult } from './cityMapWalls';
import type { RiverGenerationResult } from './cityMapRiver';

type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

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
  for (let i = 0; i < wall.wallPath.length - 1; i++) {
    barrierEdgeKeys.add(canonicalEdgeKey(wall.wallPath[i], wall.wallPath[i + 1]));
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
  // rule. Each cluster becomes its own block so the renderer can stamp a
  // wood-plank pattern per dock. Small / medium cities don't emit docks
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
        const dockClusters = clusterAdjacentPolygons(polygons, dockPolygonIds);
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
//   - polygon must be in `water`
//   - polygon must be Delaunay-adjacent to at least one `interior` polygon
//     (city footprint) — docks touch the city, they don't float offshore
// Picks the polygons closest to the interior first so dock blocks cluster
// against the coastline (stable, deterministic — no RNG).
function pickDockPolygons(
  polygons: CityPolygon[],
  water: Set<number>,
  interior: Set<number>,
  budget: number,
): number[] {
  type Candidate = { id: number; score: number };
  const candidates: Candidate[] = [];
  for (const pid of water) {
    const poly = polygons[pid];
    if (!poly) continue;
    // Count interior neighbors — more interior neighbors = more prominent coast.
    let interiorTouches = 0;
    let landTouches = 0;
    for (const nb of poly.neighbors) {
      if (interior.has(nb)) interiorTouches++;
      if (!water.has(nb)) landTouches++;
    }
    if (interiorTouches === 0) continue; // must actually touch the city
    // Score: more interior contact ranks first; break ties by id for determinism.
    candidates.push({ id: pid, score: -interiorTouches * 10 - landTouches });
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
