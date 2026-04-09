import { useEffect, useMemo, useRef } from 'react';
import type { HistoryData, HistoryEvent, SelectedEntity } from '../../lib/types';
import { formatPopulation } from '../Timeline';
import { EVENT_ICONS, EVENT_COLORS } from './eventStyles';

interface EventsTabProps {
  historyData: HistoryData;
  selectedYear: number;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
  selectedEntity?: SelectedEntity | null;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
}

/** Check if an event is relevant to the selected entity. */
function eventMatchesEntity(ev: HistoryEvent, entity: SelectedEntity, empireMembers?: Set<number>): boolean {
  switch (entity.type) {
    case 'city':
      return ev.locationCellIndex === entity.cellIndex || ev.targetCellIndex === entity.cellIndex;
    case 'country':
      return ev.initiatorId === entity.countryIndex || ev.targetId === entity.countryIndex;
    case 'empire':
      if (!empireMembers) return false;
      return empireMembers.has(ev.initiatorId) || (ev.targetId != null && empireMembers.has(ev.targetId));
  }
}

export function EventsTab({ historyData, selectedYear, onNavigate, selectedEntity, onSelectEntity }: EventsTabProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Resolve empire members for filtering (if entity is an empire)
  const empireMembers = useMemo(() => {
    if (!selectedEntity || selectedEntity.type !== 'empire') return undefined;
    const snapYear = selectedEntity.snapshotYear;
    const empSnap = historyData.empireSnapshots[snapYear];
    const entry = empSnap?.find(e => e.empireId === selectedEntity.empireId);
    if (!entry) return undefined;
    return new Set(entry.memberCountryIndices);
  }, [selectedEntity, historyData.empireSnapshots]);

  // Collect all events up to selectedYear, with a population summary at the end of each year
  const cumulativeEvents = useMemo(() => {
    const result: { year: number; event: HistoryEvent }[] = [];
    for (const yearData of historyData.years) {
      if (yearData.year > selectedYear) break;
      for (const ev of yearData.events) {
        if (selectedEntity && !eventMatchesEntity(ev, selectedEntity, empireMembers)) continue;
        result.push({ year: yearData.year, event: ev });
      }
      // Only show population summaries when not filtering
      if (!selectedEntity) {
        result.push({
          year: yearData.year,
          event: {
            type: 'POPULATION' as HistoryEvent['type'],
            year: yearData.year,
            initiatorId: -1,
            description: `World population: ${formatPopulation(yearData.worldPopulation)}`,
          },
        });
      }
    }
    return result;
  }, [historyData.years, selectedYear, selectedEntity, empireMembers]);

  // Scroll event list to bottom when year changes. `block: 'nearest'` keeps
  // the scroll contained to the inner list — without it the nested-flex
  // layout inside UnifiedOverlay can cause the page itself to scroll.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedYear]);

  // Resolve a display name for the filter banner
  const filterLabel = useMemo(() => {
    if (!selectedEntity) return null;
    if (selectedEntity.type === 'city') {
      return `City #${selectedEntity.cellIndex}`;
    }
    if (selectedEntity.type === 'country') {
      return historyData.countries[selectedEntity.countryIndex]?.name ?? `Country #${selectedEntity.countryIndex}`;
    }
    // Empire — find name from snapshot
    const snapYear = selectedEntity.snapshotYear;
    const empSnap = historyData.empireSnapshots[snapYear];
    const entry = empSnap?.find(e => e.empireId === selectedEntity.empireId);
    return entry?.name ?? `Empire`;
  }, [selectedEntity, historyData]);

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Events</span>
        <span style={styles.miniCount}>
          {cumulativeEvents.length} events &middot; Year {selectedYear}
        </span>
      </div>

      {filterLabel && (
        <div style={styles.filterBanner}>
          <span>Filtered: <strong>{filterLabel}</strong></span>
          {onSelectEntity && (
            <button style={styles.filterClearBtn} onClick={() => onSelectEntity(null)}>
              Show all
            </button>
          )}
        </div>
      )}

      <div style={styles.logList}>
        {cumulativeEvents.length === 0 ? (
          <div style={styles.noEvents}>No events yet.</div>
        ) : (
          cumulativeEvents.map((item, i) => {
            const color = EVENT_COLORS[item.event.type] ?? '#888888';
            const locatable = onNavigate && item.event.locationCellIndex != null;
            return (
              <div
                key={i}
                style={{
                  ...styles.logEvent,
                  borderLeft: `3px solid ${color}`,
                  background: item.year === selectedYear
                    ? `${color}22`
                    : `${color}0d`,
                  ...(locatable ? styles.logEventClickable : {}),
                }}
                onClick={locatable ? () => onNavigate([item.event.locationCellIndex!], item.event.locationCellIndex!) : undefined}
              >
                <span style={styles.logYear}>Y{item.year}</span>
                <span style={styles.eventIcon}>{EVENT_ICONS[item.event.type] ?? '\u2022'}</span>
                <span style={styles.logDesc}>{item.event.description}</span>
              </div>
            );
          })
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    // Constrain to viewport so long histories don't push the overlay off
    // screen. The inner logList is the only scrollable child.
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
    fontSize: 11,
    color: '#7a5a30',
  },
  filterBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 6px',
    marginBottom: 4,
    background: '#f0e4c8',
    borderRadius: 3,
    fontSize: 10,
    color: '#5a3a10',
  },
  filterClearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 10,
    color: '#2060a0',
    textDecoration: 'underline',
    padding: 0,
  },
  // Event list (the only scrollable region inside EventsTab).
  logList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    paddingRight: 2,
  },
  noEvents: {
    fontSize: 12,
    color: '#9a7a50',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 16,
  },
  logEvent: {
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
    fontSize: 11,
    color: '#2a1a00',
    lineHeight: 1.4,
    padding: '2px 4px 2px 6px',
    borderRadius: 3,
  },
  logEventClickable: {
    cursor: 'pointer',
  },
  logYear: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 'bold',
    color: '#7a5a30',
    minWidth: 30,
  },
  eventIcon: {
    flexShrink: 0,
    fontSize: 12,
  },
  logDesc: {
    flex: 1,
  },
};
