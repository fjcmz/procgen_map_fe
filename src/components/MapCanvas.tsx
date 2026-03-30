import { useEffect, useRef } from 'react';
import type { MapData, LayerVisibility } from '../lib/types';
import { render } from '../lib/renderer';

interface MapCanvasProps {
  mapData: MapData | null;
  layers: LayerVisibility;
  seed: string;
}

export function MapCanvas({ mapData, layers, seed }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        display: 'block',
        objectFit: 'contain',
      }}
    />
  );
}
