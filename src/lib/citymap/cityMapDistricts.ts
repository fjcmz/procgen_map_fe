// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Phase 5 of specs/City_districts_redux.md
// District classifier: turns the unified landmark output + city geometry into
// a per-polygon `DistrictType[]`. Output lives on `CityMapDataV2._districtsNew`
// and is ignored by the renderer until Phase 7 promotes it over `blocks`.
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Phase 5 entry points:
//
//   • `placeSlumClusters(seed, cityName, env, polygons, wall, water, mountain)`
//       Identifies up to 1 (or 2 for megalopolis at 25%) exterior polygon
//       clusters that satisfy "BFS diameter ≤ 10, far from canvas center".
//       Returns the union of selected cluster polygon ids as `Set<number>`.
//
//   • `assignDistricts(seed, cityName, env, polygons, wall, landmarksNew,
//                       waterPolygonIds, mountainPolygonIds, river, canvasSize)`
//       Phase 5b ships this as a no-op stub returning
//       `Array(polygons.length).fill('residential_medium')`. Phase 5c fills
//       the body — water/mountain skip → exterior → agricultural → slum
//       overlay → multi-source BFS from non-park landmarks → composite
//       wealth tertile reclassifies residential into high/medium/low.
//
// Conventions (mirrors every other V2 generator file):
//   • All RNG via `seededPRNG`. Sub-stream: `${seed}_city_${cityName}_districts_slums`.
//   • Polygon-graph traversal only (`polygon.neighbors`). No edge-graph A*.
//   • File-local geometric / BFS helpers (no shared module across V2 slices —
//     each slice owns its primitives, matching `cityMapLandmarks.ts` /
//     `cityMapOpenSpaces.ts` / `cityMapSprawl.ts`).
//
// Reference patterns:
//   • `cityMapCandidatePool.ts:38-55`  — multi-source BFS over `polygon.neighbors`.
//   • `cityMapBlocks.ts:233-256`       — connected-component flood (barrier-edge
//                                        logic dropped; slums use polygon adjacency).
//   • `cityMapBlocks.ts:386-442`       — `pickDockPolygons` BFS-from-shore pattern
//                                        (Phase 5c will mirror this for the dock pass).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityEnvironment,
  CityPolygon,
  CitySize,
  DistrictType,
  LandmarkKind,
  LandmarkV2,
} from './cityMapTypesV2';
import type { WallGenerationResult } from './cityMapWalls';
import type { RiverGenerationResult } from './cityMapRiver';

// ─── Slum cluster tuning ────────────────────────────────────────────────────

/**
 * Maximum BFS diameter (longest shortest path between two cluster nodes, in
 * polygon hops) for an exterior cluster to qualify as a slum candidate.
 * Spec line 56: "≤10-polygon BFS diameter".
 */
const SLUM_MAX_DIAMETER = 10;

/**
 * Probability of emitting a second slum cluster when `env.size === 'megalopolis'`.
 * Spec line 56: "megalopolis 25% second cluster".
 */
const MEGALOPOLIS_SECOND_SLUM_PROB = 0.25;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Identify exterior polygon clusters that should be tagged as `slum` by the
 * district classifier. Returns the union of selected cluster polygon ids.
 *
 * Algorithm:
 *   1. Build the exterior set: polygons not in `wall.interiorPolygonIds`,
 *      minus water and mountain polygons.
 *   2. Connected-component BFS over `polygon.neighbors` (restricted to the
 *      exterior set) → list of clusters.
 *   3. For each cluster, compute its BFS diameter via two-pass BFS. Drop
 *      clusters with diameter > `SLUM_MAX_DIAMETER`.
 *   4. Sort surviving clusters by farthest-from-canvas-center first; stable
 *      polygon-id tie-break (by min cluster id).
 *   5. Take the top 1 cluster. For megalopolis only, roll
 *      `MEGALOPOLIS_SECOND_SLUM_PROB` and add the second-ranked cluster if
 *      it exists. (Distinct connected components are inherently
 *      Delaunay-disconnected — no extra check needed.)
 *
 * Returns the union of selected clusters as `Set<number>`. May be empty for
 * degenerate inputs (no exterior, or every cluster fails the diameter cap).
 */
