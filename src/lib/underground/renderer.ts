/**
 * Underground map renderer — Canvas 2D. Draws the cavern/tunnel graph onto
 * the world canvas, replacing the surface biome paint while the underground
 * view is active. See `claude_specs/underground_map.md`.
 */

import type { Cell } from '../types';
import type { Cavern, Point, UndergroundMap } from './types';

const STONE_BG = '#1a1410';
const CAVERN_LARGE = '#9a8c70';
const CAVERN_SMALL = '#7a6d54';
const MAZE_FILL = '#5e5440';
const MAZE_PASSAGE = '#9a8c70';
const TUNNEL = '#c0b090';
const TUNNEL_LOOP = '#9a8870';
const CAVERN_OUTLINE = '#3a2f22';
const CONNECTION_FILL = '#f0d878';
const CONNECTION_OUTLINE = '#1a1410';

function tracePolygon(ctx: CanvasRenderingContext2D, polygon: Point[]): void {
  if (polygon.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i].x, polygon[i].y);
  }
  ctx.closePath();
}

function traceCavern(ctx: CanvasRenderingContext2D, cavern: Cavern): void {
  tracePolygon(ctx, cavern.polygon);
}

function tracePolyline(ctx: CanvasRenderingContext2D, path: Point[]): void {
  if (path.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
}

/** Pixels-per-world-unit; needed to keep stroke widths and icons visually
 *  stable across the canvas zoom. The caller is expected to apply its
 *  current transform before calling draw functions; we read it back via
 *  `ctx.getTransform().a`. */
function pxScale(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform();
  // Average of x/y scale; on this canvas they're equal but be defensive.
  return (Math.abs(t.a) + Math.abs(t.d)) * 0.5;
}

export function drawUnderground(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  width: number,
  height: number,
): void {
  // Solid stone background — covers the whole world rect.
  ctx.save();
  ctx.fillStyle = STONE_BG;
  ctx.fillRect(0, 0, width, height);

  const scale = pxScale(ctx);
  const px = (v: number) => v / scale;

  // Tunnels (drawn first so cavern fills paint over endpoints).
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tunnel of underground.tunnels) {
    ctx.strokeStyle = tunnel.mandatory ? TUNNEL : TUNNEL_LOOP;
    ctx.lineWidth = tunnel.mandatory ? px(3) : px(2);
    tracePolyline(ctx, tunnel.path);
    ctx.stroke();
  }

  // Large caverns.
  ctx.fillStyle = CAVERN_LARGE;
  ctx.strokeStyle = CAVERN_OUTLINE;
  ctx.lineWidth = px(1.2);
  for (const cavern of underground.largeCaverns) {
    traceCavern(ctx, cavern);
    ctx.fill();
    ctx.stroke();
  }

  // Small caverns.
  ctx.fillStyle = CAVERN_SMALL;
  for (const cavern of underground.smallCaverns) {
    traceCavern(ctx, cavern);
    ctx.fill();
    ctx.stroke();
  }

  // Maze clusters: filled bbox with grid hatching, then mini-caverns +
  // internal passages painted on top.
  for (const maze of underground.mazeClusters) {
    ctx.fillStyle = MAZE_FILL;
    ctx.fillRect(maze.bbox.x, maze.bbox.y, maze.bbox.w, maze.bbox.h);
    // Hatched grid for the dungeon-room feel.
    ctx.strokeStyle = '#3a3220';
    ctx.lineWidth = px(0.6);
    const step = Math.max(maze.bbox.w, maze.bbox.h) / 12;
    for (let x = maze.bbox.x; x <= maze.bbox.x + maze.bbox.w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, maze.bbox.y);
      ctx.lineTo(x, maze.bbox.y + maze.bbox.h);
      ctx.stroke();
    }
    for (let y = maze.bbox.y; y <= maze.bbox.y + maze.bbox.h; y += step) {
      ctx.beginPath();
      ctx.moveTo(maze.bbox.x, y);
      ctx.lineTo(maze.bbox.x + maze.bbox.w, y);
      ctx.stroke();
    }
    // Mini-cavern passages first (so cavern fills cover their endpoints).
    ctx.strokeStyle = MAZE_PASSAGE;
    ctx.lineWidth = px(2);
    for (const edge of maze.edges) {
      tracePolyline(ctx, edge.path);
      ctx.stroke();
    }
    // Mini-caverns.
    ctx.fillStyle = CAVERN_SMALL;
    ctx.strokeStyle = CAVERN_OUTLINE;
    ctx.lineWidth = px(1);
    for (const mc of maze.miniCaverns) {
      traceCavern(ctx, mc);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Surface connections — bright pip with a dark outline. Drawn last so they
  // sit on top of everything.
  drawConnectionPips(ctx, underground, scale);

  ctx.restore();
}

function drawConnectionPips(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  scale: number,
): void {
  const radius = 5 / scale;
  ctx.fillStyle = CONNECTION_FILL;
  ctx.strokeStyle = CONNECTION_OUTLINE;
  ctx.lineWidth = 1.5 / scale;
  for (const conn of underground.connections) {
    ctx.beginPath();
    ctx.arc(conn.xy.x, conn.xy.y, radius, 0, Math.PI * 2);
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
  cells: Cell[],
): void {
  const scale = pxScale(ctx);
  ctx.save();
  ctx.fillStyle = CONNECTION_FILL;
  ctx.strokeStyle = CONNECTION_OUTLINE;
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
