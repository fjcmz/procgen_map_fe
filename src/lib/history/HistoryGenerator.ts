/**
 * Phase 6: HistoryGenerator — Orchestration entry point.
 *
 * Ties together the physical world (Phase 2/3) and timeline simulation (Phase 4/5),
 * then serializes the result into HistoryData for the renderer and UI.
 */

import type { Cell, City, Road, HistoryEvent, HistoryYear, HistoryData, RegionData, ContinentData, TradeRouteEntry, TechTimeline, EmpireSnapshotEntry, WonderSnapshotEntry, WonderDetail, IllustrateDetail } from '../types';
import type { Trade } from './timeline/Trade';
import { buildPhysicalWorld } from './history';
import { RARITY_WEIGHTS_BY_MODE } from './physical/ResourceCatalog';
import type { ResourceRarity } from './physical/ResourceCatalog';
import { aStar, computeDistanceFromLand, generateTradeRoutePath } from './roads';
import { timelineGenerator } from './timeline/TimelineGenerator';
import { HistoryRoot } from './HistoryRoot';
import type { World } from './physical/World';
import type { Year } from './timeline/Year';
import type { CountryEvent } from './timeline/Country';
import type { TechField } from './timeline/Tech';
import { getCountryTechLevel } from './timeline/Tech';
import { nameForLevel } from './timeline/techNames';
import { WONDER_TIER_NAMES } from './timeline/wonderNames';
import type { IllustrateType } from './timeline/Illustrate';
import { generateCountryName, generateEmpireName } from './nameGenerator';
import type { CityEntity } from './physical/CityEntity';

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
  /** Phase 3: total number of tech discoveries across the simulated timeline. */
  totalTechs: number;
  /** Phase 3: peak level reached for each of the 9 tech fields. */
  peakTechLevelByField: Record<TechField, number>;
  /** Phase 4: total trade events across the timeline. */
  totalTrades: number;
  /** Phase 4: total conquest outcomes across the timeline. */
  totalConquests: number;
  /** Phase 4: total population killed by cataclysms across the timeline. */
  totalCataclysmDeaths: number;
  /** Spec stretch §1: total tech-loss decrements applied across the timeline. */
  totalTechLosses: number;
  /** Spec stretch §1: total tech-loss rolls absorbed by `government >= 2`. */
  totalTechLossesAbsorbed: number;
  /** Spec stretch §2: total trade-driven tech-diffusion events across the timeline. */
  totalTechDiffusions: number;
  /** Total cities that became ruins across the timeline. */
  totalRuins: number;
  /** Total territorial expansion events across the timeline. */
  totalExpansions: number;
  /** Total settlement events (cities founded in expansion territory) across the timeline. */
  totalSettlements: number;
  /** Total tech-gated resource discoveries across the timeline. */
  totalDiscoveries: number;
  /**
   * Phase 4: tech events bucketed by century (index = floor((year - startOfTime) / 100))
   * per field. Array length is `ceil(totalYearsSimulated / 100)`. Used by the sweep
   * harness to detect throughput snowballs in late-game centuries.
   */
  techEventsPerCenturyByField: Record<TechField, number[]>;
  /**
   * Phase 4: final-year peak country tech level per field. Walks `world.mapCountries`
   * once at end-of-simulation via `getCountryTechLevel` so empire-member countries
   * resolve through the founder scope correctly.
   */
  peakCountryTechLevelByField: Record<TechField, number>;
  /**
   * Phase 4: final-year median country tech level per field. Same walk as `peak…`
   * above; median is computed over all countries (including level-0 entries).
   */
  medianCountryTechLevelByField: Record<TechField, number>;
}

/** Phase 3: human-readable noun for each illustrate type, used in tech-event descriptions. */
const ILLUSTRATE_NOUN: Record<IllustrateType, string> = {
  science: 'scientist',
  military: 'military leader',
  philosophy: 'philosopher',
  industry: 'industrialist',
  religion: 'religious figure',
  art: 'artist',
};

/** Phase 3: capitalize the first letter of a string for sentence-case rendering. */
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Phase 3 + spec stretch §3: format a TECH event description.
 *
 * When `displayName` is supplied (the normal path — caller resolves it via
 * `nameForLevel`), the bare `${field} level ${level}` phrase becomes
 * `${displayName} (${field} L${level})`:
 *
 * - Country known: "Avaloria discovers Astronomy (science L4) (by a science figure in Tall Harbor)"
 * - No country, city + illustrate known: "Tall Harbor discovers Astronomy (science L4) (by a science figure)"
 * - Stateless / unknown: "Science advances to Astronomy (L4)."
 *
 * `displayName` stays optional so the function remains robust if a future
 * call site forgets to pass it — the fallback reproduces the pre-§3 text.
 */