export function placeSlumClusters(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  wall: WallGenerationResult,
  waterPolygonIds: Set<number>,
  mountainPolygonIds: Set<number>,
  canvasSize: number,
): Set<number> {
  const interior = wall.interiorPolygonIds;

  // [Voronoi-polygon] Eligible exterior set: not interior, not water, not
  // mountain. Polygons with no eligible neighbors will end up as singleton
  // clusters and naturally fail the "non-trivial slum" filter through their
  // tiny diameter, but we keep them in the pool so they can still be picked
  // for tiny-fringe cities.
  const exterior = new Set<number>();
  for (const p of polygons) {
    if (interior.has(p.id)) continue;
    if (waterPolygonIds.has(p.id)) continue;
    if (mountainPolygonIds.has(p.id)) continue;
    exterior.add(p.id);
  }
  if (exterior.size === 0) return new Set<number>();

  // [Voronoi-polygon] Connected-component flood over `polygon.neighbors`,
  // restricted to the exterior set. Same shape as `cityMapBlocks.ts:233-256`
  // with the barrier-edge logic dropped — slums respect polygon adjacency
  // only, not infrastructure.
  const visited = new Set<number>();
  const clusters: number[][] = [];
  for (const startId of exterior) {
    if (visited.has(startId)) continue;
    const cluster: number[] = [];
    const queue: number[] = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift()!;
      cluster.push(id);
      for (const nb of polygons[id].neighbors) {
        if (!exterior.has(nb)) continue;
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
      }
    }
    clusters.push(cluster);
  }

  // [Voronoi-polygon] Filter by BFS diameter. Two-pass BFS: pick any node
  // (smallest id for determinism), BFS to find the farthest node A; then BFS
  // from A — the maximum distance reached is the diameter. For non-tree
  // graphs this is a lower bound on the true diameter, but it's the standard
  // approximation and good enough for "is the cluster compact enough?".
  const candidates: { ids: number[]; centroid: [number, number]; minId: number }[] = [];
  for (const cluster of clusters) {
    if (clusterBfsDiameter(cluster, polygons, exterior) > SLUM_MAX_DIAMETER) continue;
    candidates.push({
      ids: cluster,
      centroid: clusterCentroid(cluster, polygons),
      minId: Math.min(...cluster),
    });
  }
  if (candidates.length === 0) return new Set<number>();

  // [Voronoi-polygon] Sort by distance-from-canvas-center descending (farthest
  // first), polygon-id tie-break for determinism. Spec line 56: "far from
  // center".
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  candidates.sort((a, b) => {
    const da = Math.hypot(a.centroid[0] - cx, a.centroid[1] - cy);
    const db = Math.hypot(b.centroid[0] - cx, b.centroid[1] - cy);
    if (db !== da) return db - da;
    return a.minId - b.minId;
  });

  const picked = new Set<number>();
  for (const id of candidates[0].ids) picked.add(id);

  // [Voronoi-polygon] Megalopolis-only: 25% chance of a second cluster.
  // Distinct connected components are Delaunay-disconnected by construction.
  if (env.size === 'megalopolis' && candidates.length >= 2) {
    const rng = seededPRNG(`${seed}_city_${cityName}_districts_slums`);
    if (rng() < MEGALOPOLIS_SECOND_SLUM_PROB) {
      for (const id of candidates[1].ids) picked.add(id);
    }
  }

  return picked;
}

// ─── Dock pass tuning ───────────────────────────────────────────────────────
// Mirrors `cityMapBlocks.ts:91-99`. Constants duplicated rather than shared so
// `cityMapDistricts.ts` stays self-contained — same convention as every other
// V2 slice (`cityMapBuildings.ts` / `cityMapSprawl.ts` duplicate their own
// polygon-interior helpers, etc.).

