import type { BiomeType, Cell, City, MapData } from '../types';
import { seededPRNG, createNoiseSamplers, fbm } from '../terrain/noise';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';

// Suppress unused-import warnings for utilities used by future PRs.
void seededPRNG; void createNoiseSamplers; void fbm;

// ── Public types ──

export type CitySize = 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';

export type DistrictRole = 'market' | 'residential' | 'civic' | 'harbor' | 'agricultural' | 'slum';

export interface CityEnvironment {
  biome: BiomeType;
  isCoastal: boolean;
  hasRiver: boolean;
  waterSide: 'north' | 'south' | 'east' | 'west' | null;
  elevation: number;
  moisture: number;
  temperature: number;
  isCapital: boolean;
  size: CitySize;
  wonderCount: number;
  religionCount: number;
  isRuin: boolean;
  neighborBiomes: BiomeType[];
}

export interface CityBlock {
  tiles: [number, number][];
  role: DistrictRole;
  name: string;
}

export interface CityBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
}

export interface CityLandmark {
  tile: [number, number];
  type: 'castle' | 'palace' | 'temple' | 'monument';
}

export interface CityMapData {
  grid: { w: number; h: number; tileSize: number };
  wallPath: [number, number][];
  gates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' }[];
  river: { edges: [[number, number], [number, number]][]; islands: Set<string> } | null;
  bridges: [[number, number], [number, number]][];
  roads: [number, number][][];
  streets: [number, number][][];
  blocks: CityBlock[];
  openSpaces: { kind: 'square' | 'market' | 'park'; tiles: [number, number][] }[];
  buildings: CityBuilding[];
  landmarks: CityLandmark[];
  districtLabels: { text: string; cx: number; cy: number; angle: number }[];
  canvasSize: number;
}

// ── Constants ──

const CANVAS_SIZE = 720;

const GRID_SIZES: Record<CitySize, number> = {
  small: 28,
  medium: 36,
  large: 44,
  metropolis: 54,
  megalopolis: 64,
};

// ── Environment derivation ──

export function deriveCityEnvironment(
  city: City,
  cells: Cell[],
  mapData: MapData,
  citySizesAtYear?: Uint8Array,
  selectedYear?: number,
  wonderCellIndices?: number[],
  religionCellIndices?: number[],
): CityEnvironment {
  const cell = cells[city.cellIndex];
  const neighborCells = cell.neighbors.map(i => cells[i]);

  // Determine water side
  let waterSide: 'north' | 'south' | 'east' | 'west' | null = null;
  if (cell.isCoast || neighborCells.some(n => n.isWater)) {
    let wx = 0, wy = 0, wcount = 0;
    for (const n of neighborCells) {
      if (n.isWater) {
        wx += n.x - cell.x;
        wy += n.y - cell.y;
        wcount++;
      }
    }
    if (wcount > 0) {
      wx /= wcount;
      wy /= wcount;
      if (Math.abs(wx) > Math.abs(wy)) {
        waterSide = wx > 0 ? 'east' : 'west';
      } else {
        waterSide = wy > 0 ? 'south' : 'north';
      }
    }
  }

  // Resolve dynamic size
  let size: CitySize = city.size;
  if (citySizesAtYear) {
    const cityIdx = mapData.cities.indexOf(city);
    if (cityIdx >= 0 && citySizesAtYear[cityIdx] != null) {
      size = INDEX_TO_CITY_SIZE[citySizesAtYear[cityIdx]] ?? city.size;
    }
  }

  const isRuin = city.isRuin && (selectedYear == null || city.ruinYear <= selectedYear);

  return {
    biome: cell.biome,
    isCoastal: cell.isCoast || neighborCells.some(n => n.isWater),
    hasRiver: cell.riverFlow > 0,
    waterSide,
    elevation: cell.elevation,
    moisture: cell.moisture,
    temperature: cell.temperature,
    isCapital: city.isCapital,
    size,
    wonderCount: wonderCellIndices?.filter(i => i === city.cellIndex).length ?? 0,
    religionCount: religionCellIndices?.filter(i => i === city.cellIndex).length ?? 0,
    isRuin,
    neighborBiomes: neighborCells.map(n => n.biome),
  };
}

// ── Main generator ──

export function generateCityMap(seed: string, cityName: string, env: CityEnvironment): CityMapData {
  // Suppress unused-parameter warnings for args used by future PRs.
  void seed; void cityName; void env;

  const gridW = GRID_SIZES[env.size];
  const tileSize = CANVAS_SIZE / gridW;

  return {
    grid: { w: gridW, h: gridW, tileSize },
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
