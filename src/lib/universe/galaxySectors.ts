import { Delaunay } from 'd3-delaunay';
import type { StarComposition } from './Star';
import { hashId, lcg } from './renderer';

/**
 * Galaxy "sectors" — a Voronoi-based visual backdrop that divides each galaxy
 * into clusters of 2-3 stars. Polygons are stored in **raw (cx-centred,
 * unrotated) coordinates** so the whole sector set can be rotated rigidly
 * with a single `ctx.rotate(galaxyAngle)` at draw time, matching how the
 * per-system loop in `drawGalaxySpiral` rotates star positions.
 *
 * Everything is deterministic from `galaxyId` (which itself encodes the
 * universe seed at generation time), so no universe-seed threading is
 * required. Output is cached per galaxy with the same key shape as
 * `spiralLayoutCache` in `renderer.ts`.
 *
 * The universe layer is not exercised by `npm run sweep`, so adding this
 * RNG sub-stream does not affect the sweep baseline.
 */

export interface GalaxySectors {
  polygons: Array<Array<[number, number]>>;
  tints: string[];
  strokes: string[];
}

interface Point { x: number; y: number }

// ── Star → sector grouping ────────────────────────────────────────────────
// Greedy nearest-neighbour: pick the lowest unclaimed index, gather its
// (target - 1) nearest unclaimed neighbours, form a sector. Target size is
// either 2 or 3 (biased ~55% toward 3) via a `${galaxyId}_sectors` substream.
// If the final group is a singleton, fold it into the nearest existing group.
function groupStars(rawPositions: Point[], galaxyId: string): number[][] {
  const n = rawPositions.length;
  if (n === 0) return [];

  const rng = lcg(hashId(`${galaxyId}_sectors`));
  const unclaimed = new Set<number>();
  for (let i = 0; i < n; i++) unclaimed.add(i);

  const groups: number[][] = [];
  while (unclaimed.size > 0) {
    let seed = -1;
    for (const idx of unclaimed) { seed = idx; break; }
    if (seed < 0) break;
    unclaimed.delete(seed);

    const target = rng() < 0.55 ? 3 : 2;
    const need = target - 1;
    const sp = rawPositions[seed];

    const candidates: Array<{ idx: number; d2: number }> = [];
    for (const idx of unclaimed) {
      const dx = rawPositions[idx].x - sp.x;
      const dy = rawPositions[idx].y - sp.y;
      candidates.push({ idx, d2: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    const members = [seed];
    for (let k = 0; k < need && k < candidates.length; k++) {
      members.push(candidates[k].idx);
      unclaimed.delete(candidates[k].idx);
    }
    groups.push(members);
  }

  if (groups.length >= 2 && groups[groups.length - 1].length === 1) {
    const orphan = groups.pop()!;
    const op = rawPositions[orphan[0]];
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < groups.length; i++) {
      const c = centroid(groups[i], rawPositions);
      const dx = c.x - op.x;
      const dy = c.y - op.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    groups[best].push(orphan[0]);
  }

  return groups;
}

function centroid(indices: number[], rawPositions: Point[]): Point {
  let sx = 0, sy = 0;
  for (const i of indices) {
    sx += rawPositions[i].x;
    sy += rawPositions[i].y;
  }
  return { x: sx / indices.length, y: sy / indices.length };
}

// ── Voronoi build + tint derivation ───────────────────────────────────────
function buildSectors(
  rawPositions: Point[],
  galaxyId: string,
  dominantComposition: StarComposition | undefined,
): GalaxySectors {
  const empty: GalaxySectors = { polygons: [], tints: [], strokes: [] };
  const groups = groupStars(rawPositions, galaxyId);
  if (groups.length < 2) return empty;

  const sites: Point[] = groups.map(g => centroid(g, rawPositions));

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rawPositions) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const margin = Math.max(w, h) * 0.2;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;

  const delaunay = Delaunay.from(sites.map(s => [s.x, s.y] as [number, number]));
  const voronoi = delaunay.voronoi([x0, y0, x1, y1]);

  const polygons: Array<Array<[number, number]>> = [];
  const tints: string[] = [];
  const strokes: string[] = [];

  const hueBand: [number, number] =
    dominantComposition === 'ANTIMATTER' ? [280, 330] : [210, 280];
  const bandWidth = hueBand[1] - hueBand[0];

  for (let i = 0; i < sites.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 3) {
      polygons.push([]);
      tints.push('rgba(0,0,0,0)');
      strokes.push('rgba(0,0,0,0)');
      continue;
    }
    polygons.push(poly as Array<[number, number]>);

    const hueOffset = (hashId(`${galaxyId}_s${i}`) & 0xff) / 255;
    const hue = hueBand[0] + hueOffset * bandWidth;
    tints.push(`hsla(${hue.toFixed(1)}, 35%, 55%, 0.06)`);
    strokes.push(`hsla(${hue.toFixed(1)}, 45%, 70%, 0.18)`);
  }

  return { polygons, tints, strokes };
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
  dominantComposition: StarComposition | undefined,
): GalaxySectors {
  const key = `${shape}|${galaxyId}|${rawPositions.length}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}`;
  const cached = sectorCache.get(key);
  if (cached) return cached;

  const sectors = buildSectors(rawPositions, galaxyId, dominantComposition);

  if (sectorCache.size >= SECTOR_CACHE_MAX) {
    sectorCache.delete(sectorCache.keys().next().value!);
  }
  sectorCache.set(key, sectors);
  return sectors;
}

// ── Renderer ──────────────────────────────────────────────────────────────
// Draws sector polygons rigidly rotated with the galaxy and clipped to the
// galaxy outline (disc for spiral, ellipse for oval — matching drawGalaxyGlow
// extents). Caller is expected to invoke between drawGalaxyGlow and the
// per-system loop.
export function drawGalaxySectors(
  ctx: CanvasRenderingContext2D,
  sectors: GalaxySectors,
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval',
  galaxyId: string,
  galaxyAngle: number,
): void {
  if (sectors.polygons.length === 0) return;

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

  ctx.lineWidth = 1;
  for (let i = 0; i < sectors.polygons.length; i++) {
    const poly = sectors.polygons[i];
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j][0], poly[j][1]);
    ctx.closePath();
    ctx.fillStyle = sectors.tints[i];
    ctx.fill();
    ctx.strokeStyle = sectors.strokes[i];
    ctx.stroke();
  }
  ctx.restore();
}
