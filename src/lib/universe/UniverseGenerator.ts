import { Universe } from './Universe';
import { solarSystemGenerator } from './SolarSystemGenerator';
import { rndSize } from './helpers';

export class UniverseGenerator {
  generate(rng: () => number, seed: string = ''): Universe {
    const universe = new Universe(rng, seed);
    const solarSystemCount = rndSize(rng, 5, 1);
    for (let i = 0; i < solarSystemCount; i++) {
      solarSystemGenerator.generate(universe, rng);
    }
    return universe;
  }
}

export const universeGenerator = new UniverseGenerator();