const DOCK_ELIGIBLE_SIZES: ReadonlySet<CitySize> = new Set<CitySize>([
  'large', 'metropolis', 'megalopolis',
]);
const DOCK_MAX_FRACTION_OF_CITY = 0.10;
const DOCK_MAX_DEPTH = 3;

// ─── Harbor pass tuning ─────────────────────────────────────────────────────
// Mirrors `cityMapBlocks.ts:84` — `HARBOR_BAND_FRACTION = 0.30`. A polygon
// site within `canvasSize × HARBOR_BAND_FRACTION` of the matching `waterSide`
// edge qualifies as a harbor candidate. Harbor never overrides civic / market
// / industry / military / etc.; it only fills the sentinel.
const HARBOR_BAND_FRACTION = 0.30;

// ─── Landmark BFS tuning ────────────────────────────────────────────────────
/**
 * Cap on hop distance the multi-source BFS from non-park landmarks may
 * propagate. Without a cap, a single landmark in a tightly-connected interior
 * would paint every polygon in the city; the cap leaves "background"
 * polygons for the wealth-scoring tertile to handle.
 */
const LANDMARK_BFS_MAX_HOPS = 4;

// ─── Wealth-score weights ───────────────────────────────────────────────────
// Composite-score coefficients used in step 8. Tertile bucketing only cares
// about relative ordering, so absolute values are not load-bearing — change
// freely if the histogram skews.

const WEALTH_W_POS_LANDMARK = 0.40;
const WEALTH_W_NEG_LANDMARK = 0.30;
const WEALTH_W_EDGE = 0.15;
const WEALTH_W_CENTER = 0.15;
// Falloff "reach" in polygon hops for proximity terms. Beyond this distance
// the contribution clamps to 0.
const WEALTH_REACH_HOPS = 8;

// ─── Landmark-kind → district-type mapping ──────────────────────────────────
/**
 * Drives the multi-source BFS in `assignDistricts` step 6. Exhaustive
 * `Record<LandmarkKind, DistrictType | null>` so a future Phase that adds a
 * `LandmarkKind` without updating this table is a compile-time error
 * (mirrors `LANDMARK_ALIGNMENT` in `cityMapLandmarksUnified.ts:56-96`).
 *
 * Park is intentionally `null` — park-cluster polygons are not BFS seeds.
 * They still receive a district from neighbouring seeds via the BFS; if no
 * seed reaches them they fall through to the wealth-scoring residential
 * tertile, which is the spec's "Park polygons stay park" interpretation
 * after the user's Phase 1-park-discrepancy resolution (no `park` district).
 */
const LANDMARK_KIND_TO_DISTRICT: Record<LandmarkKind, DistrictType | null> = {
  // Phase 3 named — wonders and government anchors → civic
  wonder: 'civic',
  palace: 'civic',
  civic_square: 'civic',
  // Castles are fortified strongholds — military-anchor flavor
  castle: 'military',
  // Temples and faith aux → education_faith
  temple: 'education_faith',
  // Markets seed market districts directly
  market: 'market',
  // Parks are not BFS seeds (see header note above)
  park: null,
  // Phase 4 industrial group
  forge: 'industry',
  tannery: 'industry',
  textile: 'industry',
  potters: 'industry',
  mill: 'industry',
  // Phase 4 military group
  barracks: 'military',
  citadel: 'military',
  arsenal: 'military',
  watchmen: 'military',
  // Phase 4 faith aux group
  temple_quarter: 'education_faith',
  necropolis: 'education_faith',
  plague_ward: 'education_faith',
  academia: 'education_faith',
  archive: 'education_faith',
  // Phase 4 entertainment group
  theater: 'entertainment',
  bathhouse: 'entertainment',
  pleasure: 'entertainment',
  festival: 'entertainment',
  // Phase 4 trade group
  foreign_quarter: 'trade',
  caravanserai: 'trade',
  bankers_row: 'trade',
  warehouse: 'trade',
  // Phase 4 excluded group
  gallows: 'excluded',
  workhouse: 'excluded',
  ghetto_marker: 'excluded',
};

