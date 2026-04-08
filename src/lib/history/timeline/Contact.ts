import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Contact {
  readonly id: string;
  readonly contactFrom: string; // source city ID
  readonly contactTo: string;   // target city ID
  year?: Year;
}

/**
 * Find a source city for contact, using priority order:
 * 1. Uncontacted city in a region with multiple founded cities
 * 2. Uncontacted city in a single-city region
 * 3. Any usable city (fallback)
 */
function findSourceCity(world: World, rng: () => number): CityEntity | null {
  // Priority 1: uncontacted city in a region with multiple founded cities
  const uncontacted = Array.from(world.mapUncontactedCities.values());
  if (uncontacted.length === 0) return null;

  // Shuffle for randomness
  for (let i = uncontacted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [uncontacted[i], uncontacted[j]] = [uncontacted[j], uncontacted[i]];
  }

  // Priority 1: uncontacted in region with multiple founded cities
  for (const city of uncontacted) {
    const region = world.mapRegions.get(city.regionId);
    if (!region) continue;
    const foundedCount = region.cities.filter(c => c.founded).length;
    if (foundedCount > 1) return city;
  }

  // Priority 2: uncontacted in single-city region
  for (const city of uncontacted) {
    return city;
  }

  // Priority 3: any usable city (fallback)
  const usable = Array.from(world.mapUsableCities.values());
  if (usable.length === 0) return null;
  return usable[Math.floor(rng() * usable.length)];
}

/**
 * Find a target city via BFS traversal over region adjacency graph.
 * Base depth: 1. If source city has exploration tech, depth = tech.level + 1.
 */
function findTargetCity(
  sourceCity: CityEntity,
  world: World,
  rng: () => number
): CityEntity | null {
  const sourceRegion = world.mapRegions.get(sourceCity.regionId);
  if (!sourceRegion) return null;

  // Determine BFS depth. Phase 4 tuning: `level + 1` → `1 + ceil(level/2)`.
  // With the old formula, an exploration-4 city contacted 5 region-layers per
  // year which closed the contact graph in the first few centuries of the run
  // and flattened the mid-game contact curve. Halving the slope keeps early
  // exploration useful without short-circuiting the whole diffusion phase.
  let depth = 1;
  if (sourceCity.knownTechs) {
    const explorationTech = sourceCity.knownTechs.get('exploration');
    if (explorationTech) depth = 1 + Math.ceil(explorationTech.level / 2);
  }

  // BFS over region adjacency
  const visited = new Set<string>([sourceRegion.id]);
  let frontier = [sourceRegion];
  const candidates: CityEntity[] = [];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const nextFrontier: typeof frontier = [];
    for (const region of frontier) {
      for (const neighbourId of region.neighbours) {
        if (visited.has(neighbourId)) continue;
        visited.add(neighbourId);
        const neighbour = world.mapRegions.get(neighbourId);
        if (!neighbour) continue;
        nextFrontier.push(neighbour);

        // Check cities in this neighbour region
        for (const city of neighbour.cities) {
          if (city.founded && city.id !== sourceCity.id && !city.contacted) {
            candidates.push(city);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  // Also check source region's own cities
  for (const city of sourceRegion.cities) {
    if (city.founded && city.id !== sourceCity.id && !city.contacted) {
      candidates.push(city);
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

export class ContactGenerator {
  generate(rng: () => number, year: Year, world: World): Contact | null {
    const sourceCity = findSourceCity(world, rng);
    if (!sourceCity) return null;

    const targetCity = findTargetCity(sourceCity, world, rng);
    if (!targetCity) return null;

    const contact: Contact = {
      id: IdUtil.id('contact', year.year, rngHex(rng)) ?? 'contact_unknown',
      contactFrom: sourceCity.id,
      contactTo: targetCity.id,
      year,
    };

    // Mark both cities as contacted
    sourceCity.contacted = true;
    targetCity.contacted = true;

    // Add symmetric contact links
    sourceCity.contacts.push(contact.id);
    targetCity.contacts.push(contact.id);
    sourceCity.contactCities.add(targetCity);
    targetCity.contactCities.add(sourceCity);

    // Remove from uncontacted
    world.mapUncontactedCities.delete(sourceCity.id);
    world.mapUncontactedCities.delete(targetCity.id);

    return contact;
  }
}

export const contactGenerator = new ContactGenerator();
