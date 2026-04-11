/**
 * Cylindrical wrap helpers for the renderer.
 *
 * The world is cylindrical east-west: Voronoi neighbors can legitimately span
 * the seam (a cell at x ≈ 0 is adjacent to a cell at x ≈ width-ε), and
 * rivers / roads / A*-pathed routes store those wrap-neighbors in their path
 * arrays. The renderer draws the map three times at horizontal offsets
 * [-width, 0, width] so the viewport always sees a seamless wrap, but
 * individual `lineTo` calls must treat consecutive path steps as short-arc
 * segments on the cylinder — otherwise a single segment crossing the seam
 * becomes a straight line spanning the whole map width.
 *
 * Voronoi polygons are clipped at [0, width] (see `terrain/voronoi.ts`), so
 * no single cell's polygon straddles the seam, but a wrap-neighbor pair has
 * vertices clipped at x=0 and x=width respectively — shared-vertex lookups
 * must try the neighbor's vertices shifted by ±width to recognize the shared
 * edge across the seam.
 */

import type { Cell } from '../types';

/** Shift `x` by 0 or ±width, whichever minimizes `|x - refX|`. */
export function unwrapX(refX: number, x: number, width: number): number {
  const half = width / 2;
  let dx = x - refX;
  if (dx > half) return x - width;
  if (dx < -half) return x + width;
  return x;
}

/**
 * moveTo / lineTo through a sequence of points, unwrapping each point's x
 * coordinate relative to the previously-unwrapped point so that any segment
 * which would otherwise cross the seam goes the short way instead. Issues
 * its own `beginPath()` and `stroke()`. Stroke styling (lineWidth, dash,
 * color, cap, join) must be set on `ctx` beforehand.
 */
export function drawWrappedPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  width: number,
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  let px = points[0].x;
  ctx.moveTo(px, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const ux = unwrapX(px, points[i].x, width);
    ctx.lineTo(ux, points[i].y);
    px = ux;
  }
  ctx.stroke();
}

/**
 * Find up to two shared vertices between cells `a` and `b`, also trying
 * `b`'s vertices shifted by ±width so wrap-neighbors across the seam are
 * recognized. Returned vertices are in `a`'s own (unshifted) frame, so the
 * caller's subsequent `moveTo`/`lineTo` just works — the 3× offset loop
 * guarantees at least one visible copy lands in the viewport.
 *
 * Returns `null` if fewer than two shared vertices exist (including the
 * degenerate case of no shared edge at all — rare, but possible near the
 * voronoi bounds).
 */
export function findSharedWrapAwareVerts(
  a: Cell,
  b: Cell,
  width: number,
): [[number, number], [number, number]] | null {
  const EPS = 0.5;
  // Try no shift first (fast path for the 99% of pairs that aren't on the seam),
  // then ±width for true wrap-neighbors.
  const shifts = [0, -width, width];
  const out: [number, number][] = [];
  for (const v of a.vertices) {
    for (const s of shifts) {
      if (b.vertices.some(v2 =>
        Math.abs(v[0] - (v2[0] + s)) < EPS &&
        Math.abs(v[1] - v2[1]) < EPS
      )) {
        out.push(v);
        break;
      }
    }
    if (out.length === 2) break;
  }
  return out.length === 2 ? [out[0], out[1]] : null;
}
