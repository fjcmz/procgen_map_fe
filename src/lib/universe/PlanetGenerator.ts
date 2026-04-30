import { Planet } from './Planet';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { satelliteGenerator } from './SatelliteGenerator';
import { rndSize } from './helpers';

export class PlanetGenerator {
  generate(solarSystem: SolarSystem, rng: () => number, universe: Universe): Planet {
    const planet = new Planet(rng);
    planet.solarSystemId = solarSystem.id;
    planet.radius = (Math.floor(rng() * 30000) + 1000) / 1000;
    // Read planets.length BEFORE pushing — orbit is monotonic in insertion index.
    planet.orbit =
      (Math.floor(rng() * 20000000) + solarSystem.planets.length * 20000000) / 10000000;
    planet.composition = rng() > 0.5 ? 'GAS' : 'ROCK';
    planet.life = rng() < 0.1;
    solarSystem.planets.push(planet);
    universe.mapPlanets.set(planet.id, planet);

    const satelliteCount = rndSize(rng, 15, -5);
    for (let i = 0; i < satelliteCount; i++) {
      satelliteGenerator.generate(planet, rng, universe);
    }
    return planet;
  }
}

export const planetGenerator = new PlanetGenerator();
