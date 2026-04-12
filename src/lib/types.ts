/**
 * Re-exported from `history/timeline/Tech.ts` so UI modules (Timeline.tsx)
 * don't have to reach into the history layer.
 */
export type { TechField } from './history/timeline/Tech';
import type { TechField } from './history/timeline/Tech';

/**
 * Spec stretch §5: per-field running-max time series, precomputed in
 * `HistoryGenerator.generate()` during the same walk that produces
 * `HistoryStats.peakTechLevelByField`. One `Uint8Array` per field, indexed
 * by year offset (0..numYears-1). `Uint8Array` is safe because tech levels
 * never realistically exceed ~30 in practice (cap 255).
 */
export interface TechTimeline {
  byField: Record<TechField, Uint8Array>;
}

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
  | 'ALPINE_MEADOW'
  | 'LAKE';

export type RegionBiome = 'temperate' | 'arid' | 'desert' | 'swamp' | 'tropical' | 'tundra';

export interface RegionResourceData {
  /** ResourceType union string (see `history/physical/ResourceCatalog.ts`). */
  type: string;
  /** `Resource.original` — the natural endowment, time-invariant. */
  amount: number;
  /** Cell index this resource is spatially attached to. */
  cellIndex: number;
  /**
   * Tech field the owning country must invest in to unlock this resource for
   * trade. Optional for backwards compatibility — missing means "unlocked at
   * year 0 with no tech investment" (the old behavior before tech-gating).
   */
  requiredTechField?: TechField;
  /**
   * Minimum level of `requiredTechField` required to unlock. Optional for
   * backwards compatibility — missing / 0 means always unlocked.
   */
  requiredTechLevel?: number;
}

export interface RegionData {
  id: string;
  cellIndices: number[];
  biome: RegionBiome;
  continentId: string;
  primaryResourceType?: string;
  resources?: RegionResourceData[];
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
  /**
   * Secondary polygon loop for cells that straddle the east-west seam via a
   * ghost point. The main Voronoi pass is clipped to `[0, width]`, so a
   * wrap-neighbor pair has a ghost-owned sliver inside the box near `x=0` or
   * `x=width` that the regular cell iteration never visits — leaving a
   * parchment-colored gap at the seam. `wrapVertices` holds the ghost
   * polygon (still in the `[0, width]` frame) attributed to the real cell
   * it represents, so `cellPath` can draw it as a second subpath and fill
   * the gap with the correct biome. Undefined for interior cells.
   */
  wrapVertices?: [number, number][];
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
  /** True for cells materialized by `fillDepressions` — small closed basins
   *  that become visible inland lakes. Short-circuits assignBiomes to 'LAKE'
   *  (after the polar ICE block, so cold lakes can still freeze). */
  isLake?: boolean;
}

export interface River {
  path: number[];
  maxFlow: number;
}

