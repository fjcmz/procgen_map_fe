import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MapData, LayerVisibility } from '../lib/types';
import { render } from '../lib/renderer';

interface MapCanvasProps {
  mapData: MapData | null;
  layers: LayerVisibility;
  seed: string;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

function zoomAround(prev: Transform, cx: number, cy: number, factor: number): Transform {
  const newScale = Math.min(10, Math.max(0.1, prev.scale * factor));
  const contentX = (cx - prev.x) / prev.scale;
  const contentY = (cy - prev.y) / prev.scale;
  return { scale: newScale, x: cx - contentX * newScale, y: cy - contentY * newScale };
}

function getTouchDist(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMid(t1: Touch, t2: Touch) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { mapData, layers, seed }: MapCanvasProps,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTouchDist = useRef(0);
  const lastTouchMid = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    zoomIn() {
      setTransform(prev => zoomAround(prev, window.innerWidth / 2, window.innerHeight / 2, 1.5));
    },
    zoomOut() {
      setTransform(prev => zoomAround(prev, window.innerWidth / 2, window.innerHeight / 2, 1 / 1.5));
    },
    reset() {
      setTransform({ x: 0, y: 0, scale: 1 });
    },
  }));

  // Re-render at full canvas resolution using ctx transform whenever anything changes.
  // This avoids CSS-transform pixelation: the canvas always draws at native pixel density.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    // Canvas covers the viewport; sizing it here clears any stale pixels.
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark border for areas outside the map when panned/zoomed out
    ctx.fillStyle = '#2a1a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom/pan so the renderer draws in map-coordinate space,
    // which lands correctly at whatever zoom level we're at.
    ctx.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y);
    render(ctx, mapData, layers, seed);
    ctx.resetTransform();
  }, [mapData, layers, seed, transform]);

  // Wheel zoom centered on cursor — uses RAF to coalesce rapid scroll events
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
  }, []);

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
        // zoomAround the old midpoint, then shift by the pan delta
        setTransform(prev => {
          const zoomed = zoomAround(prev, lastTouchMid.current.x, lastTouchMid.current.y, distFactor);
          return { ...zoomed, x: zoomed.x + (newMid.x - lastTouchMid.current.x), y: zoomed.y + (newMid.y - lastTouchMid.current.y) };
        });
        lastTouchDist.current = newDist;
        lastTouchMid.current = newMid;
      } else if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchMid.current.x;
        const dy = e.touches[0].clientY - lastTouchMid.current.y;
        lastTouchMid.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // Middle mouse button pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
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
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
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
  }, []);

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
