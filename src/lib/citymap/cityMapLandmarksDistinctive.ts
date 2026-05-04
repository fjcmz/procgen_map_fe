// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Distinctive feature placer (megalopolis-only).
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// One distinctive feature is placed per megalopolis. The catalog defines 30
// authored mega-landmarks across six categories (5 each):
//   geographical / military / magical / entertainment / religious / extraordinary
//
// Each feature is a 20–50 polygon BFS cluster forming its own landmark. The
// catalog encodes:
//   • polygonRange:    cluster size
//   • visual:          'natural' (organic fill) or 'striking' (architectural)
//   • category:        drives district seed + character affinity
//   • fit(env):        soft 0..1 weight; multiplied with baseWeight to pick
//   • eligible(env):   optional hard gate
//   • seedPreference:  where the cluster anchors (interior / mountain / water / wall)
//
// Selection runs through one weighted draw and is biased by city fit. The
// placer mutates the shared `used: Set<number>` so subsequent quarter
// placers don't double-claim the cluster's polygons.
//
// RNG sub-streams claimed:
//   ${seed}_city_${cityName}_distinctive_select   (feature pick)
//   ${seed}_city_${cityName}_distinctive_place    (seed polygon + cluster size)
//
// Reference patterns:
//   • `cityMapLandmarksNamed.ts:360` — bfsParkCluster (model the cluster grow).
//   • `cityMapLandmarksUnified.ts:98` — PlacerContext (fixed signature).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityEnvironment,
  DistinctiveFeatureCategory,
  LandmarkKind,
  LandmarkV2,
} from './cityMapTypesV2';
import type { PlacerContext } from './cityMapLandmarksUnified';

type SeedPreference = 'interior' | 'mountain_edge' | 'water_edge' | 'wall_edge';

export interface DistinctiveFeatureSpec {
  id: LandmarkKind;
  category: DistinctiveFeatureCategory;
  displayName: string;
  /** Min/max cluster size in polygons. Final size clamped to [20, 50]. */
  polygonRange: [number, number];
  /** Visual mode for the renderer. */
  visual: 'natural' | 'striking';
  /** Soft fit score 0..1. Multiplied with baseWeight to compute pick weight. */
  fit: (env: CityEnvironment) => number;
  /** Hard eligibility gate (return false to drop entirely). */
  eligible?: (env: CityEnvironment) => boolean;
  /** Cluster seed preference; default 'interior'. */
  seedPreference?: SeedPreference;
}

const FEATURE_BASE_WEIGHT = 1;
const MIN_FEATURE_POLYGONS = 20;
const MAX_FEATURE_POLYGONS = 50;

const isMountainAdjacent = (env: CityEnvironment): boolean =>
  env.mountainDirection !== null;

