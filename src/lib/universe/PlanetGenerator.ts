import { Planet } from './Planet';
import type { PlanetBiome } from './Planet';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { satelliteGenerator } from './SatelliteGenerator';
import { rndSize } from './helpers';
import { generatePlanetName } from './universeNameGenerator';

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
