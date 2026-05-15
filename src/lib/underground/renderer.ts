/**
 * Underground map renderer — Canvas 2D. Draws the underground polygon graph
 * cell-by-cell, matching the surface map's visual language. See
 * `claude_specs/underground_map.md`.
 */

import type { Cell as SurfaceCell } from '../types';
import type { Cavern, CavernKind, UndergroundCell, UndergroundMap } from './types';

const COLORS = {
  solidRock: '#1a1410',
  cavernLarge: '#9a8c70',
  cavernSmall: '#7a6d54',
  cavernMaze: '#6e5a40',
  tunnel: '#8c7a5a',
  tunnelMaze: '#7c6848',
  cellOutline: 'rgba(20, 14, 8, 0.45)',
  connectionFill: '#f0d878',
  connectionOutline: '#1a1410',
};

function cavernKindById(caverns: Cavern[]): Map<string, CavernKind> {
  const m = new Map<string, CavernKind>();
  for (const c of caverns) m.set(c.id, c.kind);
  return m;
}

function pxScale(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform();
  return (Math.abs(t.a) + Math.abs(t.d)) * 0.5;
}

function tracePolygon(ctx: CanvasRenderingContext2D, vertices: [number, number][]): void {
  if (vertices.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i][0], vertices[i][1]);
  }
  ctx.closePath();
}

function colorForCell(
  cell: UndergroundCell,
  kindOf: Map<string, CavernKind>,
): string {
  if (cell.category === 'solid') return COLORS.solidRock;
  if (cell.category === 'tunnel') {
    return cell.cavernId !== null ? COLORS.tunnelMaze : COLORS.tunnel;
  }
  // cavern
  const kind = cell.cavernId !== null ? kindOf.get(cell.cavernId) : undefined;
  if (kind === 'large') return COLORS.cavernLarge;
  if (kind === 'maze') return COLORS.cavernMaze;
  return COLORS.cavernSmall;
}

export function drawUnderground(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  width: number,
  height: number,
): void {
  ctx.save();

  // Solid background — covers any sliver gaps between cell polygons.
  ctx.fillStyle = COLORS.solidRock;
  ctx.fillRect(0, 0, width, height);

  const scale = pxScale(ctx);
  const kindOf = cavernKindById(underground.caverns);

  // Pass 1: fill every cell polygon (main + wrap loop).
  for (const cell of underground.cells) {
    ctx.fillStyle = colorForCell(cell, kindOf);
    if (cell.vertices.length > 0) {
      tracePolygon(ctx, cell.vertices);
      ctx.fill();
    }
    if (cell.wrapVertices && cell.wrapVertices.length > 0) {
      tracePolygon(ctx, cell.wrapVertices);
      ctx.fill();
    }
  }

  // Pass 2: thin outline between cells inside open areas (cavern↔cavern of
  // the same cluster, tunnel↔tunnel, etc.). Helps the polygon structure
  // read at high zoom. Skip on solid↔solid edges (they blend into the
  // background) and on cavern↔solid edges (the colour contrast already
  // delineates the cavern boundary).
  ctx.strokeStyle = COLORS.cellOutline;
  ctx.lineWidth = Math.max(0.3, 0.6 / scale);
  for (const cell of underground.cells) {
    if (cell.category === 'solid') continue;
    if (cell.vertices.length > 0) {
      tracePolygon(ctx, cell.vertices);
      ctx.stroke();
    }
    if (cell.wrapVertices && cell.wrapVertices.length > 0) {
      tracePolygon(ctx, cell.wrapVertices);
      ctx.stroke();
    }
  }

  // Pass 3: connection pips. Anchor at the underground cell's centroid so
  // they show up exactly where the cavern entrance is on this view.
  drawConnectionPips(ctx, underground, scale);

  ctx.restore();
}

function drawConnectionPips(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  scale: number,
): void {
  const radius = 5 / scale;
  ctx.fillStyle = COLORS.connectionFill;
  ctx.strokeStyle = COLORS.connectionOutline;
  ctx.lineWidth = 1.5 / scale;
  for (const conn of underground.connections) {
    const ugCell = underground.cells[conn.undergroundCellIndex];
    if (!ugCell) continue;
    ctx.beginPath();
    ctx.arc(ugCell.x, ugCell.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Optional overlay drawn ON TOP of the surface map when the user enables
 *  the `undergroundConnections` layer toggle. Renders one pip per entrance
 *  at the surface cell's centroid so users can correlate the two views. */
export function drawConnectionOverlay(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  cells: SurfaceCell[],
): void {
  const scale = pxScale(ctx);
  ctx.save();
  ctx.fillStyle = COLORS.connectionFill;
  ctx.strokeStyle = COLORS.connectionOutline;
  ctx.lineWidth = 1.5 / scale;
  const radius = 4 / scale;
  for (const conn of underground.connections) {
    const cell = cells[conn.surfaceCellIndex];
    if (!cell) continue;
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
