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

const INTERNAL_SIZE = 1000;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_BUTTON_FACTOR = 1.5;
const WHEEL_FACTOR = 1.15;

interface Transform { x: number; y: number; scale: number }

function getTouchDist(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMid(t1: Touch, t2: Touch) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

// Keep map covering the full canvas: scale ∈ [1, MAX_SCALE], pan limited so the
// map (INTERNAL_SIZE × scale wide) never reveals the cream backdrop's dark void.
function clampTransform(t: Transform): Transform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale));
  const minPan = INTERNAL_SIZE * (1 - scale);
  return {
    scale,
    x: Math.max(minPan, Math.min(0, t.x)),
    y: Math.max(minPan, Math.min(0, t.y)),
  };
}

// Zoom around an anchor point given in INTERNAL coordinates (0..INTERNAL_SIZE).
function zoomAround(prev: Transform, anchorX: number, anchorY: number, factor: number): Transform {
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
  // The world point under the anchor must stay under the anchor on screen.
  // screen = scale * world + pan  →  world = (anchor - pan) / scale
  // After zoom: newPan = anchor - world * newScale
  const worldX = (anchorX - prev.x) / prev.scale;
  const worldY = (anchorY - prev.y) / prev.scale;
  return clampTransform({
    scale: newScale,
    x: anchorX - worldX * newScale,
    y: anchorY - worldY * newScale,
  });
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

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;

  const wheelRafRef = useRef<number | null>(null);
  const isPinchingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastTouchDistRef = useRef(0);
  const lastTouchMidRef = useRef({ x: 0, y: 0 });
  const lastPanRef = useRef({ x: 0, y: 0 });
  const isMouseDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Generate map data (and (re)size the backing canvas) when the source inputs change.
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const dpr = window.devicePixelRatio || 1;
    const availableW = window.innerWidth - 48;
    const availableH = window.innerHeight - 116;
    const displaySize = Math.max(200, Math.min(INTERNAL_SIZE, availableW, availableH));

    canvas.width = INTERNAL_SIZE * dpr;
    canvas.height = INTERNAL_SIZE * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;

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

    // Reset zoom whenever a fresh map is generated.
    setTransform(prev =>
      (prev.x === 0 && prev.y === 0 && prev.scale === 1) ? prev : { x: 0, y: 0, scale: 1 }
    );
  }, [isOpen, seed, cityName, environment]);

  // Re-render whenever the transform or render-time toggles change. Cheap
  // because no regeneration runs — just renderCityMapV2 over cached data.
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !mapDataRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(
      dpr * transform.scale, 0, 0, dpr * transform.scale,
      dpr * transform.x, dpr * transform.y,
    );
    renderCityMapV2(ctx, mapDataRef.current, environment, seed, cityName, showIcons, showLabels);
  }, [isOpen, transform, showIcons, showLabels, environment, seed, cityName]);

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

  // Convert viewport client coords → map coords (0..INTERNAL_SIZE), accounting
  // for the current zoom transform so hit-testing works at any zoom level.
  const toMapCoords = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const naturalX = (clientX - rect.left) * (INTERNAL_SIZE / rect.width);
    const naturalY = (clientY - rect.top) * (INTERNAL_SIZE / rect.height);
    const t = transformRef.current;
    return [(naturalX - t.x) / t.scale, (naturalY - t.y) / t.scale];
  }, []);

  // Return the district info under the given client position, or null.
  const hitTest = useCallback((clientX: number, clientY: number): { name: string; role: string } | null => {
    const coords = toMapCoords(clientX, clientY);
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
  }, [toMapCoords]);

  // Convert client (x, y) on the canvas → natural canvas coords (pre-zoom).
  const clientToNatural = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return [
      (clientX - rect.left) * (INTERNAL_SIZE / rect.width),
      (clientY - rect.top) * (INTERNAL_SIZE / rect.height),
    ];
  }, []);

  // Wheel zoom around cursor. Non-passive listener so we can preventDefault to
  // suppress browser-level page scroll while the cursor is over the map.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const anchor = clientToNatural(e.clientX, e.clientY);
        if (!anchor) return;
        const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
        setTransform(prev => zoomAround(prev, anchor[0], anchor[1], factor));
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [isOpen, clientToNatural]);

  // Touch: pinch-to-zoom (two fingers), single-finger pan when zoomed in.
  // Non-passive so we can preventDefault and override browser pinch zoom.
  // Also rolls in the tooltip behavior so the React handlers don't double-fire.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;

    const showTooltipFor = (clientX: number, clientY: number) => {
      if (showLabelsRef.current) return;
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
      const hit = hitTest(clientX, clientY);
      setTooltip(hit ? { ...hit, x: clientX, y: clientY - 68 } : null);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        isPinchingRef.current = true;
        isPanningRef.current = false;
        lastTouchDistRef.current = getTouchDist(e.touches[0], e.touches[1]);
        lastTouchMidRef.current = getTouchMid(e.touches[0], e.touches[1]);
        setTooltip(null);
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current);
          tooltipTimerRef.current = null;
        }
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (transformRef.current.scale > MIN_SCALE) {
          isPanningRef.current = true;
          lastPanRef.current = { x: touch.clientX, y: touch.clientY };
        }
        showTooltipFor(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const conv = INTERNAL_SIZE / rect.width;
      if (e.touches.length === 2 && isPinchingRef.current) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const newMid = getTouchMid(e.touches[0], e.touches[1]);
        const factor = newDist / (lastTouchDistRef.current || newDist);
        const anchorX = (lastTouchMidRef.current.x - rect.left) * conv;
        const anchorY = (lastTouchMidRef.current.y - rect.top) * conv;
        const dxNatural = (newMid.x - lastTouchMidRef.current.x) * conv;
        const dyNatural = (newMid.y - lastTouchMidRef.current.y) * conv;
        setTransform(prev => {
          const zoomed = zoomAround(prev, anchorX, anchorY, factor);
          return clampTransform({
            scale: zoomed.scale,
            x: zoomed.x + dxNatural,
            y: zoomed.y + dyNatural,
          });
        });
        lastTouchDistRef.current = newDist;
        lastTouchMidRef.current = newMid;
      } else if (e.touches.length === 1 && isPanningRef.current) {
        e.preventDefault();
        const touch = e.touches[0];
        const dxNatural = (touch.clientX - lastPanRef.current.x) * conv;
        const dyNatural = (touch.clientY - lastPanRef.current.y) * conv;
        lastPanRef.current = { x: touch.clientX, y: touch.clientY };
        setTransform(prev => clampTransform({
          scale: prev.scale,
          x: prev.x + dxNatural,
          y: prev.y + dyNatural,
        }));
        // Suppress tooltip while actively dragging.
        setTooltip(null);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isPinchingRef.current = false;
        isPanningRef.current = false;
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = setTimeout(() => setTooltip(null), 2000);
      } else if (e.touches.length === 1 && isPinchingRef.current) {
        // Pinch → potential pan as the second finger lifts.
        isPinchingRef.current = false;
        if (transformRef.current.scale > MIN_SCALE) {
          isPanningRef.current = true;
          lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isOpen, hitTest]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDraggingRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const conv = INTERNAL_SIZE / rect.width;
      const dxNatural = (e.clientX - lastMouseRef.current.x) * conv;
      const dyNatural = (e.clientY - lastMouseRef.current.y) * conv;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setTransform(prev => clampTransform({
        scale: prev.scale,
        x: prev.x + dxNatural,
        y: prev.y + dyNatural,
      }));
      return;
    }
    if (showLabels) return;
    const hit = hitTest(e.clientX, e.clientY);
    setTooltip(hit ? { ...hit, x: e.clientX, y: e.clientY - 44 } : null);
  }, [showLabels, hitTest]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Left-click drag pans when zoomed in; middle-click always pans.
    if (e.button === 1 || (e.button === 0 && transformRef.current.scale > MIN_SCALE)) {
      e.preventDefault();
      isMouseDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setTooltip(null);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isMouseDraggingRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    isMouseDraggingRef.current = false;
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform(prev => zoomAround(prev, INTERNAL_SIZE / 2, INTERNAL_SIZE / 2, ZOOM_BUTTON_FACTOR));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform(prev => zoomAround(prev, INTERNAL_SIZE / 2, INTERNAL_SIZE / 2, 1 / ZOOM_BUTTON_FACTOR));
  }, []);

  const handleZoomReset = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
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
            <div style={styles.canvasFrame}>
              <canvas
                ref={canvasRef}
                style={{
                  ...styles.canvas,
                  cursor: transform.scale > MIN_SCALE ? (isMouseDraggingRef.current ? 'grabbing' : 'grab') : 'default',
                }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
              <div style={styles.zoomControls}>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomIn}
                  disabled={transform.scale >= MAX_SCALE}
                  title="Zoom in"
                >+</button>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomReset}
                  disabled={transform.scale === 1 && transform.x === 0 && transform.y === 0}
                  title="Reset zoom"
                >⌂</button>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomOut}
                  disabled={transform.scale <= MIN_SCALE}
                  title="Zoom out"
                >−</button>
              </div>
            </div>
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
  canvasFrame: {
    position: 'relative',
    display: 'inline-block',
    lineHeight: 0,
  },
  canvas: {
    borderRadius: 3,
    display: 'block',
    touchAction: 'none',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    zIndex: 2,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 16,
    color: '#3a1a00',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    padding: 0,
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
