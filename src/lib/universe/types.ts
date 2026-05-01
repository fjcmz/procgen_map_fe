import type { StarComposition } from './Star';
import type { PlanetComposition, PlanetBiome } from './Planet';
import type { SatelliteComposition } from './Satellite';
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

export interface UniverseData {
  id: string;
  humanName: string;
  scientificName: string;
  seed: string;
  solarSystems: SolarSystemData[];
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
