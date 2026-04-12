import type { Cell, BiomeType, BiomeInfo, Season, TerrainProfile } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

// Whittaker biome lookup: [elevationBand][moistureBand]
// elevation bands: <0.3, 0.3-0.6, 0.6-0.65, 0.65-0.75, 0.75+
// moisture bands: <0.1, 0.1-0.33, 0.33-0.66, 0.66+
const WHITTAKER: BiomeType[][] = [
  // elevation 0 (lowland)
  ['SUBTROPICAL_DESERT', 'GRASSLAND', 'TROPICAL_SEASONAL_FOREST', 'TROPICAL_RAIN_FOREST'],
  // elevation 1 (midland)
  ['TEMPERATE_DESERT', 'GRASSLAND', 'TEMPERATE_DECIDUOUS_FOREST', 'TEMPERATE_RAIN_FOREST'],
  // elevation 2 (highland)
  ['TEMPERATE_DESERT', 'SHRUBLAND', 'TAIGA', 'TAIGA'],
  // elevation 3 (alpine)
  ['TEMPERATE_DESERT', 'ALPINE_MEADOW', 'ALPINE_MEADOW', 'TAIGA'],
  // elevation 4 (mountain)
  ['SCORCHED', 'BARE', 'TUNDRA', 'SNOW'],
];

function elevBand(e: number): number {
  if (e < 0.3) return 0;
  if (e < 0.6) return 1;
  if (e < 0.65) return 2;
  if (e < 0.75) return 3;
  return 4;
}

// Moisture band boundaries for Whittaker lookup (also used by getVegetationDensity)
const MOISTURE_BREAKS = [0, 0.1, 0.33, 0.66, 1.0];

function moistBand(m: number): number {
  if (m < 0.1) return 0;
  if (m < 0.33) return 1;
  if (m < 0.66) return 2;
  return 3;
}

// --- Temperature-based polar thresholds ---
// These replace the old polarDist-based thresholds. Lower temperature = colder.
// Continental interiors at high latitudes will cross these thresholds sooner
// (their temperature is pushed colder), while maritime coasts stay milder.
const ICE_TEMP_THRESHOLD = 0.15;
const SNOW_TEMP_THRESHOLD = 0.10;
const TUNDRA_TEMP_THRESHOLD = 0.20;

export function assignBiomes(cells: Cell[], width: number, height: number, noise: NoiseSampler3D, profile: TerrainProfile): void {
  for (const cell of cells) {
    const ny = (cell.y / height) * 2 - 1;
    const polarDist = Math.abs(ny);
    const temp = cell.temperature;

    // Polar ice caps on water — temperature-based with noise dithering.
    // Runs before the LAKE short-circuit so that cold inland lakes still
    // freeze into ICE when `temp < iceTempThreshold`, matching ocean ice.
    if (cell.isWater && temp < profile.iceTempThreshold) {
      const iceNoise = fbmCylindrical(
        noise.continent, cell.x * 1.3, cell.y * 1.3, width, height, 3, 2.0
      );
      const iceThreshold = profile.iceTempThreshold - iceNoise * 0.06;
      if (temp < iceThreshold) {
        cell.biome = 'ICE';
        continue;
      }
    }

    // Inland lake short-circuit: cells materialized by `fillDepressions`
    // carry `isLake = true` and must keep the LAKE biome across the post-
    // erosion refresh pass. Placed after the ICE check above so that cold
    // lakes can still freeze, and before the OCEAN/COAST split below so
    // the lake isn't reclassified as ocean or shallow sea.
    if (cell.isLake) {
      cell.biome = 'LAKE';
      continue;
    }
    // Polar land: snow — temperature-based with noise dithering
    if (!cell.isWater && temp < profile.snowTempThreshold) {
      const snowNoise = fbmCylindrical(
        noise.elevation, cell.x * 1.5, cell.y * 1.5, width, height, 3, 2.0
      );
      const snowThreshold = profile.snowTempThreshold - snowNoise * 0.05;
      if (temp < snowThreshold) {
        cell.biome = 'SNOW';
        continue;
      }
    }
    // Polar land: tundra — temperature-based with noise dithering
    if (!cell.isWater && temp < profile.tundraTempThreshold) {
      const tundraNoise = fbmCylindrical(
        noise.elevation, cell.x * 1.2, cell.y * 1.2, width, height, 3, 1.8
      );
      const tundraThreshold = profile.tundraTempThreshold - tundraNoise * 0.05;
      if (temp < tundraThreshold) {
        cell.biome = 'TUNDRA';
        continue;
      }
    }

    if (cell.isWater) {
      if (cell.elevation < profile.shallowSeaThreshold) {
        cell.biome = 'OCEAN';
      } else {
        cell.biome = 'COAST';
      }
      continue;
    }
    if (cell.isCoast && cell.elevation < 0.42) {
      cell.biome = 'BEACH';
      continue;
    }

    // Temperature-driven moisture nudge: hot continental cells lose effective
    // moisture (deserts expand inland), cool maritime cells gain it (forests
    // persist on coasts). The baseline temperature is pure latitude (1-polarDist).
    const baselineTemp = 1.0 - polarDist;
    const tempDelta = temp - baselineTemp;
    const effMoisture = Math.max(0, Math.min(1,
      cell.moisture + profile.tempMoistureShift * tempDelta
    ));

    cell.biome = WHITTAKER[elevBand(cell.elevation)][moistBand(effMoisture)];

    // Profile-driven marsh override: convert low-elevation, high-moisture
    // forest/grassland biomes to MARSH. Same dithering pattern as polar biomes.
    if (profile.marshOverride
        && cell.elevation < 0.4
        && effMoisture >= 0.5) {
      const b = cell.biome;
      if (b === 'TROPICAL_RAIN_FOREST'
          || b === 'TEMPERATE_RAIN_FOREST'
          || b === 'TROPICAL_SEASONAL_FOREST'
          || b === 'TEMPERATE_DECIDUOUS_FOREST'
          || b === 'GRASSLAND') {
        const marshNoise = fbmCylindrical(
          noise.moisture, cell.x * 1.4, cell.y * 1.4, width, height, 3, 2.0
        );
        const marshScore = (0.4 - cell.elevation) + (effMoisture - 0.5) + (marshNoise - 0.5) * 0.15;
        if (marshScore > 0.05) {
          cell.biome = 'MARSH';
        }
      }
    }
  }
}

