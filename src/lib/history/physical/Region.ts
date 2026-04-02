import { IdUtil } from '../IdUtil';
import type { BiomeType } from '../../types';
import type { CityEntity } from './CityEntity';
import type { Resource } from './Resource';
import { TRADE_MIN } from './Resource';

export type RegionBiome = 'temperate' | 'arid' | 'desert' | 'swamp' | 'tropical' | 'tundra';

export const REGION_BIOME_GROWTH: Record<RegionBiome, number> = {
  temperate: 1.5,
  arid: 1.0,
  desert: 0.3,
  swamp: 0.5,
  tropical: 0.7,
  tundra: 0.3,
};

export const BIOME_TO_REGION_BIOME: Record<BiomeType, RegionBiome> = {
  SNOW: 'tundra',   ICE: 'tundra',    TUNDRA: 'tundra',
  BARE: 'arid',     SCORCHED: 'arid', SHRUBLAND: 'arid', TEMPERATE_DESERT: 'arid',
  TAIGA: 'temperate',
  TEMPERATE_RAIN_FOREST: 'temperate', TEMPERATE_DECIDUOUS_FOREST: 'temperate', GRASSLAND: 'temperate',
  TROPICAL_RAIN_FOREST: 'tropical',   TROPICAL_SEASONAL_FOREST: 'tropical',
  SUBTROPICAL_DESERT: 'desert',
  MARSH: 'swamp',
  OCEAN: 'temperate', COAST: 'temperate', BEACH: 'temperate',
};

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Region {
  readonly id: string;
  biome: RegionBiome;
  resources: Resource[] = [];
  cities: CityEntity[] = [];
  neighbours: Set<string> = new Set();
  cellIndices: number[] = [];
  // Transient
  continentId: string = '';
  neighboursCount: number = 0;
  isCountry: boolean = false;
  countryId: string | null = null;
  hasResources: boolean = false;
  neighbourRegions: Region[] = [];
  potentialNeighbours: Region[][] = [];

  constructor(biome: RegionBiome, rng: () => number) {
    this.id = IdUtil.id('region', rngHex(rng)) ?? 'region_unknown';
    this.biome = biome;
  }

  updateHasResources(): void {
    this.hasResources = this.resources.some(r => r.available >= TRADE_MIN);
  }
}
