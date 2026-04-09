import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import type { HistoryData } from '../lib/types';
import { Draggable } from './Draggable';

interface TimelineProps {
  historyData: HistoryData;
  selectedYear: number;
  onYearChange: (year: number) => void;
}

const PLAY_INTERVAL_MS = 200;

export function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(1)}K`;
  return String(pop);
}

export function Timeline({ historyData, selectedYear, onYearChange }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const maxYear = historyData.numYears - 1;

  // Auto-play logic
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        onYearChange(selectedYear + 1);
      }, PLAY_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, selectedYear, onYearChange]);

  // Stop when reaching the end
  useEffect(() => {
    if (selectedYear >= maxYear && playing) {
      setPlaying(false);
    }
  }, [selectedYear, maxYear, playing]);

  const clampYear = useCallback((y: number) => Math.max(0, Math.min(maxYear, y)), [maxYear]);

  const step = useCallback((delta: number) => {
    setPlaying(false);
    onYearChange(clampYear(selectedYear + delta));
  }, [selectedYear, clampYear, onYearChange]);

  const togglePlay = useCallback(() => {
    if (selectedYear >= maxYear) {
      // Restart from 0 if at end
      onYearChange(0);
      setPlaying(true);
    } else {
      setPlaying((p: boolean) => !p);
    }
  }, [selectedYear, maxYear, onYearChange]);

  // Count living countries at selected year (countries founded on or before the selected year)
  const livingCount = historyData.countries.filter(c => c.isAlive).length;
  const totalCount = historyData.countries.length;

  // Get world population at current year
  const currentYearData = historyData.years.find(y => y.year === selectedYear);
  const worldPopulation = currentYearData?.worldPopulation ?? 0;

  return (
    <Draggable
      defaultPosition={{ bottom: 16, left: '50%' }}
      style={{ zIndex: 10 }}
      baseTransform="translateX(-50%)"
    >
      <div style={styles.panel}>
        <div style={styles.header} data-drag-handle>
          <span style={styles.title}>History</span>
          <span style={styles.info}>
            Year {selectedYear} / {maxYear} &middot; Pop: {formatPopulation(worldPopulation)} &middot; {livingCount}/{totalCount} nations
          </span>
        </div>

        <div style={styles.sliderRow}>
          <span style={styles.yearLabel}>0</span>
          <input
            type="range"
            min={0}
            max={maxYear}
            value={selectedYear}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPlaying(false);
              onYearChange(Number(e.target.value));
            }}
            style={styles.slider}
          />
          <span style={styles.yearLabel}>{maxYear}</span>
        </div>

        <div style={styles.controls}>
          <button style={styles.btn} onClick={() => step(-10)} title="Back 10 years">
            &laquo; 10
          </button>
          <button style={styles.btn} onClick={() => step(-1)} title="Back 1 year">
            &lsaquo; 1
          </button>
          <button style={{ ...styles.btn, ...styles.playBtn }} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? '\u23F8' : '\u25B6'}
          </button>
          <button style={styles.btn} onClick={() => step(1)} title="Forward 1 year">
            1 &rsaquo;
          </button>
          <button style={styles.btn} onClick={() => step(10)} title="Forward 10 years">
            10 &raquo;
          </button>
        </div>
      </div>
    </Draggable>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 520,
    maxWidth: 'calc(100vw - 32px)',
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 8,
    padding: '10px 16px',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#2a1a00',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    cursor: 'grab',
    touchAction: 'none',
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
    flex: 1,
    textAlign: 'center',
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
  controls: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    background: 'rgba(139,96,64,0.12)',
    border: '1px solid #8b6040',
    borderRadius: 4,
    padding: '4px 10px',
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#3a1a00',
    cursor: 'pointer',
    minWidth: 44,
    textAlign: 'center',
  },
  playBtn: {
    fontSize: 16,
    padding: '4px 14px',
    minWidth: 48,
    background: 'rgba(139,69,19,0.18)',
  },
};
