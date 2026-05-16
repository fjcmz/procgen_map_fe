import type { StarComposition } from './Star';
import type { PlanetComposition, PlanetSubtype, PlanetBiome } from './Planet';
import type { SatelliteComposition, SatelliteSubtype } from './Satellite';
import type { SolarSystemComposition } from './SolarSystem';
import type { SystemKind, StarSubtype } from './SystemKind';

/**
 * Plain, structured-clone-safe shapes that cross the worker boundary.
 *
 * The class instances under `src/lib/universe/` (Universe, SolarSystem, Star,
 * Planet, Satellite) carry `Map<string, …>` indexes which are NOT
 * structured-clone safe — same pitfall called out in CLAUDE.md for the
 * `World`/`Region`/`Continent` model. The worker keeps the class instances
 * internally for generation and flattens to these plain shapes before
 * postMessage.
 */
/**
 * Five-stage life evolution. Bodies always start at `unicellular` when life
 * first appears in the universe-history simulation; each subsequent stage is
 * a roll of `LIFE_ADVANCE_CHANCE_PER_STEP` (0.07%) in
 * `UniverseHistoryGenerator`. Only `intelligent_animals` unlocks the
 * world-history hand-off — see `bodyToProfile.ts`.
 */
export type LifeLevel =
  | 'unicellular'
  | 'vegetation'
  | 'small_animals'
  | 'large_animals'
  | 'intelligent_animals';

/** Ordered progression — index in this array is the level's "tier" (0..4). */
export const LIFE_LEVELS: LifeLevel[] = [
  'unicellular',
  'vegetation',
  'small_animals',
  'large_animals',
  'intelligent_animals',
];

export interface SatelliteData {
  id: string;
  humanName: string;
  scientificName: string;
  radius: number;
  composition: SatelliteComposition;
  subtype: SatelliteSubtype;
  life: boolean;
  /**
   * Current life evolution stage. Present iff `life === true`. In static
   * (no-history) mode, life=true bodies are always seeded with
   * `intelligent_animals` so world-history generation is reachable without
   * enabling the universe timeline.
   */
  lifeLevel?: LifeLevel;
  biome?: PlanetBiome;
}

export interface PlanetData {
  id: string;
  humanName: string;
  scientificName: string;
  radius: number;
  orbit: number;
  life: boolean;
  /** See `SatelliteData.lifeLevel`. */
  lifeLevel?: LifeLevel;
  composition: PlanetComposition;
  subtype: PlanetSubtype;
  biome?: PlanetBiome;
  satellites: SatelliteData[];
}

export interface StarData {
  id: string;
  humanName: string;
  scientificName: string;
  radius: number;
  brightness: number;
  composition: StarComposition;
  subtype: StarSubtype;
}

export interface SolarSystemData {
  id: string;
  humanName: string;
  scientificName: string;
  composition: SolarSystemComposition;
  /** Taxonomic kind — see {@link SystemKind} / `SYSTEM_KIND_INFO`. */
  kind: SystemKind;
  stars: StarData[];
  /** Empty for standalone kinds (e.g. supermassive_black_hole). */
  planets: PlanetData[];
  /**
   * Wormholes anchored to this system. Only ever non-empty when
   * `isStandaloneKind(kind) === true`: 40% of standalone systems carry one
   * wormhole, 10% carry two, 50% carry none. Each wormhole pairs reciprocally
   * with another in the universe (90% same-galaxy, 10% cross-galaxy when a
   * candidate exists, otherwise falls back to the other bucket).
   */
  wormholes: WormholeData[];
  sectorId: string;
}

/**
 * Plain-data shape for a wormhole. Each instance lives inside exactly one
 * `SolarSystemData.wormholes` array; the universe-wide partner lookup is
 * built by walking every system once on the main thread.
 */
export interface WormholeData {
  id: string;
  scientificName: string;
  /** Parent system id (matches a {@link SolarSystemData.id}). */
  systemId: string;
  /** Parent galaxy id. Cached at generation time for cross-galaxy pairing. */
  galaxyId: string;
  /** Partner wormhole id, or null if no partner was found at generation time. */
  partnerId: string | null;
  /** Fixed offset from the system view's centre, in content-space units. */
  offsetX: number;
  offsetY: number;
}

