import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, Season } from '../lib/types';
import { render } from '../lib/renderer';

interface MapCanvasProps {
  mapData: MapData | null;
  layers: LayerVisibility;
  seed: string;
  selectedYear?: number;
  mapView?: MapView;
  politicalMode?: PoliticalMode;
  season?: Season;
  highlightCells?: number[] | null;
  citySizesAtYear?: Uint8Array;
  onTransformChange?: (transform: Transform) => void;
  onCellClick?: (cellIndex: number) => void;
  onInteraction?: () => void;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  navigateTo: (mapX: number, mapY: number) => void;
}

function getTouchDist(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMid(t1: Touch, t2: Touch) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

/** Compute the minimum scale that fits the map vertically in the viewport. */
function minScaleFor(mapHeight: number): number {
  return window.innerHeight / mapHeight;
}

/** Wrap horizontal pan so the map repeats seamlessly, and clamp vertical pan. */
function constrainTransform(t: Transform, mapWidth: number, mapHeight: number): Transform {
  const vh = window.innerHeight;
  const scaledW = mapWidth * t.scale;
  const scaledH = mapHeight * t.scale;

  // Wrap x into (-scaledW, 0] range so the map always covers the viewport
  let x = t.x % scaledW;
  if (x > 0) x -= scaledW;

  // Clamp y: keep map filling the viewport vertically
  let y = t.y;
  if (scaledH <= vh) {
    // Map is shorter than viewport — center it
    y = (vh - scaledH) / 2;
  } else {
    // Map is taller than viewport — don't show beyond top or bottom
    y = Math.min(0, Math.max(vh - scaledH, y));
  }

  return { scale: t.scale, x, y };
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { mapData, layers, seed, selectedYear, mapView = 'terrain', politicalMode = 'countries', season = 0, highlightCells, citySizesAtYear, onTransformChange, onCellClick, onInteraction }: MapCanvasProps,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTouchDist = useRef(0);
  const lastTouchMid = useRef({ x: 0, y: 0 });

  const constrain = useCallback((t: Transform): Transform => {
    if (!mapData) return t;
    return constrainTransform(t, mapData.width, mapData.height);
  }, [mapData]);

  const zoomAround = useCallback((prev: Transform, cx: number, cy: number, factor: number): Transform => {
    const minS = mapData ? minScaleFor(mapData.height) : 0.1;
    const newScale = Math.min(10, Math.max(minS, prev.scale * factor));
    const contentX = (cx - prev.x) / prev.scale;
    const contentY = (cy - prev.y) / prev.scale;
    return constrain({ scale: newScale, x: cx - contentX * newScale, y: cy - contentY * newScale });
  }, [mapData, constrain]);

  // Reset to fit-to-screen when new mapData arrives
  useEffect(() => {
    if (!mapData) return;
    const fitScale = minScaleFor(mapData.height);
    setTransform(constrainTransform({ scale: fitScale, x: 0, y: 0 }, mapData.width, mapData.height));
  }, [mapData]);

  useImperativeHandle(ref, () => ({
    zoomIn() {
      setTransform(prev => zoomAround(prev, window.innerWidth / 2, window.innerHeight / 2, 1.5));
    },
    zoomOut() {
      setTransform(prev => zoomAround(prev, window.innerWidth / 2, window.innerHeight / 2, 1 / 1.5));
    },
    reset() {
      if (!mapData) return;
      const fitScale = minScaleFor(mapData.height);
      setTransform(constrainTransform({ scale: fitScale, x: 0, y: 0 }, mapData.width, mapData.height));
    },
    navigateTo(mapX: number, mapY: number) {
      setTransform(prev => {
        if (!mapData) return prev;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return constrainTransform(
          { scale: prev.scale, x: vw / 2 - mapX * prev.scale, y: vh / 2 - mapY * prev.scale },
          mapData.width,
          mapData.height,
        );
      });
    },
  }), [mapData, zoomAround]);

  // Notify parent of transform changes (for minimap viewport indicator)
  useEffect(() => {
    onTransformChange?.(transform);
  }, [transform, onTransformChange]);

  // Re-render at full canvas resolution using ctx transform whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark border for areas outside the map when panned/zoomed out
    ctx.fillStyle = '#2a1a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y);
    render(ctx, mapData, layers, seed, selectedYear, mapView, season, politicalMode, highlightCells ?? undefined, citySizesAtYear);
    ctx.resetTransform();
  }, [mapData, layers, seed, transform, selectedYear, mapView, politicalMode, season, highlightCells, citySizesAtYear]);

  // Wheel zoom centered on cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setTransform(prev => zoomAround(prev, e.clientX, e.clientY, factor));
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [zoomAround]);

  // Touch: pinch-to-zoom + single-finger pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        lastTouchDist.current = getTouchDist(e.touches[0], e.touches[1]);
        lastTouchMid.current = getTouchMid(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1) {
        lastTouchMid.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const newMid = getTouchMid(e.touches[0], e.touches[1]);
        const distFactor = newDist / lastTouchDist.current;
        setTransform(prev => {
          const zoomed = zoomAround(prev, lastTouchMid.current.x, lastTouchMid.current.y, distFactor);
          return constrain({
            ...zoomed,
            x: zoomed.x + (newMid.x - lastTouchMid.current.x),
            y: zoomed.y + (newMid.y - lastTouchMid.current.y),
          });
        });
        lastTouchDist.current = newDist;
        lastTouchMid.current = newMid;
      } else if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchMid.current.x;
        const dy = e.touches[0].clientY - lastTouchMid.current.y;
        lastTouchMid.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setTransform(prev => constrain({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
    };
  }, [zoomAround, constrain]);

  // Middle mouse button pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Left-click: resolve which cell was clicked and notify parent
      if (e.button === 0) {
        if (onCellClick && mapData) {
          const t = transformRef.current;
          const mapX = (e.clientX - t.x) / t.scale;
          const mapY = (e.clientY - t.y) / t.scale;
          // Brute-force nearest cell (fast for typical cell counts < 20K)
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < mapData.cells.length; i++) {
            const c = mapData.cells[i];
            const dx = c.x - mapX;
            const dy = c.y - mapY;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          if (bestIdx >= 0) onCellClick(bestIdx);
        } else {
          onInteraction?.();
        }
      }
      if (e.button !== 1) return;
      e.preventDefault();
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setTransform(prev => constrain({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 1) return;
      isPanning.current = false;
      canvas.style.cursor = '';
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [constrain, onInteraction, onCellClick, mapData]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        display: 'block',
        touchAction: 'none',
      }}
    />
  );
});
