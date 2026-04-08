import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type { HistoryData, HistoryEvent, TechField } from '../lib/types';
import { Draggable } from './Draggable';

interface TimelineProps {
  historyData: HistoryData;
  selectedYear: number;
  onYearChange: (year: number) => void;
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

// Spec stretch §5: per-field colors for the tech chart. Anchored on the
// existing EVENT_COLORS.TECH teal so the chart feels part of the same
// visual family. If a new TechField is ever added, this Record becomes a
// TypeScript error until the entry is filled in.
const TECH_FIELD_COLORS: Record<TechField, string> = {
  science: '#208080',     // teal (canonical tech color)
  military: '#c03020',    // red
  industry: '#d4a800',    // gold
  energy: '#e07020',      // orange
  growth: '#60a040',      // green
  exploration: '#4080c0', // blue
  biology: '#60c0a0',     // mint
  art: '#b060a0',         // magenta
  government: '#8060c0',  // purple
};

const TECH_FIELD_LABELS: Record<TechField, string> = {
  science: 'Sci',
  military: 'Mil',
  industry: 'Ind',
  energy: 'Eng',
  growth: 'Grw',
  exploration: 'Exp',
  biology: 'Bio',
  art: 'Art',
  government: 'Gov',
};

const TECH_CHART_WIDTH = 240;
const TECH_CHART_HEIGHT = 80;

const PLAY_INTERVAL_MS = 200;

function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(1)}K`;
  return String(pop);
}

export function Timeline({ historyData, selectedYear, onYearChange }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [techCollapsed, setTechCollapsed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const techChartRef = useRef<HTMLCanvasElement>(null);

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

  // Scroll event log to bottom when year changes
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedYear]);

  // Spec stretch §5: draw the per-field tech chart. A single canvas is
  // used for polylines + cursor — for a 240×80 canvas with 9 fields this
  // is well under 1ms per frame and vastly simpler than two stacked
  // canvases. Early-exit when the sub-panel is collapsed (the canvas is
  // not mounted) or no timeline data exists.
  useEffect(() => {
    if (techCollapsed) return;
    const canvas = techChartRef.current;
    if (!canvas) return;
    const timeline = historyData.techTimeline;
    if (!timeline) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = TECH_CHART_WIDTH;
    const h = TECH_CHART_HEIGHT;
    const numYears = historyData.numYears;

    // Device-pixel-ratio scaling for crisp lines on hidpi displays.
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(255,248,230,0.6)';
    ctx.fillRect(0, 0, w, h);

    // Compute Y-axis max across all fields/years — floor at 1 to avoid
    // divide-by-zero on empty histories (chart collapses to a flat line
    // at the bottom in that case).
    let yMax = 1;
    for (const field of Object.keys(timeline.byField) as TechField[]) {
      const arr = timeline.byField[field];
      // Running max is monotonic, so only the last cell can be the peak.
      const peak = arr.length > 0 ? arr[arr.length - 1] : 0;
      if (peak > yMax) yMax = peak;
    }

    // Chart padding (leaves room for the year cursor ticks at top/bottom).
    const padL = 2;
    const padR = 2;
    const padT = 4;
    const padB = 4;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const xForYear = (y: number) =>
      padL + (numYears <= 1 ? 0 : (y / (numYears - 1)) * plotW);
    const yForLevel = (lvl: number) => padT + plotH - (lvl / yMax) * plotH;

    // Draw polylines — one per field, in a stable order matching the
    // TECH_FIELD_COLORS definition so the legend lines up.
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    for (const field of Object.keys(TECH_FIELD_COLORS) as TechField[]) {
      const arr = timeline.byField[field];
      if (!arr || arr.length === 0) continue;
      ctx.strokeStyle = TECH_FIELD_COLORS[field];
      ctx.beginPath();
      ctx.moveTo(xForYear(0), yForLevel(arr[0]));
      for (let i = 1; i < arr.length; i++) {
        ctx.lineTo(xForYear(i), yForLevel(arr[i]));
      }
      ctx.stroke();
    }

    // Year cursor — vertical line at selectedYear.
    const cursorX = xForYear(Math.max(0, Math.min(numYears - 1, selectedYear)));
    ctx.strokeStyle = 'rgba(58,26,0,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX + 0.5, padT);
    ctx.lineTo(cursorX + 0.5, padT + plotH);
    ctx.stroke();
  }, [historyData.techTimeline, historyData.numYears, selectedYear, techCollapsed]);

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

  // Count living countries at selected year (countries founded on or before the selected year)
  const livingCount = historyData.countries.filter(c => c.isAlive).length;
  const totalCount = historyData.countries.length;

  // Count events at current year
  const currentYearEvents = cumulativeEvents.filter(e => e.year === selectedYear).length;

  // Get world population at current year
  const currentYearData = historyData.years.find(y => y.year === selectedYear);
  const worldPopulation = currentYearData?.worldPopulation ?? 0;

  return (
    <>
      {/* Bottom timeline controls */}
      <Draggable
        defaultPosition={{ bottom: 16, left: '50%' }}
        style={{ zIndex: 10 }}
        baseTransform="translateX(-50%)"
      >
        <div style={styles.panel}>
          <div style={styles.header} data-drag-handle>
            <span style={styles.title}>History</span>
            <span style={styles.info}>
              Year {selectedYear} / {maxYear} &middot; Pop: {formatPopulation(worldPopulation)} &middot; {livingCount}/{totalCount} nations &middot; {currentYearEvents} events
            </span>
            <button
              style={styles.logToggle}
              onClick={() => setLogOpen((o: boolean) => !o)}
              title={logOpen ? 'Hide event log' : 'Show event log'}
            >
              {logOpen ? 'Hide Log' : 'Show Log'}
            </button>
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

      {/* Side panel event log */}
      {logOpen && (
        <Draggable
          defaultPosition={{ top: 16, right: 16 }}
          style={{ zIndex: 10 }}
        >
          <div style={styles.logPanel}>
            <div style={styles.logHeader} data-drag-handle>
              <span style={styles.logTitle}>Event Log</span>
              <span style={styles.logCount}>{cumulativeEvents.length} events</span>
              <button
                style={styles.collapseBtn}
                onClick={() => setLogCollapsed(c => !c)}
                title={logCollapsed ? 'Expand' : 'Collapse'}
              >
                {logCollapsed ? '\u25BE' : '\u25B4'}
              </button>
            </div>
            {!logCollapsed && historyData.techTimeline && (
              <div style={styles.techPanel}>
                <div style={styles.techHeader}>
                  <span style={styles.techTitle}>Tech</span>
                  <button
                    style={styles.collapseBtn}
                    onClick={() => setTechCollapsed(c => !c)}
                    title={techCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {techCollapsed ? '\u25BE' : '\u25B4'}
                  </button>
                </div>
                {!techCollapsed && (
                  <>
                    <div style={styles.techLegend}>
                      {(Object.keys(TECH_FIELD_COLORS) as TechField[]).map(field => (
                        <span key={field} style={styles.techLegendItem}>
                          <span
                            style={{
                              ...styles.techSwatch,
                              background: TECH_FIELD_COLORS[field],
                            }}
                          />
                          {TECH_FIELD_LABELS[field]}
                        </span>
                      ))}
                    </div>
                    <canvas
                      ref={techChartRef}
                      style={{
                        ...styles.techCanvas,
                        width: TECH_CHART_WIDTH,
                        height: TECH_CHART_HEIGHT,
                      }}
                    />
                  </>
                )}
              </div>
            )}
            {!logCollapsed && (
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
            )}
          </div>
        </Draggable>
      )}
    </>
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
  logToggle: {
    background: 'none',
    border: '1px solid #8b6040',
    borderRadius: 4,
    padding: '2px 8px',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#5a3a10',
    cursor: 'pointer',
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
  // Side panel styles
  logPanel: {
    width: 300,
    maxHeight: 'calc(100vh - 120px)',
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 8,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#2a1a00',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    userSelect: 'none',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px 8px',
    borderBottom: '1px solid #d4b896',
    cursor: 'grab',
    touchAction: 'none',
    gap: 8,
  },
  logTitle: {
    fontWeight: 'bold',
    fontSize: 13,
    color: '#3a1a00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  logCount: {
    fontSize: 11,
    color: '#7a5a30',
    flex: 1,
    textAlign: 'right',
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#5a3a10',
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
  logList: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
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
  // Spec stretch §5: tech chart sub-panel — sits between logHeader and
  // logList (outside the scrollable region so logEndRef.scrollIntoView
  // doesn't push the chart off screen on every play tick).
  techPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '6px 10px 8px',
    borderBottom: '1px solid #d4b896',
    flexShrink: 0,
  },
  techHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  techTitle: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#3a1a00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  techLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '2px 6px',
    fontSize: 9,
    color: '#5a3a10',
  },
  techLegendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  techSwatch: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: 2,
    border: '1px solid rgba(58,26,0,0.4)',
  },
  techCanvas: {
    display: 'block',
    border: '1px solid #8b6040',
    borderRadius: 3,
  },
};
