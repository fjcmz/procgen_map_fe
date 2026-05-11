import { Delaunay } from 'd3-delaunay';
import { hashId, lcg } from './renderer';

/**
 * Galaxy "sectors" — a thin-line Voronoi mesh that divides each galaxy into
 * small clusters of stars. The mesh is balanced so each Voronoi cell contains
 * **2 to 4 stars**:
 *   1. Seed with `floor(N / 3)` random star positions as sites.
 *   2. Repeat up to `MAX_ITER` times:
 *      - Assign each star to its nearest site (= the cell it falls into).
 *      - For each site, if its cell has [2..4] stars → keep, move to centroid.
 *      - If > 4 → split into `ceil(count / 3)` sites via farthest-first
 *        traversal over the cell's stars.
 *      - If < 2 → drop the site (its stars get reassigned to neighbours).
 *      - Stop early once every cell is in [2..4].
 *
 * Only the interior edges between cells are stroked; no fill, no glow.
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

const MIN_PER_CELL = 2;
const MAX_PER_CELL = 4;
const TARGET_PER_CELL = 3;
const MAX_BALANCE_ITER = 20;

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

// Farthest-first traversal over a cluster's star positions — picks `k` stars
// (returned as [x, y] pairs) that are well-separated within the cluster.
// Used to subdivide an overflowing Voronoi cell into multiple new sites.
function farthestFirst(
  starIndices: number[],
  rawPositions: Point[],
  k: number,
  rng: () => number,
): Array<[number, number]> {
  const picks: number[] = [];
  const first = starIndices[Math.floor(rng() * starIndices.length)];
  picks.push(first);
  while (picks.length < k && picks.length < starIndices.length) {
    let bestIdx = -1;
    let bestMinD2 = -1;
    for (const si of starIndices) {
      if (picks.indexOf(si) >= 0) continue;
      let minD2 = Infinity;
      for (const pi of picks) {
        const dx = rawPositions[si].x - rawPositions[pi].x;
        const dy = rawPositions[si].y - rawPositions[pi].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      if (minD2 > bestMinD2) {
        bestMinD2 = minD2;
        bestIdx = si;
      }
    }
    if (bestIdx < 0) break;
    picks.push(bestIdx);
  }
  return picks.map(si => [rawPositions[si].x, rawPositions[si].y] as [number, number]);
}

function balanceSites(rawPositions: Point[], galaxyId: string): Array<[number, number]> {
  const n = rawPositions.length;
  if (n < MIN_PER_CELL) return [];

  const rng = lcg(hashId(`${galaxyId}_sectors`));

  const initialK = Math.max(1, Math.floor(n / TARGET_PER_CELL));
  let sites: Array<[number, number]> = sampleIndices(n, initialK, rng).map(
    i => [rawPositions[i].x, rawPositions[i].y] as [number, number],
  );

  for (let iter = 0; iter < MAX_BALANCE_ITER; iter++) {
    if (sites.length === 0) {
      // All sites got dropped — reseed from a random star to recover.
      const j = Math.floor(rng() * n);
      sites = [[rawPositions[j].x, rawPositions[j].y]];
    }

    const delaunay = Delaunay.from(sites);

    const cellStars: number[][] = sites.map(() => []);
    for (let i = 0; i < n; i++) {
      const c = delaunay.find(rawPositions[i].x, rawPositions[i].y);
      cellStars[c].push(i);
    }

    let balanced = true;
    for (const stars of cellStars) {
      if (stars.length < MIN_PER_CELL || stars.length > MAX_PER_CELL) {
        balanced = false;
        break;
      }
    }
    if (balanced) break;

    const next: Array<[number, number]> = [];
    for (let s = 0; s < sites.length; s++) {
      const stars = cellStars[s];
      if (stars.length >= MIN_PER_CELL && stars.length <= MAX_PER_CELL) {
        let sx = 0, sy = 0;
        for (const si of stars) {
          sx += rawPositions[si].x;
          sy += rawPositions[si].y;
        }
        next.push([sx / stars.length, sy / stars.length]);
      } else if (stars.length > MAX_PER_CELL) {
        const k = Math.ceil(stars.length / TARGET_PER_CELL);
        for (const p of farthestFirst(stars, rawPositions, k, rng)) next.push(p);
      }
      // else (< MIN): drop the site — its stars get reassigned to neighbours.
    }

    sites = next;
  }

  return sites;
}

function buildEdges(rawPositions: Point[], galaxyId: string): Path2D | null {
  const sites = balanceSites(rawPositions, galaxyId);
  if (sites.length < 2) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rawPositions) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const margin = Math.max(x1 - x0, y1 - y0) * 0.2;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;

  const delaunay = Delaunay.from(sites);
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
