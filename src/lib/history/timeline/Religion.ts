import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Illustrate } from './Illustrate';
import type { CountryEvent } from './Country';
import { getCountryTechLevel } from './Tech';

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
  /**
   * Spec stretch §4: id of the country whose region hosted the founding city
   * at founding time. Snapshot-at-founding — not updated on conquest, so the
   * "origin country" bonus tracks the original civilization even if the
   * founding region later changes hands. `null` when the founding city was
   * pre-country (no region owner yet); bonuses then silently no-op.
   */
  readonly originCountry: string | null;
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
      // Spec stretch §4: snapshot the founding city's current country id.
      // Null when the city has no country yet — the government-bonus code
      // in YearGenerator step 6 and Path 2 below both handle that case.
      const foundingRegion = world.mapRegions.get(eligibleFounder.originCity.regionId);
      const originCountry = foundingRegion?.countryId ?? null;
      const religion: Religion = {
        id: IdUtil.id('religion', absYear, rngHex(rng)) ?? 'religion_unknown',
        founder: eligibleFounder.id,
        foundedOn: absYear,
        foundingCity: eligibleFounder.originCity.id,
        originCountry,
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

    // Spec stretch §4: weight neighbour-region candidates by
    // `1 + 0.25 * government.level` (capped at 2). Same-region candidates
    // keep weight 1, so high-`government` religions bias outward and "reach
    // further per tick". `originCountry` is read from the religion being
    // expanded, not the source city's current country, so the bonus tracks
    // the original civilization's institutional strength.
    const religion = world.mapReligions.get(religionId) as Religion | undefined;
    let govMult = 1;
    if (religion?.originCountry) {
      const originCountry = world.mapCountries.get(religion.originCountry) as CountryEvent | undefined;
      if (originCountry) {
        const govLevel = getCountryTechLevel(world, originCountry, 'government');
        govMult = Math.min(2, 1 + 0.25 * govLevel);
      }
    }
    const weightOf = (cellRegionId: string): number =>
      cellRegionId === sourceCity.regionId ? 1 : govMult;

    let targetCity: typeof targetCandidates[number];
    if (govMult === 1) {
      // Fast path: uniform pick preserves the pre-§4 RNG usage at
      // government level 0 and is indistinguishable from the original code.
      targetCity = targetCandidates[Math.floor(rng() * targetCandidates.length)];
    } else {
      let total = 0;
      for (const c of targetCandidates) total += weightOf(c.regionId);
      let r = rng() * total;
      targetCity = targetCandidates[targetCandidates.length - 1];
      for (const c of targetCandidates) {
        r -= weightOf(c.regionId);
        if (r <= 0) { targetCity = c; break; }
      }
    }

    // Seed target city's adherence with random [0.01, 0.09]
    const seedAdherence = 0.01 + rng() * 0.08;
    targetCity.religions.set(religionId, seedAdherence);

    // Return the existing religion (expansion, not a new religion object)
    return world.mapReligions.get(religionId) as Religion ?? null;
  }
}

export const religionGenerator = new ReligionGenerator();
