// V2 (Voronoi-polygon-based) — see specs/City_style_phases.md.
export type {
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
  CityBlockV2,
  CityBlockNewV2,
  CityBuildingV2,
  CityLandmarkV2,
  LandmarkV2,
  CitySize,
  DistrictRole,
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
// PR 4 (slice) — open spaces (squares + markets + parks). Polygon-keyed
// output flows into `CityMapDataV2.openSpaces`.
export { generateOpenSpaces } from './cityMapOpenSpaces';
export type { OpenSpaceEntry } from './cityMapOpenSpaces';
// PR 4 (slice) — landmarks (castle / palace / temple / monument). Polygon-
// keyed output flows into `CityMapDataV2.landmarks`. Consumes `blocks` and
// `openSpaces` from the earlier PR 4 slices for candidate pooling.
export { generateLandmarks } from './cityMapLandmarks';