// Biomes that skip vegetation density modulation (they already have
// their own visual variation or are non-vegetation types).
const NEUTRAL_BIOMES: ReadonlySet<BiomeType> = new Set([
  'OCEAN', 'COAST', 'ICE', 'SNOW', 'BEACH',
]);

/**
 * Returns 0.0 (dry/sparse edge) to 1.0 (wet/dense edge) based on where
 * the cell's moisture sits within its Whittaker moisture band.
 * Includes a spatial-hash dither to prevent visual banding.
 */
export function getVegetationDensity(cell: Cell): number {
  if (cell.isWater || NEUTRAL_BIOMES.has(cell.biome)) return 0.5;

  const m = cell.moisture;
  // Find which moisture band the cell is in
  let band = 0;
  for (let i = 1; i < MOISTURE_BREAKS.length - 1; i++) {
    if (m >= MOISTURE_BREAKS[i]) band = i;
  }
  const lo = MOISTURE_BREAKS[band];
  const hi = MOISTURE_BREAKS[band + 1];
  const t = (m - lo) / (hi - lo);

  // Spatial-hash dither to break banding (same technique as drawWaterDepth)
  const hash = Math.sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453;
  const dither = (hash - Math.floor(hash)) * 0.1 - 0.05;

  return Math.max(0, Math.min(1, t + dither));
}

// Pre-parsed RGB cache for hex colors used by modulateBiomeColor
const hexCache = new Map<string, [number, number, number]>();

function parseHex(hex: string): [number, number, number] {
  let cached = hexCache.get(hex);
  if (cached) return cached;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  cached = [r, g, b];
  hexCache.set(hex, cached);
  return cached;
}

/**
 * Modulates a biome fill color by vegetation density.
 * density=0 → 12% lighter, density=0.5 → unchanged, density=1 → 12% darker.
 */
export function modulateBiomeColor(hexColor: string, density: number): string {
  const [r, g, b] = parseHex(hexColor);
  const factor = 1.12 - density * 0.24;
  return `rgb(${Math.min(255, Math.round(r * factor))},${Math.min(255, Math.round(g * factor))},${Math.min(255, Math.round(b * factor))})`;
}

// --- Seasonal Ice / Permafrost (Phase 4.4) ---

export const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

// Seasonal offsets: [Spring, Summer, Autumn, Winter]
const SEASON_ICE_OFFSET =    [0.00, -0.04,  0.01,  0.04];
const SEASON_SNOW_OFFSET =   [0.00, -0.03,  0.01,  0.03];
const SEASON_TUNDRA_OFFSET = [0.00, -0.03,  0.01,  0.03];
const SEASON_PERMAFROST_ALPHA = [0.12, 0.06, 0.14, 0.18];

// Permafrost temperature band
const PERMAFROST_TEMP_LO = 0.10;
const PERMAFROST_TEMP_HI = 0.30;

/** Spatial hash dither for organic seasonal boundaries (no noise sampler needed at render time). */
function seasonalDither(x: number, y: number, scale: number): number {
  const hash = Math.sin(x * 127.1 * scale + y * 311.7 * scale) * 43758.5453;
  return (hash - Math.floor(hash)) * 0.08 - 0.04; // ±0.04 range
}

/**
 * Returns the effective biome for a cell given the current season.
 * Applies seasonal temperature threshold offsets to shift polar biome boundaries.
 * Non-polar cells pass through unchanged. Season 0 (Spring) returns cell.biome as-is.
 */
