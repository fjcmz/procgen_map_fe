// V2 (Voronoi-polygon-based) — see specs/City_style_phases.md.
export type {
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
  CityBlockNewV2,
  CityBuildingV2,
  LandmarkV2,
  CitySize,
  DistrictType,
  LandmarkKind,
} from './cityMapTypesV2';
export {
  deriveCityEnvironment,
  generateCityMapV2,
  POLYGON_COUNTS,
  CANVAS_POLYGON_COUNT,
} from './cityMapGeneratorV2';
export { selectCityFootprint } from './cityMapShape';
export type { CityShapeType, CityFootprintResult } from './cityMapShape';
export { renderCityMapV2 } from './cityMapRendererV2';
