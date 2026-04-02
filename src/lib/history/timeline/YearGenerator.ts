import { Year } from './Year';
import type { Timeline } from './Timeline';
import type { World } from '../physical/World';
import { REGION_BIOME_GROWTH } from '../physical/Region';
import { foundationGenerator } from './Foundation';
import { contactGenerator } from './Contact';
import { countryGenerator } from './Country';
import { illustrateGenerator } from './Illustrate';
import type { Illustrate } from './Illustrate';
import { religionGenerator } from './Religion';
import { tradeGenerator } from './Trade';
import { wonderGenerator } from './Wonder';
import { cataclysmGenerator } from './Cataclysm';
import { warGenerator } from './War';
import type { War } from './War';
import { techGenerator } from './Tech';
import { conquerGenerator } from './Conquer';
import { empireGenerator } from './Empire';
import type { CountryEvent } from './Country';

export class YearGenerator {
  generate(rng: () => number, timeline: Timeline, world: World): Year {
    const year = new Year(rng);
    year.timeline = timeline;

    // Step 1: Abort if world has ended
    if (world.endedBy !== '') {
      year.year = timeline.startOfTime + timeline.years.length;
      return year;
    }

    // Step 2: Compute absolute year
    const absYear = timeline.startOfTime + timeline.years.length;
    year.year = absYear;

    // Step 3: Sum world population from usable cities (measured before growth)
    let worldPop = 0;
    for (const city of world.mapUsableCities.values()) {
      worldPop += city.currentPopulation;
    }
    year.worldPopulation = worldPop;

    // Step 4: Increase populations using biome growth multiplier
    for (const city of world.mapUsableCities.values()) {
      const region = world.mapRegions.get(city.regionId);
      if (region) {
        const growthRate = REGION_BIOME_GROWTH[region.biome];
        // growthRate values (0.3-1.5) are percentage-point annual growth rates
        city.currentPopulation = Math.floor(
          city.currentPopulation * (1 + growthRate / 100)
        );
      }
    }

    // Step 5: Kill/retire illustrates
    // Natural death: birthYear + yearsActive <= currentYear
    // War-related death: 15% chance if active war affects origin country
    for (const [id, illustrate] of world.mapUsableIllustrates) {
      const ill = illustrate as Illustrate;
      // Natural death
      if (ill.birthYear + ill.yearsActive <= absYear) {
        ill.diedOn = absYear;
        ill.deathCause = 'natural';
        world.mapUsableIllustrates.delete(id);
        continue;
      }
      // War-related death: 15% chance if origin city's country is at war
      if (ill.originCity) {
        const region = world.mapRegions.get(ill.originCity.regionId);
        if (region && region.countryId) {
          const country = world.mapCountries.get(region.countryId) as CountryEvent | undefined;
          if (country && country.atWar && rng() < 0.15) {
            ill.diedOn = absYear;
            ill.deathCause = 'war';
            world.mapUsableIllustrates.delete(id);
          }
        }
      }
    }

    // Step 6: Propagate religions
    for (const city of world.mapUsableCities.values()) {
      if (city.religions.size === 0) continue;
      if (city.religions.size === 1) {
        // Single-religion: adherence drifts +0.05 toward dominance until 0.9
        for (const [relId, adherence] of city.religions) {
          if (adherence < 0.9) {
            city.religions.set(relId, Math.min(0.9, adherence + 0.05));
          }
        }
      } else {
        // Multi-religion: if total adherence < 0.9, random existing religion gains +0.05
        let totalAdherence = 0;
        for (const adherence of city.religions.values()) totalAdherence += adherence;
        if (totalAdherence < 0.9) {
          const relIds = Array.from(city.religions.keys());
          const picked = relIds[Math.floor(rng() * relIds.length)];
          city.religions.set(picked, (city.religions.get(picked) ?? 0) + 0.05);
        }
      }
    }
    // Recompute religion member counts
    for (const religion of world.mapReligions.values()) {
      let members = 0;
      for (const city of world.mapUsableCities.values()) {
        const adherence = city.religions.get(religion.id);
        if (adherence) {
          members += Math.floor(city.currentPopulation * adherence);
        }
      }
      religion.members = members;
    }

    // Step 7: End expired wars — remove alive wars where started + lasts < year
    for (const [warId, war] of world.mapAliveWars) {
      const w = war as War;
      if (w.started + w.lasts < absYear) {
        world.mapAliveWars.delete(warId);
        // Clear atWar flags
        const aggressor = world.mapCountries.get(w.aggressor) as CountryEvent | undefined;
        const defender = world.mapCountries.get(w.defender) as CountryEvent | undefined;
        if (aggressor) aggressor.atWar = false;
        if (defender) defender.atWar = false;
      }
    }

    // Step 8: Reassert war flags — active wars set atWar = true
    for (const war of world.mapAliveWars.values()) {
      const w = war as War;
      const aggressor = world.mapCountries.get(w.aggressor) as CountryEvent | undefined;
      const defender = world.mapCountries.get(w.defender) as CountryEvent | undefined;
      if (aggressor) aggressor.atWar = true;
      if (defender) defender.atWar = true;
    }

    // Step 9: Recompute resources — region.hasResources = any resource.available >= TRADE_MIN
    for (const region of world.mapRegions.values()) {
      region.updateHasResources();
    }

    // --- Phase 5: Generate events in order ---

    // Foundation
    const foundation = foundationGenerator.generate(rng, year, world);
    if (foundation) year.foundations.push(foundation);

    // Contact
    const contact = contactGenerator.generate(rng, year, world);
    if (contact) year.contacts.push(contact);

    // Country
    const country = countryGenerator.generate(rng, year, world);
    if (country) year.countries.push(country);

    // Illustrate
    const illustrate = illustrateGenerator.generate(rng, year, world);
    if (illustrate) year.illustrates.push(illustrate);

    // Religion
    const religion = religionGenerator.generate(rng, year, world);
    if (religion) year.religions.push(religion);

    // Trade
    const trade = tradeGenerator.generate(rng, year, world);
    if (trade) year.trades.push(trade);

    // Wonder
    const wonder = wonderGenerator.generate(rng, year, world);
    if (wonder) year.wonders.push(wonder);

    // Cataclysm
    const cataclysm = cataclysmGenerator.generate(rng, year, world);
    if (cataclysm) year.cataclysms.push(cataclysm);

    // War
    const war = warGenerator.generate(rng, year, world);
    if (war) year.wars.push(war);

    // Tech
    const tech = techGenerator.generate(rng, year, world);
    if (tech) year.techs.push(tech);

    // Conquer
    const conquer = conquerGenerator.generate(rng, year, world);
    if (conquer) {
      year.conquers.push(conquer);

      // Empire: triggered by conquer event where conqueror is not in an empire
      const empire = empireGenerator.generate(rng, year, conquer);
      if (empire) year.empires.push(empire);
    }

    return year;
  }
}

export const yearGenerator = new YearGenerator();