export function getSeasonalBiome(cell: Cell, season: Season): BiomeType {
  if (season === 0) return cell.biome;

  const temp = cell.temperature;
  const dither = seasonalDither(cell.x, cell.y, 1.3);

  // Check if this cell could be affected by seasonal shifts
  // (only cells near the polar thresholds need re-evaluation)
  if (cell.isWater) {
    const iceThresh = ICE_TEMP_THRESHOLD + SEASON_ICE_OFFSET[season] + dither * 0.06;
    if (temp < iceThresh && cell.biome !== 'ICE') {
      // Water cell that should become ICE in this season
      return 'ICE';
    }
    if (temp >= iceThresh && cell.biome === 'ICE') {
      // ICE cell that should thaw in this season
      return cell.elevation < 0.1 ? 'OCEAN' : 'COAST';
    }
    return cell.biome;
  }

  // Land cells: check snow and tundra boundaries
  const snowThresh = SNOW_TEMP_THRESHOLD + SEASON_SNOW_OFFSET[season] + dither * 0.05;
  const tundraThresh = TUNDRA_TEMP_THRESHOLD + SEASON_TUNDRA_OFFSET[season] + dither * 0.05;

  if (temp < snowThresh) {
    // Should be SNOW in this season
    if (cell.biome !== 'SNOW') return 'SNOW';
    return cell.biome;
  }
  if (temp < tundraThresh) {
    // Should be TUNDRA in this season
    if (cell.biome !== 'TUNDRA') return 'TUNDRA';
    return cell.biome;
  }

  // Above tundra threshold — if the cell was originally SNOW or TUNDRA, it thaws
  if (cell.biome === 'SNOW' || cell.biome === 'TUNDRA') {
    // Revert to what the Whittaker table would give for this cell
    return WHITTAKER[elevBand(cell.elevation)][moistBand(cell.moisture)];
  }

  return cell.biome;
}

/**
 * Returns the permafrost overlay alpha for a cell, or 0 if not in the permafrost band.
 * Land cells with temperature in [0.10, 0.30] get a blue-gray overlay.
 * Alpha scales with depth into the band (colder = stronger) and varies by season.
 */
export function getPermafrostAlpha(cell: Cell, season: Season): number {
  if (cell.isWater) return 0;
  const temp = cell.temperature;
  if (temp < PERMAFROST_TEMP_LO || temp > PERMAFROST_TEMP_HI) return 0;

  // Depth into the band: 1.0 at the cold edge, 0.0 at the warm edge
  const depth = 1.0 - (temp - PERMAFROST_TEMP_LO) / (PERMAFROST_TEMP_HI - PERMAFROST_TEMP_LO);
  const baseAlpha = SEASON_PERMAFROST_ALPHA[season];

  // Spatial dither to prevent hard edges
  const dither = seasonalDither(cell.x, cell.y, 0.9) * 0.5;
  return Math.max(0, Math.min(0.25, baseAlpha * depth + dither * 0.03));
}

// Fantasy parchment-friendly palette
export const BIOME_INFO: Record<BiomeType, BiomeInfo> = {
  OCEAN:                       { fillColor: '#4a7fa5', label: 'Ocean',                     iconType: null },
  COAST:                       { fillColor: '#5b9abf', label: 'Shallow Sea',               iconType: null },
  BEACH:                       { fillColor: '#d4c59a', label: 'Beach',                     iconType: null },
  GRASSLAND:                   { fillColor: '#8db870', label: 'Grassland',                 iconType: null },
  SUBTROPICAL_DESERT:          { fillColor: '#d9c084', label: 'Desert',                    iconType: 'desert' },
  TEMPERATE_DESERT:            { fillColor: '#c9b97a', label: 'Dry Plains',                iconType: 'desert' },
  SHRUBLAND:                   { fillColor: '#9aaa6a', label: 'Shrubland',                 iconType: null },
  TAIGA:                       { fillColor: '#6b9960', label: 'Taiga',                     iconType: 'tree' },
  TEMPERATE_DECIDUOUS_FOREST:  { fillColor: '#527a3c', label: 'Deciduous Forest',          iconType: 'tree' },
  TEMPERATE_RAIN_FOREST:       { fillColor: '#3d6b30', label: 'Rain Forest',               iconType: 'tree' },
  TROPICAL_SEASONAL_FOREST:    { fillColor: '#4a7a3a', label: 'Tropical Forest',           iconType: 'tree' },
  TROPICAL_RAIN_FOREST:        { fillColor: '#2e5c28', label: 'Dense Jungle',              iconType: 'tree' },
  TUNDRA:                      { fillColor: '#a8b890', label: 'Tundra',                    iconType: null },
  BARE:                        { fillColor: '#b0a890', label: 'Rocky',                     iconType: 'mountain' },
  SCORCHED:                    { fillColor: '#9a8878', label: 'Scorched',                  iconType: 'mountain' },
  SNOW:                        { fillColor: '#e8e8f0', label: 'Snow',                      iconType: 'snow' },
  MARSH:                       { fillColor: '#5a8a5a', label: 'Marsh',                     iconType: null },
  ICE:                         { fillColor: '#d8e8f0', label: 'Ice',                       iconType: 'snow' },
  ALPINE_MEADOW:               { fillColor: '#98b86a', label: 'Alpine Meadow',             iconType: null },
  LAKE:                        { fillColor: '#5f8fb3', label: 'Lake',                      iconType: null },
};
