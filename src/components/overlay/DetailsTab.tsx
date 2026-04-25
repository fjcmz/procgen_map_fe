import { useMemo, useState } from 'react';
import type { MapData, SelectedEntity, HistoryEvent, Country, EmpireSnapshotEntry, Cell, TradeRouteEntry, RegionData, WonderDetail } from '../../lib/types';
import type { TechField } from '../../lib/history/timeline/Tech';
import { TECH_FIELD_COLORS, TECH_FIELD_LABELS, EVENT_ICONS, EVENT_COLORS } from './eventStyles';
import { INDEX_TO_CITY_SIZE } from '../../lib/history/physical/CityEntity';
import { getEmpiresAtYear } from '../../lib/history';
import type { City } from '../../lib/types';
import { formatPopulation, formatYear } from '../Timeline';
import { BIOME_INFO } from '../../lib/terrain/biomes';
import { getLegacyCategory, type LegacyResourceCategory, type ResourceType } from '../../lib/history/physical/ResourceCatalog';
import { WONDER_TIER_NAMES } from '../../lib/history/timeline/wonderNames';
import { CityMapPopupV2 } from '../CityMapPopupV2';
import { deriveCityEnvironment, generateCityMapV2 } from '../../lib/citymap/cityMapGeneratorV2';

interface DetailsTabProps {
  selectedEntity: SelectedEntity | null;
  mapData: MapData;
  selectedYear: number;
  convertYears: boolean;
  ownershipAtYear?: Int16Array;
  citySizesAtYear?: Uint8Array;
  seed: string;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

// Empire membership is resolved by getEmpiresAtYear (replays events between snapshots).

/** Look up the population snapshot at or before the given year. */
function lookupPopulationSnapshot(
  snapshots: Record<number, Record<number, number>>,
  numYears: number,
  year: number,
): Record<number, number> {
  if (year >= numYears && snapshots[numYears]) return snapshots[numYears];
  const floored = Math.max(0, Math.floor(year / 20) * 20);
  for (let y = floored; y >= 0; y -= 20) {
    if (snapshots[y]) return snapshots[y];
  }
  return {};
}

/** Find the empire a country belongs to (if any). */
function findEmpireForCountry(
  empireSnap: EmpireSnapshotEntry[],
  countryIndex: number,
): EmpireSnapshotEntry | undefined {
  return empireSnap.find(e => e.memberCountryIndices.includes(countryIndex));
}

/** Collect events related to a country index (as initiator or target). */
function getCountryEvents(
  years: { year: number; events: HistoryEvent[] }[],
  countryIndex: number,
  upToYear: number,
): HistoryEvent[] {
  const result: HistoryEvent[] = [];
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.initiatorId === countryIndex || ev.targetId === countryIndex) {
        result.push(ev);
      }
    }
  }
  return result;
}

/** Collect events related to a specific cell (as location or target location). */
function getCellEvents(
  years: { year: number; events: HistoryEvent[] }[],
  cellIndex: number,
  upToYear: number,
): HistoryEvent[] {
  const result: HistoryEvent[] = [];
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.locationCellIndex === cellIndex || ev.targetCellIndex === cellIndex) {
        result.push(ev);
      }
    }
  }
  return result;
}

/** Compute max tech levels for a country from TECH events. */
function getCountryTechLevels(
  years: { year: number; events: HistoryEvent[] }[],
  countryIndex: number,
  upToYear: number,
): Map<string, number> {
  const techs = new Map<string, number>();
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.type === 'TECH' && ev.initiatorId === countryIndex && ev.field && ev.level != null) {
        const cur = techs.get(ev.field) ?? 0;
        if (ev.level > cur) techs.set(ev.field, ev.level);
      }
    }
  }
  return techs;
}