/** Wealth scoring treats these as positive proximity sources. */
const POSITIVE_DISTRICTS: ReadonlySet<DistrictType> = new Set<DistrictType>([
  'civic', 'market', 'education_faith',
]);

/** Wealth scoring treats these as negative proximity sources. */
const NEGATIVE_DISTRICTS: ReadonlySet<DistrictType> = new Set<DistrictType>([
  'slum', 'excluded',
]);

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Classify every polygon in the city into a `DistrictType`. Pipeline:
 *
 *   1. Allocate `out: DistrictType[]` of length `polygons.length`, all
 *      polygons start at sentinel `'residential_medium'` and unassigned.
 *   2. Water / unabsorbed-mountain polygons stay at the sentinel and remain
 *      unassigned. Phase 6 PACKING_ROLES filters them via
 *      `waterPolygonIds` / `mountainPolygonIds` independently, so the
 *      sentinel never reaches the renderer.
 *   3. Exterior pass: every non-water, non-mountain polygon outside
 *      `wall.interiorPolygonIds` → `'agricultural'`.
 *   4. Slum overlay: polygons returned by `placeSlumClusters` → `'slum'`.
 *   5. Dock pass: large+ coastal cities only — water polygons within
 *      `DOCK_MAX_DEPTH` BFS hops of the city footprint, capped at
 *      `cityPolygonCount × DOCK_MAX_FRACTION_OF_CITY`, → `'dock'`.
 *   6. Multi-source BFS from non-park landmarks (interior only, capped at
 *      `LANDMARK_BFS_MAX_HOPS` hops). Each polygon inherits the district of
 *      its nearest seed via `LANDMARK_KIND_TO_DISTRICT`.
 *   7. Harbor override: sentinel-only interior polygons within
 *      `canvasSize × HARBOR_BAND_FRACTION` of the matching `env.waterSide`
 *      canvas edge → `'harbor'`.
 *   8. Wealth scoring: every still-unassigned polygon (interior background)
 *      gets a composite score from BFS distances to positive landmark seeds,
 *      negative landmark seeds, canvas-edge polygons, and canvas-center
 *      proximity. Tertile-bucket the candidates: top → `'residential_high'`,
 *      middle → `'residential_medium'`, bottom → `'residential_low'`.
 *   9. Park polygons (cluster polygons from `landmarksNew` where
 *      `kind === 'park'`) inherit whatever steps 6–8 assigned them. Phase 7's
 *      renderer overlays park glyphs via `LandmarkV2.kind === 'park'`.
 */
