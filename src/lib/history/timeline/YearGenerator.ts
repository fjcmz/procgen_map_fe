import { Year } from './Year';
import type { Timeline } from './Timeline';
import type { World } from '../physical/World';
import { REGION_BIOME_GROWTH, REGION_BIOME_CAPACITY, CELL_BIOME_CAPACITY } from '../physical/Region';
import { computeCitySize, CITY_SIZE_TO_INDEX, maxCellsForCity } from '../physical/CityEntity';
import { foundationGenerator } from './Foundation';
import { contactGenerator } from './Contact';
import { countryGenerator } from './Country';
import { illustrateGenerator } from './Illustrate';
import type { Illustrate } from './Illustrate';
import { religionGenerator } from './Religion';
import type { Religion } from './Religion';
import { tradeGenerator } from './Trade';
import { wonderGenerator } from './Wonder';
import { cataclysmGenerator } from './Cataclysm';
import { warGenerator } from './War';
import type { War } from './War';
import { techGenerator, getCityTechLevel, getCountryTechLevel } from './Tech';
import { conquerGenerator } from './Conquer';
import { empireGenerator } from './Empire';
import { expandGenerator } from './Expand';
import type { CountryEvent } from './Country';
import { ruinifyCity } from './Ruin';
import type { CityEntity } from '../physical/CityEntity';
import type { Cell } from '../../types';

