import { Continent } from './Continent';
import type { World } from './World';

export class ContinentGenerator {
  generate(rng: () => number, world: World): Continent {
    const continent = new Continent(rng);
    continent.worldId = world.id;
    world.mapContinents.set(continent.id, continent);
    return continent;
  }
}

export const continentGenerator = new ContinentGenerator();
