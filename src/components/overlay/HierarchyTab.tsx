import { useCallback, useMemo, useState } from 'react';
import type { City, Country, EmpireSnapshotEntry, HistoryData, MapData, SelectedEntity } from '../../lib/types';
import { INDEX_TO_CITY_SIZE } from '../../lib/history/physical/CityEntity';
import { getEmpiresAtYear } from '../../lib/history';
import { formatYear } from '../Timeline';
import type { CityEnvironment } from '../../lib/citymap';
import { deriveCityEnvironment } from '../../lib/citymap';
import { CityMapPopupV2 } from '../CityMapPopupV2';

interface HierarchyTabProps {
  historyData: HistoryData;
  cities: City[];
  selectedYear: number;
  convertYears: boolean;
  ownershipAtYear?: Int16Array;
  citySizesAtYear?: Uint8Array;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
  mapData?: MapData;
  seed?: string;
}

const ALL_CITY_SIZES: City['size'][] = ['small', 'medium', 'large', 'metropolis', 'megalopolis'];

/** Unicode icon and tooltip label per city size, conveying scale progression. */
const SIZE_ICONS: Record<City['size'], string> = {
  small:       '·',  // ·  middle dot
  medium:      '•',  // •  bullet
  large:       '●',  // ●  black circle
  metropolis:  '⬤',  // ⬤  black large circle
  megalopolis: '★',  // ★  star
};
const SIZE_LABELS: Record<City['size'], string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  metropolis: 'Metropolis',
  megalopolis: 'Megalopolis',
};

interface CountryNode {
  country: Country;
  cities: City[];
}

interface EmpireNode {
  entry: EmpireSnapshotEntry;
  countries: CountryNode[];
  totalCities: number;
}

interface Tree {
  empires: EmpireNode[];
  stateless: CountryNode[];
  statelessCityCount: number;
  unassignedCities: City[];
}

interface CityMapState {
  city: City;
  environment: CityEnvironment;
}

