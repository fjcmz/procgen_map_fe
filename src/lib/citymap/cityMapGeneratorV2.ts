import type { CityEnvironment, CityMapData } from './cityMapTypes';
import { seededPRNG } from '../terrain/noise';

// PR 0 skeleton: returns an empty-valid CityMapData. PR 1 will define the
// real Voronoi data contract and replace the placeholder grid field.
export function generateCityMapV2(
  seed: string,
  cityName: string,
  env: CityEnvironment,
): CityMapData {
  // Lock the seeded-PRNG invariant now so PR 1-5 can't drift to Math.random.
  seededPRNG(`${seed}_city_${cityName}`);
  void env;

  return {
    grid: { w: 0, h: 0, tileSize: 0 },
    wallPath: [],
    gates: [],
    river: null,
    bridges: [],
    roads: [],
    streets: [],
    blocks: [],
    openSpaces: [],
    buildings: [],
    landmarks: [],
    districtLabels: [],
    canvasSize: 720,
  };
}
