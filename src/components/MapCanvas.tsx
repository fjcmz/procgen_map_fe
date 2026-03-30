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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    canvas.width = mapData.width;
    canvas.height = mapData.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    render(ctx, mapData, layers, seed);
  }, [mapData, layers, seed]);

  // Re-render when layers change but mapData hasn't changed
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render(ctx, mapData, layers, seed);
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom centered on cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
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
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Middle mouse button pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault(); // prevent browser autoscroll
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
        transformOrigin: '0 0',
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      }}
    />
  );
}