export interface City {
  cellIndex: number;
  name: string;
  isCapital: boolean;
  kingdomId: number;
  foundedYear: number;
  size: 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';
  isRuin: boolean;
  ruinYear: number;
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

/** Discriminated union representing a user-selected entity on the map. */
export type SelectedEntity =
  | { type: 'city'; cellIndex: number }
  | { type: 'country'; countryIndex: number }
  | { type: 'empire'; empireId: string; snapshotYear: number };

export type HistoryEventType =
  | 'WAR' | 'CONQUEST' | 'MERGE' | 'COLLAPSE' | 'EXPANSION'
  | 'FOUNDATION' | 'CONTACT' | 'COUNTRY' | 'ILLUSTRATE'
  | 'WONDER' | 'RELIGION' | 'TRADE' | 'CATACLYSM'
  | 'TECH' | 'TECH_LOSS' | 'EMPIRE' | 'RUIN'
  | 'TERRITORIAL_EXPANSION' | 'SETTLEMENT' | 'DISCOVERY';

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
  /** TECH-only (spec stretch §3): flavor name for the discovered tech, e.g. "Astronomy". */
  displayName?: string;
  /** TECH-only (Phase 2): identifier of the illustrate that made the discovery. */
  discovererName?: string;
  /** TECH-only (Phase 3): illustrate type — 'science' | 'military' | 'philosophy' | 'industry' | 'religion' | 'art'. */
  discovererType?: string;
  /** TECH/CONQUEST (Phase 3): resolved country display name at the time of the event. */
  countryName?: string;
  /** CONQUEST-only (Phase 3): tech delta acquired by the conqueror, when non-empty. Spec stretch §3: each entry may carry an optional `displayName` flavor string. */
  acquiredTechs?: Array<{ field: string; level: number; displayName?: string }>;
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
  /** RELIGION-only (spec stretch §4): which origin-country tech bonuses are boosting this religion's propagation (art ×0.02 adherence drift, government up to ×0.03 drift + Path 2 outward-expansion weighting). `'none'` is omitted rather than stored. */
  propagationReason?: 'art' | 'government' | 'both';
  /** TERRITORIAL_EXPANSION-only: number of cells claimed in this expansion event. */
  expansionCellCount?: number;
  /** SETTLEMENT-only: name of the city settled in expansion territory. */
  settlementCityName?: string;
  /**
   * DISCOVERY-only: the resource newly unlocked for trade in the region,
   * and the tech gate that was crossed. Used by the Events tab and
   * the locked-badge UI in the Details tab.
   */
  discoveredResource?: {
    type: string;
    field: TechField;
    level: number;
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

/**
 * Phase 4 (spec: overlays_tabs.md): empire membership at a given snapshot year.
 * One entry per empire alive at that year. Used by the Hierarchy (Realm) tab
 * to render the Empire → Country → City tree without replaying thousands of
 * events on the main thread.
 */
export interface EmpireSnapshotEntry {
  /** Internal empire id (stable across snapshots). */
  empireId: string;
  /** Display name, e.g. "Empire of <founder-capital>". */
  name: string;
  /** Index into HistoryData.countries (founder country). */
  founderCountryIndex: number;
  /** Indices into HistoryData.countries; includes the founder; sorted ascending. */
  memberCountryIndices: number[];
}

export interface HistoryData {
  countries: Country[];
  years: HistoryYear[];
  numYears: number;
  /** Absolute calendar year at which the simulation begins (in range [-3000, -1001]). Add to a relative year index to get the display year. */
  startOfTime: number;
  snapshots: Record<number, Int16Array>;
  /** Active trade route cell-index pairs, snapshotted every 20 years. */
  tradeSnapshots: Record<number, TradeRouteEntry[]>;
  /** Roads built so far, snapshotted every 20 years. Monotonically growing. */
  roadSnapshots: Record<number, Road[]>;
  /** Cell indices of cities with standing wonders, snapshotted every 20 years. */
  wonderSnapshots: Record<number, number[]>;
  /** Cell indices of cities with active religions, snapshotted every 20 years. */
  religionSnapshots: Record<number, number[]>;
  /** Phase 4: empire membership at every 20th year, aligned with `snapshots`. */
  empireSnapshots: Record<number, EmpireSnapshotEntry[]>;
  /** Per-city population at every 20th year + final year. Key: year index, value: cellIndex → population. */
  populationSnapshots: Record<number, Record<number, number>>;
  /** Spec stretch §5: per-field running-max tech level, indexed by year offset. */
  techTimeline?: TechTimeline;
  /** Per-city size tier (0–4) snapshotted every 20 years, aligned with `snapshots`. */
  citySizeSnapshots?: Record<number, Uint8Array>;
  /** Expansion flags: 1 = expansion territory, 0 = core/unclaimed. Snapshotted every 20 years + final year. */
  expansionSnapshots?: Record<number, Uint8Array>;
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

export interface TerrainProfile {
  // --- Elevation / tectonics ---
  numContinentalMin: number;
  numContinentalMax: number;
  numOceanicMin: number;
  numOceanicMax: number;
  continentalGrowthMin: number;
  continentalGrowthMax: number;
  seamBoostMin: number;
  seamBoostMax: number;
  seamSpreadRings: number;
  convergentCCBoost: number;
  convergentOCBoost: number;
  polarIceStart: number;
  polarIceEnd: number;
  polarNoiseAmplitude: number;
  thermalErosionIters: number;
  thermalErosionTalus: number;

  // --- Moisture ---
  latAmplitude: number;
  latPolarDamping: number;
  latFrequency: number;
  latBias: number;
  coastalMoistureSensitivity: number;
  continentalityStrength: number;
  continentalityMidpoint: number;
  shadowStrength: number;
  mountainThreshold: number;
  elevationScale: number;

  // --- Temperature ---
  contStrength: number;
  maritimeStrength: number;
  windwardBonus: number;
  lapseRate: number;
  currentLandInfluence: number;
  tempNoiseAmplitude: number;

  // --- Biomes ---
  iceTempThreshold: number;
  snowTempThreshold: number;
  tundraTempThreshold: number;
  tempMoistureShift: number;

  // --- Ocean currents ---
  warmCurrentStrength: number;
  coldCurrentStrength: number;

  // --- Hydraulic erosion ---
  erosionK: number;
  erosionIterations: number;

  // --- Global modifiers (Phase 3) ---
  globalMoistureOffset: number;
  globalTempOffset: number;

  // --- River control ---
  suppressRivers: boolean;
  riverFlowThreshold: number;

  // --- Elevation shaping ---
  /** Power curve applied to normalized elevation. >1 flattens terrain
   *  (pushes elevations toward 0). Default: 1.0 (no effect). */
  elevationPower: number;

  // --- Biome overrides ---
  /** When true, low-elevation high-moisture forest biomes are converted
   *  to MARSH in assignBiomes(). Default: false. */
  marshOverride: boolean;

  // --- Depression fill / lakes ---
  /** Max connected-component size (in cells) for a closed depression to
   *  become a visible LAKE. Larger basins stay as land and get a virtual
   *  drainage surface via `drainageElevation` instead. Default: 20. */
  lakeMaxSize: number;
  /** Min connected-component size (in cells) for a closed depression to
   *  become a visible LAKE. Smaller components are left as drained land
   *  (no LAKE biome) and filter out FBM-noise micropits that would otherwise
   *  pepper the map with 1–3 cell "ponds". Default: 4. */
  lakeMinSize: number;
  /** Epsilon slope used by the Priority-Flood pass in `fillDepressions`
   *  to guarantee strictly-monotonic drainage. Default: 1e-5. */
  depressionFillEpsilon: number;
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
  profileName?: string;
  profileOverrides?: Partial<TerrainProfile>;
  resourceRarityMode?: ResourceRarityMode;
}

export type WorkerMessage =
  | { type: 'PROGRESS'; step: string; pct: number }
  | { type: 'TERRAIN_READY'; data: Pick<MapData, 'cells' | 'rivers' | 'width' | 'height'> }
  | { type: 'DONE'; data: MapData }
  | { type: 'ERROR'; message: string };

export type MapView = 'terrain' | 'political';

export type PoliticalMode = 'countries' | 'empires';

/**
 * Controls the spawn probability of uncommon/rare/veryRare resources
 * during world generation via `RARITY_WEIGHTS_BY_MODE` in `ResourceCatalog.ts`.
 * - scarce:   common 100 / uncommon 40 / rare 15 / veryRare 8
 * - natural:  common 100 / uncommon 40 / rare 30 / veryRare 16
 * - abundant: common 120 / uncommon 60 / rare 25 / veryRare 15
 */
export type ResourceRarityMode = 'scarce' | 'natural' | 'abundant';

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
