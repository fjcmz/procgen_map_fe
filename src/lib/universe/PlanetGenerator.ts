import { Planet } from './Planet';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { satelliteGenerator } from './SatelliteGenerator';
import { rndSize } from './helpers';
import { generatePlanetName } from './universeNameGenerator';
import { seededPRNG } from '../terrain/noise';
import type { UniverseCatalogueSnapshot } from '../extensions/registry';
import { pickSubtype, pickBiome } from '../extensions/picker';

/**
 * Probability that a planet at `orbit` is rocky.
 * orbit < 10  → 100% rock; orbit > 20 → 100% gas; linear in between.
 */
function rockProbability(orbit: number): number {
  if (orbit <= 10) return 1.0;
  if (orbit >= 20) return 0.0;
  return 1 - (orbit - 10) / 10;
}

export class PlanetGenerator {
  generate(
    solarSystem: SolarSystem,
    rng: () => number,
    universe: Universe,
    catalogue: UniverseCatalogueSnapshot,
  ): Planet {
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
      // Biome roll uses the MAIN universe rng — same convention as the
      // original `pickBiome(rng)` call, so the rest of the universe seed
      // sequence stays unperturbed.
      planet.biome = pickBiome(catalogue.planet.biomeWeights, rng, 'default');
    }
    // Subtype draws from an isolated sub-stream so adding subtypes does not
    // perturb existing seeds (mirrors the generatePlanetName convention).
    const subRng = seededPRNG(`${universe.seed}_planetsubtype_${planet.id}`);
    planet.subtype = pickSubtype(
      catalogue.planet.rollRules,
      {
        composition: planet.composition,
        life: planet.life,
        biome: planet.biome,
        orbit: planet.orbit,
      },
      subRng,
      'terrestrial',
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
      satelliteGenerator.generate(planet, rng, universe, catalogue);
    }
    return planet;
  }
}

export const planetGenerator = new PlanetGenerator();