export function assignDistricts(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  wall: WallGenerationResult,
  landmarksNew: LandmarkV2[],
  waterPolygonIds: Set<number>,
  mountainPolygonIds: Set<number>,
  _river: RiverGenerationResult | null,
  canvasSize: number,
  cityPolygonCount: number,
): DistrictType[] {
  const n = polygons.length;
  const out = new Array<DistrictType>(n).fill('residential_medium');
  const assigned = new Array<boolean>(n).fill(false);

  const interior = wall.interiorPolygonIds;

  // ── Step 3: exterior agricultural ───────────────────────────────────────
  for (const p of polygons) {
    if (waterPolygonIds.has(p.id)) continue;
    if (mountainPolygonIds.has(p.id)) continue;
    if (interior.has(p.id)) continue;
    out[p.id] = 'agricultural';
    assigned[p.id] = true;
  }

  // ── Step 4: slum overlay ────────────────────────────────────────────────
  const slumPolygonIds = placeSlumClusters(
    seed, cityName, env, polygons, wall,
    waterPolygonIds, mountainPolygonIds, canvasSize,
  );
  for (const pid of slumPolygonIds) {
    out[pid] = 'slum';
    assigned[pid] = true;
  }

  // ── Step 5: dock pass (large+ coastal only) ─────────────────────────────
  if (
    DOCK_ELIGIBLE_SIZES.has(env.size)
    && waterPolygonIds.size > 0
    && cityPolygonCount > 0
  ) {
    const dockBudget = Math.floor(cityPolygonCount * DOCK_MAX_FRACTION_OF_CITY);
    if (dockBudget > 0) {
      const dockIds = pickDockPolygonIds(polygons, waterPolygonIds, interior, dockBudget);
      for (const pid of dockIds) {
        out[pid] = 'dock';
        assigned[pid] = true;
      }
    }
  }

  // ── Step 6: multi-source BFS from non-park landmarks ────────────────────
  // [Voronoi-polygon] Build a seed map from `landmarksNew`. Park anchors are
  // skipped (kind → null in `LANDMARK_KIND_TO_DISTRICT`). The BFS is
  // restricted to interior polygons — exterior districts (agricultural,
  // slum) are already locked in by steps 3-4.
  const seedDistricts = new Map<number, DistrictType>();
  for (const lm of landmarksNew) {
    const district = LANDMARK_KIND_TO_DISTRICT[lm.kind];
    if (district === null) continue;
    if (!interior.has(lm.polygonId)) continue;
    // Only set if not already locked by earlier passes (slum/dock can't
    // overlap interior, but this guards future re-orderings).
    if (assigned[lm.polygonId]) continue;
    // First-write wins on conflicts (named placers run first; their kinds
    // claim the polygon if multiple landmarks somehow share an id — should
    // not happen given the placer's `used` set).
    if (!seedDistricts.has(lm.polygonId)) {
      seedDistricts.set(lm.polygonId, district);
    }
  }
  if (seedDistricts.size > 0) {
    const { distance, district } = multiSourceBfs(
      polygons, interior, seedDistricts, LANDMARK_BFS_MAX_HOPS,
    );
    for (let pid = 0; pid < n; pid++) {
      if (assigned[pid]) continue;
      const d = district[pid];
      if (d === null) continue;
      // Within hop cap → adopt the seed's district. Beyond the cap → leave
      // for the wealth pass.
      if (distance[pid] <= LANDMARK_BFS_MAX_HOPS) {
        out[pid] = d;
        assigned[pid] = true;
      }
    }
  }

  // ── Step 7: harbor override on remaining interior polygons ──────────────
  if (env.isCoastal && env.waterSide) {
    const band = canvasSize * HARBOR_BAND_FRACTION;
    for (const p of polygons) {
      if (assigned[p.id]) continue;
      if (!interior.has(p.id)) continue;
      if (waterPolygonIds.has(p.id)) continue;
      if (mountainPolygonIds.has(p.id)) continue;
      const [x, y] = p.site;
      let inBand = false;
      switch (env.waterSide) {
        case 'north': inBand = y < band; break;
        case 'south': inBand = y > canvasSize - band; break;
        case 'west':  inBand = x < band; break;
        case 'east':  inBand = x > canvasSize - band; break;
      }
      if (inBand) {
        out[p.id] = 'harbor';
        assigned[p.id] = true;
      }
    }
  }

  // ── Step 8: wealth scoring → residential tertile ────────────────────────
  // [Voronoi-polygon] Compute three multi-source BFS distance maps:
  //   (a) distance to nearest POSITIVE-district polygon (civic/market/edu)
  //   (b) distance to nearest NEGATIVE-district polygon (slum/excluded)
  //   (c) distance to nearest `polygon.isEdge` polygon
  // BFS is unrestricted (can cross interior/exterior boundary) so wealth
  // scoring captures cross-boundary effects (e.g. an interior polygon is
  // poorer if a slum cluster is close on the exterior side of the wall).
  const positiveSources = new Set<number>();
  const negativeSources = new Set<number>();
  for (let pid = 0; pid < n; pid++) {
    if (POSITIVE_DISTRICTS.has(out[pid])) positiveSources.add(pid);
    if (NEGATIVE_DISTRICTS.has(out[pid])) negativeSources.add(pid);
  }
  const edgeSources = new Set<number>();
  for (const p of polygons) {
    if (p.isEdge) edgeSources.add(p.id);
  }
  const distPositive = multiSourceDistance(polygons, positiveSources);
  const distNegative = multiSourceDistance(polygons, negativeSources);
  const distEdge = multiSourceDistance(polygons, edgeSources);

  // Composite-score every still-unassigned polygon (residual interior).
  // Water and mountain polygons stay at the sentinel and are not candidates.
  type WealthCandidate = { id: number; score: number };
  const candidates: WealthCandidate[] = [];
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const halfDiag = Math.hypot(cx, cy);
  for (const p of polygons) {
    if (assigned[p.id]) continue;
    if (waterPolygonIds.has(p.id)) continue;
    if (mountainPolygonIds.has(p.id)) continue;
    const [x, y] = p.site;
    const a = proximityFalloff(distPositive[p.id]);
    const b = proximityFalloff(distNegative[p.id]);
    const e = proximityFalloff(distEdge[p.id]);
    const c = 1 - Math.hypot(x - cx, y - cy) / halfDiag;
    const score = WEALTH_W_POS_LANDMARK * a
                - WEALTH_W_NEG_LANDMARK * b
                - WEALTH_W_EDGE * e
                + WEALTH_W_CENTER * c;
    candidates.push({ id: p.id, score });
  }

  // Sort by score descending, polygon-id tie-break for determinism.
  candidates.sort((a, b) => (b.score - a.score) || (a.id - b.id));

  // Tertile-bucket: top third → high, middle → medium, bottom → low.
  const total = candidates.length;
  if (total > 0) {
    const oneThird = Math.floor(total / 3);
    const twoThirds = Math.floor((2 * total) / 3);
    for (let i = 0; i < total; i++) {
      const pid = candidates[i].id;
      let district: DistrictType;
      if (i < oneThird) district = 'residential_high';
      else if (i < twoThirds) district = 'residential_medium';
      else district = 'residential_low';
      out[pid] = district;
      assigned[pid] = true;
    }
  }

  return out;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Two-pass BFS diameter on a polygon-id cluster, traversing `polygon.neighbors`
 * but staying inside `eligibleSet` (so the same helper works for exterior /
 * interior / hybrid clusters in Phase 5c). Returns the longest shortest path
 * length in polygon hops; 0 for a singleton cluster.
 */
function clusterBfsDiameter(
  cluster: number[],
  polygons: CityPolygon[],
  eligibleSet: Set<number>,
): number {
  if (cluster.length <= 1) return 0;
  const seed = Math.min(...cluster);
  const farthestFromSeed = bfsFarthest(seed, polygons, eligibleSet);
  return bfsFarthest(farthestFromSeed.id, polygons, eligibleSet).distance;
}

/**
 * BFS from `startId` over `polygon.neighbors`, restricted to `eligibleSet`.
 * Returns the farthest reachable polygon id and its distance in hops. Stable
 * tie-break on lowest polygon id (so seed selection is deterministic).
 */
function bfsFarthest(
  startId: number,
  polygons: CityPolygon[],
  eligibleSet: Set<number>,
): { id: number; distance: number } {
  const dist = new Map<number, number>();
  dist.set(startId, 0);
  const queue: number[] = [startId];
  let head = 0;
  let bestId = startId;
  let bestDist = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = dist.get(id)!;
    if (d > bestDist || (d === bestDist && id < bestId)) {
      bestDist = d;
      bestId = id;
    }
    for (const nb of polygons[id].neighbors) {
      if (!eligibleSet.has(nb)) continue;
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }
  return { id: bestId, distance: bestDist };
}

/**
 * Mean `polygon.site` over the cluster. Used for the "far from canvas center"
 * sort. Mirrors `blockCentroid` in `cityMapBlocks.ts:551-561`.
 */
function clusterCentroid(cluster: number[], polygons: CityPolygon[]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const pid of cluster) {
    const [x, y] = polygons[pid].site;
    sx += x;
    sy += y;
  }
  const n = cluster.length;
  return [sx / n, sy / n];
}