// 30 features, sorted by `id` for byte-stable iteration order.
export const DISTINCTIVE_FEATURE_CATALOG: readonly DistinctiveFeatureSpec[] = [
  // ── Distinctive — extraordinary ─────────────────────────────────────────
  {
    id: 'dist_ancient_portal_ruin',
    category: 'extraordinary',
    displayName: 'The Ancient Portal Ruin',
    polygonRange: [22, 38],
    visual: 'striking',
    fit: () => 0.35,
  },
  // ── Distinctive — geographical ──────────────────────────────────────────
  {
    id: 'dist_ancient_grove',
    category: 'geographical',
    displayName: 'The Ancient Grove',
    polygonRange: [25, 45],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'TEMPERATE_DECIDUOUS_FOREST' ||
      env.biome === 'TEMPERATE_RAIN_FOREST' ||
      env.biome === 'TROPICAL_RAIN_FOREST' ||
      env.biome === 'TROPICAL_SEASONAL_FOREST'
        ? 0.9
        : env.moisture > 0.5 ? 0.5 : 0.15,
  },
  {
    id: 'dist_arcane_laboratorium',
    category: 'magical',
    displayName: 'The Arcane Laboratorium',
    polygonRange: [22, 36],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.7 : 0.4,
  },
  // ── Distinctive — military ──────────────────────────────────────────────
  {
    id: 'dist_bastion_citadel',
    category: 'military',
    displayName: 'The Bastion Citadel',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.95 : 0.45,
    seedPreference: 'wall_edge',
  },
  {
    id: 'dist_carnival_quarter',
    category: 'entertainment',
    displayName: 'The Carnival Quarter',
    polygonRange: [22, 36],
    visual: 'striking',
    fit: (env) => env.temperature > 0.5 ? 0.7 : 0.5,
  },
  {
    id: 'dist_crystal_bloom',
    category: 'extraordinary',
    displayName: 'The Crystal Bloom',
    polygonRange: [22, 40],
    visual: 'natural',
    fit: (env) => env.elevation > 0.55 ? 0.55 : 0.3,
  },
  {
    id: 'dist_eldritch_mirror_lake',
    category: 'magical',
    displayName: 'The Eldritch Mirror Lake',
    polygonRange: [22, 40],
    visual: 'natural',
    fit: (env) => env.hasRiver || env.isCoastal ? 0.7 : 0.3,
    seedPreference: 'water_edge',
  },
  // ── Distinctive — entertainment ─────────────────────────────────────────
  {
    id: 'dist_floating_spires',
    category: 'magical',
    displayName: 'The Floating Spires',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: () => 0.4,
  },
  {
    id: 'dist_geyser_field',
    category: 'geographical',
    displayName: 'The Geyser Field',
    polygonRange: [22, 38],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'TUNDRA' || env.biome === 'TAIGA' || env.biome === 'SNOW'
        ? 0.7
        : isMountainAdjacent(env) ? 0.55 : 0.2,
  },
  {
    id: 'dist_grand_colosseum',
    category: 'entertainment',
    displayName: 'The Grand Colosseum',
    polygonRange: [22, 40],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.85 : 0.55,
  },
  {
    id: 'dist_ley_convergence',
    category: 'magical',
    displayName: 'The Ley-Line Convergence',
    polygonRange: [20, 32],
    visual: 'natural',
    fit: (env) => env.wonderCount > 0 ? 0.7 : 0.35,
  },
  {
    id: 'dist_mage_tower_constellation',
    category: 'magical',
    displayName: 'The Tower Constellation',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.7 : 0.45,
  },
  {
    id: 'dist_meteor_crater',
    category: 'extraordinary',
    displayName: 'The Meteor Crater',
    polygonRange: [22, 42],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'TEMPERATE_DESERT' ||
      env.biome === 'SUBTROPICAL_DESERT' ||
      env.biome === 'TUNDRA' ||
      env.biome === 'BARE' ||
      env.biome === 'SCORCHED'
        ? 0.55 : 0.3,
    eligible: (env) => !env.isCoastal,
  },
  {
    id: 'dist_necropolis_hill',
    category: 'religious',
    displayName: 'The Necropolis Hill',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.religionCount >= 1 ? 0.7 : 0.3,
  },
  {
    id: 'dist_obsidian_wall_district',
    category: 'military',
    displayName: 'The Obsidian Wall District',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.65 : 0.4,
    seedPreference: 'wall_edge',
  },
  {
    id: 'dist_opera_quarter',
    category: 'entertainment',
    displayName: 'The Opera Quarter',
    polygonRange: [22, 36],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.75 : 0.45,
  },
  {
    id: 'dist_pantheon_of_all_gods',
    category: 'religious',
    displayName: 'The Pantheon of All Gods',
    polygonRange: [22, 38],
    visual: 'striking',
    fit: (env) => Math.min(1, env.religionCount / 3),
    eligible: (env) => env.religionCount >= 1,
  },
  {
    id: 'dist_petrified_titan',
    category: 'extraordinary',
    displayName: 'The Petrified Titan',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: () => 0.35,
  },
  {
    id: 'dist_pilgrimage_cathedral',
    category: 'religious',
    displayName: 'The Pilgrimage Cathedral',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.religionCount >= 1 ? 0.85 : 0.2,
    eligible: (env) => env.religionCount >= 1,
  },
  {
    id: 'dist_pleasure_gardens',
    category: 'entertainment',
    displayName: 'The Pleasure Gardens',
    polygonRange: [25, 50],
    visual: 'natural',
    fit: (env) => env.moisture > 0.5 ? 0.8 : 0.4,
  },
  {
    id: 'dist_royal_hippodrome',
    category: 'entertainment',
    displayName: 'The Royal Hippodrome',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.75 : 0.4,
  },
  {
    id: 'dist_shrine_labyrinth',
    category: 'religious',
    displayName: 'The Shrine Labyrinth',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) => Math.min(0.8, 0.3 + env.religionCount * 0.2),
  },
  {
    id: 'dist_siege_memorial_field',
    category: 'military',
    displayName: 'The Siege Memorial Field',
    polygonRange: [25, 45],
    visual: 'natural',
    fit: (env) => env.isCapital ? 0.55 : 0.4,
  },
  {
    id: 'dist_sinkhole_cenote',
    category: 'geographical',
    displayName: 'The Cenote',
    polygonRange: [20, 35],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'TROPICAL_RAIN_FOREST' ||
      env.biome === 'TROPICAL_SEASONAL_FOREST'
        ? 0.85
        : env.moisture > 0.55 ? 0.4 : 0.15,
  },
  {
    id: 'dist_sky_plateau',
    category: 'geographical',
    displayName: 'The Sky Plateau',
    polygonRange: [25, 45],
    visual: 'striking',
    fit: (env) =>
      isMountainAdjacent(env) ? 0.8 : env.elevation > 0.6 ? 0.5 : 0.1,
    seedPreference: 'mountain_edge',
  },
  {
    id: 'dist_time_frozen_quarter',
    category: 'extraordinary',
    displayName: 'The Time-Frozen Quarter',
    polygonRange: [22, 40],
    visual: 'striking',
    fit: () => 0.3,
  },
  {
    id: 'dist_triumphal_way',
    category: 'military',
    displayName: 'The Triumphal Way',
    polygonRange: [22, 40],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.7 : 0.35,
  },
  {
    id: 'dist_under_warrens',
    category: 'military',
    displayName: 'The Under-Warrens',
    polygonRange: [22, 40],
    visual: 'striking',
    fit: (env) => env.isCapital ? 0.55 : 0.4,
  },
  {
    id: 'dist_volcanic_caldera',
    category: 'geographical',
    displayName: 'The Volcanic Caldera',
    polygonRange: [25, 45],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'SCORCHED' || env.biome === 'BARE'
        ? 0.95
        : isMountainAdjacent(env) ? 0.45 : 0.05,
    seedPreference: 'mountain_edge',
  },
  {
    id: 'dist_world_tree_pillar',
    category: 'religious',
    displayName: 'The World Tree',
    polygonRange: [25, 45],
    visual: 'natural',
    fit: (env) =>
      env.biome === 'TEMPERATE_DECIDUOUS_FOREST' ||
      env.biome === 'TEMPERATE_RAIN_FOREST' ||
      env.biome === 'TROPICAL_RAIN_FOREST' ||
      env.biome === 'TROPICAL_SEASONAL_FOREST'
        ? 0.7
        : env.religionCount >= 1 ? 0.55 : 0.3,
  },
] as const;