function buildTechDescription(args: {
  countryName?: string;
  cityName?: string;
  illustrateType?: IllustrateType;
  illustrateName?: string;
  field: string;
  level: number;
  displayName?: string;
}): string {
  const { countryName, cityName, illustrateType, illustrateName, field, level, displayName } = args;
  const noun = illustrateType ? ILLUSTRATE_NOUN[illustrateType] : undefined;
  const techPhrase = displayName
    ? `${displayName} (${field} L${level})`
    : `${field} level ${level}`;
  if (countryName) {
    const by = noun
      ? illustrateName
        ? cityName
          ? ` (by ${illustrateName}, a ${noun} in ${cityName})`
          : ` (by ${illustrateName}, a ${noun})`
        : cityName
          ? ` (by a ${noun} in ${cityName})`
          : ` (by a ${noun})`
      : '';
    return `${countryName} discovers ${techPhrase}${by}.`;
  }
  if (cityName) {
    const by = noun
      ? illustrateName
        ? ` (by ${illustrateName}, a ${noun})`
        : ` (by a ${noun})`
      : '';
    return `${cityName} discovers ${techPhrase}${by}.`;
  }
  if (displayName) {
    return `${capitalize(field)} advances to ${displayName} (L${level}).`;
  }
  return `${capitalize(field)} advances to level ${level}.`;
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
function buildCountryIndexMap(world: World, rng: () => number): CountryIndexMap {
  const idToIndex = new Map<string, number>();
  const indexToCountry: { id: string; name: string; regionId: string }[] = [];
  const usedCountryNames = new Set<string>();
  let idx = 0;
  for (const [countryId, country] of world.mapCountries) {
    idToIndex.set(countryId, idx);
    const name = generateCountryName(rng, usedCountryNames);
    indexToCountry.push({ id: countryId, name, regionId: country.governingRegion });
    idx++;
  }
  // Include dissolved countries so their names can be resolved for empire snapshots
  for (const [countryId, country] of world.mapDeadCountries) {
    if (idToIndex.has(countryId)) continue; // guard against duplicates
    idToIndex.set(countryId, idx);
    const name = generateCountryName(rng, usedCountryNames);
    indexToCountry.push({ id: countryId, name, regionId: country.governingRegion });
    idx++;
  }
  return { idToIndex, indexToCountry };
}

/** Resolve a country's generated display name from countryMap, falling back to the raw ID. */
function resolveCountryName(countryMap: CountryIndexMap, countryId: string): string {
  const idx = countryMap.idToIndex.get(countryId);
  if (idx != null) return countryMap.indexToCountry[idx].name;
  return countryId;
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
    const cName = resolveCountryName(countryMap, c.id);
    events.push({
      type: 'COUNTRY',
      year: absYear,
      initiatorId: numIdx,
      description: `The nation of ${cName} is established (${c.spirit}).`,
      locationCellIndex: region?.cities[0]?.cellIndex,
    });
  }

  // Illustrates
  for (const ill of year.illustrates) {
    const city = world.mapCities.get(ill.city);
    const region = city ? world.mapRegions.get(city.regionId) : undefined;
    const illCountryName = region?.countryId
      ? resolveCountryName(countryMap, region.countryId)
      : null;
    events.push({
      type: 'ILLUSTRATE',
      year: absYear,
      initiatorId: -1,
      description: illCountryName
        ? `${ill.name}, a great ${ill.type} figure, is born in ${city?.name ?? '?'} (${illCountryName}).`
        : `${ill.name}, a great ${ill.type} figure, is born in ${city?.name ?? '?'}.`,
      locationCellIndex: city?.cellIndex,
      discovererName: ill.name,
      discovererType: ill.type,
      countryName: illCountryName ?? undefined,
    });
  }

  // Wonders
  for (const w of year.wonders) {
    const city = world.mapCities.get(w.city);
    const tierName = WONDER_TIER_NAMES[w.tier] ?? `Tier ${w.tier}`;
    events.push({
      type: 'WONDER',
      year: absYear,
      initiatorId: -1,
      description: `${w.name} (Tier ${w.tier} ${tierName}) is built in ${city?.name ?? '?'}.`,
      locationCellIndex: city?.cellIndex,
      wonderName: w.name,
      wonderTier: w.tier,
    });
  }

  // Wonder destructions — scan all wonders for any destroyed this year.
  // The destruction is recorded on the Wonder object by CataclysmGenerator;
  // we resolve the cause from the year's cataclysms to build the description.
  for (const w of world.mapWonders.values()) {
    if (w.destroyedOn !== absYear) continue;
    const city = world.mapCities.get(w.city);
    const tierName = WONDER_TIER_NAMES[w.tier] ?? `Tier ${w.tier}`;
    // Resolve cataclysm type from the year's cataclysms via destroyCause ID
    const causingCat = year.cataclysms.find(c => c.id === w.destroyCause);
    const causeDesc = causingCat ? `destroyed by ${causingCat.strength} ${causingCat.type}` : 'destroyed';
    events.push({
      type: 'WONDER_DESTROYED',
      year: absYear,
      initiatorId: -1,
      description: `${w.name} (Tier ${w.tier} ${tierName}) in ${city?.name ?? '?'} is ${causeDesc}.`,
      locationCellIndex: city?.cellIndex,
      wonderName: w.name,
      wonderTier: w.tier,
    });
  }

  // Religions
  // Spec stretch §4: resolve the religion's origin country at serialization
  // time, compute which tech bonuses (art / government) are currently
  // boosting its propagation, and surface that as both a flavor suffix on
  // the description and a structured `propagationReason` field. This mirrors
  // the "enrich description + optional structured field" pattern used by
  // TRADE/`techDiffusion` and TECH_LOSS — zero simulation impact, purely a
  // read-side enrichment over the live tech state.
  for (const r of year.religions) {
    const city = world.mapCities.get(r.foundingCity);
    let description = `A new religion is founded in ${city?.name ?? '?'}.`;
    let propagationReason: HistoryEvent['propagationReason'];
    if (r.originCountry) {
      const origin = world.mapCountries.get(r.originCountry) as CountryEvent | undefined;
      if (origin) {
        const hasArt = getCountryTechLevel(world, origin, 'art') > 0;
        const hasGov = getCountryTechLevel(world, origin, 'government') > 0;
        if (hasArt && hasGov) propagationReason = 'both';
        else if (hasArt)      propagationReason = 'art';
        else if (hasGov)      propagationReason = 'government';
        if (propagationReason) {
          const label = propagationReason === 'both'
            ? 'art and government'
            : propagationReason;
          description += ` (spread boosted by ${label})`;
        }
      }
    }
    events.push({
      type: 'RELIGION',
      year: absYear,
      initiatorId: -1,
      description,
      locationCellIndex: city?.cellIndex,
      propagationReason,
    });
  }

  // Trades
  for (const t of year.trades) {
    const c1 = world.mapCities.get(t.city1);
    const c2 = world.mapCities.get(t.city2);
    let description = `Trade route opened: ${c1?.name ?? '?'} \u2194 ${c2?.name ?? '?'} (${t.resource1}/${t.resource2}).`;

    // Spec stretch §2: surface trade-driven tech diffusion. Resolve donor +
    // receiver country names via the same `governingRegion → cities[0]?.name`
    // ladder used by the CONQUEST/TECH blocks below.
    let techDiffusionPayload: HistoryEvent['techDiffusion'];
    if (t.techDiffusion) {
      const fromName = resolveCountryName(countryMap, t.techDiffusion.donorCountryId);
      const toName = resolveCountryName(countryMap, t.techDiffusion.receiverCountryId);
      description += ` ${toName} learns ${t.techDiffusion.field} L${t.techDiffusion.newLevel} via trade with ${fromName}.`;
      techDiffusionPayload = {
        field: t.techDiffusion.field,
        fromCountryName: fromName,
        toCountryName: toName,
        newLevel: t.techDiffusion.newLevel,
      };
    }

    events.push({
      type: 'TRADE',
      year: absYear,
      initiatorId: -1,
      description,
      locationCellIndex: c1?.cellIndex,
      targetCellIndex: c2?.cellIndex,
      techDiffusion: techDiffusionPayload,
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

    // Spec stretch §1: emit per-country TECH_LOSS events for any
    // knowledge-destroying cataclysm. Lost and absorbed entries are bundled
    // per country so the renderer can show "destroyed N, government absorbed M"
    // in a single row instead of duplicating context across multiple events.
    if (cat.techLosses.length === 0 && cat.absorbedTechLosses.length === 0) continue;

    type Bucket = { lost: typeof cat.techLosses; absorbed: typeof cat.absorbedTechLosses };
    const byCountry = new Map<string, Bucket>();
    for (const l of cat.techLosses) {
      let bucket = byCountry.get(l.countryId);
      if (!bucket) {
        bucket = { lost: [], absorbed: [] };
        byCountry.set(l.countryId, bucket);
      }
      bucket.lost.push(l);
    }
    for (const a of cat.absorbedTechLosses) {
      let bucket = byCountry.get(a.countryId);
      if (!bucket) {
        bucket = { lost: [], absorbed: [] };
        byCountry.set(a.countryId, bucket);
      }
      bucket.absorbed.push(a);
    }

    for (const [countryId, { lost, absorbed }] of byCountry) {
      const cName = resolveCountryName(countryMap, countryId);
      const cIdx = countryMap.idToIndex.get(countryId) ?? -1;

      let description: string;
      if (lost.length > 0 && absorbed.length === 0) {
        const first = lost[0];
        description = `${cName} loses ${first.field} knowledge (level ${first.newLevel + 1}\u2192${first.newLevel}) in the ${cat.type}.`;
        if (lost.length > 1) description += ` (+${lost.length - 1} more)`;
      } else if (lost.length === 0 && absorbed.length > 0) {
        description = `${cName}'s government absorbs the ${cat.type}'s blow to knowledge.`;
      } else {
        description = `${cName} loses ${lost.length} tech${lost.length === 1 ? '' : 's'} in the ${cat.type} (government absorbs ${absorbed.length}).`;
      }

      events.push({
        type: 'TECH_LOSS',
        year: absYear,
        initiatorId: cIdx,
        description,
        locationCellIndex: city?.cellIndex,
        countryName: cName,
        lostTechs: lost.length > 0
          ? lost.map(l => ({ field: l.field, newLevel: l.newLevel }))
          : undefined,
        absorbedTechs: absorbed.length > 0
          ? absorbed.map(a => ({ field: a.field, level: a.level }))
          : undefined,
      });
    }
  }

  // Wars
  for (const w of year.wars) {
    const aggCountry = world.mapCountries.get(w.aggressor) as CountryEvent | undefined;
    const defCountry = world.mapCountries.get(w.defender) as CountryEvent | undefined;
    const aggRegion = aggCountry ? world.mapRegions.get(aggCountry.governingRegion) : null;
    const defRegion = defCountry ? world.mapRegions.get(defCountry.governingRegion) : null;
    const aggName = resolveCountryName(countryMap, w.aggressor);
    const defName = resolveCountryName(countryMap, w.defender);
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

  // Techs (Phase 3): enrich event with country index + name, illustrate type,
  // structured field/level, and a spec-format description so the UI can render
  // rich rows without per-event-type formatting logic.
  for (const t of year.techs) {
    const illustrate = world.mapIllustrates.get(t.discoverer);
    const city = illustrate ? world.mapCities.get(illustrate.city) : undefined;
    const region = city ? world.mapRegions.get(city.regionId) : undefined;
    const country = region?.countryId
      ? (world.mapCountries.get(region.countryId) as CountryEvent | undefined)
      : undefined;
    const countryIdx = country
      ? countryMap.idToIndex.get(country.id) ?? -1
      : -1;
    const countryName = country
      ? resolveCountryName(countryMap, country.id)
      : undefined;

    const displayName = nameForLevel(t.field, t.level);
    events.push({
      type: 'TECH',
      year: absYear,
      initiatorId: countryIdx,
      description: buildTechDescription({
        countryName,
        cityName: city?.name,
        illustrateType: illustrate?.type,
        illustrateName: illustrate?.name,
        field: t.field,
        level: t.level,
        displayName,
      }),
      locationCellIndex: city?.cellIndex,
      field: t.field,
      level: t.level,
      displayName,
      discovererName: illustrate?.name ?? 'unknown',
      discovererType: illustrate?.type,
      discovererBirthYear: illustrate?.birthYear,
      discovererCityName: city?.name,
      countryName,
    });
  }

  // Discoveries (tech-gated resources): each entry records a resource type
  // that the owning country just unlocked for trade in a specific region.
  // Description format: "{Country} discovers {resource} in {biome} region
  // (requires {field} L{level})". `locationCellIndex` prefers the region's
  // first city for clickable navigation, falling back to the region's first
  // cell when the region has no founded city yet.
  for (const d of year.discoveries) {
    const region = world.mapRegions.get(d.regionId);
    const cName = resolveCountryName(countryMap, d.countryId);
    const cIdx = countryMap.idToIndex.get(d.countryId) ?? -1;
    const locCell =
      region?.cities[0]?.cellIndex ??
      region?.cellIndices[0];
    const biomeLabel = region?.biome ?? 'unknown';
    const levelSuffix = d.level > 0 ? ` (requires ${d.field} L${d.level})` : ` (no tech gate)`;
    events.push({
      type: 'DISCOVERY',
      year: absYear,
      initiatorId: cIdx,
      description: `${cName} discovers ${d.resourceType} in ${biomeLabel} region${levelSuffix}.`,
      locationCellIndex: locCell,
      countryName: cName,
      discoveredResource: {
        type: d.resourceType,
        field: d.field,
        level: d.level,
      },
    });
  }

  // Conquers (Phase 3): surface the acquired-tech delta in both the description
  // and a structured `acquiredTechs` field for any UI that wants the raw list.
  for (const c of year.conquers) {
    const conqueror = world.mapCountries.get(c.conqueror) as CountryEvent | undefined;
    const conquered = world.mapCountries.get(c.conquered) as CountryEvent | undefined;
    const cqrRegion = conqueror ? world.mapRegions.get(conqueror.governingRegion) : null;
    const cqdRegion = conquered ? world.mapRegions.get(conquered.governingRegion) : null;
    const cqrName = resolveCountryName(countryMap, c.conqueror);
    const cqdName = resolveCountryName(countryMap, c.conquered);
    const cqrIdx = countryMap.idToIndex.get(c.conqueror) ?? -1;
    const cqdIdx = countryMap.idToIndex.get(c.conquered) ?? -1;
    const acquired = (c.acquiredTechList ?? []).map(a => ({
      field: a.field,
      level: a.level,
      displayName: nameForLevel(a.field, a.level),
    }));
    const techSuffix = acquired.length > 0
      ? ` (+${acquired.length} tech${acquired.length === 1 ? '' : 's'})`
      : '';
    events.push({
      type: 'CONQUEST',
      year: absYear,
      initiatorId: cqrIdx,
      targetId: cqdIdx,
      description: `${cqrName} conquers ${cqdName}${techSuffix}.`,
      locationCellIndex: cqrRegion?.cities[0]?.cellIndex,
      targetCellIndex: cqdRegion?.cities[0]?.cellIndex,
      countryName: cqrName,
      acquiredTechs: acquired.length > 0 ? acquired : undefined,
    });
  }

  // Empires
  for (const emp of year.empires) {
    const founder = world.mapCountries.get(emp.foundedBy) as CountryEvent | undefined;
    const founderRegion = founder ? world.mapRegions.get(founder.governingRegion) : null;
    const founderName = resolveCountryName(countryMap, emp.foundedBy);
    events.push({
      type: 'EMPIRE',
      year: absYear,
      initiatorId: countryMap.idToIndex.get(emp.foundedBy) ?? -1,
      description: `${founderName} proclaims an empire.`,
      locationCellIndex: founderRegion?.cities[0]?.cellIndex,
    });
  }

  // Ruins
  for (const ruin of year.ruins) {
    const city = world.mapCities.get(ruin.city);
    let description = `${city?.name ?? 'A city'} fell to ruin (${ruin.cause}).`;
    if (ruin.dissolvedCountry) {
      description += ` Its nation dissolved.`;
    }
    events.push({
      type: 'RUIN',
      year: absYear,
      initiatorId: -1,
      description,
      locationCellIndex: city?.cellIndex,
    });
  }

  // Territorial expansions
  for (const exp of year.expansions) {
    const numIdx = countryMap.idToIndex.get(exp.countryId) ?? -1;
    const cName = resolveCountryName(countryMap, exp.countryId);
    const region = world.mapRegions.get(exp.regionId);
    events.push({
      type: 'TERRITORIAL_EXPANSION',
      year: absYear,
      initiatorId: numIdx,
      description: `${cName} expands into unclaimed territory (${region?.biome ?? 'unknown'} region, ${exp.cellIndices.length} cells).`,
      expansionCellCount: exp.cellIndices.length,
    });
  }

  // Settlements
  for (const settle of year.settlements) {
    const numIdx = countryMap.idToIndex.get(settle.countryId) ?? -1;
    const cName = resolveCountryName(countryMap, settle.countryId);
    const city = world.mapCities.get(settle.cityId);
    events.push({
      type: 'SETTLEMENT',
      year: absYear,
      initiatorId: numIdx,
      description: `${cName} settles ${city?.name ?? 'a city'} in its expansion territory, consolidating ${settle.cellIndices.length} cells.`,
      settlementCityName: city?.name,
      locationCellIndex: city?.cellIndex,
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

  // Mark impassable cells — deep ocean and high mountains.
  // Coastal water cells that belong to a region (have regionId) stay claimable
  // so countries can own their territorial waters.
  for (let i = 0; i < n; i++) {
    if (cells[i].elevation >= 0.72) {
      ownership[i] = -2;
    } else if (cells[i].isWater && !cells[i].regionId) {
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

  // Also seed dead countries (dissolved via ruinifyCity) — their governing
  // regions should appear in historical snapshots for years before dissolution.
  // Only fill unclaimed cells so live countries take priority.
  for (const [countryId, country] of world.mapDeadCountries) {
    const ce = country as CountryEvent;
    if (ce.foundedOn > yearObj.year) continue;
    const numIdx = countryMap.idToIndex.get(countryId);
    if (numIdx === undefined) continue;
    const region = world.mapRegions.get(ce.governingRegion);
    if (!region) continue;
    for (const ci of region.cellIndices) {
      if (ownership[ci] === -1) {
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
  // Include dead countries so conquest chains involving dissolved countries
  // can still transfer their regions. Only seed if not already claimed by
  // a live country.
  for (const [countryId, country] of world.mapDeadCountries) {
    const ce = country as CountryEvent;
    if (ce.foundedOn <= yearObj.year) {
      if (!regionOwner.has(ce.governingRegion)) {
        regionOwner.set(ce.governingRegion, countryId);
      }
    }
  }

  // Now apply conquests in chronological order up to this year.
  // Transitive: when C conquers B (who had conquered A), all regions
  // owned by B (including A's formerly-conquered region) transfer to C.
  const timeline = yearObj.timeline;
  for (const y of timeline.years) {
    if (y.year > yearObj.year) break;
    for (const conquer of y.conquers) {
      const conqueredCountry = (world.mapCountries.get(conquer.conquered)
        ?? world.mapDeadCountries.get(conquer.conquered)) as CountryEvent | undefined;
      if (!conqueredCountry) continue;
      // Transfer ALL regions currently owned by the conquered to the conqueror.
      // This handles transitive chains (C beats B who beat A → C gets A's region).
      for (const [regionId, ownerId] of regionOwner) {
        if (ownerId === conquer.conquered) {
          regionOwner.set(regionId, conquer.conqueror);
        }
      }
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

  // Overlay expansion territory: replay expansion events up to this year.
  // Track current owner of each expansion event's cells so transitive
  // conquests work: when C conquers B who inherited A's expansions, C
  // inherits them too.
  const expansionOwner = new Map<string, string>(); // exp.countryId → current owner
  for (const y of timeline.years) {
    if (y.year > yearObj.year) break;
    for (const exp of y.expansions) {
      const owner = expansionOwner.get(exp.countryId) ?? exp.countryId;
      const numIdx = countryMap.idToIndex.get(owner);
      if (numIdx === undefined) continue;
      for (const ci of exp.cellIndices) {
        if (ownership[ci] !== -2) {
          ownership[ci] = numIdx;
        }
      }
    }
    // Conquests transfer expansion ownership transitively
    for (const conquer of y.conquers) {
      // Transfer all expansion events currently owned by the conquered
      for (const [origId, ownerId] of expansionOwner) {
        if (ownerId === conquer.conquered) {
          expansionOwner.set(origId, conquer.conqueror);
        }
      }
      // Also transfer the conquered country's own (original) expansion events
      if (!expansionOwner.has(conquer.conquered)) {
        expansionOwner.set(conquer.conquered, conquer.conqueror);
      }
      // Re-apply all expansion cells up to this year with updated ownership
      const conquerorIdx = countryMap.idToIndex.get(conquer.conqueror);
      if (conquerorIdx === undefined) continue;
      for (const prevY of timeline.years) {
        if (prevY.year > y.year) break;
        for (const prevExp of prevY.expansions) {
          const currentOwner = expansionOwner.get(prevExp.countryId);
          if (currentOwner === conquer.conqueror) {
            for (const ci of prevExp.cellIndices) {
              if (ownership[ci] !== -2) {
                ownership[ci] = conquerorIdx;
              }
            }
          }
        }
      }
    }
  }

  return ownership;
}

/**
 * Compute expansion flags: which cells are expansion territory at a given year.
 * Returns a Uint8Array where 1 = expansion territory, 0 = core/unclaimed.
 */
function computeExpansionFlags(
  cells: Cell[],
  yearObj: Year,
  _countryMap: CountryIndexMap,
): Uint8Array {
  const n = cells.length;
  const flags = new Uint8Array(n); // all 0

  // Track which cells are expansion territory and who owns them
  // We need to handle: expansions add cells, settlements clear them, conquests transfer them
  const expansionOwner = new Map<number, string>(); // cellIndex → countryId

  const timeline = yearObj.timeline;
  for (const y of timeline.years) {
    if (y.year > yearObj.year) break;

    // Expansions: mark cells as expansion territory
    for (const exp of y.expansions) {
      for (const ci of exp.cellIndices) {
        expansionOwner.set(ci, exp.countryId);
      }
    }

    // Settlements: clear expansion flags for consolidated cells
    for (const settle of y.settlements) {
      for (const ci of settle.cellIndices) {
        expansionOwner.delete(ci);
      }
    }

    // Conquests: transfer expansion ownership
    for (const conquer of y.conquers) {
      for (const [ci, owner] of expansionOwner) {
        if (owner === conquer.conquered) {
          expansionOwner.set(ci, conquer.conqueror);
        }
      }
    }
  }

  // Write flags
  for (const ci of expansionOwner.keys()) {
    if (ci >= 0 && ci < n) {
      flags[ci] = 1;
    }
  }

  return flags;
}

/**
 * Return rich snapshot entries for cities that have a standing wonder at the given absolute year.
 */
function computeWonderSnapshots(world: World, absYear: number): WonderSnapshotEntry[] {
  const result: WonderSnapshotEntry[] = [];
  for (const wonder of world.mapWonders.values()) {
    if (wonder.builtOn > absYear) continue;
    if (wonder.destroyedOn !== null && wonder.destroyedOn <= absYear) continue;
    const city = world.mapCities.get(wonder.city);
    if (city) {
      result.push({
        cellIndex: city.cellIndex,
        name: wonder.name,
        tier: wonder.tier,
        builtOn: wonder.builtOn,
        cityName: city.name,
      });
    }
  }
  return result;
}

/**
 * Build the full illustrateDetails array — ALL illustrates ever born (including dead).
 * Used by the IllustratesTab to render the illustrate list.
 */
function buildIllustrateDetails(world: World, countryMap: CountryIndexMap): IllustrateDetail[] {
  const details: IllustrateDetail[] = [];
  for (const ill of world.mapIllustrates.values()) {
    const city = world.mapCities.get(ill.city);
    const region = city ? world.mapRegions.get(city.regionId) : undefined;
    const countryName = region?.countryId
      ? resolveCountryName(countryMap, region.countryId)
      : null;
    details.push({
      name: ill.name,
      type: ill.type,
      cityName: city?.name ?? '?',
      cityCellIndex: city?.cellIndex ?? -1,
      countryName,
      birthYear: ill.birthYear,
      deathYear: ill.diedOn,
      deathCause: ill.deathCause,
    });
  }
  details.sort((a, b) => a.birthYear - b.birthYear);
  return details;
}

/**
 * Build the full wonderDetails array — ALL wonders ever built (including destroyed).
 * Used by the DetailsTab to render the complete wonder tree per entity.
 */
function buildWonderDetails(world: World): WonderDetail[] {
  const details: WonderDetail[] = [];
  for (const wonder of world.mapWonders.values()) {
    const city = world.mapCities.get(wonder.city);
    details.push({
      name: wonder.name,
      tier: wonder.tier,
      cityName: city?.name ?? '?',
      cityCellIndex: city?.cellIndex ?? -1,
      builtOn: wonder.builtOn,
      destroyedOn: wonder.destroyedOn,
    });
  }
  // Sort by builtOn ascending for consistent display
  details.sort((a, b) => a.builtOn - b.builtOn);
  return details;
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
    rarityWeights: Record<ResourceRarity, number> = RARITY_WEIGHTS_BY_MODE.scarce,
  ): {
    cities: City[];
    roads: Road[];
    historyData: HistoryData;
    regions: RegionData[];
    continents: ContinentData[];
    stats: HistoryStats;
  } {
    // Phase 0: Build physical world
    const { world, regionData, continentData, usedCityNames } = buildPhysicalWorld(cells, width, rng, rarityWeights);

    // Phase 1: Generate timeline (runs Phase 5 year-by-year simulation)
    const historyRoot = HistoryRoot.INSTANCE;
    const timeline = timelineGenerator.generate(rng, historyRoot, world, cells, usedCityNames);

    // Phase 1b: Update region resource exploitation status from city territory.
    // Build a global set of all cells owned by any founded city, then mark each
    // resource in regionData as exploited or not.
    {
      const allOwnedCells = new Set<number>();
      for (const city of world.mapCities.values()) {
        if (!city.founded) continue;
        for (const ci of city.ownedCells.keys()) allOwnedCells.add(ci);
      }
      for (const rd of regionData) {
        if (!rd.resources) continue;
        for (const r of rd.resources) {
          r.exploited = allOwnedCells.has(r.cellIndex);
        }
      }
    }

    // Phase 2: Build country index map for ownership arrays
    const countryMap = buildCountryIndexMap(world, rng);

    // Phase 3: Determine which years to serialize (sample up to numSimYears)
    // The timeline has 5000 years; we only expose numSimYears to the UI
    const yearsToSerialize = Math.min(numSimYears, timeline.years.length);

    // Phase 4: Serialize into HistoryData format
    const historyYears: HistoryYear[] = [];
    const snapshots: Record<number, Int16Array> = {};
    const tradeSnapshots: Record<number, TradeRouteEntry[]> = {};
    const wonderSnapshots: Record<number, WonderSnapshotEntry[]> = {};
    const religionSnapshots: Record<number, number[]> = {};
    const empireSnapshots: Record<number, EmpireSnapshotEntry[]> = {};
    const populationSnapshots: Record<number, Record<number, number>> = {};
    const expansionSnapshots: Record<number, Uint8Array> = {};

    const buildPopulationSnapshot = (yearObj: Year): Record<number, number> => {
      return { ...yearObj.cityPopulations };
    };

    // Dynamic city sizes: pre-build stable ordering of all city entities
    const allCityEntities: CityEntity[] = Array.from(world.mapCities.values());
    const rawCitySizeSnapshots: Record<number, Uint8Array> = {};

    // Phase 4 (overlays_tabs.md): pre-index empire dissolutions by absolute year.
    // `Empire.destroyedOn` captures both the shrink-to-≤1 path in
    // `_handleEmpireEffects` and the 15% `government`-tech dissolution rolled
    // inside `ConquerGenerator.generate`. The latter is not visible in any
    // event collection, so we look it up directly off the Empire object.
    const dissolvedByAbsYear = new Map<number, Set<string>>();
    for (const y of timeline.years) {
      for (const emp of y.empires) {
        if (emp.destroyedOn !== null) {
          let set = dissolvedByAbsYear.get(emp.destroyedOn);
          if (!set) { set = new Set(); dissolvedByAbsYear.set(emp.destroyedOn, set); }
          set.add(emp.id);
        }
      }
    }

    // Phase 4: running empire-membership state, replayed chronologically
    // during the year loop below by mirroring Conquer._handleEmpireEffects.
    type EmpireRun = { founderId: string; foundedOn: number; members: Set<string> };
    const liveEmpires = new Map<string, EmpireRun>();
    const countryToEmpire = new Map<string, string>(); // countryId → empireId

    // Active trade tracking: trade objects are mutated (ended field set) as simulation runs
    const activeTrades = new Map<string, Trade>();
    const activeTradeEntries = new Map<string, TradeRouteEntry>();

    // Precompute distance-from-land for trade route pathfinding (coastal-hugging A*)
    const distFromLand = computeDistanceFromLand(cells);
    const tradePathCache = new Map<string, number[]>();

    // Dynamic road tracking: roads are built incrementally as contacts, countries,
    // and conquests occur. Monotonically growing — roads never disappear.
    const activeRoads: Road[] = [];
    const roadPairKeys = new Set<string>();
    const roadPathCache = new Map<string, number[] | null>();
    const roadSnapshots: Record<number, Road[]> = {};

    const tryBuildRoad = (cell1: number, cell2: number): void => {
      const key = [cell1, cell2].sort((a, b) => a - b).join('-');
      if (roadPairKeys.has(key)) return;
      roadPairKeys.add(key);
      let path = roadPathCache.get(key);
      if (path === undefined) {
        path = aStar(cells, cell1, cell2);
        roadPathCache.set(key, path);
      }
      if (path && path.length >= 2) {
        activeRoads.push({ path });
      }
    };

    // Build an empire snapshot entry list from the current `liveEmpires` map.
    // Read-only iteration over world.mapCountries / world.mapRegions to resolve
    // a display name — no mutation of any World field.
    // Empire names are cached so the same empire keeps its name across snapshot years.
    const empireNameCache = new Map<string, string>();
    const buildEmpireSnapshot = (): EmpireSnapshotEntry[] => {
      const entries: EmpireSnapshotEntry[] = [];
      for (const [empireId, run] of liveEmpires) {
        const members: number[] = [];
        for (const cid of run.members) {
          const idx = countryMap.idToIndex.get(cid);
          if (idx !== undefined && idx >= 0) members.push(idx);
        }
        members.sort((a, b) => a - b);
        const founderIdx = countryMap.idToIndex.get(run.founderId) ?? -1;
        let name = empireNameCache.get(empireId);
        if (!name) {
          const founderEntry = countryMap.indexToCountry.find(c => c.id === run.founderId);
          const founderCountryName = founderEntry?.name ?? 'Unknown';
          name = generateEmpireName(rng, founderCountryName);
          empireNameCache.set(empireId, name);
        }
        entries.push({
          empireId,
          name,
          founderCountryIndex: founderIdx,
          memberCountryIndices: members,
        });
      }
      return entries;
    };

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

      // Dynamic road construction: contacts → country formation → conquests
      for (const contact of yearObj.contacts) {
        const c1 = world.mapCities.get(contact.contactFrom);
        const c2 = world.mapCities.get(contact.contactTo);
        if (c1 && c2) tryBuildRoad(c1.cellIndex, c2.cellIndex);
      }
      for (const country of yearObj.countries) {
        const region = country.region ?? world.mapRegions.get(country.governingRegion);
        if (region && region.cities.length > 1) {
          const capital = region.cities[0];
          for (let ci = 1; ci < region.cities.length; ci++) {
            if (region.cities[ci].founded) {
              tryBuildRoad(capital.cellIndex, region.cities[ci].cellIndex);
            }
          }
        }
      }
      for (const conquer of yearObj.conquers) {
        const conquerorCountry = conquer.conquerorCountry ?? world.mapCountries.get(conquer.conqueror);
        const conqueredCountry = conquer.conqueredCountry ?? world.mapCountries.get(conquer.conquered);
        if (conquerorCountry && conqueredCountry) {
          const conquerorRegion = world.mapRegions.get(conquerorCountry.governingRegion);
          const conqueredRegion = world.mapRegions.get(conqueredCountry.governingRegion);
          if (conquerorRegion?.cities[0] && conqueredRegion?.cities[0]) {
            tryBuildRoad(conquerorRegion.cities[0].cellIndex, conqueredRegion.cities[0].cellIndex);
          }
        }
      }

      // Phase 4: replay empire membership transitions for this year. We mirror
      // `ConquerGenerator._handleEmpireEffects` using only the recorded events —
      // we CANNOT read `CountryEvent.memberOf` here because it reflects the
      // FINAL simulation state, not year-i state. Order matches the simulation:
      // conquers first (may shrink/dissolve), then newly-founded empires, then
      // government-tech dissolutions flagged by `Empire.destroyedOn`.
      for (const conquer of yearObj.conquers) {
        // Remove conquered from its current empire (if any).
        const conqueredEmpireId = countryToEmpire.get(conquer.conquered);
        if (conqueredEmpireId) {
          const run = liveEmpires.get(conqueredEmpireId);
          if (run) {
            run.members.delete(conquer.conquered);
            if (run.members.size <= 1) {
              // Shrunk to a single member: empire dissolves, release the last member.
              for (const m of run.members) countryToEmpire.delete(m);
              liveEmpires.delete(conqueredEmpireId);
            }
          }
          countryToEmpire.delete(conquer.conquered);
        }
        // Add conquered to conqueror's empire (if conqueror is in one).
        const conquerorEmpireId = countryToEmpire.get(conquer.conqueror);
        if (conquerorEmpireId) {
          const run = liveEmpires.get(conquerorEmpireId);
          if (run) {
            run.members.add(conquer.conquered);
            countryToEmpire.set(conquer.conquered, conquerorEmpireId);
          }
        }
      }
      // New empires founded this year (conqueror was NOT already in an empire).
      for (const empEvent of yearObj.empires) {
        const triggering = yearObj.conquers.find(c => c.conqueror === empEvent.foundedBy);
        const members = new Set<string>();
        members.add(empEvent.foundedBy);
        if (triggering) members.add(triggering.conquered);
        liveEmpires.set(empEvent.id, {
          founderId: empEvent.foundedBy,
          foundedOn: empEvent.foundedOn,
          members,
        });
        for (const m of members) countryToEmpire.set(m, empEvent.id);
      }
      // Government-tech dissolutions (15% roll in ConquerGenerator) have no
      // explicit event — pick them up from the pre-indexed `destroyedOn`.
      const dissolvedThisYear = dissolvedByAbsYear.get(yearObj.year);
      if (dissolvedThisYear) {
        for (const empireId of dissolvedThisYear) {
          const run = liveEmpires.get(empireId);
          if (!run) continue;
          for (const m of run.members) countryToEmpire.delete(m);
          liveEmpires.delete(empireId);
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

      // Compute expansion flags for this year
      const expFlags = computeExpansionFlags(cells, yearObj, countryMap);

      // Snapshot every 20 years
      if (i % 20 === 0) {
        snapshots[i] = new Int16Array(ownership);
        tradeSnapshots[i] = Array.from(activeTradeEntries.values());
        roadSnapshots[i] = [...activeRoads];
        wonderSnapshots[i] = computeWonderSnapshots(world, yearObj.year);
        religionSnapshots[i] = computeReligionCells(world, yearObj.year);
        empireSnapshots[i] = buildEmpireSnapshot();
        expansionSnapshots[i] = new Uint8Array(expFlags);
        // City sizes: store size tier index for all city entities
        const sizeArr = new Uint8Array(allCityEntities.length);
        for (let ci = 0; ci < allCityEntities.length; ci++) {
          sizeArr[ci] = yearObj.citySizeByCell[allCityEntities[ci].cellIndex] ?? 0;
        }
        rawCitySizeSnapshots[i] = sizeArr;
        populationSnapshots[i] = buildPopulationSnapshot(yearObj);
      }

      prevOwnership = ownership;
    }

    // Always snapshot final year
    const finalAbsYear = timeline.years[yearsToSerialize - 1]?.year ?? 0;
    if (prevOwnership) {
      snapshots[yearsToSerialize] = prevOwnership;
      tradeSnapshots[yearsToSerialize] = Array.from(activeTradeEntries.values());
      roadSnapshots[yearsToSerialize] = [...activeRoads];
      wonderSnapshots[yearsToSerialize] = computeWonderSnapshots(world, finalAbsYear);
      religionSnapshots[yearsToSerialize] = computeReligionCells(world, finalAbsYear);
      empireSnapshots[yearsToSerialize] = buildEmpireSnapshot();
      const finalYearObj = timeline.years[yearsToSerialize - 1];
      if (finalYearObj) {
        expansionSnapshots[yearsToSerialize] = computeExpansionFlags(cells, finalYearObj, countryMap);
      }
      // Final city size snapshot
      const finalYear = timeline.years[yearsToSerialize - 1];
      const finalSizeArr = new Uint8Array(allCityEntities.length);
      for (let ci = 0; ci < allCityEntities.length; ci++) {
        finalSizeArr[ci] = finalYear?.citySizeByCell[allCityEntities[ci].cellIndex] ?? 0;
      }
      rawCitySizeSnapshots[yearsToSerialize] = finalSizeArr;
      populationSnapshots[yearsToSerialize] = buildPopulationSnapshot(finalYear);
    } else {
      snapshots[0] = new Int16Array(cells.length).fill(-1);
      tradeSnapshots[0] = [];
      roadSnapshots[0] = [];
      wonderSnapshots[0] = [];
      religionSnapshots[0] = [];
      empireSnapshots[0] = [];
      populationSnapshots[0] = {};
      expansionSnapshots[0] = new Uint8Array(cells.length);
    }

    // Phase 5: Build Country[] for UI
    const countries = countryMap.indexToCountry.map((entry, idx) => {
      const country = (world.mapCountries.get(entry.id) ?? world.mapDeadCountries.get(entry.id)) as CountryEvent | undefined;
      const region = world.mapRegions.get(entry.regionId);
      const capitalCell = region?.cities[0]?.cellIndex ?? 0;
      // Country is alive if it's still in mapCountries (not dissolved) at the final year
      const isAlive = !!country && !world.mapDeadCountries.has(entry.id)
        && country.foundedOn <= (timeline.years[yearsToSerialize - 1]?.year ?? 0);
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
        isRuin: cityEntity.isRuin,
        ruinYear: cityEntity.isRuin ? cityEntity.ruinYear - timeline.startOfTime : 0,
        ownedCells: Array.from(cityEntity.ownedCells.entries()).map(([ci, yr]) => ({
          cellIndex: ci,
          yearAdded: yr >= timeline.startOfTime ? yr - timeline.startOfTime : yr,
        })),
      });
    }

    // Phase 6b: Remap raw city size snapshots to match cities[] array order.
    // `allCityEntities` indexes ALL cities; `cities[]` only includes founded ones.
    // Build a mapping from allCityEntities index → cities[] index.
    const cityEntityIdxToFinalIdx = new Map<number, number>();
    {
      let finalIdx = 0;
      for (let raw = 0; raw < allCityEntities.length; raw++) {
        if (allCityEntities[raw].founded) {
          cityEntityIdxToFinalIdx.set(raw, finalIdx++);
        }
      }
    }
    const citySizeSnapshots: Record<number, Uint8Array> = {};
    for (const [snapYear, rawArr] of Object.entries(rawCitySizeSnapshots)) {
      const mapped = new Uint8Array(cities.length);
      for (let raw = 0; raw < rawArr.length; raw++) {
        const final = cityEntityIdxToFinalIdx.get(raw);
        if (final !== undefined) mapped[final] = rawArr[raw];
      }
      citySizeSnapshots[Number(snapYear)] = mapped;
    }

    // Phase 7: Apply final ownership to cell.kingdom for baseline rendering
    if (prevOwnership) {
      for (let i = 0; i < cells.length; i++) {
        const o = prevOwnership[i];
        cells[i].kingdom = o >= 0 ? o : null;
      }
    }

    // Phase 8: Roads are built dynamically during the year loop above.
    // The final set of roads is the accumulated activeRoads array.
    const roads = activeRoads;

    // Phase 9: Compute statistics
    let peakPop = 0;
    for (const y of timeline.years) {
      if (y.worldPopulation > peakPop) peakPop = y.worldPopulation;
    }

    // Phase 3: tech aggregates — total discoveries and peak level per field.
    // Phase 4: also bucket tech events per century per field for snowball detection,
    // and total trade / conquest / cataclysm-death counts used by the sweep harness.
    const TECH_FIELDS: TechField[] = [
      'science', 'military', 'industry', 'energy', 'growth',
      'exploration', 'biology', 'art', 'government',
    ];
    const centuryCount = Math.max(1, Math.ceil(yearsToSerialize / 100));
    const techEventsPerCenturyByField: Record<TechField, number[]> = {
      science: new Array(centuryCount).fill(0),
      military: new Array(centuryCount).fill(0),
      industry: new Array(centuryCount).fill(0),
      energy: new Array(centuryCount).fill(0),
      growth: new Array(centuryCount).fill(0),
      exploration: new Array(centuryCount).fill(0),
      biology: new Array(centuryCount).fill(0),
      art: new Array(centuryCount).fill(0),
      government: new Array(centuryCount).fill(0),
    };
    let totalTechs = 0;
    let totalTrades = 0;
    let totalConquests = 0;
    let totalCataclysmDeaths = 0;
    let totalTechLosses = 0;
    let totalTechLossesAbsorbed = 0;
    let totalTechDiffusions = 0;
    const peakTechLevelByField: Record<TechField, number> = {
      science: 0, military: 0, industry: 0, energy: 0, growth: 0,
      exploration: 0, biology: 0, art: 0, government: 0,
    };
    // Spec stretch §5: per-field running-max time series. Populated in the
    // same walk as peakTechLevelByField — one Uint8Array per field, indexed
    // by year offset [0..yearsToSerialize-1]. Allocation is bounded to
    // yearsToSerialize (NOT timeline.years.length) so the array length
    // matches historyData.numYears — a truncated run must not write past
    // the end.
    const techTimelineByField: Record<TechField, Uint8Array> = {
      science: new Uint8Array(yearsToSerialize),
      military: new Uint8Array(yearsToSerialize),
      industry: new Uint8Array(yearsToSerialize),
      energy: new Uint8Array(yearsToSerialize),
      growth: new Uint8Array(yearsToSerialize),
      exploration: new Uint8Array(yearsToSerialize),
      biology: new Uint8Array(yearsToSerialize),
      art: new Uint8Array(yearsToSerialize),
      government: new Uint8Array(yearsToSerialize),
    };
    for (let yi = 0; yi < timeline.years.length; yi++) {
      const y = timeline.years[yi];
      const century = Math.min(centuryCount - 1, Math.floor(yi / 100));
      for (const t of y.techs) {
        totalTechs++;
        techEventsPerCenturyByField[t.field][century]++;
        if (t.level > peakTechLevelByField[t.field]) {
          peakTechLevelByField[t.field] = t.level;
        }
        // Timeline write is bounded to yearsToSerialize so a lowered
        // numSimYears doesn't silently drop the tail.
        if (yi < yearsToSerialize) {
          const arr = techTimelineByField[t.field];
          if (t.level > arr[yi]) arr[yi] = t.level;
        }
      }
      totalTrades += y.trades.length;
      for (const t of y.trades) {
        if (t.techDiffusion) totalTechDiffusions++;
      }
      totalConquests += y.conquers.length;
      for (const c of y.cataclysms) {
        totalCataclysmDeaths += c.killed;
        totalTechLosses += c.techLosses.length;
        totalTechLossesAbsorbed += c.absorbedTechLosses.length;
      }
    }
    // Forward-fill: quiet years inherit the previous year's running max so
    // the chart polylines stay flat instead of dropping to zero.
    for (const field of TECH_FIELDS) {
      const arr = techTimelineByField[field];
      for (let yi = 1; yi < yearsToSerialize; yi++) {
        if (arr[yi - 1] > arr[yi]) arr[yi] = arr[yi - 1];
      }
    }
    const techTimeline: TechTimeline = { byField: techTimelineByField };

    // Phase 4: per-country tech level walk (final state). Uses the effective
    // (empire-founder → country) scope via `getCountryTechLevel` so empire-member
    // countries resolve through the founder correctly — do NOT read
    // `country.knownTechs.get(...)` directly here, it would silently miss empire
    // membership. Medians are computed over the full country set (including
    // level-0 entries) to keep small-world runs comparable to large ones.
    const peakCountryTechLevelByField: Record<TechField, number> = {
      science: 0, military: 0, industry: 0, energy: 0, growth: 0,
      exploration: 0, biology: 0, art: 0, government: 0,
    };
    const medianCountryTechLevelByField: Record<TechField, number> = {
      science: 0, military: 0, industry: 0, energy: 0, growth: 0,
      exploration: 0, biology: 0, art: 0, government: 0,
    };
    const countryList = Array.from(world.mapCountries.values());
    if (countryList.length > 0) {
      for (const field of TECH_FIELDS) {
        const levels: number[] = [];
        let peak = 0;
        for (const c of countryList) {
          const lvl = getCountryTechLevel(world, c, field);
          levels.push(lvl);
          if (lvl > peak) peak = lvl;
        }
        levels.sort((a, b) => a - b);
        const mid = Math.floor(levels.length / 2);
        const median = levels.length % 2 === 0
          ? (levels[mid - 1] + levels[mid]) / 2
          : levels[mid];
        peakCountryTechLevelByField[field] = peak;
        medianCountryTechLevelByField[field] = median;
      }
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
      totalTechs,
      peakTechLevelByField,
      totalTrades,
      totalConquests,
      totalCataclysmDeaths,
      totalTechLosses,
      totalTechLossesAbsorbed,
      totalTechDiffusions,
      totalRuins: timeline.years.reduce((sum, y) => sum + y.ruins.length, 0),
      totalExpansions: timeline.years.reduce((sum, y) => sum + y.expansions.length, 0),
      totalSettlements: timeline.years.reduce((sum, y) => sum + y.settlements.length, 0),
      totalDiscoveries: timeline.years.reduce((sum, y) => sum + y.discoveries.length, 0),
      techEventsPerCenturyByField,
      peakCountryTechLevelByField,
      medianCountryTechLevelByField,
    };

    const historyData: HistoryData = {
      countries,
      years: historyYears,
      numYears: yearsToSerialize,
      startOfTime: timeline.startOfTime,
      snapshots,
      tradeSnapshots,
      roadSnapshots,
      wonderSnapshots,
      wonderDetails: buildWonderDetails(world),
      illustrateDetails: buildIllustrateDetails(world, countryMap),
      religionSnapshots,
      empireSnapshots,
      populationSnapshots,
      techTimeline,
      citySizeSnapshots,
      expansionSnapshots,
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