/**
 * Pick water polygons to become docks. Eligibility:
 *   - polygon must be within `DOCK_MAX_DEPTH` BFS hops from the shoreline
 *     (interior-adjacent water polygons = depth 1, each step deeper adds 1)
 *   - depth-1 polygons are preferred; deeper ones fill remaining budget
 * Shallower (closer to shore) polygons rank first; ties broken by id.
 *
 * Mirrors `pickDockPolygons` in `cityMapBlocks.ts:386-442`. Re-implemented
 * locally to keep `cityMapDistricts.ts` self-contained — same convention
 * every other V2 slice follows for polygon-interior helpers.
 */
function pickDockPolygonIds(
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

/**
 * Multi-source BFS over `polygon.neighbors`, restricted to `interior` set,
 * propagating district types from a seed map. For each polygon reached
 * within `maxHops` hops, record the closest seed's district and the hop
 * distance. Polygons not reached carry `district[i] = null` and
 * `distance[i] = Infinity`.
 *
 * Ties on hop distance are broken by polygon-id (smaller id wins) — same
 * deterministic seed-stable convention as `cityMapCandidatePool.ts`.
 */
function multiSourceBfs(
  polygons: CityPolygon[],
  interior: Set<number>,
  seeds: Map<number, DistrictType>,
  maxHops: number,
): { distance: number[]; district: (DistrictType | null)[] } {
  const n = polygons.length;
  const distance = new Array<number>(n).fill(Infinity);
  const district = new Array<DistrictType | null>(n).fill(null);

  // Seed the queue. Iterate keys in ascending polygon-id order so
  // tie-breaks are deterministic when two seeds reach the same neighbor at
  // the same hop count.
  const seedIds = [...seeds.keys()].sort((a, b) => a - b);
  const queue: number[] = [];
  for (const pid of seedIds) {
    distance[pid] = 0;
    district[pid] = seeds.get(pid)!;
    queue.push(pid);
  }

  let head = 0;
  while (head < queue.length) {
    const pid = queue[head++];
    const d = distance[pid];
    if (d >= maxHops) continue;
    for (const nb of polygons[pid].neighbors) {
      if (!interior.has(nb)) continue;
      if (distance[nb] !== Infinity) continue; // first-touch wins (lowest seed id by queue order)
      distance[nb] = d + 1;
      district[nb] = district[pid];
      queue.push(nb);
    }
  }

  return { distance, district };
}

/**
 * Multi-source unrestricted BFS over `polygon.neighbors`. Returns hop
 * distance from each polygon to the nearest source. Source polygons get
 * distance 0; polygons unreachable from any source get `Infinity`. No
 * eligibility filter — the BFS crosses interior / exterior / water /
 * mountain freely (used for wealth scoring's "distance to nearest
 * positive/negative landmark / canvas edge" terms).
 */
function multiSourceDistance(
  polygons: CityPolygon[],
  sources: Set<number>,
): number[] {
  const n = polygons.length;
  const distance = new Array<number>(n).fill(Infinity);
  if (sources.size === 0) return distance;

  // Iterate sources in ascending polygon-id order for determinism.
  const sourceIds = [...sources].sort((a, b) => a - b);
  const queue: number[] = [];
  for (const pid of sourceIds) {
    distance[pid] = 0;
    queue.push(pid);
  }

  let head = 0;
  while (head < queue.length) {
    const pid = queue[head++];
    const d = distance[pid];
    for (const nb of polygons[pid].neighbors) {
      if (distance[nb] !== Infinity) continue;
      distance[nb] = d + 1;
      queue.push(nb);
    }
  }

  return distance;
}

/**
 * Linear-falloff proximity contribution given a hop distance. `distance = 0`
 * yields 1; `distance >= WEALTH_REACH_HOPS` yields 0; in between it scales
 * linearly. Inputs of `Infinity` (unreached) collapse to 0.
 */
function proximityFalloff(distance: number): number {
  if (!isFinite(distance)) return 0;
  if (distance >= WEALTH_REACH_HOPS) return 0;
  return 1 - distance / WEALTH_REACH_HOPS;
}
