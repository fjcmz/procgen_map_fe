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
  | 'ICE'
  | 'ALPINE_MEADOW';

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
  temperature: number;
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
  foundedYear: number;
  size: 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';
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

export type HistoryEventType =
  | 'WAR' | 'CONQUEST' | 'MERGE' | 'COLLAPSE' | 'EXPANSION'
  | 'FOUNDATION' | 'CONTACT' | 'COUNTRY' | 'ILLUSTRATE'
  | 'WONDER' | 'RELIGION' | 'TRADE' | 'CATACLYSM'
  | 'TECH' | 'TECH_LOSS' | 'EMPIRE';

export interface HistoryEvent {
  type: HistoryEventType;
  year: number;
  initiatorId: number;
  targetId?: number;
  description: string;
  cellsChanged?: number[];
  /** Cell index of the primary geographic location for this event (city, epicenter, etc.) */
  locationCellIndex?: number;
  /** Cell index of the secondary location (e.g. target city for CONTACT/TRADE) */
  targetCellIndex?: number;
  /** TECH-only (Phase 2): the discovered tech field name. */
  field?: string;
  /** TECH-only (Phase 2): the new level after the discovery. */
  level?: number;
  /** TECH-only (Phase 2): identifier of the illustrate that made the discovery. */
  discovererName?: string;
  /** TECH-only (Phase 3): illustrate type — 'science' | 'military' | 'philosophy' | 'industry' | 'religion' | 'art'. */
  discovererType?: string;
  /** TECH/CONQUEST (Phase 3): resolved country display name at the time of the event. */
  countryName?: string;
  /** CONQUEST-only (Phase 3): tech delta acquired by the conqueror, when non-empty. */
  acquiredTechs?: Array<{ field: string; level: number }>;
  /** TECH_LOSS-only (spec stretch §1): fields whose level was decremented (post-decrement; 0 means removed). */
  lostTechs?: Array<{ field: string; newLevel: number }>;
  /** TECH_LOSS-only (spec stretch §1): fields whose loss was absorbed by `government >= 2` (level unchanged). */
  absorbedTechs?: Array<{ field: string; level: number }>;
  /** TRADE-only (spec stretch §2): tech transferred from donor to receiver country via this trade. */
  techDiffusion?: {
    field: string;
    fromCountryName: string;
    toCountryName: string;
    newLevel: number;
  };
}

export interface HistoryYear {
  year: number;
  events: HistoryEvent[];
  ownershipDelta: Map<number, number>;
  worldPopulation: number;
}

/** A pair of cell indices representing the two endpoints of an active trade route. */
export interface TradeRouteEntry {
  cell1: number;
  cell2: number;
  /** Full cell-index path from cell1 to cell2 (coastal-hugging A* for maritime routes). */
  path?: number[];
}

export interface HistoryData {
  countries: Country[];
  years: HistoryYear[];
  numYears: number;
  snapshots: Record<number, Int16Array>;
  /** Active trade route cell-index pairs, snapshotted every 20 years. */
  tradeSnapshots: Record<number, TradeRouteEntry[]>;
  /** Cell indices of cities with standing wonders, snapshotted every 20 years. */
  wonderSnapshots: Record<number, number[]>;
  /** Cell indices of cities with active religions, snapshotted every 20 years. */
  religionSnapshots: Record<number, number[]>;
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
  /** Phase 3: optional aggregate stats forwarded from the worker for introspection. */
  historyStats?: import('./history/HistoryGenerator').HistoryStats;
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

export type MapView = 'terrain' | 'political';

/** 0 = Spring (baseline), 1 = Summer, 2 = Autumn, 3 = Winter */
export type Season = 0 | 1 | 2 | 3;

export interface LayerVisibility {
  rivers: boolean;
  roads: boolean;
  borders: boolean;
  icons: boolean;
  labels: boolean;
  legend: boolean;
  regions: boolean;
  resources: boolean;
  /** Current-year event icons/effects on the map canvas. */
  eventOverlay: boolean;
  /** Persistent active trade route lines between city pairs. */
  tradeRoutes: boolean;
  /** Persistent wonder badges on city icons. */
  wonderMarkers: boolean;
  /** Persistent religion markers on city icons. */
  religionMarkers: boolean;
  /** Small overview minimap in the corner. */
  minimap: boolean;
  /** Shaded relief (hillshading) on land terrain. */
  hillshading: boolean;
  /** Seasonal ice/snow variation and permafrost overlay. */
  seasonalIce: boolean;
}

export interface BiomeInfo {
  fillColor: string;
  label: string;
  iconType: 'tree' | 'mountain' | 'desert' | 'snow' | null;
}
