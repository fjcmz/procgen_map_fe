import type {
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
 * Step-derived life lookup for any body. When no history is attached, falls
 * back to the body's static `life` flag (the legacy generation behaviour).
 * Used by the canvas + popup + world-handoff to decide whether life is
 * "present" at the user-selected timeline step.
 */
export function isAliveAtStep(
  bodyId: string,
  staticLife: boolean,
  step: number,
  history: UniverseHistoryData | undefined,
): boolean {
  if (!history) return staticLife;
  const appearedAt = history.lifeAppearedAtStep[bodyId];
  if (appearedAt === undefined) return false;
  return step >= appearedAt;
}
