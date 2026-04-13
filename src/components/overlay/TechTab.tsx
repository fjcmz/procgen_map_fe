import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryData, HistoryEvent, TechField } from '../../lib/types';
import { TECH_FIELD_COLORS, TECH_FIELD_LABELS } from './eventStyles';
import { formatYear } from '../Timeline';

interface TechTabProps {
  historyData: HistoryData;
  selectedYear: number;
  convertYears: boolean;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

// Fixed vertical real estate — the spec calls for 120–160 px; 140 leaves
// room for the Y-axis labels without dominating the overlay.
const TECH_CHART_HEIGHT = 140;

// Plot-area padding. Left/bottom are wider than the old parked sub-panel's
// 2px so the axis labels have somewhere to sit.
const PAD_L = 28;
const PAD_R = 6;
const PAD_T = 6;
const PAD_B = 16;

/** Icon per discoverer (illustrate) type. */
const DISCOVERER_ICONS: Record<string, string> = {
  science: '\uD83D\uDD2D',     // telescope
  military: '\u2694\uFE0F',     // swords
  philosophy: '\uD83D\uDCDC',   // scroll
  industry: '\u2699\uFE0F',     // gear
  religion: '\u2626\uFE0F',     // orthodox cross
  art: '\uD83C\uDFA8',          // palette
};

export function TechTab({ historyData, selectedYear, convertYears, onNavigate }: TechTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Seeded synchronously from the container's clientWidth on first render
  // so the canvas doesn't flash empty before the ResizeObserver fires.
  const [chartWidth, setChartWidth] = useState<number>(() => 240);

  // Observe the container and push the inner width into state. The effect
  // runs once on mount (stable dependency list); cleanup disconnects.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Prime with the current width in case it's not 240.
    setChartWidth(Math.max(120, el.clientWidth));
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setChartWidth(Math.max(120, Math.floor(w)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw polylines + axis labels + year cursor in a single effect. Same
  // single-canvas design as the original `Timeline.tsx` sub-panel: a full
  // redraw on every year change is sub-millisecond for 9 × 5000-year
  // Uint8Arrays, so there's no need to split the cursor into its own layer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const timeline = historyData.techTimeline;
    if (!timeline) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = chartWidth;
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

    // Compute Y-axis max across all fields. Running max is monotonic, so
    // only the last cell of each field's array can be the peak. Floor at 1
    // to avoid divide-by-zero on empty histories.
    let yMax = 1;
    for (const field of Object.keys(timeline.byField) as TechField[]) {
      const arr = timeline.byField[field];
      const peak = arr.length > 0 ? arr[arr.length - 1] : 0;
      if (peak > yMax) yMax = peak;
    }

    const plotW = Math.max(1, w - PAD_L - PAD_R);
    const plotH = Math.max(1, h - PAD_T - PAD_B);

    const xForYear = (y: number) =>
      PAD_L + (numYears <= 1 ? 0 : (y / (numYears - 1)) * plotW);
    const yForLevel = (lvl: number) => PAD_T + plotH - (lvl / yMax) * plotH;

    // Axis frame — subtle box around the plot area.
    ctx.strokeStyle = 'rgba(90,58,16,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW, plotH);

    // Polylines — one per field, stable order matching TECH_FIELD_COLORS
    // so the legend lines up with the chart.
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    for (const field of Object.keys(TECH_FIELD_COLORS) as TechField[]) {
      const arr = timeline.byField[field];
      if (!arr || arr.length === 0) continue;
      ctx.strokeStyle = TECH_FIELD_COLORS[field];
      ctx.beginPath();
      const end = Math.min(arr.length, selectedYear + 1);
      ctx.moveTo(xForYear(0), yForLevel(arr[0]));
      for (let i = 1; i < end; i++) {
        ctx.lineTo(xForYear(i), yForLevel(arr[i]));
      }
      ctx.stroke();
    }

    // Axis labels — drawn AFTER the polylines so they sit on top of any
    // stray line ends that brush against the frame, but BEFORE the cursor
    // so the cursor stays on top of everything.
    ctx.fillStyle = '#5a3a10';
    ctx.font = '10px Georgia, serif';
    ctx.textBaseline = 'middle';
    // Y-axis: peak level at top, "0" at bottom.
    ctx.textAlign = 'right';
    ctx.fillText(String(yMax), PAD_L - 4, PAD_T + 4);
    ctx.fillText('0', PAD_L - 4, PAD_T + plotH - 2);
    // X-axis: "Y0" at left, "Y{max}" at right.
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatYear(historyData.startOfTime, 0, convertYears), PAD_L, PAD_T + plotH + 3);
    ctx.textAlign = 'right';
    ctx.fillText(formatYear(historyData.startOfTime, numYears - 1, convertYears), PAD_L + plotW, PAD_T + plotH + 3);

    // Year cursor — vertical line at selectedYear, drawn last so it stays
    // on top of the polylines and axis labels.
    const cursorX = xForYear(Math.max(0, Math.min(numYears - 1, selectedYear)));
    ctx.strokeStyle = 'rgba(58,26,0,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX + 0.5, PAD_T);
    ctx.lineTo(cursorX + 0.5, PAD_T + plotH);
    ctx.stroke();
  }, [historyData.techTimeline, historyData.numYears, historyData.startOfTime, selectedYear, chartWidth, convertYears]);

