import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryData, HistoryEvent, SelectedEntity } from '../../lib/types';
import { formatPopulation } from '../Timeline';
import { EVENT_ICONS, EVENT_COLORS, EVENT_TYPE_GROUPS } from './eventStyles';

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

function formatAbsYear(relYear: number, startOfTime: number): string {
  const abs = startOfTime + relYear;
  if (abs < 0) return `${-abs} BC`;
  return `${abs} AD`;
}

export function EventsTab({ historyData, selectedYear, onNavigate, selectedEntity, onSelectEntity }: EventsTabProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [filterExpanded, setFilterExpanded] = useState(false);

  const allFilterTypes: string[] = [...EVENT_TYPE_GROUPS.flatMap(g => g.types), 'POPULATION'];

  const toggleType = (type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

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
        if (hiddenTypes.size > 0 && hiddenTypes.has(ev.type)) continue;
        if (selectedEntity && !eventMatchesEntity(ev, selectedEntity, empireMembers)) continue;
        result.push({ year: yearData.year, event: ev });
      }
      // Only show population summaries when not filtering by entity
      if (!selectedEntity && !hiddenTypes.has('POPULATION')) {
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
  }, [historyData.years, selectedYear, selectedEntity, empireMembers, hiddenTypes]);

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
          {cumulativeEvents.length} events &middot; {formatAbsYear(selectedYear, historyData.startOfTime)}
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

      <div style={styles.typeFilterBar}>
        <button
          style={styles.typeFilterToggle}
          onClick={() => setFilterExpanded(e => !e)}
          title="Filter by event type"
        >
          {filterExpanded ? '\u25BE' : '\u25B8'} Filter
          {hiddenTypes.size > 0 && (
            <span style={styles.typeFilterBadge}>{hiddenTypes.size} hidden</span>
          )}
        </button>
        {filterExpanded && (
          <div style={styles.typeFilterIcons}>
            <span style={styles.typeFilterActions}>
              <button
                style={styles.typeFilterActionBtn}
                onClick={() => setHiddenTypes(new Set())}
                title="Show all event types"
              >
                All
              </button>
              <button
                style={styles.typeFilterActionBtn}
                onClick={() => setHiddenTypes(new Set(allFilterTypes))}
                title="Hide all event types"
              >
                None
              </button>
              <span style={styles.typeFilterSep} />
            </span>
            {EVENT_TYPE_GROUPS.map((group, gi) => (
              <span key={group.label} style={styles.typeFilterGroup}>
                {gi > 0 && <span style={styles.typeFilterSep} />}
                {group.types.map(type => {
                  const isHidden = hiddenTypes.has(type);
                  return (
                    <button
                      key={type}
                      style={{
                        ...styles.typeIconBtn,
                        opacity: isHidden ? 0.3 : 1,
                        background: isHidden ? 'transparent' : `${EVENT_COLORS[type]}22`,
                        borderColor: isHidden ? '#c0a070' : EVENT_COLORS[type],
                      }}
                      onClick={() => toggleType(type)}
                      title={`${isHidden ? 'Show' : 'Hide'} ${type.toLowerCase().replace('_', ' ')} events`}
                    >
                      {EVENT_ICONS[type]}
                    </button>
                  );
                })}
              </span>
            ))}
            <span style={styles.typeFilterGroup}>
              <span style={styles.typeFilterSep} />
              {(() => {
                const isHidden = hiddenTypes.has('POPULATION');
                return (
                  <button
                    style={{
                      ...styles.typeIconBtn,
                      opacity: isHidden ? 0.3 : 1,
                      background: isHidden ? 'transparent' : `${EVENT_COLORS['POPULATION']}22`,
                      borderColor: isHidden ? '#c0a070' : EVENT_COLORS['POPULATION'],
                    }}
                    onClick={() => toggleType('POPULATION')}
                    title={`${isHidden ? 'Show' : 'Hide'} population events`}
                  >
                    {EVENT_ICONS['POPULATION']}
                  </button>
                );
              })()}
            </span>
          </div>
        )}
      </div>

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
                <span style={styles.logYear}>{formatAbsYear(item.year, historyData.startOfTime)}</span>
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
  typeFilterBar: {
    marginBottom: 4,
  },
  typeFilterToggle: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 10,
    color: '#5a3a10',
    padding: '2px 0',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  typeFilterBadge: {
    fontSize: 9,
    color: '#a04040',
    fontWeight: 'normal',
    fontStyle: 'italic',
    textTransform: 'none' as const,
    letterSpacing: 0,
  },
  typeFilterIcons: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 2,
    marginTop: 3,
    padding: '3px 0',
  },
  typeFilterActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  typeFilterActionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 9,
    color: '#2060a0',
    textDecoration: 'underline',
    padding: '2px 0',
  },
  typeFilterGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
  },
  typeFilterSep: {
    display: 'inline-block',
    width: 1,
    height: 14,
    background: '#c0a070',
    margin: '0 2px',
  },
  typeIconBtn: {
    width: 22,
    height: 22,
    padding: 0,
    border: '1px solid #c0a070',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    lineHeight: '20px',
    textAlign: 'center' as const,
    transition: 'opacity 0.15s',
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
    minWidth: 48,
  },
  eventIcon: {
    flexShrink: 0,
    fontSize: 12,
  },
  logDesc: {
    flex: 1,
  },
};
