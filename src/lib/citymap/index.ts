// V1 (tile-based) — frozen during the PR 1-5 migration.
export type {
  CityEnvironment,
  CityMapData,
  CityBlock,
  CityBuilding,
  CityLandmark,
  CitySize,
  DistrictRole,
} from './cityMapTypes';
export { deriveCityEnvironment, generateCityMap } from './cityMapGenerator';
export { renderCityMap } from './cityMapRenderer';

// V2 (Voronoi-polygon-based) — see specs/City_style_phases.md.
//   PR 1 introduces: CityMapDataV2, CityPolygon, CityBlockV2, CityBuildingV2,
//                    CityLandmarkV2, POLYGON_COUNTS, generateCityMapV2,
//                    renderCityMapV2.
//   PR 2-5 extend CityMapDataV2 with walls, river, roads, blocks, buildings,
//   landmarks, and labels — all operating on the same polygon graph.
export type {
  CityMapDataV2,
  CityPolygon,
  CityBlockV2,
  CityBuildingV2,
  CityLandmarkV2,
} from './cityMapTypesV2';
export { generateCityMapV2, POLYGON_COUNTS } from './cityMapGeneratorV2';
export { renderCityMapV2 } from './cityMapRendererV2';
// PR 4 (slice) — open spaces (squares + markets + parks). Polygon-keyed
// output flows into `CityMapDataV2.openSpaces`. Blocks + landmarks (the
// rest of spec PR 4) are deferred and stay empty for now.
export { generateOpenSpaces } from './cityMapOpenSpaces';
export type { OpenSpaceEntry } from './cityMapOpenSpaces';
