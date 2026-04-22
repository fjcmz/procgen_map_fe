// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — landmarks (PR 4 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module lands the "landmarks" slice of the spec's PR 4 (line 66):
//
//   "capital castle-or-palace (small capital → one, large+ → both),
//    religionCount temples, wonderCount monuments, placed on civic/market
//    tiles with de-dup."
//
// Polygon-graph translation of that one spec sentence:
//
//   LANDMARK  := a single `CityLandmarkV2` anchored to one `CityPolygon.id`,
//                sourced from a pool of polygon IDs derived from blocks
//                whose role is `civic` or `market`. A shared `used:Set<number>`
//                across all three placement passes enforces de-dup so no
//                polygon ever carries two landmarks.
//
// Three ordered passes — order matters because each pass consumes polygons
// from the shared pool:
//
//   1. Capitals — only runs when `env.isCapital === true`. Small / medium
//                 capitals get ONE of {castle, palace} via a single RNG coin
//                 flip. Large / metropolis / megalopolis capitals get BOTH.
//                 Anchored to the civic polygon(s) nearest canvas center.
//
//   2. Temples — one per `env.religionCount`. Random pick from the full
//                `civicAndMarket` pool (block-scoped, broad).
//
//   3. Monuments — one per `env.wonderCount`. Hybrid pool matching V1
//                  `cityMapGenerator.ts:1126-1138`: openSpaces civic+market
//                  polygons FIRST, then civicAndMarket block polygons. The
//                  V1 concat intentionally duplicates square polygons that
//                  also appear in their containing block, giving them ~2×
//                  random-pick weight — we preserve that weighting so
//                  monuments cluster near plaza centers.
//
// Every placement decision references one of these `CityPolygon` primitives:
//   • `polygon.id`         — output identity (`CityLandmarkV2.polygonId`)
//   • `polygon.site`       — distance-from-center sort for capital anchoring
//
// The renderer (cityMapRendererV2.ts Layer 12) additionally reads
// `polygon.area` to scale glyphs — no area lookup needed here at gen time.
//
// No tile lattice. No `Math.random`. RNG: three dedicated sub-streams so
// future landmark kinds can be inserted without shifting existing seeds:
//   • `${seed}_city_${cityName}_landmarks_capitals`   (small-capital coin flip)
//   • `${seed}_city_${cityName}_landmarks_temples`    (per-religion pick)
//   • `${seed}_city_${cityName}_landmarks_monuments`  (per-wonder pick)
//
// Output type — frozen since PR 1 (`cityMapTypesV2.ts:85-88`):
//   { polygonId: number; type: 'castle' | 'palace' | 'temple' | 'monument' }[]
//
// Reference patterns:
//   • cityMapOpenSpaces.ts        — multi-sub-stream RNG naming + polygon pools
//   • cityMapBlocks.ts            — role-filtered iteration over blocks
//   • cityMapGenerator.ts:1066-1142 — V1 landmark placement algorithm (tile-
//                                      based; the tile flood is discarded,
//                                      the three-pass placement shape carries
//                                      over verbatim).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
} from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';

type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

// Which size tiers receive BOTH castle and palace on capital cities. Mirrors
// V1 `cityMapGenerator.ts:1096-1100` `bigEnough` check.
const CAPITAL_LARGE_SIZES: ReadonlySet<CitySize> = new Set<CitySize>([
  'large',
  'metropolis',
  'megalopolis',
]);

/**
 * Generate the city's landmarks (castle / palace / temple / monument).
 *
 * Polygon-graph algorithm in three ordered passes (capitals → temples →
 * monuments), sharing one `used:Set<number>` for de-duplication. Returns
 * `[]` on degenerate input (no blocks). Otherwise returns zero or more
 * `CityLandmarkV2` entries, each anchored to exactly one `CityPolygon.id`.
 *
 * Wired into `cityMapGeneratorV2.ts` AFTER `generateBlocks` so the role-
 * filtered candidate pools (civic / market) are already computed.
 */
// Spec: "Mountain polygons are 5 times more prone to having a temple or a
// landmark." Temple and monument candidate pools concat each mountain
// polygon id MOUNTAIN_LANDMARK_WEIGHT times so its random-pick probability
// multiplies by the same factor. Capitals (castle / palace) still anchor
// to civic polygons near canvas center — they do not migrate to mountain
// peaks because the spec requires them on central civic blocks.
const MOUNTAIN_LANDMARK_WEIGHT = 5;

