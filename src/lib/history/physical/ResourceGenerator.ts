import type { Cell } from '../../types';
import type { Region, RegionBiome } from './Region';
import { Resource } from './Resource';
import {
  RESOURCE_SPECS,
  RARITY_WEIGHTS,
  type ClimateRange,
  type HabitatSpec,
  type ResourceSpec,
} from './ResourceCatalog';

/**
 * Habitat-aware per-cell resource generator.
 *
 * Pipeline per region:
 *   1. Roll target `count = 1 + floor(rng()*10)` (same budget roll as
 *      the legacy per-region generator).
 *   2. For each land cell in the region, build a per-cell profile and
 *      compute the total eligible weight across `RESOURCE_SPECS`. This
 *      is a deterministic score reflecting how resource-rich the cell's
 *      specific terrain/climate/hydrology is.
 *   3. Rank land cells by total eligible weight descending (tiebreak by
 *      cell index for determinism), take the top `count` cells.
 *   4. For each selected cell, weighted-pick one spec from that cell's
 *      own pool (1 rng call), construct a `Resource` with `cellIndex`
 *      (3 hex + 10 dice rng calls). Also populates `region.cellResources`.
 *
 * RNG-call accounting:
 *   1 (count) + count * (1 sample + 3 hex + 10 dice) = 1 + 14*count
 *   When fewer land cells exist than `count`, the shortfall burns
 *   14 rng calls per missing cell to keep the per-region budget stable.
 *   When a selected cell has an empty pool (all specs hard-gated), the
 *   same 14-call burn applies.
 */

export interface RegionProfile {
  regionBiome: RegionBiome;
  hasCoast: boolean;
  hasRiver: boolean;
  hasLake: boolean;
  hasMountain: boolean;
  mountainFraction: number;
  maxElevation: number;
  meanTemperature: number;
  meanMoisture: number;
  cellCount: number;
}

// ---------------------------------------------------------------------------
// Profile builders
// ---------------------------------------------------------------------------

const RIVER_FLOW_THRESHOLD = 4;
const MOUNTAIN_ELEVATION_THRESHOLD = 0.72;

/**
 * Build a profile for a single cell, reusing the `RegionProfile` shape so
 * `computeFitScore` works unchanged. `regionBiome` is inherited from the
 * owning region (the off-biome soft bias still uses the region's dominant
 * biome, not the individual cell's Voronoi biome).
 */
export function buildCellProfile(cell: Cell, regionBiome: RegionBiome): RegionProfile {
  const isMountain = cell.elevation > MOUNTAIN_ELEVATION_THRESHOLD;
  return {
    regionBiome,
    hasCoast: cell.isCoast,
    hasRiver: cell.riverFlow > RIVER_FLOW_THRESHOLD,
    hasLake: !!cell.isLake,
    hasMountain: isMountain,
    mountainFraction: isMountain ? 1 : 0,
    maxElevation: cell.elevation,
    meanTemperature: cell.temperature,
    meanMoisture: cell.moisture,
    cellCount: 1,
  };
}

/** Aggregate region profile (kept for any external callers). */
export function buildRegionProfile(region: Region, cells: Cell[]): RegionProfile {
  let hasCoast = false;
  let hasRiver = false;
  let hasLake = false;
  let mountainCount = 0;
  let maxElev = 0;
  let sumTemp = 0;
  let sumMoist = 0;
  let n = 0;

  for (const ci of region.cellIndices) {
    const c = cells[ci];
    if (!c) continue;
    n++;
    if (c.isCoast) hasCoast = true;
    if (c.riverFlow > RIVER_FLOW_THRESHOLD) hasRiver = true;
    if (c.isLake) hasLake = true;
    if (c.elevation > MOUNTAIN_ELEVATION_THRESHOLD) mountainCount++;
    if (c.elevation > maxElev) maxElev = c.elevation;
    sumTemp += c.temperature;
    sumMoist += c.moisture;
  }

  const count = Math.max(n, 1);
  return {
    regionBiome: region.biome,
    hasCoast,
    hasRiver,
    hasLake,
    hasMountain: mountainCount > 0,
    mountainFraction: mountainCount / count,
    maxElevation: maxElev,
    meanTemperature: sumTemp / count,
    meanMoisture: sumMoist / count,
    cellCount: n,
  };
}

// ---------------------------------------------------------------------------
// Fit scoring
// ---------------------------------------------------------------------------

/**
 * Evaluate a soft trapezoid range at `value`.
 * Returns 0 (reject) if `value` is outside `[min, max]`.
 * When only `[min, max]` is given, the whole range is flat 1.0 inside.
 * When `[min, max, preferMin, preferMax]` is given, flat 1.0 inside
 * `[preferMin, preferMax]` and a linear ramp from 0.25 at the hard edge
 * up to 1.0 at the preferred edge on each shoulder.
 */
function evalRange(range: ClimateRange, value: number): number {
  const min = range[0];
  const max = range[1];
  if (value < min || value > max) return 0;
  if (range.length === 2) return 1;
  const preferMin = range[2];
  const preferMax = range[3];
  if (value >= preferMin && value <= preferMax) return 1;
  if (value < preferMin) {
    const span = preferMin - min;
    if (span <= 0) return 1;
    const t = (value - min) / span;      // 0 at min, 1 at preferMin
    return 0.25 + 0.75 * t;
  }
  // value > preferMax
  const span = max - preferMax;
  if (span <= 0) return 1;
  const t = (value - preferMax) / span;  // 0 at preferMax, 1 at max
  return 0.25 + 0.75 * (1 - t);
}