/** Compute terrain (biome) distribution for cells owned by any of the given countries. */
function getTerrainDistribution(
  ownershipAtYear: Int16Array | undefined,
  cells: Cell[],
  countryIndices: Set<number>,
): [string, number][] {
  if (!ownershipAtYear) return [];
  const counts = new Map<string, number>();
  for (let i = 0; i < ownershipAtYear.length; i++) {
    if (countryIndices.has(ownershipAtYear[i])) {
      const biome = cells[i]?.biome;
      if (biome && biome !== 'OCEAN' && biome !== 'COAST') {
        counts.set(biome, (counts.get(biome) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/** Count illustrates, wonders, contacts, and techs for an entity's cities/countries. */
function getEntityEventCounts(
  years: { year: number; events: HistoryEvent[] }[],
  cityCellSet: Set<number>,
  countryIndices: Set<number>,
  upToYear: number,
): { illustrates: number; wonders: number; contacts: number; techs: number } {
  let illustrates = 0, wonders = 0, contacts = 0, techs = 0;
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      switch (ev.type) {
        case 'ILLUSTRATE':
          if (ev.locationCellIndex != null && cityCellSet.has(ev.locationCellIndex)) illustrates++;
          break;
        case 'WONDER':
          if (ev.locationCellIndex != null && cityCellSet.has(ev.locationCellIndex)) wonders++;
          break;
        case 'CONTACT':
          if ((ev.locationCellIndex != null && cityCellSet.has(ev.locationCellIndex)) ||
              (ev.targetCellIndex != null && cityCellSet.has(ev.targetCellIndex))) contacts++;
          break;
        case 'TECH':
          if (countryIndices.has(ev.initiatorId)) techs++;
          break;
      }
    }
  }
  return { illustrates, wonders, contacts, techs };
}

/** Count active trade routes involving the entity's cities at the given year. */
function getActiveTradeCount(
  tradeSnapshots: Record<number, TradeRouteEntry[]>,
  cityCellSet: Set<number>,
  numYears: number,
  selectedYear: number,
): number {
  let snap: TradeRouteEntry[] | undefined;
  if (selectedYear >= numYears && tradeSnapshots[numYears]) {
    snap = tradeSnapshots[numYears];
  } else {
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (tradeSnapshots[y]) { snap = tradeSnapshots[y]; break; }
    }
  }
  if (!snap) return 0;
  let count = 0;
  for (const route of snap) {
    if (cityCellSet.has(route.cell1) || cityCellSet.has(route.cell2)) count++;
  }
  return count;
}

/** Aggregate tech levels across multiple countries (max per field). */
function getEmpireTechLevels(
  years: { year: number; events: HistoryEvent[] }[],
  countryIndices: Set<number>,
  upToYear: number,
): Map<string, number> {
  const techs = new Map<string, number>();
  for (const idx of countryIndices) {
    const countryTechs = getCountryTechLevels(years, idx, upToYear);
    for (const [field, level] of countryTechs) {
      const cur = techs.get(field) ?? 0;
      if (level > cur) techs.set(field, level);
    }
  }
  return techs;
}

/**
 * Aggregated resource info per type — `amount` is the summed `Resource.original`
 * across every region owned by the entity that contains this type; `locked` is
 * true only if EVERY such region is still locked (any single unlocked region
 * flips it to unlocked, since the entity can still trade it from there).
 */
export interface ResourceAggregate {
  amount: number;
  locked: boolean;
  /** True if at least one instance of this resource is on a cell owned by a city. */
  exploited: boolean;
}

/**
 * Build a locked-check for a given type by cross-referencing `region.resources`
 * requirement fields against the current tech levels. Returns `true` when the
 * entity's tech level is below the resource's requirement.
 */
function isResourceLocked(
  r: NonNullable<RegionData['resources']>[number],
  techLevels: Map<string, number>,
): boolean {
  const req = r.requiredTechField;
  const lvl = r.requiredTechLevel ?? 0;
  if (req == null || lvl <= 0) return false;
  const current = techLevels.get(req) ?? 0;
  return current < lvl;
}

/**
 * Aggregate Resource.original amounts across every region currently owned by
 * `countryIndex` at the selected year. Regions are atomically owned (Phase 6
 * model — conquests transfer whole regions), so we probe `region.cellIndices[0]`
 * as a cheap representative of the whole region's owner.
 */
function getCountryResources(
  countryIndex: number,
  ownershipAtYear: Int16Array | undefined,
  regions: RegionData[] | undefined,
  techLevels: Map<string, number>,
  cities?: City[],
  selectedYear?: number,
): Map<string, ResourceAggregate> {
  const acc = new Map<string, ResourceAggregate>();
  if (!ownershipAtYear || !regions) return acc;
  // Build set of all cells owned by any city in this country at selectedYear
  const cityOwnedCells = new Set<number>();
  if (cities && selectedYear != null) {
    for (const city of cities) {
      if (city.kingdomId !== countryIndex) continue;
      if (city.ownedCells) {
        for (const oc of city.ownedCells) {
          if (oc.yearAdded <= selectedYear) cityOwnedCells.add(oc.cellIndex);
        }
      }
    }
  }
  for (const region of regions) {
    if (region.cellIndices.length === 0) continue;
    if (ownershipAtYear[region.cellIndices[0]] !== countryIndex) continue;
    if (!region.resources) continue;
    for (const r of region.resources) {
      const locked = isResourceLocked(r, techLevels);
      const exploited = cityOwnedCells.has(r.cellIndex);
      const prev = acc.get(r.type);
      if (prev) {
        prev.amount += r.amount;
        // Any unlocked region wins (entity can already exploit it somewhere).
        if (!locked) prev.locked = false;
        if (exploited) prev.exploited = true;
      } else {
        acc.set(r.type, { amount: r.amount, locked, exploited });
      }
    }
  }
  return acc;
}

/** Same as `getCountryResources` but sums across a set of member countries. */
function getEmpireResources(
  countryIndices: Set<number>,
  ownershipAtYear: Int16Array | undefined,
  regions: RegionData[] | undefined,
  techLevels: Map<string, number>,
  cities?: City[],
  selectedYear?: number,
): Map<string, ResourceAggregate> {
  const acc = new Map<string, ResourceAggregate>();
  if (!ownershipAtYear || !regions) return acc;
  // Build set of all cells owned by any city in member countries at selectedYear
  const cityOwnedCells = new Set<number>();
  if (cities && selectedYear != null) {
    for (const city of cities) {
      if (!countryIndices.has(city.kingdomId)) continue;
      if (city.ownedCells) {
        for (const oc of city.ownedCells) {
          if (oc.yearAdded <= selectedYear) cityOwnedCells.add(oc.cellIndex);
        }
      }
    }
  }
  for (const region of regions) {
    if (region.cellIndices.length === 0) continue;
    if (!countryIndices.has(ownershipAtYear[region.cellIndices[0]])) continue;
    if (!region.resources) continue;
    for (const r of region.resources) {
      const locked = isResourceLocked(r, techLevels);
      const exploited = cityOwnedCells.has(r.cellIndex);
      const prev = acc.get(r.type);
      if (prev) {
        prev.amount += r.amount;
        if (!locked) prev.locked = false;
        if (exploited) prev.exploited = true;
      } else {
        acc.set(r.type, { amount: r.amount, locked, exploited });
      }
    }
  }
  return acc;
}

export function DetailsTab({
  selectedEntity,
  mapData,
  selectedYear,
  convertYears,
  ownershipAtYear,
  citySizesAtYear,
  seed,
  onSelectEntity,
  onNavigate,
}: DetailsTabProps) {
  const history = mapData.history!;

  const empireSnap = useMemo(
    () => getEmpiresAtYear(history, selectedYear),
    [history, selectedYear],
  );

  const popSnap = useMemo(
    () => lookupPopulationSnapshot(history.populationSnapshots, history.numYears, selectedYear),
    [history, selectedYear],
  );

  // Compute the nearest 20-year snap key for empire selection
  const snapKey = useMemo(() => {
    if (selectedYear >= history.numYears && history.empireSnapshots[history.numYears]) return history.numYears;
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.empireSnapshots[y]) return y;
    }
    return 0;
  }, [history, selectedYear]);

  if (!selectedEntity) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Details</span>
        </div>
        <div style={styles.placeholder}>
          Click an entity on the map or in the Realm tab to view details.
        </div>
      </div>
    );
  }

  if (selectedEntity.type === 'city') {
    return (
      <CityDetails
        cellIndex={selectedEntity.cellIndex}
        mapData={mapData}
        history={history}
        selectedYear={selectedYear}
        convertYears={convertYears}
        empireSnap={empireSnap}
        snapKey={snapKey}
        ownershipAtYear={ownershipAtYear}
        citySizesAtYear={citySizesAtYear}
        popSnap={popSnap}
        seed={seed}
        onSelectEntity={onSelectEntity}
        onNavigate={onNavigate}
      />
    );
  }

  if (selectedEntity.type === 'country') {
    return (
      <CountryDetails
        countryIndex={selectedEntity.countryIndex}
        mapData={mapData}
        history={history}
        selectedYear={selectedYear}
        convertYears={convertYears}
        empireSnap={empireSnap}
        snapKey={snapKey}
        ownershipAtYear={ownershipAtYear}
        citySizesAtYear={citySizesAtYear}
        popSnap={popSnap}
        seed={seed}
        onSelectEntity={onSelectEntity}
        onNavigate={onNavigate}
      />
    );
  }

  // Empire
  return (
    <EmpireDetails
      empireId={selectedEntity.empireId}
      mapData={mapData}
      history={history}
      selectedYear={selectedYear}
      convertYears={convertYears}
      empireSnap={empireSnap}
      snapKey={snapKey}
      ownershipAtYear={ownershipAtYear}
      citySizesAtYear={citySizesAtYear}
      popSnap={popSnap}
      seed={seed}
      onSelectEntity={onSelectEntity}
      onNavigate={onNavigate}
    />
  );
}

