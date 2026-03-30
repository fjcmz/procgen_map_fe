import { useEffect, useRef, useState } from 'react';
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

export function MapCanvas({ mapData, layers, seed }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

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
        setTransform(prev => {
          const newScale = Math.min(10, Math.max(0.1, prev.scale * factor));
          const contentX = (e.clientX - prev.x) / prev.scale;
          const contentY = (e.clientY - prev.y) / prev.scale;
          return {
            scale: newScale,
            x: e.clientX - contentX * newScale,
            y: e.clientY - contentY * newScale,
          };
        });
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
      }}
    />
  );
}