export class YearGenerator {
  generate(rng: () => number, timeline: Timeline, world: World, cells?: Cell[], usedCityNames?: Set<string>): Year {
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

    // Step 4: Logistic growth with per-cell carrying capacity
    // Capacity = sum of CELL_BIOME_CAPACITY for owned cells, capped at
    // REGION_BIOME_CAPACITY. Early cities are cell-limited; mature cities
    // hit the region cap, matching old flat-cap behavior.
    for (const city of world.mapUsableCities.values()) {
      const region = world.mapRegions.get(city.regionId);
      if (region) {
        const growthRate = REGION_BIOME_GROWTH[region.biome] / 100;
        let capacity = REGION_BIOME_CAPACITY[region.biome];
        if (cells) {
          let cellCap = 0;
          for (const ci of city.ownedCells.keys()) {
            const cell = cells[ci];
            if (cell) cellCap += CELL_BIOME_CAPACITY[cell.biome] ?? 0;
          }
          if (cellCap === 0) {
            const cell = cells[city.cellIndex];
            if (cell) cellCap = CELL_BIOME_CAPACITY[cell.biome] ?? 50_000;
          }
          capacity = Math.min(cellCap, capacity);
        }
        const growthLevel = getCityTechLevel(world, city, 'growth');
        if (growthLevel > 0) {
          const energyLevel = getCityTechLevel(world, city, 'energy');
          const energyMult = 1 + 0.05 * Math.min(energyLevel, 10);
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

    // Step 4b: Recompute dynamic city sizes from population + tech
    for (const city of world.mapUsableCities.values()) {
      const govLevel = getCityTechLevel(world, city, 'government');
      const indLevel = getCityTechLevel(world, city, 'industry');
      city.size = computeCitySize(city.currentPopulation, govLevel, indLevel);
    }

    // Step 4c: Territory expansion — cities claim adjacent cells from their region
    // when population milestones (+ gov tech bonus) allow more cells.
    if (cells) {
      // Build a global claimed-cells index: cellIndex → cityId (prevents overlaps)
      const claimedCells = new Map<number, string>();
      for (const city of world.mapUsableCities.values()) {
        for (const ci of city.ownedCells.keys()) {
          claimedCells.set(ci, city.id);
        }
      }

      for (const city of world.mapUsableCities.values()) {
        const govLevel = getCityTechLevel(world, city, 'government');
        const maxCells = maxCellsForCity(city.currentPopulation, govLevel);
        if (city.ownedCells.size >= maxCells) continue;

        const region = world.mapRegions.get(city.regionId);
        if (!region) continue;

        const regionCellSet = new Set(region.cellIndices);

        // Build frontier: cells adjacent to owned cells, in the same region, unclaimed
        const frontier: number[] = [];
        const seen = new Set<number>();
        for (const ownedCi of city.ownedCells.keys()) seen.add(ownedCi);
        for (const ownedCi of city.ownedCells.keys()) {
          for (const ni of cells[ownedCi].neighbors) {
            if (seen.has(ni)) continue;
            seen.add(ni);
            if (!regionCellSet.has(ni)) continue;
            if (claimedCells.has(ni)) continue;
            frontier.push(ni);
          }
        }

        if (frontier.length === 0) continue;

        // Sort: resource cells first, then land over water, then by biome capacity desc
        frontier.sort((a, b) => {
          const aRes = region.cellResources.has(a) ? 1 : 0;
          const bRes = region.cellResources.has(b) ? 1 : 0;
          if (aRes !== bRes) return bRes - aRes; // resource cells first
          const aWater = cells[a].isWater ? 1 : 0;
          const bWater = cells[b].isWater ? 1 : 0;
          if (aWater !== bWater) return aWater - bWater; // land first
          return (CELL_BIOME_CAPACITY[cells[b].biome] ?? 0) - (CELL_BIOME_CAPACITY[cells[a].biome] ?? 0);
        });

        // Claim cells one at a time up to maxCells
        let toClaim = maxCells - city.ownedCells.size;
        for (const ci of frontier) {
          if (toClaim <= 0) break;
          city.ownedCells.set(ci, absYear);
          claimedCells.set(ci, city.id);
          toClaim--;
        }
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
    // Spec stretch §4: the religion's origin country's `government` tech adds a
    // further +0.01 per level, capped at +0.03 (government level 3+). The art
    // bonus is city-scoped (applies to any religion in an `art` city) while the
    // government bonus is religion-scoped (travels with the religion), so drift
    // is now computed per (city × religion) rather than per city.
    const computeGovBonus = (religion: Religion | undefined): number => {
      if (!religion?.originCountry) return 0;
      const origin = world.mapCountries.get(religion.originCountry) as CountryEvent | undefined;
      if (!origin) return 0;
      const govLevel = getCountryTechLevel(world, origin, 'government');
      return 0.01 * Math.min(3, govLevel);
    };
    for (const city of world.mapUsableCities.values()) {
      if (city.religions.size === 0) continue;
      const artBonus = getCityTechLevel(world, city, 'art') > 0 ? 0.02 : 0;
      if (city.religions.size === 1) {
        // Single-religion: adherence drifts toward dominance until 0.9
        for (const [relId, adherence] of city.religions) {
          if (adherence < 0.9) {
            const religion = world.mapReligions.get(relId) as Religion | undefined;
            const drift = 0.05 + artBonus + computeGovBonus(religion);
            city.religions.set(relId, Math.min(0.9, adherence + drift));
          }
        }
      } else {
        // Multi-religion: if total adherence < 0.9, random existing religion gains drift
        let totalAdherence = 0;
        for (const adherence of city.religions.values()) totalAdherence += adherence;
        if (totalAdherence < 0.9) {
          const relIds = Array.from(city.religions.keys());
          // RNG draw happens before drift computation — identical call order
          // to the pre-§4 code path so seed reproducibility is preserved.
          const picked = relIds[Math.floor(rng() * relIds.length)];
          const religion = world.mapReligions.get(picked) as Religion | undefined;
          const drift = 0.05 + artBonus + computeGovBonus(religion);
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

    // Step 9: Tech-gated resource discovery, then recompute `hasResources`.
    //
    // For each claimed region (has a countryId), walk its resources and
    // promote any whose requirement is met by the country's current tech
    // level (via the empire-founder-aware scope ladder in
    // `getCountryTechLevel`). Discovered types are added to
    // `region.discoveredResources` permanently — conquest transfers the
    // region but never removes knowledge, so empire growth and peaceful
    // absorption both inherit the set. Stateless regions (no country yet)
    // are skipped; their commons were bootstrapped at `buildPhysicalWorld`
    // time and stay gated until country formation.
    //
    // Empire members naturally inherit founder tech through the scope
    // ladder, so a region owned by an empire-member country reads the
    // federation's effective level without any special-case code here.
    for (const region of world.mapRegions.values()) {
      if (region.countryId && region.resources.length > region.discoveredResources.size) {
        const country = world.mapCountries.get(region.countryId) as CountryEvent | undefined;
        if (country) {
          for (const r of region.resources) {
            if (region.discoveredResources.has(r.type)) continue;
            if (r.requiredTechLevel <= 0) {
              // L0-other-field fallback (currently unused — all L0 entries
              // are `exploration 0` — but defensive so future table tweaks
              // that add a `biology 0` row Just Work).
              region.discoveredResources.add(r.type);
              year.discoveries.push({
                countryId: country.id,
                regionId: region.id,
                resourceType: r.type,
                field: r.requiredTechField,
                level: r.requiredTechLevel,
              });
              continue;
            }
            const lvl = getCountryTechLevel(world, country, r.requiredTechField);
            if (lvl >= r.requiredTechLevel) {
              region.discoveredResources.add(r.type);
              year.discoveries.push({
                countryId: country.id,
                regionId: region.id,
                resourceType: r.type,
                field: r.requiredTechField,
                level: r.requiredTechLevel,
              });
            }
          }
        }
      }
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

    // 3b. Territorial expansion: countries expand into unclaimed neighboring regions
    if (cells && usedCityNames) {
      const { expansions, settlements } = expandGenerator.generate(rng, year, world, cells, usedCityNames);
      year.expansions.push(...expansions);
      year.settlements.push(...settlements);
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

    // 8. Cataclysms: rndSize(6, -3) clamped to 1 per 20 usable cities.
    // The base roll (0–2) is unchanged for large worlds; the cap protects
    // small-city-count worlds (ocean, ice) from disproportionate disasters.
    const cataclysmCap = Math.floor(world.mapUsableCities.size / 20);
    const cataclysmCount = Math.min(rndSize(6, -3), cataclysmCap);
    for (let i = 0; i < cataclysmCount; i++) {
      const c = cataclysmGenerator.generate(rng, year, world);
      if (c) year.cataclysms.push(c); else break;
    }

    // 8b. Post-cataclysm ruin check: cities with pop < 100 become ruins
    {
      const citiesToRuin: CityEntity[] = [];
      for (const city of world.mapUsableCities.values()) {
        if (city.currentPopulation < 100) citiesToRuin.push(city);
      }
      for (const city of citiesToRuin) {
        const ruin = ruinifyCity(city, world, year, 'depopulation', rng);
        year.ruins.push(ruin);
      }
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

    // Capture per-city population, size, and owned cells at end of year for snapshot serialization
    for (const city of world.mapCities.values()) {
      if (city.founded) {
        year.cityPopulations[city.cellIndex] = city.currentPopulation;
        year.citySizeByCell[city.cellIndex] = CITY_SIZE_TO_INDEX[city.size];
        if (city.ownedCells.size > 0) {
          year.cityOwnedCellsByCell[city.cellIndex] = Array.from(city.ownedCells.keys());
        }
      }
    }

    return year;
  }
}

export const yearGenerator = new YearGenerator();
