import { World } from './World';

export class WorldGenerator {
  generate(rng: () => number, seed: string = ''): World {
    return new World(rng, seed);
  }
}

export const worldGenerator = new WorldGenerator();
