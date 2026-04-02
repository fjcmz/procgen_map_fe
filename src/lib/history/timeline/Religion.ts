import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Illustrate } from './Illustrate';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Religion {
  readonly id: string;
  readonly founder: string; // illustrate ID
  foundedOn: number;
  readonly foundingCity: string; // city ID
  members: number;
  year?: Year;
}

export class ReligionGenerator {
  generate(rng: () => number, year: Year, world: World): Religion | null {
    // Path 1: Found new religion if there is a usable illustrate of type "religion"
    // whose origin city has no religions
    const illustrates = Array.from(world.mapUsableIllustrates.values()) as Illustrate[];
    // Shuffle for randomness
    for (let i = illustrates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [illustrates[i], illustrates[j]] = [illustrates[j], illustrates[i]];
    }

    const eligibleFounder = illustrates.find(ill => {
      if (ill.type !== 'religion') return false;
      const city = ill.originCity;
      if (!city) return false;
      return city.religions.size === 0;
    });

    if (eligibleFounder && eligibleFounder.originCity) {
      const absYear = year.year;
      const religion: Religion = {
        id: IdUtil.id('religion', absYear, rngHex(rng)) ?? 'religion_unknown',
        founder: eligibleFounder.id,
        foundedOn: absYear,
        foundingCity: eligibleFounder.originCity.id,
        members: 0,
        year,
      };

      // Consume illustrate
      eligibleFounder.greatDeed = `Founded religion ${religion.id}`;
      world.mapUsableIllustrates.delete(eligibleFounder.id);

      // Initialize founding city's adherence with random [0.10, 0.49]
      const adherence = 0.10 + rng() * 0.39;
      eligibleFounder.originCity.religions.set(religion.id, adherence);

      // Add to world
      world.mapReligions.set(religion.id, religion);

      return religion;
    }

    // Path 2: Expand existing religion
    if (world.mapReligions.size === 0) return null;

    // Pick a random usable city with at least one religion
    const citiesWithReligion = Array.from(world.mapUsableCities.values())
      .filter(c => c.religions.size > 0);
    if (citiesWithReligion.length === 0) return null;

    const sourceCity = citiesWithReligion[Math.floor(rng() * citiesWithReligion.length)];
    const religionIds = Array.from(sourceCity.religions.keys());
    const religionId = religionIds[Math.floor(rng() * religionIds.length)];

    // Find target city without that religion in same or neighbouring region
    const sourceRegion = world.mapRegions.get(sourceCity.regionId);
    if (!sourceRegion) return null;

    const candidateRegions = [sourceRegion];
    for (const nId of sourceRegion.neighbours) {
      const n = world.mapRegions.get(nId);
      if (n) candidateRegions.push(n);
    }

    // Collect candidate cities
    const targetCandidates = candidateRegions
      .flatMap(r => r.cities)
      .filter(c => c.founded && !c.religions.has(religionId) && c.id !== sourceCity.id);

    if (targetCandidates.length === 0) return null;

    const targetCity = targetCandidates[Math.floor(rng() * targetCandidates.length)];

    // Seed target city's adherence with random [0.01, 0.09]
    const seedAdherence = 0.01 + rng() * 0.08;
    targetCity.religions.set(religionId, seedAdherence);

    // Return the existing religion (expansion, not a new religion object)
    return world.mapReligions.get(religionId) as Religion ?? null;
  }
}

export const religionGenerator = new ReligionGenerator();