/**
 * Pick a single feature by weighted random draw, biased by `fit(env)`.
 * Returns null when no feature is eligible (very rare — most have no `eligible`
 * gate). Iteration order is byte-stable thanks to the catalog's sort-by-id.
 */
function pickFeature(
  env: CityEnvironment,
  rng: () => number,
): DistinctiveFeatureSpec | null {
  const eligible: { spec: DistinctiveFeatureSpec; weight: number }[] = [];
  let total = 0;
  for (const spec of DISTINCTIVE_FEATURE_CATALOG) {
    if (spec.eligible && !spec.eligible(env)) continue;
    const fit = Math.max(0, Math.min(1, spec.fit(env)));
    const weight = FEATURE_BASE_WEIGHT * fit;
    if (weight <= 0) continue;
    eligible.push({ spec, weight });
    total += weight;
  }
  if (total <= 0 || eligible.length === 0) return null;
  let pick = rng() * total;
  for (const { spec, weight } of eligible) {
    pick -= weight;
    if (pick <= 0) return spec;
  }
  return eligible[eligible.length - 1].spec;
}

/**
 * Pick the seed polygon for the cluster, honoring `spec.seedPreference`.
 * Falls back to the centermost interior polygon when the preferred pool is
 * empty, so degenerate inputs still produce a placement.
 */
