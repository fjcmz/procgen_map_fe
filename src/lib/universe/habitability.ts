import type {
  LifeLevel,
  PlanetData,
  SatelliteData,
  UniverseHistoryData,
} from './types';

/**
 * Habitable-zone orbit bounds (inclusive). Aligned with
 * `PlanetGenerator.pickPlanetSubtype` bands: <6 is lava-favored (too hot),
 * >14 is carbon/ice_rock (too cold). Anything outside this window is treated
 * as inhospitable to life by the universe-history simulation.
 */
export const HABITABLE_ORBIT_MIN = 6;
export const HABITABLE_ORBIT_MAX = 14;

export function isPlanetHabitable(planet: PlanetData): boolean {
  return (
    planet.composition === 'ROCK' &&
    planet.orbit >= HABITABLE_ORBIT_MIN &&
    planet.orbit <= HABITABLE_ORBIT_MAX
  );
}

export function isSatelliteHabitable(
  satellite: SatelliteData,
  parentPlanet: PlanetData,
): boolean {
  return (
    satellite.composition === 'ROCK' &&
    parentPlanet.orbit >= HABITABLE_ORBIT_MIN &&
    parentPlanet.orbit <= HABITABLE_ORBIT_MAX
  );
}

/**
 * Step-derived life-level lookup for any body. When no history is attached,
 * falls back to the body's static `.lifeLevel` (or undefined when life is
 * absent in static mode). Used by the canvas + popup + world-handoff to read
 * the body's biosphere stage at the user-selected timeline step.
 *
 * The per-body entries in `lifeAdvancesByBody` are chronological. A linear
 * scan is fine — each body has at most `LIFE_LEVELS.length` (= 5) entries.
 */
export function getLifeLevelAtStep(
  bodyId: string,
  staticLevel: LifeLevel | undefined,
  step: number,
  history: UniverseHistoryData | undefined,
): LifeLevel | undefined {
  if (!history) return staticLevel;
  const entries = history.lifeAdvancesByBody[bodyId];
  if (!entries || entries.length === 0) return undefined;
  let current: LifeLevel | undefined;
  for (const entry of entries) {
    if (entry.step > step) break;
    current = entry.level;
  }
  return current;
}

