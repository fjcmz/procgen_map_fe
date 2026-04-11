export { Resource, TRADE_MIN, TRADE_USE, getResourceCategory } from './Resource';
export type { ResourceType, ResourceCategory } from './Resource';
export {
  RESOURCE_SPECS,
  RESOURCE_SPEC_BY_TYPE,
  RARITY_WEIGHTS,
  getResourceSpec,
  getLegacyCategory,
  selectPrimary,
} from './ResourceCatalog';
export type {
  ResourceDomain,
  ResourceRarity,
  LegacyResourceCategory,
  ClimateRange,
  HabitatSpec,
  AbundanceDice,
  ResourceSpec,
} from './ResourceCatalog';
export { CityEntity, pickCitySize, rollInitialPopulation, CITY_SIZE_WEIGHTS, CITY_SIZE_TRADE_CAP } from './CityEntity';
export type { CitySize } from './CityEntity';
export { Region, REGION_BIOME_GROWTH, BIOME_TO_REGION_BIOME } from './Region';
export type { RegionBiome } from './Region';
export { Continent } from './Continent';
export { World } from './World';
export {
  ResourceGenerator,
  resourceGenerator,
  buildRegionProfile,
  computeFitScore,
} from './ResourceGenerator';
export type { RegionProfile } from './ResourceGenerator';
export { CityGenerator, cityGenerator } from './CityGenerator';
export { RegionGenerator, regionGenerator } from './RegionGenerator';
export { ContinentGenerator, continentGenerator } from './ContinentGenerator';
export { WorldGenerator, worldGenerator } from './WorldGenerator';
export { CityVisitor, cityVisitor } from './CityVisitor';
export { RegionVisitor, regionVisitor } from './RegionVisitor';
