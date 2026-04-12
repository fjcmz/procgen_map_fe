import { IdUtil } from '../IdUtil';
import type { BiomeType } from '../../types';
import type { CityEntity } from './CityEntity';
import type { Resource, ResourceType } from './Resource';
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

/** Carrying capacity per city for logistic growth, by region biome. */
export const REGION_BIOME_CAPACITY: Record<RegionBiome, number> = {
  temperate: 2_500_000,
  arid:      1_000_000,
  tropical:    750_000,
  swamp:       400_000,
  desert:      250_000,
  tundra:      250_000,
};

export const BIOME_TO_REGION_BIOME: Record<BiomeType, RegionBiome> = {
  SNOW: 'tundra',   ICE: 'tundra',    TUNDRA: 'tundra',
  BARE: 'arid',     SCORCHED: 'arid', SHRUBLAND: 'arid', TEMPERATE_DESERT: 'arid',
  TAIGA: 'temperate',
  TEMPERATE_RAIN_FOREST: 'temperate', TEMPERATE_DECIDUOUS_FOREST: 'temperate', GRASSLAND: 'temperate',
  TROPICAL_RAIN_FOREST: 'tropical',   TROPICAL_SEASONAL_FOREST: 'tropical',
  SUBTROPICAL_DESERT: 'desert',
  MARSH: 'swamp',
  ALPINE_MEADOW: 'temperate',
  OCEAN: 'temperate', COAST: 'temperate', BEACH: 'temperate', LAKE: 'temperate',
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
  /** True when this region was claimed via territorial expansion (not country formation). */
  isExpansion: boolean = false;
  /** Country ID of the country that claimed this region via expansion. */
  expansionOwnerId: string | null = null;
  hasResources: boolean = false;
  neighbourRegions: Region[] = [];
  potentialNeighbours: Region[][] = [];
  /**
   * Resource types the owning country has "discovered" (unlocked for trade).
   * Grows monotonically — once a type enters this set it never leaves, even
   * after conquest (the conqueror inherits institutional knowledge). Common
   * L0 resources are bootstrapped at year 0 in `history.ts`; the yearly tick
   * in `YearGenerator` adds additional types as the owning country's tech
   * levels cross each resource's `requiredTechLevel`.
   */
  discoveredResources: Set<ResourceType> = new Set();

  constructor(biome: RegionBiome, rng: () => number) {
    this.id = IdUtil.id('region', rngHex(rng)) ?? 'region_unknown';
    this.biome = biome;
  }

  updateHasResources(): void {
    // Resource must be both discovered (tech-unlocked) AND have enough stock
    // remaining to trade. Bootstrap at region creation populates common L0
    // resources so pre-country regions still report correctly.
    this.hasResources = this.resources.some(r =>
      this.discoveredResources.has(r.type) && r.available >= TRADE_MIN
    );
  }
}
