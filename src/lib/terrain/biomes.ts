import type { Cell, BiomeType, BiomeInfo } from '../types';

// Whittaker biome lookup: [elevationBand][moistureBand]
// elevation bands: <0.3, 0.3-0.6, 0.6-0.8, 0.8+
// moisture bands: <0.1, 0.1-0.33, 0.33-0.66, 0.66+
const WHITTAKER: BiomeType[][] = [
  // elevation 0 (lowland)
  ['SUBTROPICAL_DESERT', 'GRASSLAND', 'TROPICAL_SEASONAL_FOREST', 'TROPICAL_RAIN_FOREST'],
  // elevation 1 (midland)
  ['TEMPERATE_DESERT', 'GRASSLAND', 'TEMPERATE_DECIDUOUS_FOREST', 'TEMPERATE_RAIN_FOREST'],
  // elevation 2 (highland)
  ['TEMPERATE_DESERT', 'SHRUBLAND', 'TAIGA', 'TAIGA'],
  // elevation 3 (mountain)
  ['SCORCHED', 'BARE', 'TUNDRA', 'SNOW'],
];

function elevBand(e: number): number {
  if (e < 0.3) return 0;
  if (e < 0.6) return 1;
  if (e < 0.8) return 2;
  return 3;
}

function moistBand(m: number): number {
  if (m < 0.1) return 0;
  if (m < 0.33) return 1;
  if (m < 0.66) return 2;
  return 3;
}

export function assignBiomes(cells: Cell[], height: number): void {
  for (const cell of cells) {
    const ny = (cell.y / height) * 2 - 1;
    const polarDist = Math.abs(ny);

    // Polar ice caps on water
    if (cell.isWater && polarDist > 0.85) {
      cell.biome = 'ICE';
      continue;
    }
    // Permafrost zone on land
    if (!cell.isWater && polarDist > 0.9) {
      cell.biome = 'TUNDRA';
      continue;
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
    cell.biome = WHITTAKER[elevBand(cell.elevation)][moistBand(cell.moisture)];
  }
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
};