function pickSeedPolygon(
  spec: DistinctiveFeatureSpec,
  ctx: PlacerContext,
  insidePool: Set<number>,
  used: Set<number>,
  rng: () => number,
): number {
  const { polygons, wall, mountainPolygonIds, waterPolygonIds, env } = ctx;

  const eligible: number[] = [];
  for (const pid of insidePool) {
    if (used.has(pid)) continue;
    eligible.push(pid);
  }
  if (eligible.length === 0) return -1;
  eligible.sort((a, b) => a - b);

  const pref: SeedPreference = spec.seedPreference ?? 'interior';

  if (pref === 'mountain_edge') {
    const mountainAdj = eligible.filter((pid) =>
      polygons[pid].neighbors.some((nb) => mountainPolygonIds.has(nb)),
    );
    if (mountainAdj.length > 0) return mountainAdj[Math.floor(rng() * mountainAdj.length)];
  }

  if (pref === 'water_edge') {
    const waterAdj = eligible.filter((pid) =>
      polygons[pid].neighbors.some((nb) => waterPolygonIds.has(nb)),
    );
    if (waterAdj.length > 0) return waterAdj[Math.floor(rng() * waterAdj.length)];
  }

  if (pref === 'wall_edge') {
    const exteriorSet = new Set<number>();
    for (const p of polygons) {
      if (!wall.interiorPolygonIds.has(p.id)) exteriorSet.add(p.id);
    }
    const wallAdj = eligible.filter((pid) =>
      polygons[pid].neighbors.some((nb) => exteriorSet.has(nb)),
    );
    if (wallAdj.length > 0) return wallAdj[Math.floor(rng() * wallAdj.length)];
  }

  // Default / fallback: bias toward the canvas center to avoid degenerate
  // edge placements. Sort by site distance from canvas center, take the
  // closest 30%, RNG-pick within that.
  const cx = 500;
  const cy = 500;
  const sorted = [...eligible].sort((a, b) => {
    const da = Math.hypot(polygons[a].site[0] - cx, polygons[a].site[1] - cy);
    const db = Math.hypot(polygons[b].site[0] - cx, polygons[b].site[1] - cy);
    if (da !== db) return da - db;
    return a - b;
  });
  // Capital megalopolises lean slightly more central (top 20%) than non-capital
  // (top 35%) so flagship features sit in the heart of the city.
  const topFrac = env.isCapital ? 0.2 : 0.35;
  const topN = Math.max(1, Math.floor(sorted.length * topFrac));
  const top = sorted.slice(0, topN);
  return top[Math.floor(rng() * top.length)];
}

/**
 * BFS over polygon.neighbors from `seedId`, absorbing polygons that are in
 * `candidatePool` and not yet `used`. Optionally allows water/mountain
 * polygons when the seed preference invites them. Stops at `targetSize`.
 *
 * Mirrors `bfsParkCluster` in `cityMapLandmarksNamed.ts:360`, with the
 * water/mountain whitelisting added for `water_edge` / `mountain_edge` seeds.
 */
