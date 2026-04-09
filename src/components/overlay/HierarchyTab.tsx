import { useCallback, useMemo, useState } from 'react';
import type { City, Country, EmpireSnapshotEntry, HistoryData } from '../../lib/types';

interface HierarchyTabProps {
  historyData: HistoryData;
  cities: City[];
  selectedYear: number;
  ownershipAtYear?: Int16Array;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

/** Short label rendered after each city name. */
const SIZE_LABELS: Record<City['size'], string> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  metropolis: 'metropolis',
  megalopolis: 'megalopolis',
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
}

/**
 * Look up the empire snapshot at or before `selectedYear`. Snapshots are
 * written every 20 years plus the final year, so we floor to the nearest
 * 20-year tick and walk backward if that key is missing (truncated runs).
 */
function lookupEmpireSnapshot(
  historyData: HistoryData,
  selectedYear: number,
): EmpireSnapshotEntry[] {
  const finalKey = historyData.numYears;
  // Prefer the exact final snapshot on the last frame.
  if (selectedYear >= finalKey && historyData.empireSnapshots[finalKey]) {
    return historyData.empireSnapshots[finalKey];
  }
  const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
  for (let y = floored; y >= 0; y -= 20) {
    const snap = historyData.empireSnapshots[y];
    if (snap) return snap;
  }
  return [];
}

