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
 * Habitat-aware region generator.
 *
 * Pipeline per region:
 *   1. `buildRegionProfile(region, cells)` — single-pass aggregate of
 *      cell climate/geography data (no RNG).
 *   2. Pick a uniform `count = 1 + floor(rng()*10)` — **byte-identical**
 *      to the legacy loop that this replaces, so the RNG budget per
 *      region stays stable and downstream simulation (city placement,
 *      history steps) reads the same rng values as before.
 *   3. Filter `RESOURCE_SPECS` by `computeFitScore > 0`. Hydrology and
 *      climate axes are hard gates; the biome whitelist is a SOFT bias
 *      (off-biome specs stay eligible at 20% weight) so the per-region
 *      eligible pool stays wide regardless of biome. Weight each
 *      eligible spec as `rarityWeight * fitScore`.
 *   4. Iterate `count` times: weighted-pick from the pool (1 rng call),
 *      construct a `Resource` (rngHex = 3 + rollDice = 10 rng calls —
 *      same shape as legacy `resourceGenerator.generate`), then remove
 *      the pick from the pool so no duplicates within a region.
 *
 * RNG-call accounting (must stay byte-identical to legacy path):
 *   legacy: 1 (count) + count * (1 pickType + 3 hex + 10 dice) = 1 + 14*count
 *   new:    1 (count) + count * (1 sample + 3 hex + 10 dice) = 1 + 14*count  ✓
 *
 * Rarity influences *which* types spawn (via `RARITY_WEIGHTS`), not how
 * much stockpile they start with — every spec uses the same
 * `STANDARD_ABUNDANCE` (10d10+20) as the legacy code so trade
 * exhaustion timing and Wonder gating stay unchanged.
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
// Profile builder
// ---------------------------------------------------------------------------

const RIVER_FLOW_THRESHOLD = 4;
const MOUNTAIN_ELEVATION_THRESHOLD = 0.72;

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
// Public generator
// ---------------------------------------------------------------------------

export class ResourceGenerator {
  /**
   * Generate the full resource list for a region using habitat-aware
   * weighted sampling. Replaces the legacy `1 + rng() * 10` loop over
   * `pickResourceType(rng)` while keeping the per-region RNG call
   * budget byte-identical (see module docstring).
   */
  generateForRegion(region: Region, cells: Cell[], rng: () => number): Resource[] {
    // --- Step A: target count (1 rng call, same shape as legacy) ---
    const count = Math.floor(rng() * 10) + 1;

    // --- Step B: build eligible pool in a stable, deterministic order ---
    const profile = buildRegionProfile(region, cells);
    const pool: EligibleEntry[] = [];
    for (const spec of RESOURCE_SPECS) {
      const fit = computeFitScore(spec, profile);
      if (fit <= 0) continue;
      const rarityWeight = RARITY_WEIGHTS[spec.rarity];
      pool.push({ spec, weight: rarityWeight * fit });
    }

    // --- Step C: interleaved sample + construct ---
    // Each iteration consumes: 1 rng (sample) + 3 rng (rngHex in
    // Resource ctor) + 10 rng (rollDice) = 14 rng calls, matching the
    // legacy pickResourceType + new Resource(rng) per-iteration budget.
    const out: Resource[] = [];
    for (let i = 0; i < count; i++) {
      if (pool.length === 0) {
        // Pool exhausted — we still need to consume 14 rng calls to
        // preserve the RNG budget, but there's no spec to assign them
        // to. Consume and discard: 1 sample + 3 hex + 10 dice = 14.
        // This path is rare (requires more than `pool.length` target
        // picks for a region with very few eligible specs).
        for (let j = 0; j < 14; j++) rng();
        continue;
      }
      const idx = weightedPickIndex(pool, rng);
      const picked = pool[idx].spec;
      pool.splice(idx, 1);
      out.push(new Resource(picked.type, rng, picked.abundance));
    }
    return out;
  }
}

export const resourceGenerator = new ResourceGenerator();
