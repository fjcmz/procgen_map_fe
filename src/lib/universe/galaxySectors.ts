import { Delaunay } from 'd3-delaunay';
import { hashId, lcg } from './renderer';

/**
 * Galaxy "sectors" — a thin-line Voronoi mesh that divides each galaxy into
 * small clusters of stars. Sites are sampled from the existing rawPositions
 * (so the mesh inherits the galaxy's density distribution — dense centre +
 * arms for spirals, even ellipse for ovals) at a count of `floor(3 * N / 13)`,
 * giving roughly a sector per few stars. Only the interior edges between
 * cells are stroked; no fill, no glow.
 *
 * The mesh is cached per galaxy as a Path2D in **raw (cx-centred, unrotated)
 * coordinates** so the whole mesh can be rotated rigidly with the galaxy via
 * a single `ctx.rotate(galaxyAngle)` at draw time.
 *
 * Determinism: site selection uses an isolated `lcg(hashId(\`${galaxyId}_sectors\`))`
 * sub-stream — galaxy id encodes the universe seed at generation time, so no
 * universe-seed threading is required. The universe layer is not exercised
 * by `npm run sweep`, so this RNG does not affect the sweep baseline.
 */

export interface GalaxySectors {
  edges: Path2D | null;
}

interface Point { x: number; y: number }

// Fisher-Yates shuffle, take first K. Uses the supplied seeded rng.
function sampleIndices(n: number, k: number, rng: () => number): number[] {
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  const take = Math.min(k, n);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, take);
}

function buildEdges(rawPositions: Point[], galaxyId: string): Path2D | null {
  const n = rawPositions.length;
  const siteCount = Math.floor((3 * n) / 13);
  if (siteCount < 2) return null;

  const rng = lcg(hashId(`${galaxyId}_sectors`));
  const idx = sampleIndices(n, siteCount, rng);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rawPositions) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const margin = Math.max(x1 - x0, y1 - y0) * 0.2;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;

  const points: Array<[number, number]> = idx.map(i => [rawPositions[i].x, rawPositions[i].y]);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([x0, y0, x1, y1]);

  const path = new Path2D();
  voronoi.render(path);
  return path;
}

// ── Cache ─────────────────────────────────────────────────────────────────
const sectorCache = new Map<string, GalaxySectors>();
const SECTOR_CACHE_MAX = 10;

export function buildOrGetSectors(
  rawPositions: Point[],
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval',
  galaxyId: string,
): GalaxySectors {
  const key = `${shape}|${galaxyId}|${rawPositions.length}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}`;
  const cached = sectorCache.get(key);
  if (cached) return cached;

  const sectors: GalaxySectors = { edges: buildEdges(rawPositions, galaxyId) };

  if (sectorCache.size >= SECTOR_CACHE_MAX) {
    sectorCache.delete(sectorCache.keys().next().value!);
  }
  sectorCache.set(key, sectors);
  return sectors;
}

// ── Renderer ──────────────────────────────────────────────────────────────
// Strokes the cached Voronoi mesh as thin lines, rotated rigidly with the
// galaxy and clipped to the galaxy outline (disc for spiral, ellipse for
// oval — matching drawGalaxyGlow extents). Caller is expected to invoke
// between drawGalaxyGlow and the per-system loop.
const EDGE_STROKE = 'rgba(170, 190, 220, 0.22)';

export function drawGalaxySectors(
  ctx: CanvasRenderingContext2D,
  sectors: GalaxySectors,
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval',
  galaxyId: string,
  galaxyAngle: number,
  viewScale: number,
): void {
  if (!sectors.edges) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(galaxyAngle);
  ctx.translate(-cx, -cy);

  const clipR = spread * 0.52;
  ctx.beginPath();
  if (shape === 'oval') {
    const h = hashId(galaxyId);
    const aspectX = 1.4 + (h & 0xfff) / 0xfff * 0.8;
    ctx.ellipse(cx, cy, clipR * aspectX, clipR, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
  }
  ctx.clip();

  ctx.lineWidth = 1 / Math.max(viewScale, 0.0001);
  ctx.strokeStyle = EDGE_STROKE;
  ctx.stroke(sectors.edges);

  ctx.restore();
}