export function HierarchyTab({ historyData, cities, selectedYear, ownershipAtYear, onNavigate }: HierarchyTabProps) {
  // Empires default to expanded, countries and the stateless bucket to collapsed.
  // Keys: 'emp:<empireId>' | 'cty:<countryIndex>' | 'stateless'.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>();
    init.add('stateless');
    return init;
  });

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  // Keep the empire tree defaulted-expanded even when the snapshot changes
  // as the user scrubs: seed any newly-seen empire ids into the expanded set.
  const snapshot = useMemo(
    () => lookupEmpireSnapshot(historyData, selectedYear),
    [historyData, selectedYear],
  );

  const tree = useMemo<Tree>(() => {
    const { countries } = historyData;
    // Map each country index → empire entry (if any).
    const countryToEmpire = new Map<number, EmpireSnapshotEntry>();
    for (const emp of snapshot) {
      for (const memberIdx of emp.memberCountryIndices) {
        countryToEmpire.set(memberIdx, emp);
      }
    }

    // Bucket cities by country index, filtered to those founded by selectedYear.
    const citiesByCountry = new Map<number, City[]>();
    for (const city of cities) {
      if (city.kingdomId < 0) continue;
      if (city.foundedYear > selectedYear) continue;
      let list = citiesByCountry.get(city.kingdomId);
      if (!list) { list = []; citiesByCountry.set(city.kingdomId, list); }
      list.push(city);
    }
    for (const list of citiesByCountry.values()) {
      list.sort((a, b) => {
        if (a.isCapital !== b.isCapital) return a.isCapital ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }

    // Group countries into empires + stateless.
    const empireMap = new Map<string, EmpireNode>();
    for (const emp of snapshot) {
      empireMap.set(emp.empireId, { entry: emp, countries: [], totalCities: 0 });
    }
    const stateless: CountryNode[] = [];
    let statelessCityCount = 0;

    for (const country of countries) {
      const countryCities = citiesByCountry.get(country.id) ?? [];
      // Skip countries that have no cities AND are not alive — these are
      // usually placeholder rows at default-0 capital cells.
      if (!country.isAlive && countryCities.length === 0) continue;
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

    // Sort: member-count desc, then name asc. Founder first inside each empire.
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

    return { empires, stateless, statelessCityCount };
  }, [historyData, snapshot, cities, selectedYear]);

  const totalLiveCountries = tree.empires.reduce((s, e) => s + e.countries.length, 0) + tree.stateless.length;

  const renderCity = (city: City, dead: boolean) => {
    const sizeLabel = SIZE_LABELS[city.size];
    const capitalMark = city.isCapital ? '\u2605 ' : '\u2022 ';
    return (
      <div
        key={city.cellIndex}
        style={{
          ...styles.cityRow,
          ...(dead ? styles.deadText : {}),
        }}
      >
        <span style={styles.cityBullet}>{capitalMark}</span>
        <span style={styles.cityName}>{city.name}</span>
        <span style={styles.citySize}>
          {city.isCapital ? 'capital, ' : ''}{sizeLabel}
        </span>
        {onNavigate && (
          <button
            style={styles.locateBtn}
            onClick={(e) => { e.stopPropagation(); handleLocateCity(city); }}
            title={`Locate ${city.name}`}
          >{'\u25CE'}</button>
        )}
      </div>
    );
  };

  const renderCountry = (node: CountryNode, founderIdx: number | null) => {
    const key = `cty:${node.country.id}`;
    const isOpen = expanded.has(key);
    const isFounder = founderIdx !== null && node.country.id === founderIdx;
    const dead = !node.country.isAlive;
    return (
      <div key={key} style={styles.countryBlock}>
        <button
          style={styles.countryHeader}
          onClick={() => toggle(key)}
        >
          <span style={styles.chevron}>{isOpen ? '\u25BE' : '\u25B8'}</span>
          <span style={{ ...styles.countryName, ...(dead ? styles.deadText : {}) }}>
            {node.country.name}
          </span>
          {isFounder && <span style={styles.founderTag}>founder</span>}
          <span style={styles.countryMeta}>
            {node.cities.length} {node.cities.length === 1 ? 'city' : 'cities'}
          </span>
          {onNavigate && (
            <button
              style={styles.locateBtn}
              onClick={(e) => { e.stopPropagation(); handleLocateCountry(node.country); }}
              title={`Locate ${node.country.name}`}
            >{'\u25CE'}</button>
          )}
        </button>
        {isOpen && (
          <div style={styles.cityList}>
            {node.cities.length === 0
              ? <div style={styles.emptyNote}>no cities yet</div>
              : node.cities.map(c => renderCity(c, dead))}
          </div>
        )}
      </div>
    );
  };

  const renderEmpire = (emp: EmpireNode) => {
    const key = `emp:${emp.entry.empireId}`;
    // Default expanded unless explicitly collapsed by the user.
    const isOpen = !expanded.has(`emp:collapsed:${emp.entry.empireId}`);
    return (
      <div key={key} style={styles.empireBlock}>
        <button
          style={styles.empireHeader}
          onClick={() => toggle(`emp:collapsed:${emp.entry.empireId}`)}
        >
          <span style={styles.chevron}>{isOpen ? '\u25BE' : '\u25B8'}</span>
          <span style={styles.empireName}>{emp.entry.name}</span>
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
            >{'\u25CE'}</button>
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

  const statelessOpen = expanded.has('stateless');

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Realm</span>
        <span style={styles.miniCount}>
          {tree.empires.length} {tree.empires.length === 1 ? 'empire' : 'empires'}
          {' · '}
          {totalLiveCountries} {totalLiveCountries === 1 ? 'country' : 'countries'}
          {' · Y'}{selectedYear}
        </span>
      </div>

      <div style={styles.treeList}>
        {tree.empires.length === 0 && tree.stateless.length === 0 && (
          <div style={styles.emptyNote}>No realms yet.</div>
        )}

        {tree.empires.map(renderEmpire)}

        {tree.stateless.length > 0 && (
          <div style={styles.empireBlock}>
            <button
              style={styles.empireHeader}
              onClick={() => toggle('stateless')}
            >
              <span style={styles.chevron}>{statelessOpen ? '\u25BE' : '\u25B8'}</span>
              <span style={styles.empireName}>Stateless</span>
              <span style={styles.empireMeta}>
                {tree.stateless.length} {tree.stateless.length === 1 ? 'country' : 'countries'}
                {', '}
                {tree.statelessCityCount} {tree.statelessCityCount === 1 ? 'city' : 'cities'}
              </span>
            </button>
            {statelessOpen && (
              <div style={styles.countryList}>
                {tree.stateless.map(c => renderCountry(c, null))}
              </div>
            )}
          </div>
        )}
      </div>
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
};
