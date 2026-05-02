import type { StarComposition } from './Star';
import type { PlanetComposition, PlanetSubtype, PlanetBiome } from './Planet';
import type { SatelliteComposition, SatelliteSubtype } from './Satellite';
import type { SolarSystemComposition } from './SolarSystem';

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
export interface SatelliteData {
  id: string;
  humanName: string;
  scientificName: string;
  radius: number;
  composition: SatelliteComposition;
  subtype: SatelliteSubtype;
  life: boolean;
  biome?: PlanetBiome;
}

export interface PlanetData {
  id: string;
  humanName: string;
  scientificName: string;
  radius: number;
  orbit: number;
  life: boolean;
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
}

export interface SolarSystemData {
  id: string;
  humanName: string;
  scientificName: string;
  composition: SolarSystemComposition;
  stars: StarData[];
  planets: PlanetData[];
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
}

export interface UniverseData {
  id: string;
  humanName: string;
  scientificName: string;
  seed: string;
  solarSystems: SolarSystemData[];
  galaxies: GalaxyData[];
}

/** Worker request — universe pipeline mirrors the planet `WorkerMessage` schema. */
export interface UniverseGenerateRequest {
  type: 'GENERATE';
  seed: string;
  numSolarSystems: number;
}

export type UniverseWorkerMessage =
  | { type: 'PROGRESS'; step: string; pct: number }
  | { type: 'DONE'; data: UniverseData }
  | { type: 'ERROR'; message: string };
