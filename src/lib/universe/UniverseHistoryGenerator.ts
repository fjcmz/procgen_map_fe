import type { Universe } from './Universe';
import type { Planet, PlanetBiome, RockPlanetSubtype } from './Planet';
import type { Satellite, RockSatelliteSubtype } from './Satellite';
import type { UniverseHistoryData, UniverseHistoryEvent } from './types';
import { isPlanetHabitable, isSatelliteHabitable } from './habitability';
import { seededPRNG } from '../terrain/noise';

const LIFE_CHANCE_PER_STEP = 0.005;

/**
 * Universe-history simulation. Runs after `universeGenerator.generate(...)`
 * when the request carries `generateHistory: true`. For every body in the
 * habitable zone, walks `numSteps` 1 million-year ticks and rolls a 0.5%
 * chance per step for life to appear. First success records the step,
 * picks a biome, and mutates the underlying entity so the serializer
 * downstream sees `life=true` + the right biome.
 *
 * All randomness routes through a per-body isolated sub-stream
 * (`${seed}_universe_life_${bodyId}`) so that adding future event types
 * (extinctions, civilizations) won't perturb existing life timings and the
 * history-on / history-off branches stay independent.
 */
function pickBiome(rng: () => number): PlanetBiome {
  const r = rng();
  if (r < 0.40) return 'default';
  if (r < 0.50) return 'desert';
  if (r < 0.60) return 'ice';
  if (r < 0.70) return 'forest';
  if (r < 0.80) return 'swamp';
  if (r < 0.90) return 'mountains';
  return 'ocean';
}

/**
 * Biome → rock-planet subtype map. Mirrors the same lookup used inside
 * `PlanetGenerator.pickPlanetSubtype` for life-bearing rock planets — kept in
 * sync so the visual subtype matches the assigned biome when life is granted
 * by the timeline (rather than at generation time).
 */
const PLANET_BIOME_TO_SUBTYPE: Record<PlanetBiome, RockPlanetSubtype> = {
  default: 'terrestrial',
  forest: 'terrestrial',
  ocean: 'ocean',
  desert: 'desert',
  swamp: 'terrestrial',
  ice: 'ice_rock',
  mountains: 'terrestrial',
};

/**
 * Satellite biome → subtype is much simpler: the original satellite generator
 * uses `desert_moon` for desert-biome rock moons and `terrestrial` otherwise.
 */
function satelliteSubtypeForBiome(biome: PlanetBiome): RockSatelliteSubtype {
  return biome === 'desert' ? 'desert_moon' : 'terrestrial';
}

export class UniverseHistoryGenerator {
  generate(universe: Universe, seed: string, numSteps: number): UniverseHistoryData {
    const events: UniverseHistoryEvent[] = [];
    const lifeAppearedAtStep: Record<string, number> = {};

    // Walk planets in their canonical generation order. Satellites are walked
    // alongside their parent so events within the same step land in a stable
    // "planet first, then its moons" order — keeps the events list readable.
    for (const ss of universe.solarSystems) {
      for (const planet of ss.planets) {
        if (isPlanetHabitable(planet)) {
          rollPlanet(planet, seed, numSteps, events, lifeAppearedAtStep);
        }
        for (const satellite of planet.satellites) {
          if (isSatelliteHabitable(satellite, planet)) {
            rollSatellite(satellite, seed, numSteps, events, lifeAppearedAtStep);
          }
        }
      }
    }

    // Per-body iteration emits events grouped by body; resort by step so the
    // event log reads chronologically. Stable sort preserves the
    // planet-before-its-moons order within a tie.
    events.sort((a, b) => a.step - b.step);

    return { numSteps, events, lifeAppearedAtStep };
  }
}

function rollPlanet(
  planet: Planet,
  seed: string,
  numSteps: number,
  events: UniverseHistoryEvent[],
  lifeAppearedAtStep: Record<string, number>,
): void {
  const rng = seededPRNG(`${seed}_universe_life_${planet.id}`);
  for (let step = 0; step < numSteps; step++) {
    if (rng() < LIFE_CHANCE_PER_STEP) {
      const biome = pickBiome(rng);
      planet.life = true;
      planet.biome = biome;
      planet.subtype = PLANET_BIOME_TO_SUBTYPE[biome];
      lifeAppearedAtStep[planet.id] = step;
      events.push({ type: 'LIFE_APPEARED', step, bodyKind: 'planet', bodyId: planet.id });
      return;
    }
  }
}

function rollSatellite(
  satellite: Satellite,
  seed: string,
  numSteps: number,
  events: UniverseHistoryEvent[],
  lifeAppearedAtStep: Record<string, number>,
): void {
  const rng = seededPRNG(`${seed}_universe_life_${satellite.id}`);
  for (let step = 0; step < numSteps; step++) {
    if (rng() < LIFE_CHANCE_PER_STEP) {
      const biome = pickBiome(rng);
      satellite.life = true;
      satellite.biome = biome;
      satellite.subtype = satelliteSubtypeForBiome(biome);
      lifeAppearedAtStep[satellite.id] = step;
      events.push({ type: 'LIFE_APPEARED', step, bodyKind: 'satellite', bodyId: satellite.id });
      return;
    }
  }
}

export const universeHistoryGenerator = new UniverseHistoryGenerator();
