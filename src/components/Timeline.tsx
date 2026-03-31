import type { ChangeEvent } from 'react';
import type { HistoryData } from '../lib/types';

interface TimelineProps {
  historyData: HistoryData;
  selectedYear: number;
  onYearChange: (year: number) => void;
}

const EVENT_ICONS: Record<string, string> = {
  WAR: '⚔',
  CONQUEST: '🏴',
  MERGE: '🤝',
  COLLAPSE: '💀',
  EXPANSION: '📍',
};

export function Timeline({ historyData, selectedYear, onYearChange }: TimelineProps) {
  const yearData = historyData.years.find(y => y.year === selectedYear);
  const events = yearData?.events ?? [];

  // Count living vs total countries
  const livingCount = historyData.countries.filter(c => c.isAlive).length;
  const totalCount = historyData.countries.length;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>History</span>
        <span style={styles.info}>
          {livingCount}/{totalCount} kingdoms
        </span>
      </div>

      <div style={styles.sliderRow}>
        <span style={styles.yearLabel}>Year 0</span>
        <input
          type="range"
          min={0}
          max={historyData.numYears}
          value={selectedYear}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onYearChange(Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.yearLabel}>Year {historyData.numYears}</span>
      </div>

      <div style={styles.currentYear}>Year {selectedYear}</div>

      <div style={styles.eventList}>
        {events.length === 0 ? (
          <div style={styles.noEvents}>No notable events this year.</div>
        ) : (
          events.map((ev, i) => (
            <div key={i} style={styles.event}>
              <span style={styles.eventIcon}>{EVENT_ICONS[ev.type] ?? '•'}</span>
              <span>{ev.description}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 480,
    maxWidth: 'calc(100vw - 32px)',
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 8,
    padding: '12px 16px',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#2a1a00',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontWeight: 'bold',
    fontSize: 13,
    color: '#3a1a00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  info: {
    fontSize: 11,
    color: '#7a5a30',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  slider: {
    flex: 1,
    accentColor: '#8b4513',
    cursor: 'pointer',
  },
  yearLabel: {
    fontSize: 11,
    color: '#7a5a30',
    whiteSpace: 'nowrap',
  },
  currentYear: {
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 12,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventList: {
    maxHeight: 80,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  noEvents: {
    fontSize: 12,
    color: '#9a7a50',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  event: {
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
    fontSize: 12,
    color: '#2a1a00',
    lineHeight: 1.4,
  },
  eventIcon: {
    flexShrink: 0,
    fontSize: 12,
  },
};
