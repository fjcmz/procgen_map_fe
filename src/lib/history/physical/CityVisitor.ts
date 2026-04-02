import type { CityEntity } from './CityEntity';
import type { World } from './World';

export class CityVisitor {
  iterateAll(world: World): IterableIterator<CityEntity> {
    return world.mapCities.values();
  }

  iterateUsable(world: World): IterableIterator<CityEntity> {
    return world.mapUsableCities.values();
  }

  /**
   * Randomly select one city from all cities matching the predicate.
   * Shuffles candidates (Fisher-Yates) then returns the first match, or null.
   */
  selectRandom(world: World, predicate: (c: CityEntity) => boolean, rng: () => number): CityEntity | null {
    const candidates = Array.from(world.mapCities.values());
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.find(predicate) ?? null;
  }

  /**
   * Randomly select one usable city matching the predicate, or null.
   */
  selectRandomUsable(world: World, predicate: (c: CityEntity) => boolean, rng: () => number): CityEntity | null {
    const candidates = Array.from(world.mapUsableCities.values());
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.find(predicate) ?? null;
  }
}

export const cityVisitor = new CityVisitor();
