import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CityEnvironment, CityMapDataV2, DistrictType } from '../lib/citymap';
import { generateCityMapV2, renderCityMapV2 } from '../lib/citymap';

interface CityMapPopupV2Props {
  isOpen: boolean;
  onClose: () => void;
  cityName: string;
  environment: CityEnvironment;
  seed: string;
}

// Mirrors NO_LABEL_ROLES in cityMapGeneratorV2.ts — roles excluded from labels.
const NO_LABEL_ROLES = new Set<string>([
  'slum', 'agricultural', 'dock', 'excluded',
]);

// Emoji icon + human-readable label for every coarse district type.
const DISTRICT_ROLE_INFO: Partial<Record<DistrictType, { icon: string; label: string }>> = {
  civic:               { icon: '🏛',  label: 'Civic Centre' },
  market:              { icon: '🛒',  label: 'Market' },
  harbor:              { icon: '⚓',  label: 'Harbour' },
  residential_high:    { icon: '🏘',  label: 'Wealthy Residential' },
  residential_medium:  { icon: '🏠',  label: 'Residential' },
  residential_low:     { icon: '🏚',  label: 'Poor Residential' },
  agricultural:        { icon: '🌾',  label: 'Fields' },
  slum:                { icon: '🏚',  label: 'Slums' },
  dock:                { icon: '⚓',  label: 'Docks' },
  industry:            { icon: '⚒️',  label: 'Industry Quarter' },
  education_faith:     { icon: '⛪',  label: 'Education & Faith' },
  military:            { icon: '⚔️',  label: 'Military Quarter' },
  trade:               { icon: '💰',  label: 'Trade Quarter' },
  entertainment:       { icon: '🎭',  label: 'Entertainment Quarter' },
  excluded:            { icon: '⚖️',  label: 'Excluded Zone' },
};

