import type { Universe } from './Universe';
import type { Planet, PlanetBiome, RockPlanetSubtype } from './Planet';
import type { Satellite, RockSatelliteSubtype } from './Satellite';
import type {
  LifeAdvanceEntry,
  LifeLevel,
  UniverseHistoryData,
  UniverseHistoryEvent,
} from './types';
import { LIFE_LEVELS } from './types';
import { isPlanetHabitable, isSatelliteHabitable } from './habitability';
import { seededPRNG } from '../terrain/noise';

const LIFE_CHANCE_PER_STEP = 0.00005;
const LIFE_ADVANCE_CHANCE_PER_STEP = 0.0007;

/**
 * Universe-history simulation. Runs after `universeGenerator.generate(...)`
 * when the request carries `generateHistory: true`. For every body in the
 * habitable zone, walks `numSteps` 1 million-year ticks:
 *
 * 1. Until life appears, roll 0.005% per step on the existing
 *    `${seed}_universe_life_${bodyId}` sub-stream. First success seeds the
 *    body with `lifeLevel = 'unicellular'`, picks a biome, and emits a
 *    `LIFE_APPEARED` event.
 * 2. Once life is present and below the terminal level, roll 0.1% per
 *    step on the new `${seed}_lifeevolution_${bodyId}` sub-stream to step
 *    the body one tier up the `LIFE_LEVELS` ladder. Each success emits a
 *    `LIFE_ADVANCED` event.
 *
 * Splitting the appearance + advancement rolls onto isolated sub-streams
 * keeps the spawn timings byte-stable against earlier seeds — feature gates
 * on the universe sweep (none today, but the discipline matches the
 * world-history sub-stream convention in CLAUDE.md).
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

function nextLifeLevel(current: LifeLevel): LifeLevel | null {
  const idx = LIFE_LEVELS.indexOf(current);
  if (idx < 0 || idx >= LIFE_LEVELS.length - 1) return null;
  return LIFE_LEVELS[idx + 1];
}

export class UniverseHistoryGenerator {
  generate(universe: Universe, seed: string, numSteps: number): UniverseHistoryData {
    const events: UniverseHistoryEvent[] = [];
    const lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]> = {};

    // Walk planets in their canonical generation order. Satellites are walked
    // alongside their parent so events within the same step land in a stable
    // "planet first, then its moons" order — keeps the events list readable.
    for (const ss of universe.solarSystems) {
      for (const planet of ss.planets) {
        if (isPlanetHabitable(planet)) {
          rollPlanet(planet, seed, numSteps, events, lifeAdvancesByBody);
        }
        for (const satellite of planet.satellites) {
          if (isSatelliteHabitable(satellite, planet)) {
            rollSatellite(satellite, seed, numSteps, events, lifeAdvancesByBody);
          }
        }
      }
    }

    // Per-body iteration emits events grouped by body; resort by step so the
    // event log reads chronologically. Stable sort preserves the
    // planet-before-its-moons order within a tie.
    events.sort((a, b) => a.step - b.step);

    return { numSteps, events, lifeAdvancesByBody };
  }
}

function rollPlanet(
  planet: Planet,
  seed: string,
  numSteps: number,
  events: UniverseHistoryEvent[],
  lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]>,
): void {
  const appearanceRng = seededPRNG(`${seed}_universe_life_${planet.id}`);
  const advanceRng = seededPRNG(`${seed}_lifeevolution_${planet.id}`);
  let currentLevel: LifeLevel | undefined;
  const entries: LifeAdvanceEntry[] = [];

  for (let step = 0; step < numSteps; step++) {
    if (currentLevel === undefined) {
      if (appearanceRng() < LIFE_CHANCE_PER_STEP) {
        const biome = pickBiome(appearanceRng);
        planet.life = true;
        planet.biome = biome;
        planet.subtype = PLANET_BIOME_TO_SUBTYPE[biome];
        currentLevel = 'unicellular';
        planet.lifeLevel = currentLevel;
        entries.push({ step, level: currentLevel });
        events.push({
          type: 'LIFE_APPEARED', step, bodyKind: 'planet', bodyId: planet.id,
          level: 'unicellular',
        });
      }
      continue;
    }
    const next = nextLifeLevel(currentLevel);
    if (!next) break;
    if (advanceRng() < LIFE_ADVANCE_CHANCE_PER_STEP) {
      const fromLevel = currentLevel;
      currentLevel = next;
      planet.lifeLevel = currentLevel;
      entries.push({ step, level: currentLevel });
      events.push({
        type: 'LIFE_ADVANCED', step, bodyKind: 'planet', bodyId: planet.id,
        fromLevel, toLevel: currentLevel,
      });
    }
  }

  if (entries.length > 0) {
    lifeAdvancesByBody[planet.id] = entries;
  }
}

function rollSatellite(
  satellite: Satellite,
  seed: string,
  numSteps: number,
  events: UniverseHistoryEvent[],
  lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]>,
): void {
  const appearanceRng = seededPRNG(`${seed}_universe_life_${satellite.id}`);
  const advanceRng = seededPRNG(`${seed}_lifeevolution_${satellite.id}`);
  let currentLevel: LifeLevel | undefined;
  const entries: LifeAdvanceEntry[] = [];

  for (let step = 0; step < numSteps; step++) {
    if (currentLevel === undefined) {
      if (appearanceRng() < LIFE_CHANCE_PER_STEP) {
        const biome = pickBiome(appearanceRng);
        satellite.life = true;
        satellite.biome = biome;
        satellite.subtype = satelliteSubtypeForBiome(biome);
        currentLevel = 'unicellular';
        satellite.lifeLevel = currentLevel;
        entries.push({ step, level: currentLevel });
        events.push({
          type: 'LIFE_APPEARED', step, bodyKind: 'satellite', bodyId: satellite.id,
          level: 'unicellular',
        });
      }
      continue;
    }
    const next = nextLifeLevel(currentLevel);
    if (!next) break;
    if (advanceRng() < LIFE_ADVANCE_CHANCE_PER_STEP) {
      const fromLevel = currentLevel;
      currentLevel = next;
      satellite.lifeLevel = currentLevel;
      entries.push({ step, level: currentLevel });
      events.push({
        type: 'LIFE_ADVANCED', step, bodyKind: 'satellite', bodyId: satellite.id,
        fromLevel, toLevel: currentLevel,
      });
    }
  }

  if (entries.length > 0) {
    lifeAdvancesByBody[satellite.id] = entries;
  }
}

export const universeHistoryGenerator = new UniverseHistoryGenerator();
