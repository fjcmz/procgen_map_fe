/**
 * Phase 6: HistoryGenerator — Orchestration entry point.
 *
 * Ties together the physical world (Phase 2/3) and timeline simulation (Phase 4/5),
 * then serializes the result into HistoryData for the renderer and UI.
 */

import type { Cell, City, Road, HistoryEvent, HistoryYear, HistoryData, RegionData, ContinentData, TradeRouteEntry } from '../types';
import type { Trade } from './timeline/Trade';
import { buildPhysicalWorld } from './history';
import { generateRoads, computeDistanceFromLand, generateTradeRoutePath } from './roads';
import { timelineGenerator } from './timeline/TimelineGenerator';
import { HistoryRoot } from './HistoryRoot';
import type { World } from './physical/World';
import type { Year } from './timeline/Year';
import type { CountryEvent } from './timeline/Country';

/** Statistics about the generated history, for optional introspection. */
export interface HistoryStats {
  totalYearsSimulated: number;
  startOfTime: number;
  totalCities: number;
  totalFoundedCities: number;
  totalCountries: number;
  totalWars: number;
  totalWonders: number;
  totalReligions: number;
  totalCataclysms: number;
  totalEmpires: number;
  worldEnded: boolean;
  worldEndedOn?: number;
  peakPopulation: number;
}

/** Mapping from internal country ID (string) to numeric country index for ownership arrays. */
interface CountryIndexMap {
  idToIndex: Map<string, number>;
  indexToCountry: { id: string; name: string; regionId: string }[];
}

/**
 * Build a stable numeric index for all countries that formed during the timeline.
 * The old HistoryData format uses numeric country IDs for ownership arrays.
 */
function buildCountryIndexMap(world: World): CountryIndexMap {
  const idToIndex = new Map<string, number>();
  const indexToCountry: { id: string; name: string; regionId: string }[] = [];
  let idx = 0;
  for (const [countryId, country] of world.mapCountries) {
    idToIndex.set(countryId, idx);
    const region = world.mapRegions.get(country.governingRegion);
    // Use the first city's name as the country name, or the region ID
    const firstCity = region?.cities[0];
    const name = firstCity?.name ?? countryId;
    indexToCountry.push({ id: countryId, name, regionId: country.governingRegion });
    idx++;
  }
  return { idToIndex, indexToCountry };
}

/**
 * Convert a Phase 5 Year's events into HistoryEvent[] for the event log.
 */