/** Resolve dynamic city size from snapshot, falling back to static size. */
function resolveCitySize(city: City, mapData: MapData, citySizesAtYear?: Uint8Array): City['size'] {
  if (!citySizesAtYear) return city.size;
  const idx = mapData.cities.indexOf(city);
  if (idx < 0) return city.size;
  return INDEX_TO_CITY_SIZE[citySizesAtYear[idx]] ?? city.size;
}

// ── Shared sub-props ──
interface SubProps {
  mapData: MapData;
  history: NonNullable<MapData['history']>;
  selectedYear: number;
  convertYears: boolean;
  empireSnap: EmpireSnapshotEntry[];
  snapKey: number;
  citySizesAtYear?: Uint8Array;
  ownershipAtYear?: Int16Array;
  popSnap: Record<number, number>;
  seed: string;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

// ── City Details ──
function CityDetails({ cellIndex, mapData, history, selectedYear, convertYears, empireSnap, snapKey, ownershipAtYear, citySizesAtYear, popSnap, seed, onSelectEntity, onNavigate }: SubProps & { cellIndex: number }) {
  const city = mapData.cities.find(c => c.cellIndex === cellIndex);
  const countryId = ownershipAtYear ? ownershipAtYear[cellIndex] : -1;
  const country = countryId >= 0 ? history.countries[countryId] : undefined;
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [quartersOpen, setQuartersOpen] = useState(false);
  const [showCityMapV2, setShowCityMapV2] = useState(false);
  const empire = country ? findEmpireForCountry(empireSnap, country.id) : undefined;

  const wonderSnap = useMemo(() => {
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.wonderSnapshots[y]) return history.wonderSnapshots[y];
    }
    return [];
  }, [history, selectedYear]);

  const religionSnap = useMemo(() => {
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.religionSnapshots[y]) return history.religionSnapshots[y];
    }
    return [];
  }, [history, selectedYear]);

  const hasWonder = wonderSnap.some(w => w.cellIndex === cellIndex);
  const hasReligion = religionSnap.includes(cellIndex);

  // Wonders for this city from wonderDetails (includes destroyed)
  const cityWonders = useMemo(() => {
    if (!history.wonderDetails) return [];
    return history.wonderDetails.filter(
      w => w.cityCellIndex === cellIndex && w.builtOn <= (history.startOfTime + selectedYear),
    );
  }, [history.wonderDetails, cellIndex, selectedYear, history.startOfTime]);
  const [wondersOpen, setWondersOpen] = useState(false);

  const events = useMemo(
    () => getCellEvents(history.years, cellIndex, selectedYear),
    [history.years, cellIndex, selectedYear],
  );

  const techLevels = useMemo(
    () => countryId >= 0 ? getCountryTechLevels(history.years, countryId, selectedYear) : new Map<string, number>(),
    [history.years, countryId, selectedYear],
  );

  const cityResources = useMemo(() => {
    const acc = new Map<string, ResourceAggregate>();
    if (!city?.ownedCells || !mapData.regions) return acc;
    const ownedSet = new Set(
      city.ownedCells.filter(oc => oc.yearAdded <= selectedYear).map(oc => oc.cellIndex),
    );
    for (const region of mapData.regions) {
      if (!region.resources) continue;
      for (const r of region.resources) {
        if (!ownedSet.has(r.cellIndex)) continue;
        const locked = isResourceLocked(r, techLevels);
        const prev = acc.get(r.type);
        if (prev) {
          prev.amount += r.amount;
          if (!locked) prev.locked = false;
        } else {
          acc.set(r.type, { amount: r.amount, locked, exploited: true });
        }
      }
    }
    return acc;
  }, [city, mapData.regions, selectedYear, techLevels]);

  const recentEvents = events.slice(-15);

  const cityEnvironment = useMemo(() => {
    if (!city) return null;
    return deriveCityEnvironment(
      city,
      mapData.cells,
      mapData,
      citySizesAtYear,
      selectedYear,
      wonderSnap,
      religionSnap,
    );
  }, [city, mapData, citySizesAtYear, selectedYear, wonderSnap, religionSnap]);

  // Block counts by role — computed lazily when the Quarters section is expanded.
  // Keyed on env fields that affect block layout (size, coastal, mountains)
  // rather than year-varying wonder/religion counts which only affect landmarks.
  const blockCounts = useMemo(() => {
    if (!quartersOpen || !city || !cityEnvironment) return null;
    const mapV2 = generateCityMapV2(seed, city.name, cityEnvironment);
    const counts: Record<string, number> = {};
    for (const block of mapV2.blocks) {
      if (block.polygonIds.length === 0) continue;
      counts[block.role] = (counts[block.role] ?? 0) + 1;
    }
    return counts;
  }, [quartersOpen, seed, city?.name, cityEnvironment?.size, cityEnvironment?.isCoastal, cityEnvironment?.waterSide, cityEnvironment?.mountainDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>City Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityNameRow}>
          <div style={styles.entityName}>
            {city?.isCapital && <span title="Capital">{'\u2605'} </span>}
            {city?.name ?? `Cell #${cellIndex}`}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {city && cityEnvironment && (
              <button
                style={styles.cityMapBtn}
                onClick={() => setShowCityMapV2(true)}
                title="View City Map"
              >Map</button>
            )}
            {onNavigate && (
              <button
                style={styles.locateBtn}
                onClick={() => onNavigate([cellIndex], cellIndex)}
                title="Locate on map"
              >{'\u25CE'}</button>
            )}
          </div>
        </div>

        <div style={styles.infoGrid}>
          {city && <InfoRow label="Size" value={resolveCitySize(city, mapData, citySizesAtYear)} />}
          {city && <InfoRow label="Founded" value={formatYear(history.startOfTime, city.foundedYear, convertYears)} />}
          {popSnap[cellIndex] != null && <InfoRow label="Population" value={formatPopulation(popSnap[cellIndex])} />}
          {country && (
            <InfoRow label="Country">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'country', countryIndex: country.id })}
              >
                {country.name}
              </button>
            </InfoRow>
          )}
          {empire && (
            <InfoRow label="Empire">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'empire', empireId: empire.empireId, snapshotYear: snapKey })}
              >
                {empire.name}
              </button>
            </InfoRow>
          )}
          {hasWonder && <InfoRow label="Wonders" value={String(cityWonders.length)} />}
          {hasReligion && <InfoRow label="Religion" value="Present" />}
          {city?.ownedCells && (
            <InfoRow label="Territory" value={`${city.ownedCells.filter(oc => oc.yearAdded <= selectedYear).length} cells`} />
          )}
        </div>

        {/* Resources on this city's owned cells */}
        {cityResources.size > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setResourcesOpen(v => !v)}
              aria-expanded={resourcesOpen}
            >
              {resourcesOpen ? '\u25be' : '\u25b8'} Resources ({cityResources.size})
            </button>
            {resourcesOpen && <ResourceList resources={cityResources} />}
          </>
        )}

        {/* Quarters (city district blocks) */}
        {city && cityEnvironment && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setQuartersOpen(v => !v)}
              aria-expanded={quartersOpen}
            >
              {quartersOpen ? '▾' : '▸'} Quarters
              {blockCounts && ` (${Object.values(blockCounts).reduce((s, c) => s + c, 0)})`}
            </button>
            {quartersOpen && !blockCounts && <div style={styles.loadingNote}>Computing&hellip;</div>}
            {quartersOpen && blockCounts && <QuartersList counts={blockCounts} />}
          </>
        )}

        {/* Wonders in this city */}
        {cityWonders.length > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setWondersOpen(v => !v)}
              aria-expanded={wondersOpen}
            >
              {wondersOpen ? '\u25be' : '\u25b8'} Wonders ({cityWonders.length})
            </button>
            {wondersOpen && <WonderList wonders={cityWonders} convertYears={convertYears} />}
          </>
        )}

        {recentEvents.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Recent Events ({events.length} total)</div>
            <div style={styles.eventList}>
              {recentEvents.map((ev, i) => (
                <EventRow key={i} event={ev} startOfTime={history.startOfTime} convertYears={convertYears} />
              ))}
            </div>
          </>
        )}
      </div>

      {city && cityEnvironment && (
        <CityMapPopupV2
          isOpen={showCityMapV2}
          onClose={() => setShowCityMapV2(false)}
          cityName={city.name}
          environment={cityEnvironment}
          seed={seed}
        />
      )}
    </div>
  );
}