export function generateLandmarks(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: OpenSpaceEntry[],
  canvasSize: number,
  mountainPolygonIds?: Set<number>,
): CityLandmarkV2[] {
  if (blocks.length === 0) return [];
  const mountains = mountainPolygonIds ?? new Set<number>();

  // ── Build candidate pools from block roles ───────────────────────────────
  // [Voronoi-polygon] Matches V1's `civicBlocks.flatMap(b => b.tiles)` shape
  // (`cityMapGenerator.ts:1092-1093`) but over polygon IDs instead of tile
  // coordinates. Blocks are partitioned across every polygon (no polygon
  // appears in two blocks — see `cityMapBlocks.ts` flood-fill guarantee), so
  // the pools have no duplicate IDs within themselves.
  const civicPool: number[] = [];
  const marketPool: number[] = [];
  for (const block of blocks) {
    if (block.role === 'civic') {
      for (const pid of block.polygonIds) civicPool.push(pid);
    } else if (block.role === 'market') {
      for (const pid of block.polygonIds) marketPool.push(pid);
    }
  }
  // Order mirrors V1's `[civic..., market...]` concatenation
  // (`cityMapGenerator.ts:1113-1116`). Preserves the monument hybrid-pool
  // weighting described in pass 3 below.
  const civicAndMarket: number[] = [...civicPool, ...marketPool];

  // [Voronoi-polygon] Mountain polygons — weighted 5× for temple + monument
  // pools so mountaintop shrines / peak-crowning monuments read as a common
  // outcome when the city sits next to a range. Repeating each id
  // MOUNTAIN_LANDMARK_WEIGHT times in the candidate array gives the pick
  // probability a factor-of-N boost without changing the uniform-random
  // RNG recipe. An exterior filter would bias the result toward absorbed
  // mountain polygons; we deliberately skip that check so the weighting
  // covers the whole mountain range, not just the foothills blocks
  // absorbed into the city.
  const mountainWeighted: number[] = [];
  if (mountains.size > 0) {
    const sorted = Array.from(mountains).sort((a, b) => a - b);
    for (const pid of sorted) {
      for (let i = 0; i < MOUNTAIN_LANDMARK_WEIGHT; i++) {
        mountainWeighted.push(pid);
      }
    }
  }

  // `used` is the single dedup set shared across all three passes. A polygon
  // that hosts the castle can never also host a temple or monument.
  const used = new Set<number>();
  const landmarks: CityLandmarkV2[] = [];

  // ── Pass 1: capital castle/palace ────────────────────────────────────────
  // [Voronoi-polygon] Sort the civic pool by squared distance from canvas
  // center (`polygon.site` vs. `(canvasSize/2, canvasSize/2)`) so the
  // capital anchors to the most-central civic polygon(s). Stable id
  // tie-break so equidistant sites resolve identically across runs.
  // Mirrors V1 `byDistanceToCenter` at `cityMapGenerator.ts:1085-1090`.
  if (env.isCapital && civicPool.length > 0) {
    const capitalRng = seededPRNG(`${seed}_city_${cityName}_landmarks_capitals`);
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const sortedCivic = civicPool.slice().sort((a, b) => {
      const [ax, ay] = polygons[a].site;
      const [bx, by] = polygons[b].site;
      const da = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
      const db = (bx - cx) * (bx - cx) + (by - cy) * (by - cy);
      if (da !== db) return da - db;
      return a - b;
    });

    // Small / medium capital: ONE type via RNG coin flip. Large+: BOTH.
    const large = CAPITAL_LARGE_SIZES.has(env.size);
    const capitalTypes: ('castle' | 'palace')[] = large
      ? ['castle', 'palace']
      : [capitalRng() < 0.5 ? 'castle' : 'palace'];

    let sortedIdx = 0;
    for (const type of capitalTypes) {
      while (sortedIdx < sortedCivic.length && used.has(sortedCivic[sortedIdx])) {
        sortedIdx++;
      }
      if (sortedIdx >= sortedCivic.length) break;
      const pid = sortedCivic[sortedIdx++];
      landmarks.push({ polygonId: pid, type });
      used.add(pid);
    }
  }

  // ── Pass 2: temples (one per env.religionCount) ─────────────────────────
  // [Voronoi-polygon] Broad pool = civic+market block polygons + mountain
  // polygons (each mountain repeated MOUNTAIN_LANDMARK_WEIGHT times for a
  // 5× pick boost, per spec), minus anything already used by the capital
  // pass. Random pick per religion, dropping the chosen polygon into
  // `used` so the next iteration re-filters.
  const templePool = [...civicAndMarket, ...mountainWeighted];
  if (env.religionCount > 0 && templePool.length > 0) {
    const templeRng = seededPRNG(`${seed}_city_${cityName}_landmarks_temples`);
    for (let i = 0; i < env.religionCount; i++) {
      const candidates = filterUnused(templePool, used);
      if (candidates.length === 0) break;
      const pid = candidates[Math.floor(templeRng() * candidates.length)];
      landmarks.push({ polygonId: pid, type: 'temple' });
      used.add(pid);
    }
  }

  // ── Pass 3: monuments (one per env.wonderCount) ─────────────────────────
  // [Voronoi-polygon] Hybrid pool matching V1 `cityMapGenerator.ts:1126-1138`:
  // openSpaces civic+market polygons FIRST, then broader civicAndMarket
  // block polygons. The V1 concat intentionally duplicates polygons that
  // host both an openSpaces entry AND sit inside a civic/market block —
  // those polygons appear twice in the pool, giving them ~2× random-pick
  // weight. We preserve that weighting so monuments cluster near plaza
  // centers rather than drifting to the block edges.
  if (env.wonderCount > 0) {
    const squarePool: number[] = [];
    for (const entry of openSpaces) {
      if (entry.kind === 'square' || entry.kind === 'market') {
        for (const pid of entry.polygonIds) squarePool.push(pid);
      }
    }
    // Mountain polygons join the monument pool weighted 5× each so peak-
    // crowning obelisks / cairns read as a common outcome when the city
    // sits next to a range.
    const fullPool: number[] = [...squarePool, ...civicAndMarket, ...mountainWeighted];
    if (fullPool.length > 0) {
      const monumentRng = seededPRNG(`${seed}_city_${cityName}_landmarks_monuments`);
      for (let i = 0; i < env.wonderCount; i++) {
        const candidates = filterUnused(fullPool, used);
        if (candidates.length === 0) break;
        const pid = candidates[Math.floor(monumentRng() * candidates.length)];
        landmarks.push({ polygonId: pid, type: 'monument' });
        used.add(pid);
      }
    }
  }

  return landmarks;
}

// [Voronoi-polygon] Build a fresh array of polygon IDs from `source` that
// are NOT in `used`. Inlined helper so the three passes share one filter
// shape — avoids subtle divergence when future passes are added.
function filterUnused(source: number[], used: Set<number>): number[] {
  const out: number[] = [];
  for (const pid of source) {
    if (!used.has(pid)) out.push(pid);
  }
  return out;
}
