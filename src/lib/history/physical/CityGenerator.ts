import { CityEntity } from './CityEntity';
import type { Region } from './Region';
import type { World } from './World';

export class CityGenerator {
  generate(cellIndex: number, name: string, rng: () => number, region: Region, world: World): CityEntity {
    const city = new CityEntity(cellIndex, name, rng);
    city.regionId = region.id;
    world.mapCities.set(city.id, city);
    return city;
  }
}

export const cityGenerator = new CityGenerator();