function serializeYearEvents(
  year: Year,
  world: World,
  countryMap: CountryIndexMap,
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const absYear = year.year;

  // Foundations
  for (const f of year.foundations) {
    const city = world.mapCities.get(f.founded);
    events.push({
      type: 'FOUNDATION',
      year: absYear,
      initiatorId: -1,
      description: `${city?.name ?? 'A city'} is founded.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Contacts
  for (const c of year.contacts) {
    const from = world.mapCities.get(c.contactFrom);
    const to = world.mapCities.get(c.contactTo);
    events.push({
      type: 'CONTACT',
      year: absYear,
      initiatorId: -1,
      description: `${from?.name ?? '?'} makes contact with ${to?.name ?? '?'}.`,
      locationCellIndex: from?.cellIndex,
      targetCellIndex: to?.cellIndex,
    });
  }

  // Countries formed
  for (const c of year.countries) {
    const numIdx = countryMap.idToIndex.get(c.id) ?? -1;
    const region = world.mapRegions.get(c.governingRegion);
    const firstName = region?.cities[0]?.name ?? c.id;
    events.push({
      type: 'COUNTRY',
      year: absYear,
      initiatorId: numIdx,
      description: `The nation of ${firstName} is established (${c.spirit}).`,
      locationCellIndex: region?.cities[0]?.cellIndex,
    });
  }

  // Illustrates
  for (const ill of year.illustrates) {
    const city = world.mapCities.get(ill.city);
    events.push({
      type: 'ILLUSTRATE',
      year: absYear,
      initiatorId: -1,
      description: `A great ${ill.type} figure is born in ${city?.name ?? '?'}.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Wonders
  for (const w of year.wonders) {
    const city = world.mapCities.get(w.city);
    events.push({
      type: 'WONDER',
      year: absYear,
      initiatorId: -1,
      description: `A wonder is built in ${city?.name ?? '?'}.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Religions
  for (const r of year.religions) {
    const city = world.mapCities.get(r.foundingCity);
    events.push({
      type: 'RELIGION',
      year: absYear,
      initiatorId: -1,
      description: `A new religion is founded in ${city?.name ?? '?'}.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Trades
  for (const t of year.trades) {
    const c1 = world.mapCities.get(t.city1);
    const c2 = world.mapCities.get(t.city2);
    events.push({
      type: 'TRADE',
      year: absYear,
      initiatorId: -1,
      description: `Trade route opened: ${c1?.name ?? '?'} \u2194 ${c2?.name ?? '?'} (${t.resource1}/${t.resource2}).`,
      locationCellIndex: c1?.cellIndex,
      targetCellIndex: c2?.cellIndex,
    });
  }

  // Cataclysms
  for (const cat of year.cataclysms) {
    const city = world.mapCities.get(cat.city);
    events.push({
      type: 'CATACLYSM',
      year: absYear,
      initiatorId: -1,
      description: `${cat.strength} ${cat.type} strikes ${city?.name ?? '?'} — ${cat.killed.toLocaleString()} killed.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Wars
  for (const w of year.wars) {
    const aggCountry = world.mapCountries.get(w.aggressor) as CountryEvent | undefined;
    const defCountry = world.mapCountries.get(w.defender) as CountryEvent | undefined;
    const aggRegion = aggCountry ? world.mapRegions.get(aggCountry.governingRegion) : null;
    const defRegion = defCountry ? world.mapRegions.get(defCountry.governingRegion) : null;
    const aggName = aggRegion?.cities[0]?.name ?? w.aggressor;
    const defName = defRegion?.cities[0]?.name ?? w.defender;
    const aggIdx = countryMap.idToIndex.get(w.aggressor) ?? -1;
    const defIdx = countryMap.idToIndex.get(w.defender) ?? -1;
    events.push({
      type: 'WAR',
      year: absYear,
      initiatorId: aggIdx,
      targetId: defIdx,
      description: `${aggName} declares war on ${defName} (${w.reason}).`,
      locationCellIndex: aggRegion?.cities[0]?.cellIndex,
      targetCellIndex: defRegion?.cities[0]?.cellIndex,
    });
  }

  // Techs
  for (const t of year.techs) {
    const illustrate = world.mapIllustrates.get(t.discoverer);
    const city = illustrate ? world.mapCities.get(illustrate.city) : undefined;
    events.push({
      type: 'TECH',
      year: absYear,
      initiatorId: -1,
      description: `${t.field} technology advances to level ${t.level}.`,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Conquers
  for (const c of year.conquers) {
    const conqueror = world.mapCountries.get(c.conqueror) as CountryEvent | undefined;
    const conquered = world.mapCountries.get(c.conquered) as CountryEvent | undefined;
    const cqrRegion = conqueror ? world.mapRegions.get(conqueror.governingRegion) : null;
    const cqdRegion = conquered ? world.mapRegions.get(conquered.governingRegion) : null;
    const cqrName = cqrRegion?.cities[0]?.name ?? c.conqueror;
    const cqdName = cqdRegion?.cities[0]?.name ?? c.conquered;
    const cqrIdx = countryMap.idToIndex.get(c.conqueror) ?? -1;
    const cqdIdx = countryMap.idToIndex.get(c.conquered) ?? -1;
    events.push({
      type: 'CONQUEST',
      year: absYear,
      initiatorId: cqrIdx,
      targetId: cqdIdx,
      description: `${cqrName} conquers ${cqdName}.`,
      locationCellIndex: cqrRegion?.cities[0]?.cellIndex,
      targetCellIndex: cqdRegion?.cities[0]?.cellIndex,
    });
  }

  // Empires
  for (const emp of year.empires) {
    const founder = world.mapCountries.get(emp.foundedBy) as CountryEvent | undefined;
    const founderRegion = founder ? world.mapRegions.get(founder.governingRegion) : null;
    const founderName = founderRegion?.cities[0]?.name ?? emp.foundedBy;
    events.push({
      type: 'EMPIRE',
      year: absYear,
      initiatorId: countryMap.idToIndex.get(emp.foundedBy) ?? -1,
      description: `${founderName} proclaims an empire.`,
      locationCellIndex: founderRegion?.cities[0]?.cellIndex,
    });
  }

  return events;
}

/**
 * Compute cell-level ownership from the region-based country model at a given year index.
 * Returns an Int16Array mapping cellIndex → numeric country index (or -1 unclaimed, -2 impassable).
 */
function computeOwnership(
  cells: Cell[],
  world: World,
  yearObj: Year,
  countryMap: CountryIndexMap,
): Int16Array {
  const n = cells.length;
  const ownership = new Int16Array(n).fill(-1);

  // Mark impassable cells
  for (let i = 0; i < n; i++) {
    if (cells[i].isWater || cells[i].elevation >= 0.72) {
      ownership[i] = -2;
    }
  }

  // For each country, if it exists by this year, mark its region's cells
  for (const [countryId, country] of world.mapCountries) {
    const ce = country as CountryEvent;
    if (ce.foundedOn > yearObj.year) continue;
    const numIdx = countryMap.idToIndex.get(countryId);
    if (numIdx === undefined) continue;
    const region = world.mapRegions.get(ce.governingRegion);
    if (!region) continue;
    for (const ci of region.cellIndices) {
      if (ownership[ci] !== -2) {
        ownership[ci] = numIdx;
      }
    }
  }

  // Handle conquests: conquered country's region transfers to conqueror
  // We need to replay all conquests up to this year
  // The conquer events mutate country membership in empires but the region's countryId
  // doesn't change in the current model. So we track conquest-based region transfers.
  // Actually, looking at ConquerGenerator, it doesn't transfer region ownership.
  // We need to build a region→owner map from conquests.
  const regionOwner = new Map<string, string>(); // regionId → countryId
  for (const [countryId, country] of world.mapCountries) {
    const ce = country as CountryEvent;
    if (ce.foundedOn <= yearObj.year) {
      regionOwner.set(ce.governingRegion, countryId);
    }
  }

  // Now apply conquests in chronological order up to this year
  // We need to scan all years' conquers
  const timeline = yearObj.timeline;
  for (const y of timeline.years) {
    if (y.year > yearObj.year) break;
    for (const conquer of y.conquers) {
      const conqueredCountry = world.mapCountries.get(conquer.conquered) as CountryEvent | undefined;
      if (!conqueredCountry) continue;
      // Transfer the conquered country's region to the conqueror
      regionOwner.set(conqueredCountry.governingRegion, conquer.conqueror);
    }
  }

  // Now rebuild ownership from regionOwner
  for (const [regionId, ownerId] of regionOwner) {
    const numIdx = countryMap.idToIndex.get(ownerId);
    if (numIdx === undefined) continue;
    const region = world.mapRegions.get(regionId);
    if (!region) continue;
    for (const ci of region.cellIndices) {
      if (ownership[ci] !== -2) {
        ownership[ci] = numIdx;
      }
    }
  }

  return ownership;
}

/**
 * Return cell indices of cities that have a standing wonder at the given absolute year.
 */
function computeWonderCells(world: World, absYear: number): number[] {
  const result: number[] = [];
  for (const wonder of world.mapWonders.values()) {
    if (wonder.builtOn > absYear) continue;
    if (wonder.destroyedOn !== null && wonder.destroyedOn <= absYear) continue;
    const city = world.mapCities.get(wonder.city);
    if (city) result.push(city.cellIndex);
  }
  return result;
}

/**
 * Return cell indices of cities that have at least one active religion at the given absolute year.
 */
function computeReligionCells(world: World, absYear: number): number[] {
  const result: number[] = [];
  for (const city of world.mapUsableCities.values()) {
    if (city.foundedOn > absYear) continue;
    if (city.religions.size > 0) result.push(city.cellIndex);
  }
  return result;
}

export class HistoryGenerator {
  /**
   * Run the full generation pipeline: physical world + timeline simulation.
   * Returns everything needed for the renderer and UI.
   */
  generate(
    cells: Cell[],
    width: number,
    rng: () => number,
    numSimYears: number,
  ): {
    cities: City[];
    roads: Road[];
    historyData: HistoryData;
    regions: RegionData[];
    continents: ContinentData[];
    stats: HistoryStats;
  } {
    // Phase 0: Build physical world
    const { world, regionData, continentData } = buildPhysicalWorld(cells, width, rng);

    // Phase 1: Generate timeline (runs Phase 5 year-by-year simulation)
    const historyRoot = HistoryRoot.INSTANCE;
    const timeline = timelineGenerator.generate(rng, historyRoot, world);

    // Phase 2: Build country index map for ownership arrays
    const countryMap = buildCountryIndexMap(world);

    // Phase 3: Determine which years to serialize (sample up to numSimYears)
    // The timeline has 5000 years; we only expose numSimYears to the UI
    const yearsToSerialize = Math.min(numSimYears, timeline.years.length);

    // Phase 4: Serialize into HistoryData format
    const historyYears: HistoryYear[] = [];
    const snapshots: Record<number, Int16Array> = {};
    const tradeSnapshots: Record<number, TradeRouteEntry[]> = {};
    const wonderSnapshots: Record<number, number[]> = {};
    const religionSnapshots: Record<number, number[]> = {};

    // Active trade tracking: trade objects are mutated (ended field set) as simulation runs
    const activeTrades = new Map<string, Trade>();
    const activeTradeEntries = new Map<string, TradeRouteEntry>();

    // Precompute distance-from-land for trade route pathfinding (coastal-hugging A*)
    const distFromLand = computeDistanceFromLand(cells);
    const tradePathCache = new Map<string, number[]>();

    // Compute ownership at year 0 (before any events)
    let prevOwnership: Int16Array | null = null;

    for (let i = 0; i < yearsToSerialize; i++) {
      const yearObj = timeline.years[i];
      const events = serializeYearEvents(yearObj, world, countryMap);

      // Track newly-started trades this year
      for (const trade of yearObj.trades) {
        const c1 = world.mapCities.get(trade.city1);
        const c2 = world.mapCities.get(trade.city2);
        if (c1 && c2) {
          activeTrades.set(trade.id, trade);
          const cacheKey = [c1.cellIndex, c2.cellIndex].sort((a, b) => a - b).join('-');
          let path = tradePathCache.get(cacheKey);
          if (!path) {
            path = generateTradeRoutePath(cells, distFromLand, c1.cellIndex, c2.cellIndex, width);
            tradePathCache.set(cacheKey, path);
          }
          activeTradeEntries.set(trade.id, { cell1: c1.cellIndex, cell2: c2.cellIndex, path });
        }
      }

      // Remove ended trades (trade.ended is set by the simulation)
      for (const [id, trade] of activeTrades) {
        if (trade.ended !== null && trade.ended <= yearObj.year) {
          activeTrades.delete(id);
          activeTradeEntries.delete(id);
        }
      }

      // Compute ownership for this year
      const ownership = computeOwnership(cells, world, yearObj, countryMap);

      // Compute delta from previous
      const delta = new Map<number, number>();
      if (prevOwnership) {
        for (let ci = 0; ci < cells.length; ci++) {
          if (ownership[ci] !== prevOwnership[ci]) {
            delta.set(ci, ownership[ci]);
          }
        }
      }

      historyYears.push({
        year: i,
        events,
        ownershipDelta: delta,
        worldPopulation: yearObj.worldPopulation,
      });

      // Snapshot every 20 years
      if (i % 20 === 0) {
        snapshots[i] = new Int16Array(ownership);
        tradeSnapshots[i] = Array.from(activeTradeEntries.values());
        wonderSnapshots[i] = computeWonderCells(world, yearObj.year);
        religionSnapshots[i] = computeReligionCells(world, yearObj.year);
      }

      prevOwnership = ownership;
    }

    // Always snapshot final year
    const finalAbsYear = timeline.years[yearsToSerialize - 1]?.year ?? 0;
    if (prevOwnership) {
      snapshots[yearsToSerialize] = prevOwnership;
      tradeSnapshots[yearsToSerialize] = Array.from(activeTradeEntries.values());
      wonderSnapshots[yearsToSerialize] = computeWonderCells(world, finalAbsYear);
      religionSnapshots[yearsToSerialize] = computeReligionCells(world, finalAbsYear);
    } else {
      snapshots[0] = new Int16Array(cells.length).fill(-1);
      tradeSnapshots[0] = [];
      wonderSnapshots[0] = [];
      religionSnapshots[0] = [];
    }

    // Phase 5: Build Country[] for UI
    const countries = countryMap.indexToCountry.map((entry, idx) => {
      const country = world.mapCountries.get(entry.id) as CountryEvent;
      const region = world.mapRegions.get(entry.regionId);
      const capitalCell = region?.cities[0]?.cellIndex ?? 0;
      // Country is alive if its region isn't conquered by another at the final year
      const isAlive = !!country && country.foundedOn <= (timeline.years[yearsToSerialize - 1]?.year ?? 0);
      return {
        id: idx,
        name: entry.name,
        capitalCellIndex: capitalCell,
        isAlive,
      };
    });

    // Phase 6: Build City[] for rendering from founded CityEntity objects
    const cities: City[] = [];
    for (const cityEntity of world.mapCities.values()) {
      if (!cityEntity.founded) continue;
      // Find which country (if any) owns this city's region
      const region = world.mapRegions.get(cityEntity.regionId);
      let kingdomId = -1;
      if (region?.countryId) {
        kingdomId = countryMap.idToIndex.get(region.countryId) ?? -1;
      }
      cities.push({
        cellIndex: cityEntity.cellIndex,
        name: cityEntity.name,
        isCapital: region?.cities[0]?.id === cityEntity.id,
        kingdomId,
        foundedYear: cityEntity.foundedOn - timeline.startOfTime,
        size: cityEntity.size,
      });
    }

    // Phase 7: Apply final ownership to cell.kingdom for baseline rendering
    if (prevOwnership) {
      for (let i = 0; i < cells.length; i++) {
        const o = prevOwnership[i];
        cells[i].kingdom = o >= 0 ? o : null;
      }
    }

    // Phase 8: Generate roads between founded cities
    const roads = generateRoads(cells, cities);

    // Phase 9: Compute statistics
    let peakPop = 0;
    for (const y of timeline.years) {
      if (y.worldPopulation > peakPop) peakPop = y.worldPopulation;
    }

    const stats: HistoryStats = {
      totalYearsSimulated: yearsToSerialize,
      startOfTime: timeline.startOfTime,
      totalCities: world.mapCities.size,
      totalFoundedCities: world.mapUsableCities.size,
      totalCountries: world.mapCountries.size,
      totalWars: world.mapWars.size,
      totalWonders: world.mapWonders.size,
      totalReligions: world.mapReligions.size,
      totalCataclysms: timeline.years.reduce((sum, y) => sum + y.cataclysms.length, 0),
      totalEmpires: timeline.years.reduce((sum, y) => sum + y.empires.length, 0),
      worldEnded: world.endedBy !== '',
      worldEndedOn: world.endedOn || undefined,
      peakPopulation: peakPop,
    };

    const historyData: HistoryData = {
      countries,
      years: historyYears,
      numYears: yearsToSerialize,
      snapshots,
      tradeSnapshots,
      wonderSnapshots,
      religionSnapshots,
    };

    return {
      cities,
      roads,
      historyData,
      regions: regionData,
      continents: continentData,
      stats,
    };
  }
}

export const historyGenerator = new HistoryGenerator();
