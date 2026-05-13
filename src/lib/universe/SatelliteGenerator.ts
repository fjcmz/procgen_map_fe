import { Satellite } from './Satellite';
import type { SatelliteSubtype, IceSatelliteSubtype, RockSatelliteSubtype } from './Satellite';
import type { PlanetBiome } from './Planet';
import type { Planet } from './Planet';
import type { Universe } from './Universe';
import { generateSatelliteName } from './universeNameGenerator';
import { seededPRNG } from '../terrain/noise';

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
 * Weighted satellite subtype roll, parent-orbit aware. Inner-orbit moons skew
 * volcanic / iron_rich (Io-like tidal heating); outer-orbit moons skew toward
 * methane / nitrogen / dirty ice (Triton-like). Life-bearing rock biases toward
 * terrestrial regardless of orbit. Uses an isolated sub-stream keyed on
 * `(seed, satellite.id)` so adding subtypes does not perturb existing seeds.
 */
function pickSatelliteSubtype(
  composition: 'ICE' | 'ROCK',
  parentOrbit: number,
  life: boolean,
  biome: PlanetBiome | undefined,
  subRng: () => number,
): SatelliteSubtype {
  if (composition === 'ROCK') {
    if (life && biome === 'desert') return 'desert_moon';
    if (life) return 'terrestrial';
    const r = subRng();
    if (parentOrbit < 8) {
      if (r < 0.40) return 'volcanic';
      if (r < 0.65) return 'iron_rich';
      if (r < 0.85) return 'cratered';
      return 'desert_moon';
    }
    const rockOuter: RockSatelliteSubtype[] = ['cratered', 'terrestrial', 'iron_rich', 'desert_moon'];
    return rockOuter[Math.floor(r * rockOuter.length)];
  }

  const r = subRng();
  if (parentOrbit < 10) {
    // Inner ice moons sublimate / get sulfur-coated more often.
    if (r < 0.45) return 'water_ice';
    if (r < 0.70) return 'sulfur_ice';
    if (r < 0.90) return 'dirty_ice';
    return 'methane_ice';
  }
  const iceOuter: IceSatelliteSubtype[] =
    ['water_ice', 'methane_ice', 'nitrogen_ice', 'dirty_ice', 'sulfur_ice'];
  return iceOuter[Math.floor(r * iceOuter.length)];
}

export class SatelliteGenerator {
  generate(planet: Planet, rng: () => number, universe: Universe, generateHistory: boolean = false): Satellite {
    const satellite = new Satellite(rng);
    satellite.planetId = planet.id;
    const parentRadius = planet.radius * 10;
    satellite.radius = (Math.floor(rng() * Math.floor(parentRadius)) + parentRadius / 5) / 1000;
    satellite.composition = rng() > 0.5 ? 'ICE' : 'ROCK';
    // Same byte-stability pattern as PlanetGenerator: always consume the life
    // + (conditional) biome draws so the main rng stays aligned regardless of
    // history mode. When history is on the result is discarded — life and
    // biome are owned by UniverseHistoryGenerator.
    const lifeRoll = rng() < 0.1;
    const wouldHaveBiome = satellite.composition === 'ROCK' && lifeRoll;
    const biomeRoll: PlanetBiome | undefined = wouldHaveBiome ? pickBiome(rng) : undefined;
    if (!generateHistory) {
      satellite.life = lifeRoll;
      if (biomeRoll) satellite.biome = biomeRoll;
      // Static-mode life is seeded at the terminal stage so world-history
      // hand-off (gated on `intelligent_animals`) remains reachable without
      // enabling the universe timeline.
      if (lifeRoll) satellite.lifeLevel = 'intelligent_animals';
    }
    const subRng = seededPRNG(`${universe.seed}_satsubtype_${satellite.id}`);
    satellite.subtype = pickSatelliteSubtype(
      satellite.composition, planet.orbit, lifeRoll, biomeRoll, subRng,
    );
    // Read moon index BEFORE pushing — same convention as PlanetGenerator for orbit.
    const moonIndex = planet.satellites.length;
    planet.satellites.push(satellite);
    universe.mapSatellites.set(satellite.id, satellite);
    // Isolated sub-stream — no physics RNG perturbed.
    const { human, scientific } = generateSatelliteName(
      universe.seed, satellite.id, planet.scientificName, moonIndex, universe.usedSatelliteNames,
    );
    satellite.humanName = human;
    satellite.scientificName = scientific;
    return satellite;
  }
}

export const satelliteGenerator = new SatelliteGenerator();
