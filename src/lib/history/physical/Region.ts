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

/**
 * Per-cell carrying capacity by fine-grained cell biome (20 types).
 * Calibrated so ~32 cells of grassland/forest ≈ old REGION_BIOME_CAPACITY for temperate (2.5M).
 * Used by YearGenerator step 4 to compute city carrying capacity from owned cells.
 */
export const CELL_BIOME_CAPACITY: Record<BiomeType, number> = {
  // Land biomes — calibrated so 60 cells ≈ old REGION_BIOME_CAPACITY.
  // Temperate target: 2.5M / 60 ≈ 42K average.
  GRASSLAND:                     47_500,
  TEMPERATE_DECIDUOUS_FOREST:    42_500,
  TEMPERATE_RAIN_FOREST:         40_000,
  TAIGA:                         30_000,
  ALPINE_MEADOW:                 25_000,
  TROPICAL_SEASONAL_FOREST:      15_000,
  TROPICAL_RAIN_FOREST:          12_500,
  SHRUBLAND:                     18_750,
  MARSH:                          7_500,
  TEMPERATE_DESERT:              13_750,
  SUBTROPICAL_DESERT:             4_500,
  BARE:                           3_750,
  SCORCHED:                       2_500,
  TUNDRA:                         4_500,
  SNOW:                           3_000,
  ICE:                            1_250,
  // Water biomes — modest capacity (fishing, trade)
  COAST:                          6_250,
  BEACH:                          8_750,
  OCEAN:                          2_000,
  LAKE:                          11_250,
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
  /** Per-cell resource index (worker-only). Keys are cell indices, values
   *  are the subset of `resources` that belong to that cell. Populated by
   *  `ResourceGenerator.generateForRegion`. */
  cellResources: Map<number, Resource[]> = new Map();
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