/**
 * Off-biome bias: when the region's dominant biome is NOT in the spec's
 * whitelist, we don't hard-reject — the resource is still eligible but
 * at 20% of its normal weight. This keeps every region's eligible pool
 * wide (so `region.resources.length` matches the baseline `count` and
 * downstream simulation convergence) while still biasing resources
 * strongly toward plausible climates — a Sahara still overwhelmingly
 * gets desert resources, but can occasionally produce a pearl if it
 * also has warm coastline (the Persian Gulf being the real-world
 * analogue).
 *
 * Hydrology gates (coast/river/mountain/lake) and climate trapezoids
 * (temperature/moisture/elevation) stay hard — no amount of
 * off-biome bias will put pearls in a frozen inland tundra.
 */
const OFF_BIOME_FIT = 0.2;

export function computeFitScore(spec: ResourceSpec, profile: RegionProfile): number {
  const h: HabitatSpec = spec.habitat;

  let fit = 1;
  if (h.biomes && !h.biomes.includes(profile.regionBiome)) {
    fit = OFF_BIOME_FIT;
  }

  // Hard hydrology/topography gates
  if (h.requiresCoast && !profile.hasCoast) return 0;
  if (h.requiresRiver && !profile.hasRiver) return 0;
  if (h.requiresMountain && !profile.hasMountain) return 0;
  if (h.requiresLake && !profile.hasLake) return 0;
  if (h.forbidsMountain && profile.mountainFraction >= 0.15) return 0;

  if (h.temperature) {
    fit *= evalRange(h.temperature, profile.meanTemperature);
    if (fit === 0) return 0;
  }
  if (h.moisture) {
    fit *= evalRange(h.moisture, profile.meanMoisture);
    if (fit === 0) return 0;
  }
  if (h.elevation) {
    fit *= evalRange(h.elevation, profile.maxElevation);
    if (fit === 0) return 0;
  }
  return fit;
}

// ---------------------------------------------------------------------------
// Weighted selection
// ---------------------------------------------------------------------------

interface EligibleEntry {
  spec: ResourceSpec;
  weight: number;
}

/**
 * Roulette-wheel pick from a weighted pool. Consumes exactly 1 rng call
 * regardless of pool size. Returns the picked index so the caller can
 * splice it out for sampling-without-replacement.
 */
function weightedPickIndex(pool: EligibleEntry[], rng: () => number): number {
  let totalWeight = 0;
  for (const e of pool) totalWeight += e.weight;
  if (totalWeight <= 0) {
    // All weights zero — pick the first entry. We still consume one
    // rng call so the per-pick RNG budget stays consistent with the
    // normal path.
    rng();
    return 0;
  }
  let roll = rng() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    roll -= pool[i].weight;
    if (roll <= 0) return i;
  }
  return pool.length - 1;
}

// ---------------------------------------------------------------------------
// Per-cell fit ranking
// ---------------------------------------------------------------------------

interface CellFit {
  cellIndex: number;
  pool: EligibleEntry[];
  totalWeight: number;
}

/**
 * Build the eligible resource pool for a single cell and return the
 * aggregate weight (used to rank cells by resource-richness).
 */
function buildCellFit(cellIndex: number, cell: Cell, regionBiome: RegionBiome): CellFit {
  const profile = buildCellProfile(cell, regionBiome);
  const pool: EligibleEntry[] = [];
  let totalWeight = 0;
  for (const spec of RESOURCE_SPECS) {
    const fit = computeFitScore(spec, profile);
    if (fit <= 0) continue;
    const w = RARITY_WEIGHTS[spec.rarity] * fit;
    pool.push({ spec, weight: w });
    totalWeight += w;
  }
  return { cellIndex, pool, totalWeight };
}

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

export class ResourceGenerator {
  /**
   * Generate resources for a region using per-cell habitat scoring.
   *
   * Each resource is attached to a specific cell (the top-K most
   * resource-fit land cells in the region). The flat array is stored
   * on `region.resources`; the per-cell index is stored on
   * `region.cellResources`.
   *
   * RNG budget: 1 (count) + count * 14 (1 sample + 3 hex + 10 dice).
   */
  generateForRegion(region: Region, cells: Cell[], rng: () => number): Resource[] {
    // --- Step A: target count (1 rng call) ---
    const count = Math.floor(rng() * 10) + 1;

    // --- Step B: score every land cell in the region ---
    const fits: CellFit[] = [];
    for (const ci of region.cellIndices) {
      const c = cells[ci];
      if (!c || c.isWater) continue;
      fits.push(buildCellFit(ci, c, region.biome));
    }

    // Sort by totalWeight descending, tiebreak by cellIndex ascending
    // for deterministic order independent of region.cellIndices iteration.
    fits.sort((a, b) => b.totalWeight - a.totalWeight || a.cellIndex - b.cellIndex);

    // --- Step C: pick top `count` cells, one resource each ---
    const out: Resource[] = [];
    region.cellResources.clear();

    for (let i = 0; i < count; i++) {
      if (i >= fits.length) {
        // Fewer land cells than target — burn 14 rng calls to keep
        // the per-region budget stable.
        for (let j = 0; j < 14; j++) rng();
        continue;
      }
      const cf = fits[i];
      if (cf.pool.length === 0) {
        // Cell has no eligible specs — burn 14 rng calls.
        for (let j = 0; j < 14; j++) rng();
        continue;
      }
      const idx = weightedPickIndex(cf.pool, rng);
      const picked = cf.pool[idx].spec;
      const res = new Resource(cf.cellIndex, picked.type, rng, picked.abundance);
      out.push(res);

      // Populate the per-cell index
      let arr = region.cellResources.get(cf.cellIndex);
      if (!arr) {
        arr = [];
        region.cellResources.set(cf.cellIndex, arr);
      }
      arr.push(res);
    }
    return out;
  }
}

export const resourceGenerator = new ResourceGenerator();
