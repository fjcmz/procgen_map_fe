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

export type RegionBiome = 'temperate' | 'arid' | 'desert' | 'swamp' | 'tropical' | 'tundra';

export interface RegionData {
  id: string;
  cellIndices: number[];
  biome: RegionBiome;
  continentId: string;
  primaryResourceType?: string;
}

export interface ContinentData {
  id: string;
  regionIds: string[];
}

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
  regionId?: string;
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

export interface Country {
  id: number;
  name: string;
  capitalCellIndex: number;
  isAlive: boolean;
  absorbedById?: number;
}

export type HistoryEventType = 'WAR' | 'CONQUEST' | 'MERGE' | 'COLLAPSE' | 'EXPANSION';

export interface HistoryEvent {
  type: HistoryEventType;
  year: number;
  initiatorId: number;
  targetId?: number;
  description: string;
  cellsChanged?: number[];
}

export interface HistoryYear {
  year: number;
  events: HistoryEvent[];
  ownershipDelta: Map<number, number>;
}

export interface HistoryData {
  countries: Country[];
  years: HistoryYear[];
  numYears: number;
  snapshots: Record<number, Int16Array>;
}

export interface MapData {
  cells: Cell[];
  rivers: River[];
  cities: City[];
  roads: Road[];
  width: number;
  height: number;
  history?: HistoryData;
  regions?: RegionData[];
  continents?: ContinentData[];
}

export interface GenerateRequest {
  type: 'GENERATE';
  seed: string;
  numCells: number;
  width: number;
  height: number;
  waterRatio: number;
  generateHistory?: boolean;
  numSimYears?: number;
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
  legend: boolean;
  regions: boolean;
  resources: boolean;
}

export interface BiomeInfo {
  fillColor: string;
  label: string;
  iconType: 'tree' | 'mountain' | 'desert' | 'snow' | null;
}
