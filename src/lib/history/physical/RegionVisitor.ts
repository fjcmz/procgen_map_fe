import type { Region } from './Region';
import type { World } from './World';

export class RegionVisitor {
  iterateAll(world: World): IterableIterator<Region> {
    return world.mapRegions.values();
  }

  /**
   * Select up to n regions matching the predicate, in randomized order.
   */
  selectUpToN(world: World, n: number, predicate: (r: Region) => boolean, rng: () => number): Region[] {
    const candidates = Array.from(world.mapRegions.values());
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const result: Region[] = [];
    for (const r of candidates) {
      if (result.length >= n) break;
      if (predicate(r)) result.push(r);
    }
    return result;
  }

  /**
   * Select one region matching the predicate (randomized order), or null.
   */
  selectOne(world: World, predicate: (r: Region) => boolean, rng: () => number): Region | null {
    return this.selectUpToN(world, 1, predicate, rng)[0] ?? null;
  }
}

export const regionVisitor = new RegionVisitor();
