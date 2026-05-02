import { Planet } from './Planet';
import type { PlanetBiome, PlanetSubtype, RockPlanetSubtype, GasPlanetSubtype } from './Planet';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { satelliteGenerator } from './SatelliteGenerator';
import { rndSize } from './helpers';
import { generatePlanetName } from './universeNameGenerator';
import { seededPRNG } from '../terrain/noise';

/**
 * Probability that a planet at `orbit` is rocky.
 * orbit < 10  → 100% rock; orbit > 20 → 100% gas; linear in between.
 */
function rockProbability(orbit: number): number {
  if (orbit <= 10) return 1.0;
  if (orbit >= 20) return 0.0;
  return 1 - (orbit - 10) / 10;
}

/**
 * Pick a terrain biome subtype for a ROCK planet with life.
 * default: 40%; each of the other 6 profiles: 10%.
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
 * Weighted compositional subtype roll. Inner / outer orbit and life flag bias
 * the distribution: hot inner orbits favor lava / volcanic / desert; cold outer
 * rock favors ice_rock / carbon; life-bearing rock biases toward
 * terrestrial / ocean. Gas-giant subtype is also orbit-biased: hot_jupiter
 * close in, ice_giant / methane_giant far out. Uses an isolated PRNG sub-stream
 * so the choice is deterministic from `(seed, planet.id)` without perturbing
 * the main universe RNG sequence.
 */
function pickPlanetSubtype(
  composition: 'GAS' | 'ROCK',
  orbit: number,
  life: boolean,
  biome: PlanetBiome | undefined,
  subRng: () => number,
): PlanetSubtype {
  if (composition === 'ROCK') {
    if (life && biome) {
      // Map biome → most apt rock subtype so a "forest" world looks lush
      // rather than getting a random subtype assigned underneath the biome.
      const biomeMap: Record<PlanetBiome, RockPlanetSubtype> = {
        default: 'terrestrial',
        forest: 'terrestrial',
        ocean: 'ocean',
        desert: 'desert',
        swamp: 'terrestrial',
        ice: 'ice_rock',
        mountains: 'terrestrial',
      };
      return biomeMap[biome];
    }
    // Hot rocky planet — 0..6 → lava-favored, 6..12 → desert / volcanic / iron,
    // 12..20 → carbon / ice_rock heavy.
    const r = subRng();
    if (orbit < 6) {
      if (r < 0.45) return 'lava';
      if (r < 0.75) return 'volcanic';
      if (r < 0.90) return 'iron';
      return 'desert';
    }
    if (orbit < 12) {
      if (r < 0.30) return 'desert';
      if (r < 0.50) return 'terrestrial';
      if (r < 0.65) return 'iron';
      if (r < 0.78) return 'volcanic';
      if (r < 0.88) return 'ocean';
      if (r < 0.95) return 'carbon';
      return 'ice_rock';
    }
    if (r < 0.45) return 'ice_rock';
    if (r < 0.70) return 'carbon';
    if (r < 0.85) return 'iron';
    if (r < 0.95) return 'desert';
    return 'terrestrial';
  }

  const r = subRng();
  if (orbit < 12) {
    if (r < 0.55) return 'hot_jupiter';
    if (r < 0.85) return 'jovian';
    return 'ammonia_giant';
  }
  if (orbit < 18) {
    if (r < 0.45) return 'jovian';
    if (r < 0.70) return 'ammonia_giant';
    if (r < 0.88) return 'methane_giant';
    return 'ice_giant';
  }
  // Outer giants — Uranus/Neptune territory.
  const outer: GasPlanetSubtype[] = ['ice_giant', 'methane_giant', 'ammonia_giant'];
  return outer[Math.floor(r * outer.length)];
}

export class PlanetGenerator {
  generate(solarSystem: SolarSystem, rng: () => number, universe: Universe): Planet {
    const planet = new Planet(rng);
    planet.solarSystemId = solarSystem.id;
    planet.radius = (Math.floor(rng() * 30000) + 1000) / 1000;
    // Read planets.length BEFORE pushing — orbit is monotonic in insertion index.
    const orbitIndex = solarSystem.planets.length;
    planet.orbit =
      (Math.floor(rng() * 20000000) + orbitIndex * 20000000) / 10000000;
    // Composition driven by orbit distance: inner planets rock, outer gas.
    planet.composition = rng() < rockProbability(planet.orbit) ? 'ROCK' : 'GAS';
    planet.life = rng() < 0.1;
    if (planet.composition === 'ROCK' && planet.life) {
      planet.biome = pickBiome(rng);
    }
    // Subtype draws from an isolated sub-stream so adding subtypes does not
    // perturb existing seeds (mirrors the generatePlanetName convention).
    const subRng = seededPRNG(`${universe.seed}_planetsubtype_${planet.id}`);
    planet.subtype = pickPlanetSubtype(
      planet.composition, planet.orbit, planet.life, planet.biome, subRng,
    );
    solarSystem.planets.push(planet);
    universe.mapPlanets.set(planet.id, planet);
    // Isolated sub-stream — no physics RNG perturbed; primary star's scientific
    // name drives the "HD 12345 III" pattern.
    const primaryStarScientific = solarSystem.stars[0]?.scientificName ?? '?';
    const { human, scientific } = generatePlanetName(
      universe.seed, planet.id, primaryStarScientific, orbitIndex, universe.usedPlanetNames,
    );
    planet.humanName = human;
    planet.scientificName = scientific;

    const satelliteCount = rndSize(rng, 15, -5);
    for (let i = 0; i < satelliteCount; i++) {
      satelliteGenerator.generate(planet, rng, universe);
    }
    return planet;
  }
}

export const planetGenerator = new PlanetGenerator();
