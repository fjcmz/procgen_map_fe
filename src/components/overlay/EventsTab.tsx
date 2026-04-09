import { useEffect, useMemo, useRef } from 'react';
import type { HistoryData, HistoryEvent, TechField } from '../../lib/types';
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

// TODO(Phase 3): move to TechTab — the per-field tech chart is parked here
// while Phase 3 promotes it to its own dedicated tab. The constants, drawing
// effect, and JSX block below should all migrate together.
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

export function EventsTab({ historyData, selectedYear }: EventsTabProps) {
  const techChartRef = useRef<HTMLCanvasElement>(null);
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

  // TODO(Phase 3): move to TechTab — draw the per-field tech chart. Same
  // single-canvas design as the original Timeline sub-panel: polylines and
  // year cursor are rendered in one effect because the chart is small
  // enough that a full redraw on every year change is sub-millisecond.
  useEffect(() => {
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
  }, [historyData.techTimeline, historyData.numYears, selectedYear]);

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Events</span>
        <span style={styles.miniCount}>
          {cumulativeEvents.length} events &middot; Year {selectedYear}
        </span>
      </div>

      {/* TODO(Phase 3): move to TechTab — tech chart sub-panel is parked
          here so the chart keeps rendering while Phase 3 is pending. Sits
          OUTSIDE the scrollable logList so logEndRef.scrollIntoView doesn't
          push the chart off screen on every play tick. */}
      {historyData.techTimeline && (
        <div style={styles.techPanel}>
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
        </div>
      )}

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
  // TODO(Phase 3): move to TechTab — styles below this point belong to the
  // parked tech sub-panel and should migrate together.
  techPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBottom: 8,
    marginBottom: 6,
    borderBottom: '1px solid #d4b896',
    flexShrink: 0,
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