export function HierarchyTab({ historyData, cities, selectedYear, convertYears, ownershipAtYear, citySizesAtYear, onNavigate, onSelectEntity, mapData, seed }: HierarchyTabProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledSizes, setEnabledSizes] = useState<Set<City['size']>>(() => new Set(ALL_CITY_SIZES));
  const [cityMapState, setCityMapState] = useState<CityMapState | null>(null);

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSize = (size: City['size']) => {
    setEnabledSizes(prev => {
      const next = new Set(prev);
      if (next.has(size)) {
        // Keep at least one size enabled
        if (next.size > 1) next.delete(size);
      } else {
        next.add(size);
      }
      return next;
    });
  };

  /** Collect all cell indices owned by a given country id. */
  const getCellsForCountry = useCallback((countryId: number): number[] => {
    if (!ownershipAtYear) return [];
    const result: number[] = [];
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (ownershipAtYear[i] === countryId) result.push(i);
    }
    return result;
  }, [ownershipAtYear]);

  /** Collect all cell indices owned by any country in the given set. */
  const getCellsForCountries = useCallback((countryIds: number[]): number[] => {
    if (!ownershipAtYear) return [];
    const idSet = new Set(countryIds);
    const result: number[] = [];
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (idSet.has(ownershipAtYear[i])) result.push(i);
    }
    return result;
  }, [ownershipAtYear]);

  const handleLocateCity = useCallback((city: City) => {
    onNavigate?.([city.cellIndex], city.cellIndex);
  }, [onNavigate]);

  const handleLocateCountry = useCallback((country: Country) => {
    const cells = getCellsForCountry(country.id);
    if (cells.length === 0) cells.push(country.capitalCellIndex);
    onNavigate?.(cells, country.capitalCellIndex);
  }, [onNavigate, getCellsForCountry]);

  const handleLocateEmpire = useCallback((emp: EmpireNode) => {
    const memberIds = emp.countries.map(c => c.country.id);
    const cells = getCellsForCountries(memberIds);
    const founderCountry = historyData.countries[emp.entry.founderCountryIndex];
    const centerCell = founderCountry?.capitalCellIndex ?? emp.countries[0]?.country.capitalCellIndex ?? 0;
    if (cells.length === 0) cells.push(centerCell);
    onNavigate?.(cells, centerCell);
  }, [onNavigate, getCellsForCountries, historyData.countries]);

  const handleOpenCityMap = useCallback((city: City) => {
    if (!mapData || !seed) return;
    const wonderSnap = (() => {
      const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
      for (let y = floored; y >= 0; y -= 20) {
        if (historyData.wonderSnapshots?.[y]) return historyData.wonderSnapshots[y];
      }
      return [];
    })();
    const religionSnap = (() => {
      const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
      for (let y = floored; y >= 0; y -= 20) {
        if (historyData.religionSnapshots?.[y]) return historyData.religionSnapshots[y];
      }
      return [];
    })();
    const environment = deriveCityEnvironment(
      city,
      mapData.cells,
      mapData,
      citySizesAtYear,
      selectedYear,
      wonderSnap.map(w => w.cellIndex),
      religionSnap,
    );
    setCityMapState({ city, environment });
  }, [mapData, seed, historyData, selectedYear, citySizesAtYear]);

  const snapshot = useMemo(
    () => getEmpiresAtYear(historyData, selectedYear),
    [historyData, selectedYear],
  );

  const snapKey = selectedYear;

  const tree = useMemo<Tree>(() => {
    const { countries } = historyData;
    const countryToEmpire = new Map<number, EmpireSnapshotEntry>();
    for (const emp of snapshot) {
      for (const memberIdx of emp.memberCountryIndices) {
        countryToEmpire.set(memberIdx, emp);
      }
    }

    const citiesByCountry = new Map<number, City[]>();
    const unassignedCities: City[] = [];
    for (const city of cities) {
      if (city.foundedYear > selectedYear) continue;
      if (city.kingdomId < 0) {
        unassignedCities.push(city);
        continue;
      }
      let owner: number;
      if (ownershipAtYear) {
        const cellOwner = ownershipAtYear[city.cellIndex];
        if (cellOwner >= 0) {
          owner = cellOwner;
        } else {
          unassignedCities.push(city);
          continue;
        }
      } else {
        owner = city.kingdomId;
      }
      let list = citiesByCountry.get(owner);
      if (!list) { list = []; citiesByCountry.set(owner, list); }
      list.push(city);
    }
    for (const [countryIdx, list] of citiesByCountry.entries()) {
      const capitalCell = countries[countryIdx]?.capitalCellIndex;
      list.sort((a, b) => {
        const aIsCap = a.cellIndex === capitalCell;
        const bIsCap = b.cellIndex === capitalCell;
        if (aIsCap !== bIsCap) return aIsCap ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    unassignedCities.sort((a, b) => a.name.localeCompare(b.name));

    const empireMap = new Map<string, EmpireNode>();
    for (const emp of snapshot) {
      empireMap.set(emp.empireId, { entry: emp, countries: [], totalCities: 0 });
    }
    const stateless: CountryNode[] = [];
    let statelessCityCount = 0;

    for (const country of countries) {
      if (country.foundedYear > selectedYear) continue;
      const countryCities = citiesByCountry.get(country.id) ?? [];
      const aliveAtYear = country.diedYear === undefined || country.diedYear > selectedYear;
      if (!aliveAtYear && countryCities.length === 0) continue;
      const node: CountryNode = { country, cities: countryCities };
      const emp = countryToEmpire.get(country.id);
      if (emp) {
        const empireNode = empireMap.get(emp.empireId);
        if (empireNode) {
          empireNode.countries.push(node);
          empireNode.totalCities += countryCities.length;
          continue;
        }
      }
      stateless.push(node);
      statelessCityCount += countryCities.length;
    }

    const empires = Array.from(empireMap.values())
      .filter(e => e.countries.length > 0)
      .sort((a, b) => {
        const diff = b.countries.length - a.countries.length;
        if (diff !== 0) return diff;
        return a.entry.name.localeCompare(b.entry.name);
      });
    for (const emp of empires) {
      emp.countries.sort((a, b) => {
        const aFounder = a.country.id === emp.entry.founderCountryIndex ? 0 : 1;
        const bFounder = b.country.id === emp.entry.founderCountryIndex ? 0 : 1;
        if (aFounder !== bFounder) return aFounder - bFounder;
        return a.country.name.localeCompare(b.country.name);
      });
    }
    stateless.sort((a, b) => a.country.name.localeCompare(b.country.name));

    return { empires, stateless, statelessCityCount, unassignedCities };
  }, [historyData, snapshot, cities, selectedYear, ownershipAtYear]);

  // Map cellIndex → cities[] array index for dynamic size lookup
  const cityIdxMap = useMemo(() => {
    if (!citySizesAtYear) return undefined;
    return new Map(cities.map((c, i) => [c.cellIndex, i]));
  }, [cities, citySizesAtYear]);

  const resolveCitySize = useCallback((city: City): City['size'] => {
    if (!citySizesAtYear || !cityIdxMap) return city.size;
    const idx = cityIdxMap.get(city.cellIndex);
    if (idx === undefined) return city.size;
    return INDEX_TO_CITY_SIZE[citySizesAtYear[idx]] ?? city.size;
  }, [citySizesAtYear, cityIdxMap]);

  // Apply city-size filter on top of the raw tree.
  // Countries with cities that are all filtered out are hidden; countries
  // with naturally zero cities are kept as-is.
  const sizeFilteredTree = useMemo<Tree>(() => {
    if (enabledSizes.size === ALL_CITY_SIZES.length) return tree;

    const filterCountryBySizes = (node: CountryNode): CountryNode | null => {
      if (node.cities.length === 0) return node;
      const filtered = node.cities.filter(c => enabledSizes.has(resolveCitySize(c)));
      if (filtered.length === 0) return null;
      return { ...node, cities: filtered };
    };

    const filteredEmpires: EmpireNode[] = [];
    for (const emp of tree.empires) {
      const filteredCountries: CountryNode[] = [];
      let totalCities = 0;
      for (const c of emp.countries) {
        const fc = filterCountryBySizes(c);
        if (fc) { filteredCountries.push(fc); totalCities += fc.cities.length; }
      }
      if (filteredCountries.length > 0) {
        filteredEmpires.push({ ...emp, countries: filteredCountries, totalCities });
      }
    }

    const filteredStateless: CountryNode[] = [];
    let filteredStatelessCityCount = 0;
    for (const c of tree.stateless) {
      const fc = filterCountryBySizes(c);
      if (fc) { filteredStateless.push(fc); filteredStatelessCityCount += fc.cities.length; }
    }

    const filteredUnassigned = tree.unassignedCities.filter(c => enabledSizes.has(resolveCitySize(c)));

    return {
      empires: filteredEmpires,
      stateless: filteredStateless,
      statelessCityCount: filteredStatelessCityCount,
      unassignedCities: filteredUnassigned,
    };
  }, [tree, enabledSizes, resolveCitySize]);

  // Search filter applied on top of size filter
  const filteredTree = useMemo<Tree>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sizeFilteredTree;

    const matchesQuery = (name: string) => name.toLowerCase().includes(q);

    const filterCountryNode = (node: CountryNode, parentMatched: boolean): CountryNode | null => {
      const countryMatches = matchesQuery(node.country.name);
      if (parentMatched || countryMatches) return node;
      const matchedCities = node.cities.filter(c => matchesQuery(c.name));
      if (matchedCities.length > 0) return { country: node.country, cities: matchedCities };
      return null;
    };

    const filteredEmpires: EmpireNode[] = [];
    for (const emp of sizeFilteredTree.empires) {
      const empireMatches = matchesQuery(emp.entry.name);
      if (empireMatches) { filteredEmpires.push(emp); continue; }
      const filteredCountries: CountryNode[] = [];
      let totalCities = 0;
      for (const c of emp.countries) {
        const fc = filterCountryNode(c, false);
        if (fc) { filteredCountries.push(fc); totalCities += fc.cities.length; }
      }
      if (filteredCountries.length > 0) {
        filteredEmpires.push({ entry: emp.entry, countries: filteredCountries, totalCities });
      }
    }

    const filteredStateless: CountryNode[] = [];
    let filteredStatelessCityCount = 0;
    for (const c of sizeFilteredTree.stateless) {
      const fc = filterCountryNode(c, false);
      if (fc) { filteredStateless.push(fc); filteredStatelessCityCount += fc.cities.length; }
    }

    const filteredUnassigned = sizeFilteredTree.unassignedCities.filter(c => matchesQuery(c.name));

    return {
      empires: filteredEmpires,
      stateless: filteredStateless,
      statelessCityCount: filteredStatelessCityCount,
      unassignedCities: filteredUnassigned,
    };
  }, [sizeFilteredTree, searchQuery]);

  const isSearching = searchQuery.trim().length > 0;
  const isExpanded = (key: string) => isSearching || expanded.has(key);

  const totalLiveCountries = filteredTree.empires.reduce((s, e) => s + e.countries.length, 0) + filteredTree.stateless.length;

  const renderCity = (city: City, dead: boolean, isCapitalHere: boolean) => {
    const isRuinNow = city.isRuin && city.ruinYear <= selectedYear;
    const sizeLabel = isRuinNow ? 'ruin' : SIZE_LABELS[resolveCitySize(city)];
    const capitalMark = isRuinNow ? '• ' : isCapitalHere ? '★ ' : '• ';
    const canShowMap = !isRuinNow && !!mapData && !!seed;
    return (
      <div
        key={city.cellIndex}
        style={{
          ...styles.cityRow,
          ...(dead || isRuinNow ? styles.deadText : {}),
          ...(isRuinNow ? { fontStyle: 'italic' } : {}),
        }}
      >
        <span style={styles.cityBullet}>{capitalMark}</span>
        {onSelectEntity ? (
          <button
            style={{ ...styles.nameLink, ...(isRuinNow ? { fontStyle: 'italic', color: '#888' } : {}) }}
            onClick={(e) => { e.stopPropagation(); onSelectEntity({ type: 'city', cellIndex: city.cellIndex }); }}
            title={`View ${city.name} details`}
          >
            {city.name}
          </button>
        ) : (
          <span style={styles.cityName}>{city.name}</span>
        )}
        <span style={styles.citySize}>
          {!isRuinNow && isCapitalHere ? 'capital, ' : ''}{sizeLabel}
        </span>
        {canShowMap && (
          <button
            style={styles.cityMapBtn}
            onClick={(e) => { e.stopPropagation(); handleOpenCityMap(city); }}
            title={`Open city map for ${city.name}`}
          >{'\u{1F5FA}'}</button>
        )}
        {onNavigate && (
          <button
            style={styles.locateBtn}
            onClick={(e) => { e.stopPropagation(); handleLocateCity(city); }}
            title={`Locate ${city.name}`}
          >{'◎'}</button>
        )}
      </div>
    );
  };

  const renderCountry = (node: CountryNode, founderIdx: number | null) => {
    const key = `cty:${node.country.id}`;
    const isOpen = isExpanded(key);
    const isFounder = founderIdx !== null && node.country.id === founderIdx;
    const dead = node.country.diedYear !== undefined
      ? node.country.diedYear <= selectedYear
      : !node.country.isAlive;
    return (
      <div key={key} style={styles.countryBlock}>
        <button
          style={styles.countryHeader}
          onClick={() => toggle(key)}
        >
          <span style={styles.chevron}>{isOpen ? '▾' : '▸'}</span>
          {onSelectEntity ? (
            <button
              style={{ ...styles.nameLink, ...(dead ? styles.deadText : {}), flex: 1, fontSize: 11 }}
              onClick={(e) => { e.stopPropagation(); onSelectEntity({ type: 'country', countryIndex: node.country.id }); }}
              title={`View ${node.country.name} details`}
            >
              {node.country.name}
            </button>
          ) : (
            <span style={{ ...styles.countryName, ...(dead ? styles.deadText : {}) }}>
              {node.country.name}
            </span>
          )}
          {isFounder && <span style={styles.founderTag}>founder</span>}
          <span style={styles.countryMeta}>
            {node.cities.length} {node.cities.length === 1 ? 'city' : 'cities'}
          </span>
          {onNavigate && (
            <button
              style={styles.locateBtn}
              onClick={(e) => { e.stopPropagation(); handleLocateCountry(node.country); }}
              title={`Locate ${node.country.name}`}
            >{'◎'}</button>
          )}
        </button>
        {isOpen && (
          <div style={styles.cityList}>
            {node.cities.length === 0
              ? <div style={styles.emptyNote}>no cities yet</div>
              : node.cities.map(c => renderCity(c, dead, c.cellIndex === node.country.capitalCellIndex))}
          </div>
        )}
      </div>
    );
  };

  const renderEmpire = (emp: EmpireNode) => {
    const key = `emp:${emp.entry.empireId}`;
    const isOpen = isExpanded(key);
    return (
      <div key={key} style={styles.empireBlock}>
        <button
          style={styles.empireHeader}
          onClick={() => toggle(key)}
        >
          <span style={styles.chevron}>{isOpen ? '▾' : '▸'}</span>
          {onSelectEntity ? (
            <button
              style={{ ...styles.nameLink, flex: 1, fontWeight: 'bold', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onSelectEntity({ type: 'empire', empireId: emp.entry.empireId, snapshotYear: snapKey }); }}
              title={`View ${emp.entry.name} details`}
            >
              {emp.entry.name}
            </button>
          ) : (
            <span style={styles.empireName}>{emp.entry.name}</span>
          )}
          <span style={styles.empireMeta}>
            {emp.countries.length} {emp.countries.length === 1 ? 'country' : 'countries'}
            {', '}
            {emp.totalCities} {emp.totalCities === 1 ? 'city' : 'cities'}
          </span>
          {onNavigate && (
            <button
              style={styles.locateBtn}
              onClick={(e) => { e.stopPropagation(); handleLocateEmpire(emp); }}
              title={`Locate ${emp.entry.name}`}
            >{'◎'}</button>
          )}
        </button>
        {isOpen && (
          <div style={styles.countryList}>
            {emp.countries.map(c => renderCountry(c, emp.entry.founderCountryIndex))}
          </div>
        )}
      </div>
    );
  };

  const statelessOpen = isExpanded('stateless');
  const unassignedOpen = isExpanded('unassigned');

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Realm</span>
        <span style={styles.miniCount}>
          {tree.empires.length} {tree.empires.length === 1 ? 'empire' : 'empires'}
          {' · '}
          {totalLiveCountries} {totalLiveCountries === 1 ? 'country' : 'countries'}
          {' · '}{formatYear(historyData.startOfTime, selectedYear, convertYears)}
        </span>
      </div>

      <div style={styles.searchBox}>
        <input
          type="text"
          placeholder="Search realms..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
        {searchQuery && (
          <button
            style={styles.searchClear}
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >{'×'}</button>
        )}
        <div style={styles.sizeFilterRow}>
          {ALL_CITY_SIZES.map(size => {
            const active = enabledSizes.has(size);
            return (
              <button
                key={size}
                style={{
                  ...styles.sizeFilterBtn,
                  opacity: active ? 1 : 0.3,
                  background: active ? '#e8d4a8' : 'transparent',
                  border: active ? '1px solid #b89050' : '1px solid #c8b07a',
                }}
                onClick={() => toggleSize(size)}
                title={`${active ? 'Hide' : 'Show'} ${SIZE_LABELS[size]} cities`}
                aria-pressed={active}
              >
                <span style={styles.sizeIcon}>{SIZE_ICONS[size]}</span>
                <span style={styles.sizeFilterLabel}>{SIZE_LABELS[size][0]}{size === 'metropolis' ? 'tr' : size === 'megalopolis' ? 'eg' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={styles.treeList}>
        {filteredTree.empires.length === 0
          && filteredTree.stateless.length === 0
          && filteredTree.unassignedCities.length === 0 && (
          <div style={styles.emptyNote}>
            {isSearching ? 'No matches.' : enabledSizes.size < ALL_CITY_SIZES.length ? 'No cities match the selected sizes.' : 'No realms yet.'}
          </div>
        )}

        {filteredTree.empires.map(renderEmpire)}

        {filteredTree.stateless.length > 0 && (
          <div style={styles.empireBlock}>
            <button
              style={styles.empireHeader}
              onClick={() => toggle('stateless')}
            >
              <span style={styles.chevron}>{statelessOpen ? '▾' : '▸'}</span>
              <span style={styles.empireName}>Stateless</span>
              <span style={styles.empireMeta}>
                {filteredTree.stateless.length} {filteredTree.stateless.length === 1 ? 'country' : 'countries'}
                {', '}
                {filteredTree.statelessCityCount} {filteredTree.statelessCityCount === 1 ? 'city' : 'cities'}
              </span>
            </button>
            {statelessOpen && (
              <div style={styles.countryList}>
                {filteredTree.stateless.map(c => renderCountry(c, null))}
              </div>
            )}
          </div>
        )}

        {filteredTree.unassignedCities.length > 0 && (
          <div style={styles.empireBlock}>
            <button
              style={styles.empireHeader}
              onClick={() => toggle('unassigned')}
            >
              <span style={styles.chevron}>{unassignedOpen ? '▾' : '▸'}</span>
              <span style={styles.empireName}>Free Cities</span>
              <span style={styles.empireMeta}>
                {filteredTree.unassignedCities.length}{' '}
                {filteredTree.unassignedCities.length === 1 ? 'city' : 'cities'}
              </span>
            </button>
            {unassignedOpen && (
              <div style={styles.cityList}>
                {filteredTree.unassignedCities.map(c => renderCity(c, false, false))}
              </div>
            )}
          </div>
        )}
      </div>

      {cityMapState && seed && (
        <CityMapPopupV2
          isOpen={true}
          onClose={() => setCityMapState(null)}
          cityName={cityMapState.city.name}
          environment={cityMapState.environment}
          seed={seed}
        />
      )}
    </div>
  );
}

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
  miniCount: {
    fontSize: 10,
    color: '#7a5a30',
    textAlign: 'right',
  },
  treeList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingRight: 2,
  },
  empireBlock: {
    display: 'flex',
    flexDirection: 'column',
  },
  empireHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    background: '#f3e3c3',
    border: '1px solid #d4b896',
    borderRadius: 3,
    padding: '4px 6px',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    textAlign: 'left',
    color: '#2a1a00',
  },
  empireName: {
    fontWeight: 'bold',
    fontSize: 12,
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  empireMeta: {
    flexShrink: 0,
    fontSize: 10,
    color: '#7a5a30',
  },
  countryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingLeft: 12,
    marginTop: 2,
  },
  countryBlock: {
    display: 'flex',
    flexDirection: 'column',
  },
  countryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '2px 4px',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    textAlign: 'left',
    color: '#2a1a00',
  },
  countryName: {
    fontSize: 11,
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  founderTag: {
    flexShrink: 0,
    fontSize: 9,
    color: '#8a5a20',
    fontStyle: 'italic',
    padding: '0 4px',
  },
  countryMeta: {
    flexShrink: 0,
    fontSize: 10,
    color: '#7a5a30',
  },
  chevron: {
    flexShrink: 0,
    fontSize: 9,
    color: '#7a5a30',
    width: 10,
    display: 'inline-block',
  },
  cityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    paddingLeft: 18,
    marginTop: 1,
    marginBottom: 3,
  },
  cityRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    fontSize: 10,
    color: '#3a2a10',
    lineHeight: 1.4,
  },
  cityBullet: {
    flexShrink: 0,
    color: '#a08030',
  },
  cityName: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  citySize: {
    flexShrink: 0,
    fontSize: 9,
    color: '#8a6a30',
    fontStyle: 'italic',
  },
  nameLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    color: '#2060a0',
    textDecoration: 'none',
    padding: 0,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  locateBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    color: '#7a5a30',
    padding: '0 2px',
    lineHeight: 1,
    opacity: 0.7,
  },
  cityMapBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    color: '#7a5a30',
    padding: '0 2px',
    lineHeight: 1,
    opacity: 0.75,
  },
  deadText: {
    textDecoration: 'line-through',
    color: '#8a7a60',
  },
  emptyNote: {
    fontSize: 10,
    color: '#9a7a50',
    fontStyle: 'italic',
    padding: '4px 8px',
  },
  searchBox: {
    position: 'relative',
    marginBottom: 4,
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '4px 24px 4px 6px',
    fontSize: 11,
    fontFamily: 'Georgia, serif',
    border: '1px solid #d4b896',
    borderRadius: 3,
    background: '#faf3e6',
    color: '#3a1a00',
    outline: 'none',
  },
  searchClear: {
    position: 'absolute',
    right: 2,
    top: 6,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#7a5a30',
    padding: '0 4px',
    lineHeight: 1,
  },
  sizeFilterRow: {
    display: 'flex',
    gap: 3,
    marginTop: 4,
  },
  sizeFilterBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '1px 4px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 9,
    color: '#3a1a00',
    transition: 'opacity 0.15s',
    flexShrink: 0,
  },
  sizeIcon: {
    fontSize: 10,
    lineHeight: 1,
    color: '#5a3a00',
  },
  sizeFilterLabel: {
    fontSize: 8,
    letterSpacing: 0.2,
    color: '#5a3a00',
    textTransform: 'uppercase',
  },
};
