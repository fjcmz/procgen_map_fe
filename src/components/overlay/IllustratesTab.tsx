import { useMemo, useRef, useEffect, useState } from 'react';
import type { HistoryData, IllustrateDetail } from '../../lib/types';
import { EVENT_ICONS } from './eventStyles';
import { formatYear } from '../Timeline';

interface IllustratesTabProps {
  historyData: HistoryData;
  selectedYear: number;
  convertYears: boolean;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

const TYPE_COLORS: Record<IllustrateDetail['type'], string> = {
  religion: '#8040a0',
  science: '#208080',
  philosophy: '#4070b0',
  industry: '#d4a800',
  military: '#c03020',
  art: '#b060a0',
};

const TYPE_ICONS: Record<IllustrateDetail['type'], string> = {
  religion: '\u2626\uFE0F',
  science: '\uD83D\uDD2C',
  philosophy: '\uD83D\uDCDC',
  industry: '\u2692\uFE0F',
  military: '\u2694\uFE0F',
  art: '\uD83C\uDFA8',
};

type FilterType = 'all' | IllustrateDetail['type'];

export function IllustratesTab({ historyData, selectedYear, convertYears, onNavigate }: IllustratesTabProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [showDead, setShowDead] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const absSelectedYear = historyData.startOfTime + selectedYear;

  const illustrates = useMemo(() => {
    const details = historyData.illustrateDetails;
    if (!details) return [];
    return details.filter(ill => {
      if (ill.birthYear > absSelectedYear) return false;
      if (!showDead && ill.deathYear != null && ill.deathYear <= absSelectedYear) return false;
      if (filter !== 'all' && ill.type !== filter) return false;
      return true;
    });
  }, [historyData.illustrateDetails, absSelectedYear, filter, showDead]);

  const aliveCount = useMemo(() => {
    return illustrates.filter(ill =>
      ill.deathYear == null || ill.deathYear > absSelectedYear
    ).length;
  }, [illustrates, absSelectedYear]);

  // Auto-scroll to bottom when year changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [selectedYear]);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerLabel}>
          {EVENT_ICONS.ILLUSTRATE} {aliveCount} alive / {illustrates.length} shown
        </span>
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as FilterType)}
          style={styles.select}
        >
          <option value="all">All types</option>
          <option value="religion">Religion</option>
          <option value="science">Science</option>
          <option value="philosophy">Philosophy</option>
          <option value="industry">Industry</option>
          <option value="military">Military</option>
          <option value="art">Art</option>
        </select>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showDead}
            onChange={() => setShowDead(d => !d)}
          />
          Dead
        </label>
      </div>

      {/* List */}
      <div ref={listRef} style={styles.list}>
        {illustrates.length === 0 && (
          <div style={styles.empty}>No illustrious figures yet.</div>
        )}
        {illustrates.map((ill, i) => {
          const isDead = ill.deathYear != null && ill.deathYear <= absSelectedYear;
          const color = TYPE_COLORS[ill.type];
          return (
            <div
              key={i}
              style={{
                ...styles.row,
                borderLeftColor: color,
                opacity: isDead ? 0.55 : 1,
              }}
            >
              <div style={styles.rowTop}>
                <span style={styles.typeIcon} title={ill.type}>
                  {TYPE_ICONS[ill.type]}
                </span>
                <span style={{ ...styles.typeBadge, background: color }}>
                  {ill.type}
                </span>
                {isDead && (
                  <span style={styles.deadBadge} title={`Died: ${ill.deathCause || 'unknown'}`}>
                    \u2020
                  </span>
                )}
                {ill.cityCellIndex >= 0 && onNavigate && (
                  <button
                    style={styles.locateBtn}
                    title="Locate on map"
                    onClick={() => onNavigate([ill.cityCellIndex], ill.cityCellIndex)}
                  >
                    &#x25CE;
                  </button>
                )}
              </div>
              <div style={styles.rowDetails}>
                <span style={styles.detailCity}>
                  {ill.cityName}
                  {ill.countryName ? ` (${ill.countryName})` : ''}
                </span>
                <span style={styles.detailYears}>
                  {formatYear(0, ill.birthYear, convertYears)}
                  {isDead && ill.deathYear != null
                    ? ` \u2013 ${formatYear(0, ill.deathYear, convertYears)}`
                    : ' \u2013 alive'}
                </span>
                {isDead && ill.deathCause && (
                  <span style={styles.detailCause}>{ill.deathCause}</span>
                )}
              </div>
            </div>
          );
        })}
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    fontSize: 11,
    color: '#5a3a10',
    borderBottom: '1px solid #d8c090',
    marginBottom: 4,
  },
  headerLabel: {
    fontWeight: 'bold',
  },
  filterBar: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '2px 0 4px',
    fontSize: 11,
  },
  select: {
    flex: 1,
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #c0a070',
    borderRadius: 3,
    background: '#fff8e0',
    color: '#2a1a00',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 11,
    color: '#5a3a10',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  empty: {
    padding: '24px 8px',
    textAlign: 'center',
    fontSize: 12,
    color: '#8a6a30',
    fontStyle: 'italic',
  },
  row: {
    padding: '4px 6px',
    borderLeft: '3px solid #aaa',
    borderRadius: 2,
    background: 'rgba(255,255,255,0.3)',
    fontSize: 11,
  },
  rowTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  typeIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  typeBadge: {
    color: '#fff',
    padding: '1px 5px',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  deadBadge: {
    color: '#804040',
    fontWeight: 'bold',
    fontSize: 13,
    marginLeft: 2,
  },
  locateBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: '1px solid #c0a070',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 11,
    padding: '0 4px',
    color: '#5a3a10',
    lineHeight: '16px',
  },
  rowDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    paddingLeft: 17,
    marginTop: 1,
  },
  detailCity: {
    color: '#3a2a00',
    fontSize: 11,
  },
  detailYears: {
    color: '#6a5a30',
    fontSize: 10,
  },
  detailCause: {
    color: '#804040',
    fontSize: 10,
    fontStyle: 'italic',
  },
};
