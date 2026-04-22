// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — buildings (PR 5 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module generates building footprints by subdividing each eligible block
// polygon into Voronoi lots and insetting each lot uniformly from its edges.
//
// ALGORITHM (per eligible polygon):
//   1. Determine N = number of building lots (role + area formula, 1–6).
//   2. Rejection-sample N random seed points inside the polygon.
//   3. Run D3 Delaunay/Voronoi on those seeds, clipped to the polygon bbox.
//   4. Clip each Voronoi cell to the parent polygon via Sutherland–Hodgman.
//   5. Inset the clipped lot polygon by BUILDING_INSET_PX (parallel offset).
//   6. If the result has area >= MIN_FOOTPRINT_AREA, emit it as a CityBuildingV2.
//
// The inset uses a centroid-directed parallel-offset: for each edge the inward
// normal is computed (the perpendicular direction toward the polygon centroid),
// the edge is offset by BUILDING_INSET_PX, and adjacent offset edges are
// intersected to find the new vertex. This produces straight building walls
// parallel to the street/lot boundary — the "set-back from the street" read
// that top-down city maps use. Voronoi lots from convex parents are also convex,
// so the inset is always valid when BUILDING_INSET_PX < the lot's inradius.
//
// ELIGIBLE POLYGONS — same criteria as before:
//   • block role in {civic, market, harbor, residential}
//   • polygon not in reservedPolygonIds (openSpaces ∪ landmarks)
//   • polygon.isEdge === false (edge polygons belong to sprawl)
//   • polygon.area >= MIN_PARENT_AREA
//
// Seed generation uses a rejection-sampler bounded by the polygon bbox.
// Sutherland–Hodgman works for any convex clip polygon regardless of winding —
// the sign of the shoelace sum is detected at runtime so the "inside" test
// always points toward the interior. D3 Voronoi cells and city polygons are
// both from the same D3 pipeline and share the same CW-in-screen winding
// (positive shoelace sum), but the detection makes this robust if that ever
// changes.
//
// RNG sub-stream: `${seed}_city_${cityName}_buildings` — same key as before,
// so old snapshots re-rendered with the new generator keep a consistent stream.
// Iteration order: block order → polygon.id order → seed roll → solid roll,
// fully deterministic and seed-stable across re-runs.
//
// NO tile lattice. NO `Math.random`. Every geometric helper is file-local so
// there is no dependency on `cityMapEdgeGraph.ts` — this module does polygon-
// interior work, not edge-graph traversal.
// ─────────────────────────────────────────────────────────────────────────────

import { Delaunay } from 'd3-delaunay';
import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityBuildingV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
  DistrictRole,
} from './cityMapTypesV2';

// ─── Tunables ────────────────────────────────────────────────────────────────

const PACKING_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>([
  'civic',
  'market',
  'harbor',
  'residential',
]);

// Per-role lot-count formula: N = clamp(min, max, round(base + area / divisor)).
// Tuned so civic blocks get a few large administrative footprints, market blocks
// get many small stalls, residential blocks get dense row-house clusters,
// and harbor blocks get long warehouse rows.
const LOT_BASE: Record<DistrictRole, number> = {
  civic: 2,
  market: 3,
  harbor: 2,
  residential: 3,
  slum: 0,
  agricultural: 0,
};
const LOT_DIVISOR: Record<DistrictRole, number> = {
  civic: 700,
  market: 220,
  harbor: 550,
  residential: 280,
  slum: 1,
  agricultural: 1,
};
const LOT_MIN: Record<DistrictRole, number> = {
  civic: 1,
  market: 2,
  harbor: 1,
  residential: 2,
  slum: 0,
  agricultural: 0,
};
const LOT_MAX: Record<DistrictRole, number> = {
  civic: 4,
  market: 6,
  harbor: 4,
  residential: 6,
  slum: 0,
  agricultural: 0,
};

// Inset distance in pixels. Each lot polygon is shrunk inward by this amount
// on all sides; the gap between adjacent buildings is ~2× this value.
const BUILDING_INSET_PX = 3;

// Minimum area filters.
const MIN_PARENT_AREA = 100;      // px² — skip polygons too small to subdivide
const MIN_FOOTPRINT_AREA = 16;    // px² — skip lots whose inset collapses them

// Fraction of buildings drawn as solid vs. hollow outline.
const SOLID_PROBABILITY = 0.55;

// Max rejection-sampling attempts per seed point.
const MAX_SEED_ATTEMPTS_MULTIPLIER = 40;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate `buildings: CityBuildingV2[]` for a V2 city map.
 *
 * Each building is a polygon footprint produced by Voronoi-subdividing the
 * parent block polygon into lots and insetting each lot by BUILDING_INSET_PX.
 */
