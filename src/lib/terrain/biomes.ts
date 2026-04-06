import type { Cell, BiomeType, BiomeInfo } from '../types';
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

// How much temperature shifts effective moisture for Whittaker lookup
const TEMP_MOISTURE_SHIFT = 0.05;

export function assignBiomes(cells: Cell[], width: number, height: number, noise: NoiseSampler3D): void {
  for (const cell of cells) {
    const ny = (cell.y / height) * 2 - 1;
    const polarDist = Math.abs(ny);
    const temp = cell.temperature;

    // Polar ice caps on water — temperature-based with noise dithering
    if (cell.isWater && temp < ICE_TEMP_THRESHOLD) {
      const iceNoise = fbmCylindrical(
        noise.continent, cell.x * 1.3, cell.y * 1.3, width, height, 3, 2.0
      );
      const iceThreshold = ICE_TEMP_THRESHOLD - iceNoise * 0.06;
      if (temp < iceThreshold) {
        cell.biome = 'ICE';
        continue;
      }
    }
    // Polar land: snow — temperature-based with noise dithering
    if (!cell.isWater && temp < SNOW_TEMP_THRESHOLD) {
      const snowNoise = fbmCylindrical(
        noise.elevation, cell.x * 1.5, cell.y * 1.5, width, height, 3, 2.0
      );
      const snowThreshold = SNOW_TEMP_THRESHOLD - snowNoise * 0.05;
      if (temp < snowThreshold) {
        cell.biome = 'SNOW';
        continue;
      }
    }
    // Polar land: tundra — temperature-based with noise dithering
    if (!cell.isWater && temp < TUNDRA_TEMP_THRESHOLD) {
      const tundraNoise = fbmCylindrical(
        noise.elevation, cell.x * 1.2, cell.y * 1.2, width, height, 3, 1.8
      );
      const tundraThreshold = TUNDRA_TEMP_THRESHOLD - tundraNoise * 0.05;
      if (temp < tundraThreshold) {
        cell.biome = 'TUNDRA';
        continue;
      }
    }

    if (cell.isWater) {
      if (cell.elevation < 0.1) {
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
      cell.moisture + TEMP_MOISTURE_SHIFT * tempDelta
    ));

    cell.biome = WHITTAKER[elevBand(cell.elevation)][moistBand(effMoisture)];
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
  MARSH:                       { fillColor: '#7a9a70', label: 'Marsh',                     iconType: null },
  ICE:                         { fillColor: '#d8e8f0', label: 'Ice',                       iconType: 'snow' },
  ALPINE_MEADOW:               { fillColor: '#98b86a', label: 'Alpine Meadow',             iconType: null },
};
