import type { CityEnvironment, CityMapData, CitySize } from './cityMapTypes';
import { seededPRNG } from '../terrain/noise';
import { computeWallsAndGates } from './walls';

const CANVAS_SIZE = 720;

const GRID_SIZES: Record<CitySize, number> = {
  small: 28,
  medium: 36,
  large: 44,
  metropolis: 54,
  megalopolis: 64,
};

// PR 2: grid + radial/FBM wall footprint + cardinal gates. Every other
// geometry field stays empty until PR 3-5 fills it in.
export function generateCityMapV2(
  seed: string,
  cityName: string,
  env: CityEnvironment,
): CityMapData {
  const innerSeed = `${seed}_city_${cityName}`;
  // Lock the seeded-PRNG invariant now so PR 3-5 can't drift to Math.random.
  seededPRNG(innerSeed);

  const n = GRID_SIZES[env.size];
  const grid = { w: n, h: n, tileSize: CANVAS_SIZE / n };

  const { wallPath, gates } = computeWallsAndGates(grid, env, innerSeed);

  return {
    grid,
    wallPath,
    gates,
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