export function generateBuildings(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: CityMapDataV2['openSpaces'],
  landmarks: CityLandmarkV2[],
  canvasSize: number,
): CityBuildingV2[] {
  void env;
  void canvasSize;

  if (polygons.length === 0 || blocks.length === 0) return [];

  const reservedPolygonIds = new Set<number>();
  for (const entry of openSpaces) {
    for (const id of entry.polygonIds) reservedPolygonIds.add(id);
  }
  for (const lm of landmarks) reservedPolygonIds.add(lm.polygonId);

  const rng = seededPRNG(`${seed}_city_${cityName}_buildings`);
  const out: CityBuildingV2[] = [];

  for (const block of blocks) {
    if (!PACKING_ROLES.has(block.role)) continue;

    for (const polygonId of block.polygonIds) {
      if (reservedPolygonIds.has(polygonId)) continue;
      const polygon = polygons[polygonId];
      if (!polygon) continue;
      if (polygon.isEdge) continue;
      if (polygon.vertices.length < 3) continue;
      if (polygon.area < MIN_PARENT_AREA) continue;

      packBuildingsInPolygon(polygon, block.role, rng, out);
    }
  }

  return out;
}

// ─── Core packing logic ───────────────────────────────────────────────────────

function packBuildingsInPolygon(
  polygon: CityPolygon,
  role: DistrictRole,
  rng: () => number,
  out: CityBuildingV2[],
): void {
  const n = clamp(
    LOT_MIN[role],
    LOT_MAX[role],
    Math.round(LOT_BASE[role] + polygon.area / LOT_DIVISOR[role]),
  );
  if (n === 0) return;

  // [Voronoi-polygon] Generate n seed points inside the polygon.
  const seeds = generateSeedsInPolygon(polygon.vertices, n, rng);
  if (seeds.length === 0) return;

  // [Voronoi-polygon] Subdivide the polygon into Voronoi lots and clip each
  // lot to the parent polygon boundary.
  const lots = seeds.length === 1
    ? [polygon.vertices as [number, number][]]
    : subdivideToLots(polygon, seeds);

  // [Voronoi-polygon] Inset each lot polygon to produce the building footprint.
  for (const lot of lots) {
    if (polygonArea(lot) < MIN_FOOTPRINT_AREA * 4) continue; // too small to inset
    const footprint = insetPolygon(lot, BUILDING_INSET_PX);
    if (!footprint || footprint.length < 3) continue;
    if (polygonArea(footprint) < MIN_FOOTPRINT_AREA) continue;

    out.push({
      vertices: footprint,
      solid: rng() < SOLID_PROBABILITY,
      polygonId: polygon.id,
    });
  }
}

// ─── Seed generation ─────────────────────────────────────────────────────────

// [Voronoi-polygon] Rejection-sample `n` random points inside the polygon
// ring. Bounded by the polygon's axis-aligned bounding box.
function generateSeedsInPolygon(
  verts: [number, number][],
  n: number,
  rng: () => number,
): [number, number][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [vx, vy] of verts) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }

  const seeds: [number, number][] = [];
  const maxAttempts = n * MAX_SEED_ATTEMPTS_MULTIPLIER;
  let attempts = 0;
  while (seeds.length < n && attempts < maxAttempts) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (pointInPolygon([x, y], verts)) seeds.push([x, y]);
    attempts++;
  }
  return seeds;
}

// ─── Voronoi subdivision + Sutherland–Hodgman clipping ───────────────────────

// [Voronoi-polygon] Build D3 Voronoi on `seeds`, clipped to the polygon bbox,
// then clip each cell to the parent polygon using Sutherland–Hodgman. The
// parent polygon is convex (it is itself a Voronoi cell from the city graph),
// and convex × convex intersection is always convex — so the resulting lots
// are convex and the inset is always well-defined.
function subdivideToLots(
  polygon: CityPolygon,
  seeds: [number, number][],
): [number, number][][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [vx, vy] of polygon.vertices) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }

  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi([minX, minY, maxX, maxY]);

  const lots: [number, number][][] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 4) continue;

    // D3 returns a closed ring (last === first); strip the closing vertex.
    const cellVerts: [number, number][] = [];
    for (let j = 0; j < cell.length - 1; j++) {
      cellVerts.push([cell[j][0], cell[j][1]]);
    }

    const clipped = sutherlandHodgmanClip(cellVerts, polygon.vertices);
    if (clipped.length >= 3) lots.push(clipped);
  }

  return lots;
}

// [Voronoi-polygon] Sutherland–Hodgman polygon clipping. Clips `subject`
// (arbitrary polygon) against `clip` (convex polygon). The winding of `clip`
// is detected at runtime (positive shoelace sum = CW in screen-space, which is
// the D3 Voronoi convention). For each clip edge the algorithm tests which side
// of the edge the "inside" is on, consistent with the detected winding.
function sutherlandHodgmanClip(
  subject: [number, number][],
  clip: [number, number][],
): [number, number][] {
  // Detect clip-polygon winding.
  let clipSum = 0;
  const cn = clip.length;
  for (let i = 0; i < cn; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % cn];
    clipSum += ax * by - bx * ay;
  }
  // Positive shoelace sum → CW in screen coords → inside when cross >= 0.
  // Negative shoelace sum → CCW in screen coords → inside when cross <= 0.
  const cwClip = clipSum >= 0;

  let output: [number, number][] = subject.slice();

  for (let i = 0; i < cn; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    const a = clip[i];
    const b = clip[(i + 1) % cn];

    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const crossP = edgeCross(a, b, p);
      const crossQ = edgeCross(a, b, q);
      const pIn = cwClip ? crossP >= 0 : crossP <= 0;
      const qIn = cwClip ? crossQ >= 0 : crossQ <= 0;
      if (pIn) output.push(p);
      if (pIn !== qIn) {
        const ix = lineIntersect(p, q, a, b);
        if (ix) output.push(ix);
      }
    }
  }
  return output;
}

