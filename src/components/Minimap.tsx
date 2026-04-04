import { useEffect, useRef, useCallback } from 'react';
import type { MapData, MapView, LayerVisibility } from '../lib/types';
import type { Transform } from './MapCanvas';
import { render } from '../lib/renderer';
import { Draggable } from './Draggable';

interface MinimapProps {
  mapData: MapData;
  layers: LayerVisibility;
  seed: string;
  selectedYear?: number;
  mapView: MapView;
  viewTransform: Transform;
  onNavigate: (mapX: number, mapY: number) => void;
}

const MINIMAP_WIDTH = 240;

/** Simplified layers for the minimap — hide labels, icons, and per-city markers. */
function minimapLayers(layers: LayerVisibility): LayerVisibility {
  return {
    ...layers,
    labels: false,
    icons: false,
    legend: false,
    minimap: false,
    resources: false,
    eventOverlay: false,
    wonderMarkers: false,
    religionMarkers: false,
  };
}

export function Minimap({
  mapData,
  layers,
  seed,
  selectedYear,
  mapView,
  viewTransform,
  onNavigate,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapCacheRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);

  const mapW = mapData.width;
  const mapH = mapData.height;
  const miniH = Math.round(MINIMAP_WIDTH * (mapH / mapW));
  const scaleX = MINIMAP_WIDTH / mapW;
  const scaleY = miniH / mapH;

  // Build a cache key from props that affect the rendered map image
  const cacheKey = `${mapW}x${mapH}-${seed}-${selectedYear ?? ''}-${mapView}`
    + `-${layers.rivers}-${layers.roads}-${layers.borders}-${layers.regions}-${layers.tradeRoutes}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Re-render the map cache if the key changed
    if (!mapCacheRef.current || mapCacheRef.current.key !== cacheKey) {
      const offscreen = document.createElement('canvas');
      offscreen.width = MINIMAP_WIDTH;
      offscreen.height = miniH;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.save();
        offCtx.scale(scaleX, scaleY);
        render(offCtx, mapData, minimapLayers(layers), seed, selectedYear, mapView);
        offCtx.restore();
        mapCacheRef.current = { canvas: offscreen, key: cacheKey };
      }
    }

    // Draw cached map image
    ctx.clearRect(0, 0, MINIMAP_WIDTH, miniH);
    if (mapCacheRef.current) {
      ctx.drawImage(mapCacheRef.current.canvas, 0, 0);
    }

    // Compute visible area in map coordinates
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visLeft = -viewTransform.x / viewTransform.scale;
    const visTop = -viewTransform.y / viewTransform.scale;
    const visW = vw / viewTransform.scale;
    const visH = vh / viewTransform.scale;

    // Draw viewport rectangle (handle horizontal wrapping)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';

    const rx = visLeft * scaleX;
    const ry = Math.max(0, visTop * scaleY);
    const rw = visW * scaleX;
    const rh = Math.min(miniH, visH * scaleY);

    // If viewport is smaller than the full map, draw the indicator
    if (rw < MINIMAP_WIDTH * 0.98 || rh < miniH * 0.98) {
      // Handle wrapping: the rect may extend past the right edge
      const wrappedX = ((rx % MINIMAP_WIDTH) + MINIMAP_WIDTH) % MINIMAP_WIDTH;

      if (wrappedX + rw > MINIMAP_WIDTH) {
        // Splits across the wrap boundary — draw two rects
        const rightPart = MINIMAP_WIDTH - wrappedX;
        ctx.strokeRect(wrappedX, ry, rightPart, rh);
        ctx.fillRect(wrappedX, ry, rightPart, rh);
        ctx.strokeRect(0, ry, rw - rightPart, rh);
        ctx.fillRect(0, ry, rw - rightPart, rh);
      } else {
        ctx.strokeRect(wrappedX, ry, rw, rh);
        ctx.fillRect(wrappedX, ry, rw, rh);
      }
    }
  }, [mapData, layers, seed, selectedYear, mapView, viewTransform, cacheKey, miniH, scaleX, scaleY]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) / scaleX;
      const clickY = (e.clientY - rect.top) / scaleY;
      onNavigate(clickX, clickY);
    },
    [scaleX, scaleY, onNavigate],
  );

  return (
    <Draggable defaultPosition={{ bottom: '10px', left: '10px' }}>
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          borderRadius: 6,
          padding: 4,
          border: '1px solid rgba(255, 255, 255, 0.25)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        <div
          data-drag-handle
          style={{
            color: '#ccc',
            fontSize: 11,
            padding: '2px 4px',
            cursor: 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          Minimap
        </div>
        <canvas
          ref={canvasRef}
          width={MINIMAP_WIDTH}
          height={miniH}
          style={{ display: 'block', cursor: 'crosshair', borderRadius: 3 }}
          onClick={handleClick}
        />
      </div>
    </Draggable>
  );
}