  const logEndRef = useRef<HTMLDivElement>(null);

  // Peak-level readout for the mini-header — matches the yMax derivation
  // inside the draw effect so the number in the header always matches the
  // top of the Y-axis.
  const peakLevel = (() => {
    const timeline = historyData.techTimeline;
    if (!timeline) return 0;
    let peak = 0;
    const idx = Math.min(selectedYear, historyData.numYears - 1);
    for (const field of Object.keys(timeline.byField) as TechField[]) {
      const arr = timeline.byField[field];
      const val = idx >= 0 && idx < arr.length ? arr[idx] : 0;
      if (val > peak) peak = val;
    }
    return peak;
  })();

  // Collect TECH and TECH_LOSS events up to selectedYear for the discovery log.
  const techEvents = useMemo(() => {
    const result: { year: number; event: HistoryEvent }[] = [];
    for (const yearData of historyData.years) {
      if (yearData.year > selectedYear) break;
      for (const ev of yearData.events) {
        if (ev.type === 'TECH' || ev.type === 'TECH_LOSS') {
          result.push({ year: yearData.year, event: ev });
        }
      }
    }
    return result;
  }, [historyData.years, selectedYear]);

  // Auto-scroll event list to bottom on year change.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedYear]);

  return (
    <div ref={containerRef} style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Tech</span>
        <span style={styles.miniCount}>
          Peak Lvl {peakLevel} &middot; {techEvents.length} discoveries &middot; {formatYear(historyData.startOfTime, selectedYear, convertYears)}
        </span>
      </div>

      <div style={styles.legend}>
        {(Object.keys(TECH_FIELD_COLORS) as TechField[]).map(field => (
          <span key={field} style={styles.legendItem}>
            <span
              style={{
                ...styles.swatch,
                background: TECH_FIELD_COLORS[field],
              }}
            />
            {TECH_FIELD_LABELS[field]}
          </span>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        style={{
          ...styles.canvas,
          width: chartWidth,
          height: TECH_CHART_HEIGHT,
        }}
      />

      <div style={styles.eventList}>
        {techEvents.length === 0 ? (
          <div style={styles.noEvents}>No tech discoveries yet.</div>
        ) : (
          techEvents.map((item, i) => {
            const ev = item.event;
            const fieldColor = ev.field
              ? TECH_FIELD_COLORS[ev.field as TechField] ?? '#888'
              : '#888';
            const locatable = onNavigate && ev.locationCellIndex != null;
            const discovererIcon = ev.discovererType
              ? DISCOVERER_ICONS[ev.discovererType] ?? '\u2022'
              : null;
            const isTechLoss = ev.type === 'TECH_LOSS';

            return (
              <div
                key={i}
                style={{
                  ...styles.eventRow,
                  borderLeft: `3px solid ${isTechLoss ? '#a04040' : fieldColor}`,
                  background: item.year === selectedYear
                    ? `${fieldColor}22`
                    : `${fieldColor}0d`,
                  ...(locatable ? styles.eventRowClickable : {}),
                }}
                onClick={locatable ? () => onNavigate([ev.locationCellIndex!], ev.locationCellIndex!) : undefined}
              >
                <span style={styles.eventYear}>
                  {formatYear(historyData.startOfTime, item.year, convertYears)}
                </span>
                <span style={{ ...styles.eventField, color: fieldColor }}>
                  {isTechLoss ? '\uD83D\uDCDA' : '\uD83D\uDD2C'}
                </span>
                <span style={styles.eventBody}>
                  {isTechLoss ? (
                    <span style={styles.techLossText}>{ev.description}</span>
                  ) : (
                    <>
                      <span style={styles.eventName}>
                        {ev.displayName ?? `${ev.field} L${ev.level}`}
                      </span>
                      {ev.field && (
                        <span style={{ ...styles.eventFieldLabel, color: fieldColor }}>
                          {' '}{TECH_FIELD_LABELS[ev.field as TechField] ?? ev.field} L{ev.level}
                        </span>
                      )}
                      {ev.countryName && (
                        <span style={styles.eventCountry}> — {ev.countryName}</span>
                      )}
                      {discovererIcon && ev.discovererType && (
                        <div style={styles.discovererRow}>
                          <span style={styles.discovererIcon}>{discovererIcon}</span>
                          <span style={styles.discovererDetail}>
                            {ev.discovererType} figure
                            {ev.discovererCityName && <> from <strong>{ev.discovererCityName}</strong></>}
                            {ev.discovererBirthYear != null && (
                              <>, born {formatYear(0, ev.discovererBirthYear, convertYears)}</>
                            )}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </span>
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
    gap: 6,
    maxHeight: 'calc(100vh - 180px)',
    overflow: 'hidden',
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
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
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: '3px 8px',
    fontSize: 10,
    color: '#5a3a10',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  swatch: {
    display: 'inline-block',
    width: 9,
    height: 9,
    borderRadius: 2,
    border: '1px solid rgba(58,26,0,0.4)',
  },
  canvas: {
    display: 'block',
    border: '1px solid #8b6040',
    borderRadius: 3,
    flexShrink: 0,
  },
  eventList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingRight: 2,
    borderTop: '1px solid #d4b896',
    paddingTop: 6,
  },
  noEvents: {
    fontSize: 11,
    color: '#9a7a50',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 12,
  },
  eventRow: {
    display: 'flex',
    gap: 5,
    alignItems: 'flex-start',
    fontSize: 10,
    color: '#2a1a00',
    lineHeight: 1.4,
    padding: '2px 4px 2px 5px',
    borderRadius: 3,
  },
  eventRowClickable: {
    cursor: 'pointer',
  },
  eventYear: {
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 'bold',
    color: '#7a5a30',
    minWidth: 44,
  },
  eventField: {
    flexShrink: 0,
    fontSize: 11,
  },
  eventBody: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.4,
  },
  eventName: {
    fontWeight: 'bold',
    color: '#2a1a00',
  },
  eventFieldLabel: {
    fontSize: 9,
    fontWeight: 'normal',
  },
  eventCountry: {
    color: '#5a3a10',
    fontSize: 10,
  },
  discovererRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 1,
  },
  discovererIcon: {
    fontSize: 10,
    flexShrink: 0,
  },
  discovererDetail: {
    color: '#7a5a30',
    fontSize: 9,
    fontStyle: 'italic',
  },
  techLossText: {
    color: '#804040',
    fontStyle: 'italic',
    fontSize: 10,
  },
};