function growCluster(
  seedId: number,
  targetSize: number,
  ctx: PlacerContext,
  insidePool: Set<number>,
  used: Set<number>,
  spec: DistinctiveFeatureSpec,
): number[] {
  const { polygons, waterPolygonIds, mountainPolygonIds } = ctx;
  const allowWater = spec.seedPreference === 'water_edge';
  const allowMountain = spec.seedPreference === 'mountain_edge';
  // Cap optional water/mountain absorption so the cluster doesn't drift fully
  // outside the city footprint.
  const maxOptional = Math.floor(targetSize * 0.35);

  const cluster: number[] = [seedId];
  const visited = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  let optionalUsed = 0;
  while (queue.length > 0 && cluster.length < targetSize) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (cluster.length >= targetSize) break;
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (used.has(nb)) continue;
      const isInside = insidePool.has(nb);
      const isWater = waterPolygonIds.has(nb);
      const isMountain = mountainPolygonIds.has(nb);
      if (isInside) {
        cluster.push(nb);
        queue.push(nb);
        continue;
      }
      if (allowWater && isWater && optionalUsed < maxOptional) {
        cluster.push(nb);
        queue.push(nb);
        optionalUsed++;
        continue;
      }
      if (allowMountain && isMountain && optionalUsed < maxOptional) {
        cluster.push(nb);
        queue.push(nb);
        optionalUsed++;
        continue;
      }
    }
  }
  return cluster;
}

/**
 * Megalopolis-only distinctive feature placer.
 *
 *   1. Tier-gate (no-op for any tier other than `megalopolis`).
 *   2. Pick one feature via `pickFeature` (weighted by `fit(env)`).
 *   3. Pick a seed polygon honoring `seedPreference`.
 *   4. Grow a 20–50 polygon cluster via BFS.
 *   5. Mark every cluster polygon as `used` so subsequent quarter placers
 *      don't double-claim.
 *   6. Emit one `LandmarkV2` whose `kind` is the feature id, `polygonIds` is
 *      the cluster, and `distinctive` carries category + visual.
 *
 * Returns `[]` when the tier doesn't qualify, when no feature is eligible,
 * when the candidate pool is empty, or when the BFS reaches a cluster
 * shorter than `MIN_FEATURE_POLYGONS`. Logs nothing — the caller treats an
 * empty return as "no distinctive feature this city".
 */
export function placeDistinctiveFeature(
  ctx: PlacerContext,
  used: Set<number>,
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (env.size !== 'megalopolis') return [];
  if (candidatePool.size === 0) return [];

  const selectRng = seededPRNG(`${seed}_city_${cityName}_distinctive_select`);
  const placeRng = seededPRNG(`${seed}_city_${cityName}_distinctive_place`);

  const spec = pickFeature(env, selectRng);
  if (spec === null) return [];

  // Interior-only candidate pool (the cluster itself stays inside the city
  // footprint; water/mountain absorption is opt-in via seed preference).
  const interiorPool = new Set<number>();
  for (const pid of candidatePool) {
    if (wall.interiorPolygonIds.has(pid)) interiorPool.add(pid);
  }
  const insidePool = interiorPool.size > 0 ? interiorPool : candidatePool;

  const seedId = pickSeedPolygon(spec, ctx, insidePool, used, placeRng);
  if (seedId === -1) return [];

  const [minSize, maxSize] = spec.polygonRange;
  const clampedMin = Math.max(MIN_FEATURE_POLYGONS, Math.min(minSize, MAX_FEATURE_POLYGONS));
  const clampedMax = Math.max(clampedMin, Math.min(maxSize, MAX_FEATURE_POLYGONS));
  const targetSize = clampedMin + Math.floor(placeRng() * (clampedMax - clampedMin + 1));

  const cluster = growCluster(seedId, targetSize, ctx, insidePool, used, spec);

  // Reject undersized clusters — happens when the city footprint is narrow or
  // the seed sits in a pinched corner. No retry: the tier gate gives megalopolis
  // 1000 polygons, plenty for any 20-poly cluster, so a failure here is rare
  // and gracefully degrades to "no feature this city".
  if (cluster.length < MIN_FEATURE_POLYGONS) {
    // Restore: nothing was added to `used` yet.
    return [];
  }

  for (const pid of cluster) used.add(pid);
  void polygons; // referenced through ctx for parity with other placers

  return [
    {
      polygonId: seedId,
      kind: spec.id,
      name: spec.displayName,
      polygonIds: cluster,
      distinctive: {
        category: spec.category,
        visual: spec.visual,
      },
    },
  ];
}