// ── Country Details ──
function CountryDetails({ countryIndex, mapData, history, selectedYear, convertYears, empireSnap, snapKey, ownershipAtYear, citySizesAtYear, popSnap, onSelectEntity, onNavigate }: SubProps & { countryIndex: number }) {
  const country = history.countries[countryIndex];
  const empire = findEmpireForCountry(empireSnap, countryIndex);

  const cities = useMemo(
    () => mapData.cities.filter(c => c.kingdomId === countryIndex && c.foundedYear <= selectedYear),
    [mapData.cities, countryIndex, selectedYear],
  );

  const countryPop = useMemo(() => {
    let total = 0;
    for (const city of cities) {
      total += popSnap[city.cellIndex] ?? 0;
    }
    return total;
  }, [cities, popSnap]);

  const territorySize = useMemo(() => {
    if (!ownershipAtYear) return 0;
    let count = 0;
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (ownershipAtYear[i] === countryIndex) count++;
    }
    return count;
  }, [ownershipAtYear, countryIndex]);

  const techLevels = useMemo(
    () => getCountryTechLevels(history.years, countryIndex, selectedYear),
    [history.years, countryIndex, selectedYear],
  );

  const events = useMemo(
    () => getCountryEvents(history.years, countryIndex, selectedYear),
    [history.years, countryIndex, selectedYear],
  );

  const warCount = events.filter(e => e.type === 'WAR').length;
  const conquestCount = events.filter(e => e.type === 'CONQUEST' && e.initiatorId === countryIndex).length;
  const conqueredCount = events.filter(e => e.type === 'CONQUEST' && e.targetId === countryIndex).length;

  const countrySet = useMemo(() => new Set([countryIndex]), [countryIndex]);

  const cityCellSet = useMemo(
    () => new Set(cities.map(c => c.cellIndex)),
    [cities],
  );

  const terrainDist = useMemo(
    () => getTerrainDistribution(ownershipAtYear, mapData.cells, countrySet),
    [ownershipAtYear, mapData.cells, countrySet],
  );

  const resources = useMemo(
    () => getCountryResources(countryIndex, ownershipAtYear, mapData.regions, techLevels, mapData.cities, selectedYear),
    [countryIndex, ownershipAtYear, mapData.regions, techLevels, mapData.cities, selectedYear],
  );
  const [resourcesOpen, setResourcesOpen] = useState(false);

  // Wonders for this country's cities (includes destroyed)
  const countryWonders = useMemo(() => {
    if (!history.wonderDetails) return [];
    return history.wonderDetails.filter(
      w => cityCellSet.has(w.cityCellIndex) && w.builtOn <= (history.startOfTime + selectedYear),
    );
  }, [history.wonderDetails, cityCellSet, selectedYear, history.startOfTime]);
  const [wondersOpen, setWondersOpen] = useState(false);

  const eventCounts = useMemo(
    () => getEntityEventCounts(history.years, cityCellSet, countrySet, selectedYear),
    [history.years, cityCellSet, countrySet, selectedYear],
  );

  const activeTradeCount = useMemo(
    () => getActiveTradeCount(history.tradeSnapshots, cityCellSet, history.numYears, selectedYear),
    [history.tradeSnapshots, cityCellSet, history.numYears, selectedYear],
  );

  const recentEvents = events.slice(-15);

  if (!country) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Country Details</span>
          <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
        </div>
        <div style={styles.placeholder}>Country not found.</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Country Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityNameRow}>
          <div style={styles.entityName}>
            {country.name}
            {(country.diedYear !== undefined ? country.diedYear <= selectedYear : !country.isAlive) && <span style={styles.deadBadge}> (fallen)</span>}
          </div>
          {onNavigate && ownershipAtYear && (
            <button
              style={styles.locateBtn}
              onClick={() => {
                const cells: number[] = [];
                for (let i = 0; i < ownershipAtYear.length; i++) {
                  if (ownershipAtYear[i] === countryIndex) cells.push(i);
                }
                if (cells.length === 0) cells.push(country.capitalCellIndex);
                onNavigate(cells, country.capitalCellIndex);
              }}
              title="Locate on map"
            >{'\u25CE'}</button>
          )}
        </div>

        <div style={styles.infoGrid}>
          <InfoRow label="Territory" value={`${territorySize} cells`} />
          <InfoRow label="Population" value={formatPopulation(countryPop)} />
          <InfoRow label="Cities" value={String(cities.length)} />
          <InfoRow label="Illustrates" value={String(eventCounts.illustrates)} />
          <InfoRow label="Wonders" value={String(eventCounts.wonders)} />
          <InfoRow label="Techs" value={String(eventCounts.techs)} />
          <InfoRow label="Contacts" value={String(eventCounts.contacts)} />
          <InfoRow label="Trades" value={String(activeTradeCount)} />
          <InfoRow label="Wars" value={String(warCount)} />
          <InfoRow label="Conquests" value={`${conquestCount} won, ${conqueredCount} lost`} />
          {empire && (
            <InfoRow label="Empire">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'empire', empireId: empire.empireId, snapshotYear: snapKey })}
              >
                {empire.name}
              </button>
            </InfoRow>
          )}
        </div>

        {terrainDist.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Terrain</div>
            <TerrainBar distribution={terrainDist} />
          </>
        )}

        {resources.size > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setResourcesOpen(v => !v)}
              aria-expanded={resourcesOpen}
            >
              {resourcesOpen ? '\u25be' : '\u25b8'} Resources ({resources.size})
            </button>
            {resourcesOpen && <ResourceList resources={resources} />}
          </>
        )}

        {/* Wonders across this country's cities */}
        {countryWonders.length > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setWondersOpen(v => !v)}
              aria-expanded={wondersOpen}
            >
              {wondersOpen ? '\u25be' : '\u25b8'} Wonders ({countryWonders.length})
            </button>
            {wondersOpen && <WonderListGrouped wonders={countryWonders} convertYears={convertYears} />}
          </>
        )}

        {techLevels.size > 0 && (
          <>
            <div style={styles.sectionLabel}>Technology</div>
            <div style={styles.techGrid}>
              {Array.from(techLevels.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([field, level]) => (
                  <div key={field} style={styles.techRow}>
                    <span
                      style={{
                        ...styles.techDot,
                        background: TECH_FIELD_COLORS[field as TechField] ?? '#888',
                      }}
                    />
                    <span style={styles.techLabel}>
                      {TECH_FIELD_LABELS[field as TechField] ?? field}
                    </span>
                    <span style={styles.techLevel}>L{level}</span>
                  </div>
                ))}
            </div>
          </>
        )}

        {cities.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Cities</div>
            <div style={styles.cityList}>
              {cities.map(city => (
                <button
                  key={city.cellIndex}
                  style={styles.cityItem}
                  onClick={() => onSelectEntity({ type: 'city', cellIndex: city.cellIndex })}
                >
                  {city.isCapital ? '\u2605 ' : '\u2022 '}
                  {city.name}
                  <span style={styles.citySizeMeta}> ({resolveCitySize(city, mapData, citySizesAtYear)})</span>
                </button>
              ))}
            </div>
          </>
        )}

        {recentEvents.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Recent Events ({events.length} total)</div>
            <div style={styles.eventList}>
              {recentEvents.map((ev, i) => (
                <EventRow key={i} event={ev} startOfTime={history.startOfTime} convertYears={convertYears} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Empire Details ──
function EmpireDetails({ empireId, history, mapData, selectedYear, convertYears, empireSnap, ownershipAtYear, popSnap, onSelectEntity, onNavigate }: SubProps & { empireId: string }) {
  const empEntry = empireSnap.find(e => e.empireId === empireId);

  const founderCountry = empEntry ? history.countries[empEntry.founderCountryIndex] : undefined;

  const memberCountries = useMemo(() => {
    if (!empEntry) return [];
    return empEntry.memberCountryIndices
      .map(idx => history.countries[idx])
      .filter(Boolean) as Country[];
  }, [empEntry, history.countries]);

  const memberSet = useMemo(
    () => empEntry ? new Set(empEntry.memberCountryIndices) : new Set<number>(),
    [empEntry],
  );

  const empireCities = useMemo(
    () => empEntry ? mapData.cities.filter(c => memberSet.has(c.kingdomId) && c.foundedYear <= selectedYear) : [],
    [empEntry, mapData.cities, memberSet, selectedYear],
  );

  const cityCellSet = useMemo(
    () => new Set(empireCities.map(c => c.cellIndex)),
    [empireCities],
  );

  const totalTerritory = useMemo(() => {
    if (!ownershipAtYear || !empEntry) return 0;
    let count = 0;
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (memberSet.has(ownershipAtYear[i])) count++;
    }
    return count;
  }, [ownershipAtYear, empEntry, memberSet]);

  const empirePop = useMemo(() => {
    if (!empEntry) return 0;
    let total = 0;
    for (const city of empireCities) {
      total += popSnap[city.cellIndex] ?? 0;
    }
    return total;
  }, [empEntry, empireCities, popSnap]);

  const terrainDist = useMemo(
    () => getTerrainDistribution(ownershipAtYear, mapData.cells, memberSet),
    [ownershipAtYear, mapData.cells, memberSet],
  );

  const techLevels = useMemo(
    () => getEmpireTechLevels(history.years, memberSet, selectedYear),
    [history.years, memberSet, selectedYear],
  );

  const resources = useMemo(
    () => getEmpireResources(memberSet, ownershipAtYear, mapData.regions, techLevels, mapData.cities, selectedYear),
    [memberSet, ownershipAtYear, mapData.regions, techLevels, mapData.cities, selectedYear],
  );
  const [resourcesOpen, setResourcesOpen] = useState(false);

  // Wonders across all empire member cities (includes destroyed)
  const empireWonders = useMemo(() => {
    if (!history.wonderDetails) return [];
    return history.wonderDetails.filter(
      w => cityCellSet.has(w.cityCellIndex) && w.builtOn <= (history.startOfTime + selectedYear),
    );
  }, [history.wonderDetails, cityCellSet, selectedYear, history.startOfTime]);
  const [wondersOpen, setWondersOpen] = useState(false);

  const eventCounts = useMemo(
    () => getEntityEventCounts(history.years, cityCellSet, memberSet, selectedYear),
    [history.years, cityCellSet, memberSet, selectedYear],
  );

  const activeTradeCount = useMemo(
    () => getActiveTradeCount(history.tradeSnapshots, cityCellSet, history.numYears, selectedYear),
    [history.tradeSnapshots, cityCellSet, history.numYears, selectedYear],
  );

  if (!empEntry) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Empire Details</span>
          <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
        </div>
        <div style={styles.placeholder}>Empire not found at this year.</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Empire Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityNameRow}>
          <div style={styles.entityName}>{empEntry.name}</div>
          {onNavigate && ownershipAtYear && (
            <button
              style={styles.locateBtn}
              onClick={() => {
                const idSet = new Set(empEntry.memberCountryIndices);
                const cells: number[] = [];
                for (let i = 0; i < ownershipAtYear.length; i++) {
                  if (idSet.has(ownershipAtYear[i])) cells.push(i);
                }
                const founder = history.countries[empEntry.founderCountryIndex];
                const centerCell = founder?.capitalCellIndex ?? 0;
                if (cells.length === 0) cells.push(centerCell);
                onNavigate(cells, centerCell);
              }}
              title="Locate on map"
            >{'\u25CE'}</button>
          )}
        </div>

        <div style={styles.infoGrid}>
          <InfoRow label="Territory" value={`${totalTerritory} cells`} />
          <InfoRow label="Population" value={formatPopulation(empirePop)} />
          <InfoRow label="Cities" value={String(empireCities.length)} />
          <InfoRow label="Members" value={`${memberCountries.length} countries`} />
          <InfoRow label="Illustrates" value={String(eventCounts.illustrates)} />
          <InfoRow label="Wonders" value={String(eventCounts.wonders)} />
          <InfoRow label="Techs" value={String(eventCounts.techs)} />
          <InfoRow label="Contacts" value={String(eventCounts.contacts)} />
          <InfoRow label="Trades" value={String(activeTradeCount)} />
          {founderCountry && (
            <InfoRow label="Founder">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'country', countryIndex: founderCountry.id })}
              >
                {founderCountry.name}
              </button>
            </InfoRow>
          )}
        </div>

        {terrainDist.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Terrain</div>
            <TerrainBar distribution={terrainDist} />
          </>
        )}

        {resources.size > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setResourcesOpen(v => !v)}
              aria-expanded={resourcesOpen}
            >
              {resourcesOpen ? '\u25be' : '\u25b8'} Resources ({resources.size})
            </button>
            {resourcesOpen && <ResourceList resources={resources} />}
          </>
        )}

        {/* Wonders across all empire member cities */}
        {empireWonders.length > 0 && (
          <>
            <button
              type="button"
              style={styles.sectionToggle}
              onClick={() => setWondersOpen(v => !v)}
              aria-expanded={wondersOpen}
            >
              {wondersOpen ? '\u25be' : '\u25b8'} Wonders ({empireWonders.length})
            </button>
            {wondersOpen && <WonderListGrouped wonders={empireWonders} convertYears={convertYears} />}
          </>
        )}

        {techLevels.size > 0 && (
          <>
            <div style={styles.sectionLabel}>Technology</div>
            <div style={styles.techGrid}>
              {Array.from(techLevels.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([field, level]) => (
                  <div key={field} style={styles.techRow}>
                    <span
                      style={{
                        ...styles.techDot,
                        background: TECH_FIELD_COLORS[field as TechField] ?? '#888',
                      }}
                    />
                    <span style={styles.techLabel}>
                      {TECH_FIELD_LABELS[field as TechField] ?? field}
                    </span>
                    <span style={styles.techLevel}>L{level}</span>
                  </div>
                ))}
            </div>
          </>
        )}

        <div style={styles.sectionLabel}>Member Countries</div>
        <div style={styles.cityList}>
          {memberCountries.map(c => (
            <button
              key={c.id}
              style={styles.cityItem}
              onClick={() => onSelectEntity({ type: 'country', countryIndex: c.id })}
            >
              {c.id === empEntry.founderCountryIndex ? '\u2605 ' : '\u2022 '}
              {c.name}
              {!c.isAlive && <span style={styles.deadBadge}> (fallen)</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared small components ──

function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{children ?? value}</span>
    </div>
  );
}

function EventRow({ event, startOfTime, convertYears }: { event: HistoryEvent; startOfTime: number; convertYears: boolean }) {
  const color = EVENT_COLORS[event.type] ?? '#888';
  const icon = EVENT_ICONS[event.type] ?? '\u2022';
  return (
    <div style={{ ...styles.eventRow, borderLeft: `3px solid ${color}` }}>
      <span style={styles.eventYear}>{formatYear(startOfTime, event.year, convertYears)}</span>
      <span style={styles.eventIcon}>{icon}</span>
      <span style={styles.eventDesc}>{event.description}</span>
    </div>
  );
}

// ── Quarters List ──

const QUARTER_ICONS: Record<string, string> = {
  civic: '\u{1F3DB}',           // 🏛 classical building
  market: '⚖',             // ⚖ balance scales
  harbor: '⚓',             // ⚓ anchor
  residential: '\u{1F3E0}',     // 🏠 house
  agricultural: '\u{1F33E}',    // 🌾 sheaf
  slum: '\u{1F3DA}',            // 🏚 derelict house
  dock: '⛵',               // ⛵ sailboat
  forge: '\u{1F528}',           // 🔨 hammer
  tannery: '\u{1F6E1}',         // 🛡 shield (leather)
  textile: '\u{1F9F5}',         // 🧵 thread
  potters: '\u{1F3FA}',         // 🏺 amphora
  mill: '⚙',               // ⚙ gear
  temple_quarter: '⛩',     // ⛩ shinto shrine
  necropolis: '⚰',         // ⚰ coffin
  academia: '\u{1F4DA}',        // 📚 books
  plague_ward: '⚕',        // ⚕ medical
  archive_quarter: '\u{1F4DC}', // 📜 scroll
  foreign_quarter: '\u{1F3F4}', // 🏴 flag (foreign banner)
  caravanserai: '\u{1F42A}',    // 🐪 camel
  bankers_row: '\u{1F4B0}',     // 💰 money bag
  warehouse_row: '\u{1F4E6}',   // 📦 package
  barracks: '⚔',           // ⚔ crossed swords
  citadel: '\u{1F3F0}',         // 🏰 castle
  arsenal: '⚒',            // ⚒ hammer and pick
  watchmen_precinct: '\u{1F441}', // 👁 eye
  theater_district: '\u{1F3AD}',  // 🎭 performing arts
  bathhouse_quarter: '\u{1F6C1}', // 🛁 bathtub
  pleasure_quarter: '\u{1F3AA}',  // 🎪 circus tent
  festival_grounds: '\u{1F38A}',  // 🎊 confetti
  ghetto: '\u{1F512}',          // 🔒 lock
  workhouse: '⚒',          // ⚒ hammer and pick
  gallows_hill: '☠',       // ☠ skull and crossbones
};

const QUARTER_LABELS: Record<string, string> = {
  civic: 'Civic',
  market: 'Market',
  harbor: 'Harbor',
  residential: 'Residential',
  agricultural: 'Agricultural',
  slum: 'Slum',
  dock: 'Dock',
  forge: 'Forge',
  tannery: 'Tannery',
  textile: 'Textile',
  potters: 'Potters',
  mill: 'Mill',
  temple_quarter: 'Temple',
  necropolis: 'Necropolis',
  academia: 'Academia',
  plague_ward: 'Plague Ward',
  archive_quarter: 'Archive',
  foreign_quarter: 'Foreign Quarter',
  caravanserai: 'Caravanserai',
  bankers_row: 'Bankers Row',
  warehouse_row: 'Warehouse Row',
  barracks: 'Barracks',
  citadel: 'Citadel',
  arsenal: 'Arsenal',
  watchmen_precinct: 'Watchmen',
  theater_district: 'Theater',
  bathhouse_quarter: 'Bathhouse',
  pleasure_quarter: 'Pleasure',
  festival_grounds: 'Festival Grounds',
  ghetto: 'Ghetto',
  workhouse: 'Workhouse',
  gallows_hill: 'Gallows Hill',
};

function QuartersList({ counts }: { counts: Record<string, number> }) {
  const entries = useMemo(
    () => Object.entries(counts).sort((a, b) => b[1] - a[1]),
    [counts],
  );
  return (
    <div style={styles.techGrid}>
      {entries.map(([role, count]) => (
        <div key={role} style={styles.techRow}>
          <span style={{ fontSize: 11, lineHeight: 1 }}>{QUARTER_ICONS[role] ?? '▪'}</span>
          <span style={styles.techLabel}>{QUARTER_LABELS[role] ?? role}</span>
          <span style={styles.techLevel}>{count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Resource List ──

/** Dot color per legacy category, matches the map icon bucket split in renderer.ts. */
const CATEGORY_COLORS: Record<LegacyResourceCategory, string> = {
  strategic: '#8a8a8a',
  agricultural: '#6b9a4e',
  luxury: '#c9a240',
};

/** `natural_gas` → `Natural gas`, `iron` → `Iron`. */
function formatResourceType(type: string): string {
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Resolve category color with a safe fallback for unknown types. */
function resourceDotColor(type: string): string {
  try {
    return CATEGORY_COLORS[getLegacyCategory(type as ResourceType)];
  } catch {
    return '#888';
  }
}

// ── Wonder List ──

function WonderList({ wonders, convertYears }: { wonders: WonderDetail[]; convertYears: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      {wonders.map((w, i) => {
        const tierName = WONDER_TIER_NAMES[w.tier] ?? `Tier ${w.tier}`;
        const isDestroyed = w.destroyedOn !== null;
        return (
          <div
            key={i}
            style={{
              fontSize: 11,
              lineHeight: '16px',
              paddingLeft: 8,
              textDecoration: isDestroyed ? 'line-through' : undefined,
              opacity: isDestroyed ? 0.6 : 1,
            }}
          >
            <span style={{ color: '#d4a800' }}>{'\u2605'} </span>
            <span style={{ fontWeight: 500 }}>{w.name}</span>
            <span style={{ color: '#999', marginLeft: 4 }}>
              Tier {w.tier} {tierName} ({formatYear(0, w.builtOn, convertYears)})
            </span>
            {isDestroyed && (
              <span style={{ color: '#c44', marginLeft: 4 }}>
                [Destroyed {formatYear(0, w.destroyedOn!, convertYears)}]
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Wonder List Grouped ──

function WonderListGrouped({
  wonders,
  convertYears,
}: {
  wonders: WonderDetail[];
  convertYears: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WonderDetail[]>();
    for (const w of wonders) {
      const key = w.cityName;
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(w);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [wonders]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      {groups.map(([cityName, cityWonders]) => (
        <div key={cityName}>
          <div style={{ fontSize: 11, fontWeight: 600, paddingLeft: 4, color: '#bbb' }}>
            {cityName}
          </div>
          <WonderList wonders={cityWonders} convertYears={convertYears} />
        </div>
      ))}
    </div>
  );
}

function ResourceList({ resources }: { resources: Map<string, ResourceAggregate> }) {
  const entries = useMemo(
    () => Array.from(resources.entries()).sort((a, b) => b[1].amount - a[1].amount),
    [resources],
  );
  return (
    <div style={styles.techGrid}>
      {entries.map(([type, { amount, locked, exploited }]) => {
        const title = locked
          ? 'Locked \u2014 requires more tech to unlock for trade'
          : !exploited
            ? 'Unexploited \u2014 no city controls this resource'
            : undefined;
        return (
          <div
            key={type}
            style={{
              ...styles.techRow,
              opacity: locked ? 0.55 : !exploited ? 0.7 : 1,
            }}
            title={title}
          >
            <span style={{ ...styles.techDot, background: resourceDotColor(type) }} />
            <span style={styles.techLabel}>
              {locked ? '\u{1F512} ' : !exploited ? '\u26D4 ' : '\u2692 '}{formatResourceType(type)}
            </span>
            <span style={styles.techLevel}>{amount}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Terrain Bar ──

function TerrainBar({ distribution }: { distribution: [string, number][] }) {
  if (distribution.length === 0) return null;
  const total = distribution.reduce((s, [, c]) => s + c, 0);
  const TOP_N = 4;
  const topBiomes = distribution.slice(0, TOP_N);
  const otherCount = distribution.slice(TOP_N).reduce((s, [, c]) => s + c, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={styles.terrainBar}>
        {distribution.map(([biome, count]) => (
          <div
            key={biome}
            title={`${(BIOME_INFO as Record<string, { label: string }>)[biome]?.label ?? biome}: ${count}`}
            style={{
              width: `${(count / total) * 100}%`,
              height: '100%',
              background: (BIOME_INFO as Record<string, { fillColor: string }>)[biome]?.fillColor ?? '#888',
            }}
          />
        ))}
      </div>
      <div style={styles.terrainLegend}>
        {topBiomes.map(([biome, count]) => (
          <span key={biome} style={styles.terrainLegendItem}>
            <span
              style={{
                ...styles.terrainDot,
                background: (BIOME_INFO as Record<string, { fillColor: string }>)[biome]?.fillColor ?? '#888',
              }}
            />
            {(BIOME_INFO as Record<string, { label: string }>)[biome]?.label ?? biome}: {count}
          </span>
        ))}
        {otherCount > 0 && (
          <span style={styles.terrainLegendItem}>
            <span style={{ ...styles.terrainDot, background: '#aaa' }} />
            Other: {otherCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100vh - 180px)',
    overflow: 'hidden',
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottom: '1px solid #d4b896',
    gap: 8,
  },
  miniTitle: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#3a1a00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    color: '#7a5a30',
    padding: '0 4px',
    lineHeight: 1,
    fontWeight: 'bold',
  },
  placeholder: {
    fontSize: 12,
    color: '#9a7a50',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingRight: 2,
  },
  entityNameRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  entityName: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#2a1a00',
    padding: '2px 0',
  },
  cityMapBtn: {
    flexShrink: 0,
    background: 'none',
    border: '1px solid #c4a46a',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    color: '#5a3a10',
    padding: '1px 5px',
    lineHeight: 1.4,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  locateBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#7a5a30',
    padding: '0 2px',
    lineHeight: 1,
    opacity: 0.7,
  },
  deadBadge: {
    fontWeight: 'normal',
    fontSize: 11,
    color: '#8a6a50',
    fontStyle: 'italic',
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  infoRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
  },
  infoLabel: {
    flexShrink: 0,
    fontWeight: 'bold',
    color: '#5a3a10',
    minWidth: 60,
  },
  infoValue: {
    color: '#2a1a00',
    flex: 1,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#2060a0',
    textDecoration: 'underline',
    padding: 0,
    textAlign: 'left',
  },
  sectionLabel: {
    fontWeight: 'bold',
    fontSize: 10,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    paddingBottom: 2,
    borderBottom: '1px solid #e0d0b0',
  },
  sectionToggle: {
    // Matches `sectionLabel` visual weight but rendered as a button so the
    // whole header is clickable for the collapsible Resources section.
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #e0d0b0',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontWeight: 'bold',
    fontSize: 10,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    paddingBottom: 2,
    paddingLeft: 0,
    paddingRight: 0,
    textAlign: 'left',
  },
  techGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  techRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    padding: '1px 4px',
    background: '#f5ecd8',
    borderRadius: 3,
  },
  techDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  techLabel: {
    color: '#3a2a10',
  },
  techLevel: {
    fontWeight: 'bold',
    color: '#2a1a00',
  },
  cityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  cityItem: {
    display: 'block',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#2060a0',
    textDecoration: 'none',
    padding: '1px 4px',
    textAlign: 'left',
    borderRadius: 2,
  },
  citySizeMeta: {
    fontSize: 9,
    color: '#8a6a30',
    fontStyle: 'italic',
  },
  loadingNote: {
    fontSize: 10,
    color: '#9a7a50',
    fontStyle: 'italic',
    padding: '2px 0',
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  eventRow: {
    display: 'flex',
    gap: 5,
    alignItems: 'flex-start',
    fontSize: 10,
    color: '#2a1a00',
    lineHeight: 1.4,
    padding: '1px 4px 1px 5px',
    borderRadius: 2,
    background: 'rgba(0,0,0,0.03)',
  },
  eventYear: {
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 'bold',
    color: '#7a5a30',
    minWidth: 44,
  },
  eventIcon: {
    flexShrink: 0,
    fontSize: 10,
  },
  eventDesc: {
    flex: 1,
  },
  terrainBar: {
    height: 12,
    borderRadius: 3,
    overflow: 'hidden',
    display: 'flex',
    border: '1px solid #d4b896',
  },
  terrainLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '2px 8px',
    fontSize: 9,
    color: '#3a2a10',
  },
  terrainLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
  },
  terrainDot: {
    width: 7,
    height: 7,
    borderRadius: 2,
    flexShrink: 0,
    border: '1px solid rgba(0,0,0,0.15)',
  },
};
