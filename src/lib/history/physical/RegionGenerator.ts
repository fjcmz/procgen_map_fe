import { Region } from './Region';
import type { RegionBiome } from './Region';
import type { World } from './World';

export class RegionGenerator {
  generate(biome: RegionBiome, rng: () => number, world: World): Region {
    const region = new Region(biome, rng);
    world.mapRegions.set(region.id, region);
    return region;
  }

  /**
   * Assign symmetric adjacency links from pre-computed geographic neighbours.
   * Deduplicates: safe to call multiple times for the same pair.
   */
  assignNeighbours(region: Region, neighbourRegions: Region[]): void {
    for (const neighbour of neighbourRegions) {
      region.neighbours.add(neighbour.id);
      neighbour.neighbours.add(region.id);
      if (!region.neighbourRegions.includes(neighbour)) region.neighbourRegions.push(neighbour);
      if (!neighbour.neighbourRegions.includes(region)) neighbour.neighbourRegions.push(region);
    }
    // Update neighboursCount to reflect current actual adjacency
    region.neighboursCount = region.neighbourRegions.length;
    for (const neighbour of neighbourRegions) {
      neighbour.neighboursCount = neighbour.neighbourRegions.length;
    }
  }

  /**
   * Recompute BFS-layered potentialNeighbours for ALL regions in the world.
   * potentialNeighbours[0] = direct neighbours, [1] = distance-2, etc.
   * Call once after all regions have been created and connected.
   */
  updatePotentialNeighbours(world: World): void {
    for (const region of world.mapRegions.values()) {
      const visited = new Set<string>([region.id]);
      const layers: Region[][] = [];
      let frontier = region.neighbourRegions.filter(r => !visited.has(r.id));
      frontier.forEach(r => visited.add(r.id));
      while (frontier.length > 0) {
        layers.push(frontier);
        const next: Region[] = [];
        for (const r of frontier) {
          for (const nr of r.neighbourRegions) {
            if (!visited.has(nr.id)) {
              visited.add(nr.id);
              next.push(nr);
            }
          }
        }
        frontier = next;
      }
      region.potentialNeighbours = layers;
    }
  }
}

export const regionGenerator = new RegionGenerator();
