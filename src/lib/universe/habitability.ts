import type {
  BodyOccupancyEntry,
  LifeLevel,
  PlanetData,
  SatelliteData,
  TerraformResult,
  UniverseHistoryData,
} from './types';
import type { PlanetBiome, PlanetSubtype, PlanetComposition } from './Planet';
import type { SatelliteSubtype, SatelliteComposition } from './Satellite';

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

/**
 * Latest occupancy entry for a body at the user-selected step, or `null`.
 * Used by the popup to render "Outpost of X" / "Colonised by Y" /
 * "Terraforming in progress" / "Terraformed by Z in step N" rows.
 *
 * Unlike `currentOccupant` in `expansion.ts` (which masks
 * TERRAFORM_START), this returns the raw latest entry so the UI can
 * distinguish in-progress terraforming from a completed colony.
 */
export function getBodyOccupancyAtStep(
  bodyId: string,
  step: number,
  history: UniverseHistoryData | undefined,
): BodyOccupancyEntry | null {
  if (!history) return null;
  const entries = history.occupancyByBody[bodyId];
  if (!entries || entries.length === 0) return null;
  let latest: BodyOccupancyEntry | null = null;
  for (const entry of entries) {
    if (entry.step > step) break;
    latest = entry;
  }
  return latest;
}

/**
 * Find the terraform record (if any) targeting a body. Used to thread the
 * step at which a body becomes habitable through the popup + the world-
 * map hand-off. Returns the FIRST registered terraform — re-terraforming
 * isn't supported in Mode A. Cost is O(N) over the terraform array, which
 * is small (≤ MAX_CIVS_PER_UNIVERSE × few attempts).
 */
export function findTerraformForBody(
  bodyId: string,
  history: UniverseHistoryData | undefined,
): TerraformResult | null {
  if (!history) return null;
  for (const t of history.terraforms) {
    if (t.bodyId === bodyId) return t;
  }
  return null;
}

/**
 * Step-derived body state. Used by the world-map hand-off in `App.tsx` to
 * patch a body's biome / lifeLevel / composition / subtype to match its
 * state at the user-selected step. After a terraform completes, the body's
 * state on the snapshot reflects the new (habitable) biome — this helper
 * exposes that to callers without them having to walk the terraform list
 * themselves.
 *
 * `staticPlanet` / `staticSatellite` is the body as it appears in the
 * serialised `UniverseData` (i.e. its end-of-time state — terraforms are
 * already mutated in by the worker). For pre-completion steps, this helper
 * "rolls back" by reading from the matching `TerraformResult`.
 */
export interface BodyStateAtStep {
  life: boolean;
  lifeLevel: LifeLevel | undefined;
  biome: PlanetBiome | undefined;
  subtype: PlanetSubtype | SatelliteSubtype;
  composition: PlanetComposition | SatelliteComposition;
  /** True iff this body has been terraformed at this step (or earlier). */
  isTerraformed: boolean;
  /** True iff this body has a terraform that hasn't yet completed at
   *  this step. */
  isTerraformInProgress: boolean;
}

export function getBodyStateAtStep(
  body: PlanetData | SatelliteData,
  step: number,
  history: UniverseHistoryData | undefined,
): BodyStateAtStep {
  const liveLevel = getLifeLevelAtStep(body.id, body.lifeLevel, step, history);
  const terraform = findTerraformForBody(body.id, history);
  // The body's serialised composition / subtype / biome reflect end-of-
  // time (terraforms already applied). For pre-completion steps, reach
  // into the terraform record's preserved originals to render the
  // body's true visual at the selected step.
  if (terraform && step < terraform.completeStep) {
    return {
      life: liveLevel !== undefined,
      lifeLevel: liveLevel,
      biome: terraform.originalBiome,
      subtype: terraform.originalSubtype,
      composition: terraform.originalComposition,
      isTerraformed: false,
      isTerraformInProgress: step >= terraform.startStep,
    };
  }
  return {
    life: liveLevel !== undefined,
    lifeLevel: liveLevel,
    biome: body.biome,
    subtype: body.subtype,
    composition: body.composition,
    isTerraformed: terraform !== null && step >= terraform.completeStep,
    isTerraformInProgress: false,
  };
}

