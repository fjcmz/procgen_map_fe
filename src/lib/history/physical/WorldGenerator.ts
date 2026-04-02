import { World } from './World';

export class WorldGenerator {
  generate(rng: () => number): World {
    return new World(rng);
  }
}

export const worldGenerator = new WorldGenerator();
