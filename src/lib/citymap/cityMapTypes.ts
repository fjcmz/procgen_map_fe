import type { BiomeType } from '../types';

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