// Ray-casting point-in-polygon (unclosed ring, matching CityPolygon contract).
function pointInPolygon(px: number, py: number, verts: [number, number][]): boolean {
  let inside = false;
  const n = verts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function CityMapPopupV2({ isOpen, onClose, cityName, environment, seed }: CityMapPopupV2Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapDataRef = useRef<CityMapDataV2 | null>(null);
  // polygonId → { name, role } for labeled blocks only.
  const polygonToLabelRef = useRef(new Map<number, { name: string; role: string }>());
  const [showIcons, setShowIcons] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [tooltip, setTooltip] = useState<{ name: string; role: string; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Generate + render whenever inputs change.
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const internalSize = 1000;
    const availableW = window.innerWidth - 48;
    const availableH = window.innerHeight - 116;
    const displaySize = Math.max(200, Math.min(internalSize, availableW, availableH));

    canvas.width = internalSize * dpr;
    canvas.height = internalSize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    ctx.scale(dpr, dpr);

    const data = generateCityMapV2(seed, cityName, environment);
    mapDataRef.current = data;

    // Build polygon → { name, role } index for hover hit-testing.
    const pMap = new Map<number, { name: string; role: string }>();
    const landmarkPids = new Set(data.landmarks.map(lm => lm.polygonId));
    for (const block of data.blocks) {
      if (NO_LABEL_ROLES.has(block.role)) continue;
      if (block.polygonIds.some(pid => landmarkPids.has(pid))) continue;
      const entry = { name: block.name, role: block.role };
      for (const pid of block.polygonIds) pMap.set(pid, entry);
    }
    polygonToLabelRef.current = pMap;

    renderCityMapV2(ctx, data, environment, seed, cityName, showIcons, showLabels);
  }, [isOpen, seed, cityName, environment, showIcons, showLabels]);

  // Clear tooltip when labels are turned on or popup closes.
  useEffect(() => {
    if (showLabels || !isOpen) {
      setTooltip(null);
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    }
  }, [showLabels, isOpen]);

  // Keyboard escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Convert viewport client coords → internal canvas coords (0–1000 space).
  const toCanvasCoords = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return [
      (clientX - rect.left) * (1000 / rect.width),
      (clientY - rect.top) * (1000 / rect.height),
    ];
  }, []);

  // Return the district info under the given client position, or null.
  const hitTest = useCallback((clientX: number, clientY: number): { name: string; role: string } | null => {
    const coords = toCanvasCoords(clientX, clientY);
    if (!coords) return null;
    const data = mapDataRef.current;
    if (!data) return null;
    const [cx, cy] = coords;
    for (const polygon of data.polygons) {
      if (pointInPolygon(cx, cy, polygon.vertices)) {
        return polygonToLabelRef.current.get(polygon.id) ?? null;
      }
    }
    return null;
  }, [toCanvasCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (showLabels) return;
    const hit = hitTest(e.clientX, e.clientY);
    setTooltip(hit ? { ...hit, x: e.clientX, y: e.clientY - 44 } : null);
  }, [showLabels, hitTest]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  // Touch: show on finger-down, auto-hide 2 s after finger lifts.
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (showLabels) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (tooltipTimerRef.current) { clearTimeout(tooltipTimerRef.current); tooltipTimerRef.current = null; }
    const hit = hitTest(touch.clientX, touch.clientY);
    setTooltip(hit ? { ...hit, x: touch.clientX, y: touch.clientY - 68 } : null);
  }, [showLabels, hitTest]);

  const handleTouchEnd = useCallback(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => setTooltip(null), 2000);
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const roleInfo = tooltip ? (DISTRICT_ROLE_INFO[tooltip.role as DistrictType] ?? null) : null;

  return createPortal(
    <>
      <div style={styles.backdrop} onClick={handleBackdropClick}>
        <div style={styles.container}>
          <div style={styles.header}>
            <span style={styles.title}>{cityName}</span>
            <div style={styles.headerControls}>
              <label style={styles.iconToggle}>
                <input
                  type="checkbox"
                  checked={showIcons}
                  onChange={e => setShowIcons(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.iconToggleText}>Icons</span>
              </label>
              <label style={styles.iconToggle}>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={e => setShowLabels(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.iconToggleText}>Labels</span>
              </label>
              <button style={styles.closeBtn} onClick={onClose} title="Close">&times;</button>
            </div>
          </div>
          <div style={styles.canvasWrapper}>
            <canvas
              ref={canvasRef}
              style={styles.canvas}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            />
          </div>
          <div style={styles.footer}>
            <span style={styles.footerText}>
              {environment.size.charAt(0).toUpperCase() + environment.size.slice(1)}
              {environment.isCapital ? ' • Capital' : ''}
              {environment.isCoastal ? ' • Coastal' : ''}
              {environment.hasRiver ? ' • River' : ''}
              {environment.isRuin ? ' • Ruins' : ''}
            </span>
          </div>
        </div>
      </div>
      {!showLabels && tooltip && roleInfo && (
        <div style={{ ...styles.tooltip, left: tooltip.x, top: tooltip.y }}>
          <div style={styles.tooltipName}>{tooltip.name}</div>
          <div style={styles.tooltipRole}>{roleInfo.icon} {roleInfo.label}</div>
        </div>
      )}
    </>,
    document.body,
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 20, 10, 0.6)',
    zIndex: 10000,
    padding: '16px 12px',
    boxSizing: 'border-box',
  },
  container: {
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #d4b896',
    background: '#ecdbb8',
    borderRadius: '6px 6px 0 0',
    flexShrink: 0,
    gap: 8,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 15,
    color: '#3a1a00',
    letterSpacing: 0.5,
    fontFamily: 'Georgia, serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 1,
    minWidth: 0,
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  iconToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    userSelect: 'none',
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #c4a070',
    background: 'rgba(255,255,255,0.35)',
    transition: 'background 0.15s',
  },
  checkbox: {
    cursor: 'pointer',
    accentColor: '#8a6a3a',
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  iconToggleText: {
    fontSize: 11,
    color: '#5a3a10',
    fontFamily: 'sans-serif',
    letterSpacing: 0.3,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    color: '#7a5a30',
    padding: '4px 8px',
    lineHeight: 1,
    fontWeight: 'bold',
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  canvasWrapper: {
    padding: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    flexShrink: 1,
    minHeight: 0,
  },
  canvas: {
    borderRadius: 3,
    display: 'block',
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #d4b896',
    textAlign: 'center',
    flexShrink: 0,
  },
  footerText: {
    fontSize: 11,
    color: '#6a4a20',
    fontStyle: 'italic',
  },
  tooltip: {
    position: 'fixed',
    transform: 'translateX(-50%)',
    background: 'rgba(28, 18, 8, 0.93)',
    color: '#f0e0b8',
    fontFamily: "Georgia, 'Times New Roman', serif",
    padding: '6px 14px 8px',
    borderRadius: 5,
    border: '1px solid rgba(200, 155, 70, 0.55)',
    boxShadow: '0 3px 12px rgba(0,0,0,0.55)',
    pointerEvents: 'none',
    zIndex: 10001,
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 3,
  },
  tooltipRole: {
    fontSize: 11,
    color: '#c8a462',
    letterSpacing: 0.4,
  },
};
