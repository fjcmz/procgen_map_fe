import type { CityEnvironment, CityMapData, CitySize } from './cityMapTypes';
import { seededPRNG } from '../terrain/noise';

const CANVAS_SIZE = 720;

const GRID_SIZES: Record<CitySize, number> = {
  small: 28,
  medium: 36,
  large: 44,
  metropolis: 54,
  megalopolis: 64,
};

// PR 1 foundation: flat-paper data shape. Populates grid sizing by size tier;
// every geometry field stays empty until PR 2-5 fills them in.
export function generateCityMapV2(
  seed: string,
  cityName: string,
  env: CityEnvironment,
): CityMapData {
  // Lock the seeded-PRNG invariant now so PR 2-5 can't drift to Math.random.
  seededPRNG(`${seed}_city_${cityName}`);

  const n = GRID_SIZES[env.size];

  return {
    grid: { w: n, h: n, tileSize: CANVAS_SIZE / n },
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
    canvasSize: CANVAS_SIZE,
  };
}
