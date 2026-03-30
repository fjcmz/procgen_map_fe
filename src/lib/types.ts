export type BiomeType =
  | 'OCEAN'
  | 'COAST'
  | 'BEACH'
  | 'SNOW'
  | 'TUNDRA'
  | 'BARE'
  | 'SCORCHED'
  | 'TAIGA'
  | 'SHRUBLAND'
  | 'TEMPERATE_DESERT'
  | 'TEMPERATE_RAIN_FOREST'
  | 'TEMPERATE_DECIDUOUS_FOREST'
  | 'GRASSLAND'
  | 'TROPICAL_RAIN_FOREST'
  | 'TROPICAL_SEASONAL_FOREST'
  | 'SUBTROPICAL_DESERT'
  | 'MARSH'
  | 'ICE';

export interface Cell {
  index: number;
  x: number;
  y: number;
  vertices: [number, number][];
  neighbors: number[];
  elevation: number;
  moisture: number;
  biome: BiomeType;
  isWater: boolean;
  isCoast: boolean;
  riverFlow: number;
  kingdom: number | null;
}

export interface River {
  path: number[];
  width: number;
}

export interface City {
  cellIndex: number;
  name: string;
  isCapital: boolean;
  kingdomId: number;
}

export interface Road {
  path: number[];
}

export interface MapData {
  cells: Cell[];
  rivers: River[];
  cities: City[];
  roads: Road[];
  width: number;
  height: number;
}

export interface GenerateRequest {
  type: 'GENERATE';
  seed: string;
  numCells: number;
  width: number;
  height: number;
}

export type WorkerMessage =
  | { type: 'PROGRESS'; step: string; pct: number }
  | { type: 'DONE'; data: MapData }
  | { type: 'ERROR'; message: string };

export interface LayerVisibility {
  rivers: boolean;
  roads: boolean;
  borders: boolean;
  icons: boolean;
  labels: boolean;
}

export interface BiomeInfo {
  fillColor: string;
  label: string;
  iconType: 'tree' | 'mountain' | 'desert' | 'snow' | null;
}