// ─── Polygon inset (parallel offset) ─────────────────────────────────────────

// [Voronoi-polygon] Inset a convex polygon by `dist` pixels on all sides using
// a parallel-edge offset. For each vertex the two adjacent edges are each
// shifted inward by `dist` along their inward normal (directed toward the
// centroid), and the new vertex is the intersection of the two shifted edges.
// This produces building walls that are exactly parallel to the lot boundary —
// the "set-back from the street" look — unlike a centroid-blend which gives
// non-uniform gaps on elongated polygons.
function insetPolygon(
  verts: [number, number][],
  dist: number,
): [number, number][] | null {
  const n = verts.length;
  if (n < 3) return null;

  // Compute centroid for inward-normal direction disambiguation.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of verts) { cx += x; cy += y; }
  cx /= n;
  cy /= n;

  const result: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];

    // Inward-directed normal for edge prev→curr.
    const d1x = curr[0] - prev[0];
    const d1y = curr[1] - prev[1];
    const len1 = Math.hypot(d1x, d1y);
    if (len1 < 1e-6) { result.push([curr[0], curr[1]]); continue; }
    let n1x = -d1y / len1;
    let n1y =  d1x / len1;
    const mid1x = (prev[0] + curr[0]) * 0.5;
    const mid1y = (prev[1] + curr[1]) * 0.5;
    if (n1x * (cx - mid1x) + n1y * (cy - mid1y) < 0) { n1x = -n1x; n1y = -n1y; }

    // Inward-directed normal for edge curr→next.
    const d2x = next[0] - curr[0];
    const d2y = next[1] - curr[1];
    const len2 = Math.hypot(d2x, d2y);
    if (len2 < 1e-6) { result.push([curr[0], curr[1]]); continue; }
    let n2x = -d2y / len2;
    let n2y =  d2x / len2;
    const mid2x = (curr[0] + next[0]) * 0.5;
    const mid2y = (curr[1] + next[1]) * 0.5;
    if (n2x * (cx - mid2x) + n2y * (cy - mid2y) < 0) { n2x = -n2x; n2y = -n2y; }

    // Offset both edges inward and intersect them.
    const a1: [number, number] = [prev[0] + n1x * dist, prev[1] + n1y * dist];
    const b1: [number, number] = [curr[0] + n1x * dist, curr[1] + n1y * dist];
    const a2: [number, number] = [curr[0] + n2x * dist, curr[1] + n2y * dist];
    const b2: [number, number] = [next[0] + n2x * dist, next[1] + n2y * dist];

    const p = lineIntersect(a1, b1, a2, b2);
    if (!p) {
      // Parallel adjacent edges — use the average of the two offset endpoints.
      result.push([(b1[0] + a2[0]) * 0.5, (b1[1] + a2[1]) * 0.5]);
    } else {
      result.push(p);
    }
  }

  return result.length >= 3 ? result : null;
}

// ─── Local geometry helpers — [Voronoi-polygon] ───────────────────────────────

// [Voronoi-polygon] Classic ray-cast point-in-polygon on an UNCLOSED ring.
function pointInPolygon(p: [number, number], verts: [number, number][]): boolean {
  const [px, py] = p;
  const n = verts.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// [Voronoi-polygon] Signed 2D cross product of edge a→b with vector a→p.
// Positive → p is to the left of a→b (in standard math / CCW convention).
function edgeCross(
  a: [number, number],
  b: [number, number],
  p: [number, number],
): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

// [Voronoi-polygon] Line–line intersection of segments a→b and c→d, returned
// as the point on line a→b parameterized by t. Returns null for parallel lines.
function lineIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): [number, number] | null {
  const dx1 = b[0] - a[0];
  const dy1 = b[1] - a[1];
  const dx2 = d[0] - c[0];
  const dy2 = d[1] - c[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c[0] - a[0]) * dy2 - (c[1] - a[1]) * dx2) / denom;
  return [a[0] + t * dx1, a[1] + t * dy1];
}

// [Voronoi-polygon] Shoelace absolute area of an unclosed polygon ring.
function polygonArea(verts: [number, number][]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[(i + 1) % n];
    area += ax * by - bx * ay;
  }
  return Math.abs(area) * 0.5;
}

function clamp(min: number, max: number, v: number): number {
  return v < min ? min : v > max ? max : v;
}
