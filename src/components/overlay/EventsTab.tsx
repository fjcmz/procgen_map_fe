import { useEffect, useMemo, useRef } from 'react';
import type { HistoryData, HistoryEvent } from '../../lib/types';
import { formatPopulation } from '../Timeline';

interface EventsTabProps {
  historyData: HistoryData;
  selectedYear: number;
}

const EVENT_ICONS: Record<string, string> = {
  WAR: '\u2694\uFE0F',
  CONQUEST: '\uD83C\uDFF4',
  MERGE: '\uD83E\uDD1D',
  COLLAPSE: '\uD83D\uDC80',
  EXPANSION: '\uD83D\uDCCD',
  FOUNDATION: '\uD83C\uDFD7\uFE0F',
  CONTACT: '\uD83D\uDCE8',
  COUNTRY: '\uD83C\uDFDB\uFE0F',
  ILLUSTRATE: '\u2B50',
  WONDER: '\uD83C\uDFDB',
  RELIGION: '\u2626\uFE0F',
  TRADE: '\uD83D\uDCB0',
  CATACLYSM: '\uD83C\uDF0B',
  TECH: '\uD83D\uDD2C',
  TECH_LOSS: '\uD83D\uDCDA',
  EMPIRE: '\uD83D\uDC51',
  POPULATION: '\uD83D\uDC65',
};

const EVENT_COLORS: Record<string, string> = {
  WAR: '#c03020',
  CONQUEST: '#803020',
  MERGE: '#606060',
  COLLAPSE: '#404040',
  EXPANSION: '#407040',
  FOUNDATION: '#c07820',
  CONTACT: '#4080c0',
  COUNTRY: '#6040b0',
  ILLUSTRATE: '#a0a000',
  WONDER: '#d4a800',
  RELIGION: '#8040a0',
  TRADE: '#20a040',
  CATACLYSM: '#d03010',
  TECH: '#208080',
  TECH_LOSS: '#a04040',
  EMPIRE: '#c08000',
  POPULATION: '#5a7a5a',
};

export function EventsTab({ historyData, selectedYear }: EventsTabProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Collect all events up to selectedYear, with a population summary at the end of each year
  const cumulativeEvents = useMemo(() => {
    const result: { year: number; event: HistoryEvent }[] = [];
    for (const yearData of historyData.years) {
      if (yearData.year > selectedYear) break;
      for (const ev of yearData.events) {
        result.push({ year: yearData.year, event: ev });
      }
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
    return result;
  }, [historyData.years, selectedYear]);

  // Scroll event list to bottom when year changes. `block: 'nearest'` keeps
  // the scroll contained to the inner list — without it the nested-flex
  // layout inside UnifiedOverlay can cause the page itself to scroll.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedYear]);

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Events</span>
        <span style={styles.miniCount}>
          {cumulativeEvents.length} events &middot; Year {selectedYear}
        </span>
      </div>

      <div style={styles.logList}>
        {cumulativeEvents.length === 0 ? (
          <div style={styles.noEvents}>No events yet.</div>
        ) : (
          cumulativeEvents.map((item, i) => {
            const color = EVENT_COLORS[item.event.type] ?? '#888888';
            return (
              <div
                key={i}
                style={{
                  ...styles.logEvent,
                  borderLeft: `3px solid ${color}`,
                  background: item.year === selectedYear
                    ? `${color}22`
                    : `${color}0d`,
                }}
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
