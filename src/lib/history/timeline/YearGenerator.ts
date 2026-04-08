import { Year } from './Year';
import type { Timeline } from './Timeline';
import type { World } from '../physical/World';
import { REGION_BIOME_GROWTH, REGION_BIOME_CAPACITY } from '../physical/Region';
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
import { techGenerator, getCityTechLevel } from './Tech';
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

    // Step 4: Logistic growth with biome carrying capacity
    // Phase 1: `energy` tech multiplies `growth`'s effective level, capped so
    // a level-10 energy country gets +50% growth boost (1.5×) at most.
    // Note: tech effects read from the country-scope (or empire founder) via
    // getCityTechLevel, not directly from city.knownTechs — see Tech.ts helpers.
    for (const city of world.mapUsableCities.values()) {
      const region = world.mapRegions.get(city.regionId);
      if (region) {
        const growthRate = REGION_BIOME_GROWTH[region.biome] / 100;
        // Carrying capacity: base from biome, scaled up by growth tech (× energy)
        let capacity = REGION_BIOME_CAPACITY[region.biome];
        const growthLevel = getCityTechLevel(world, city, 'growth');
        if (growthLevel > 0) {
          const energyLevel = getCityTechLevel(world, city, 'energy');
          const energyMult = 1 + 0.05 * Math.min(energyLevel, 10);
          // Phase 4 tuning: growth coefficient 0.15 → 0.12. `energy` stacks
          // (up to ×1.5) on top of `growth` since Phase 1, so 0.15 was
          // effectively 0.225 at energy level 10 — the compounding snowball
          // the spec warns about in `tech_overhaul.md` Phase 4. A full halving
          // to 0.10 dropped peakPopulation by ~32% across the 5-seed sweep
          // (outside the ±30% quality gate), so round 2 backs off to 0.12 to
          // land inside the gate while still curbing the compounding effect.
          capacity *= 1 + growthLevel * 0.12 * energyMult;
        }
        // Logistic growth: rate decelerates as population approaches capacity
        const logisticFactor = 1 - city.currentPopulation / capacity;
        city.currentPopulation = Math.max(
          city.currentPopulation,
          Math.floor(city.currentPopulation * (1 + growthRate * logisticFactor))
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
    // Phase 1: `art` tech bumps adherence drift +0.05 → +0.07 (soft-power lever).
    for (const city of world.mapUsableCities.values()) {
      if (city.religions.size === 0) continue;
      const drift = 0.05 + (getCityTechLevel(world, city, 'art') > 0 ? 0.02 : 0);
      if (city.religions.size === 1) {
        // Single-religion: adherence drifts toward dominance until 0.9
        for (const [relId, adherence] of city.religions) {
          if (adherence < 0.9) {
            city.religions.set(relId, Math.min(0.9, adherence + drift));
          }
        }
      } else {
        // Multi-religion: if total adherence < 0.9, random existing religion gains drift
        let totalAdherence = 0;
        for (const adherence of city.religions.values()) totalAdherence += adherence;
        if (totalAdherence < 0.9) {
          const relIds = Array.from(city.religions.keys());
          const picked = relIds[Math.floor(rng() * relIds.length)];
          city.religions.set(picked, (city.religions.get(picked) ?? 0) + drift);
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

    // --- Phase 5: Generate events in order, with per-type size functions ---

    // Size helper: random [0, max(2, x)-1], floored, min 0
    const rndSize = (n: number, offset: number) => Math.max(0, Math.floor(rng() * n) + offset);

    // 1. Foundations: random [0, max(2, toFound/300)-1]
    const toFound = world.mapCities.size - world.mapUsableCities.size;
    const foundationCount = Math.floor(rng() * Math.max(2, Math.floor(toFound / 300)));
    for (let i = 0; i < foundationCount; i++) {
      const f = foundationGenerator.generate(rng, year, world);
      if (f) year.foundations.push(f); else break;
    }

    // 2. Contacts: rndSize(30, 2)
    const contactCount = rndSize(30, 2);
    for (let i = 0; i < contactCount; i++) {
      const c = contactGenerator.generate(rng, year, world);
      if (c) year.contacts.push(c); else break;
    }

    // 3. Countries: rndSize(10, 0)
    const countryCount = rndSize(10, 0);
    for (let i = 0; i < countryCount; i++) {
      const c = countryGenerator.generate(rng, year, world);
      if (c) year.countries.push(c); else break;
    }

    // 4. Illustrates: random [0, max(2, usableCities/500)-1]
    const illustrateCount = Math.floor(rng() * Math.max(2, Math.floor(world.mapUsableCities.size / 500)));
    for (let i = 0; i < illustrateCount; i++) {
      const il = illustrateGenerator.generate(rng, year, world);
      if (il) year.illustrates.push(il); else break;
    }

    // 5. Wonders: random [0, max(2, usableCities/500)-1]
    const wonderCount = Math.floor(rng() * Math.max(2, Math.floor(world.mapUsableCities.size / 500)));
    for (let i = 0; i < wonderCount; i++) {
      const w = wonderGenerator.generate(rng, year, world);
      if (w) year.wonders.push(w); else break;
    }

    // 6. Religions: often zero (two consecutive boolean checks), else up to scaled count
    if (rng() < 0.5 && rng() < 0.5) {
      let withoutReligion = 0;
      for (const city of world.mapUsableCities.values()) {
        if (city.religions.size === 0) withoutReligion++;
      }
      const religionMax = Math.max(2, Math.floor(withoutReligion / 1000));
      const religionCount = Math.floor(rng() * religionMax);
      for (let i = 0; i < religionCount; i++) {
        const r = religionGenerator.generate(rng, year, world);
        if (r) year.religions.push(r); else break;
      }
    }

    // 7. Trades: roll(6, 10)
    {
      let tradesRoll = 0;
      for (let i = 0; i < 6; i++) tradesRoll += Math.floor(rng() * 10) + 1;
      for (let i = 0; i < tradesRoll; i++) {
        const t = tradeGenerator.generate(rng, year, world);
        if (t) year.trades.push(t); else break;
      }
    }

    // 8. Cataclysms: rndSize(6, -3)
    const cataclysmCount = rndSize(6, -3);
    for (let i = 0; i < cataclysmCount; i++) {
      const c = cataclysmGenerator.generate(rng, year, world);
      if (c) year.cataclysms.push(c); else break;
    }

    // 9. Wars: random [0, max(2, countries/50)-1]
    const warCount = Math.floor(rng() * Math.max(2, Math.floor(world.mapCountries.size / 50)));
    for (let i = 0; i < warCount; i++) {
      const w = warGenerator.generate(rng, year, world);
      if (w) year.wars.push(w); else break;
    }

    // 10. Techs (Phase 2): per-year throughput is N=clamp(0..5, log10(worldPop/10k)),
    // rolled per-country (chance min(1, illustrates/5)) plus a single legacy
    // stateless fallback. The whole flow lives in techGenerator.generateForYear.
    year.techs.push(...techGenerator.generateForYear(rng, year, world));

    // 11. Conquers: rndSize(4, 1)
    const conquerCount = rndSize(4, 1);
    for (let i = 0; i < conquerCount; i++) {
      const c = conquerGenerator.generate(rng, year, world);
      if (c) year.conquers.push(c); else break;
    }

    // 12. Empires: exactly conquers.size() attempts (one per conquer this year)
    for (const conquer of year.conquers) {
      const empire = empireGenerator.generate(rng, year, conquer);
      if (empire) year.empires.push(empire);
    }

    return year;
  }
}

export const yearGenerator = new YearGenerator();