/**
 * A "sector" groups 2–4 stars within a galaxy via a balanced Voronoi
 * partition. Sectors are generated at universe-generation time by
 * `SectorGenerator` and stable across re-runs for a given galaxy id. `cx`/`cy`
 * is the Voronoi site (also the centroid of the contained stars after Lloyd
 * relaxation) in raw galaxy-frame coordinates, so the renderer can derive the
 * visual mesh directly from `sectors[].cx/cy`.
 *
 * Sectors carry a scientific designation only — no human name.
 */
export interface SectorData {
  id: string;
  scientificName: string;
  cx: number;
  cy: number;
  systemIds: string[];
}

/**
 * Galaxy grouping. Generated for every universe (length ≥ 1) so readers
 * never have to special-case the "no grouping" path. When `solarSystems.length
 * <= 100`, exactly one galaxy `gal_0` wraps every system and the UI hides the
 * galaxy level entirely (legacy single-spiral rendering preserved). When the
 * count exceeds 100, systems are split into equal sequential chunks
 * (`numGalaxies = ceil(N/100)`, `groupSize ≈ ceil(N/numGalaxies)`) and laid
 * out so pairwise center-to-center distance falls in [5×, 10×] of the average
 * galaxy diameter.
 *
 * Layout fields (`cx`, `cy`, `radius`, `spread`) are baked in the worker
 * (deterministic from a `${seed}_galaxy_layout` sub-stream) so the renderer
 * stays purely visual.
 */
export interface GalaxyData {
  id: string;
  humanName: string;
  scientificName: string;
  systemIds: string[];
  cx: number;
  cy: number;
  radius: number;
  spread: number;
  shape: 'spiral' | 'oval';
  sectors: SectorData[];
}

export interface UniverseData {
  id: string;
  humanName: string;
  scientificName: string;
  seed: string;
  solarSystems: SolarSystemData[];
  galaxies: GalaxyData[];
  /**
   * Optional universe history — present only when the generation request
   * carried `generateHistory: true`. Each step represents one million years.
   */
  history?: UniverseHistoryData;
}

/**
 * Universe-history event log entries. Discriminated union via `type`.
 *
 * - `LIFE_APPEARED` fires once per body, the first time life arises. The
 *   level is always `'unicellular'` — kept as a field so future spawn-tier
 *   tweaks don't require a separate event type.
 * - `LIFE_ADVANCED` fires each time a body's biosphere clears the 0.07%
 *   advancement roll and steps one tier up.
 */
export interface UniverseLifeAppearedEvent {
  type: 'LIFE_APPEARED';
  step: number;
  bodyKind: 'planet' | 'satellite';
  bodyId: string;
  level: 'unicellular';
}

export interface UniverseLifeAdvancedEvent {
  type: 'LIFE_ADVANCED';
  step: number;
  bodyKind: 'planet' | 'satellite';
  bodyId: string;
  fromLevel: LifeLevel;
  toLevel: LifeLevel;
}

export type UniverseHistoryEvent =
  | UniverseLifeAppearedEvent
  | UniverseLifeAdvancedEvent;

/**
 * Chronological per-body progression: `lifeAdvancesByBody[bodyId]` is the
 * ordered list of (step, level) entries — first entry is always the
 * `unicellular` spawn step, subsequent entries are advancements. At most 5
 * entries per body. `getLifeLevelAtStep` walks this array.
 */
export interface LifeAdvanceEntry {
  step: number;
  level: LifeLevel;
}

export interface UniverseHistoryData {
  numSteps: number;
  events: UniverseHistoryEvent[];
  /** bodyId → chronological list of life-stage entries. */
  lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]>;
}

/** Worker request — universe pipeline mirrors the planet `WorkerMessage` schema. */
export interface UniverseGenerateRequest {
  type: 'GENERATE';
  seed: string;
  numSolarSystems: number;
  /**
   * When true, run the universe-history simulation after generating the
   * universe. The static 10% life roll on planets/satellites is skipped —
   * life is derived from the timeline instead. Defaults to false.
   */
  generateHistory?: boolean;
  /** Steps to simulate (each = 1 million years). 1–5000, default 5000. */
  numHistorySteps?: number;
}

export type UniverseWorkerMessage =
  | { type: 'PROGRESS'; step: string; pct: number }
  | { type: 'DONE'; data: UniverseData }
  | { type: 'ERROR'; message: string };
