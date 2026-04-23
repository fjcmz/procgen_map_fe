// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — buildings (PR 5 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// ALGORITHM (per eligible block polygon):
//   1. Determine N = number of building lots (role + area formula, 1–6).
//   2. Rejection-sample N random seed points inside the polygon.
//   3. Run D3 Delaunay/Voronoi on those seeds, clipped to the polygon bbox.
//   4. Clip each Voronoi cell to the parent polygon via Sutherland–Hodgman.
//   5. Classify each lot edge:
//        • Lot edge whose midpoint lies on the parent polygon boundary
//          → BOUNDARY EDGE. Setback = 4px if on a road, 2px otherwise.
//        • All other lot edges (internal to the polygon, shared between lots)
//          → INTERNAL EDGE. Setback = 0 — buildings touch along these edges.
//   6. Apply the per-edge setback via a selective parallel-offset inset:
//      for each lot vertex, intersect the two adjacent offset lines (at their
//      respective setback distances). Internal edges are not shifted, so
//      adjacent buildings abut exactly along their shared lot boundary.
//   7. If the resulting footprint has area ≥ MIN_FOOTPRINT_AREA, emit it.
//
// SETBACK RATIONALE
//   Buildings need breathing room from streets/roads/walls (they run along
//   polygon boundary edges), but buildings within the same block polygon
//   should be packed tightly — the lot boundary IS the building boundary.
//   Road edges get a larger setback (4 vs 2 px) to reflect wider pavements.
//
// ELIGIBLE POLYGONS — same criteria as before:
//   • block role in {civic, market, harbor, residential}
//   • polygon not in reservedPolygonIds (openSpaces ∪ landmarks)
//   • polygon.isEdge === false (edge polygons belong to sprawl)
//   • polygon.area >= MIN_PARENT_AREA
//
// RNG sub-stream: `${seed}_city_${cityName}_buildings` — same key so old
// snapshots re-rendered with the new generator keep a consistent stream.
// Iteration: block order → polygon.id order → seed roll → solid roll.
//
// NO tile lattice. NO `Math.random`. This module does NOT import
// `cityMapEdgeGraph.ts` — edge-key helpers are implemented locally with the
// same VERTEX_PRECISION = 100 constant used by that module so canonical keys
// from `roads` match parent polygon edge keys.
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
  // Craft & industry — larger sparse workshops (1–3 per polygon).
  'forge',
  'tannery',
  'textile',
  'potters',
  'mill',
]);

const LOT_BASE: Record<DistrictRole, number> = {
  civic: 2,
  market: 3,
  harbor: 2,
  residential: 3,
  slum: 0,
  agricultural: 0,
  dock: 0,
  // Craft: sparse — 1–2 large workshop footprints per polygon.
  forge:   1,
  tannery: 1,
  textile: 1,
  potters: 2,
  mill:    1,
};
const LOT_DIVISOR: Record<DistrictRole, number> = {
  civic: 700,
  market: 220,
  harbor: 550,
  residential: 280,
  slum: 1,
  agricultural: 1,
  dock: 1,
  // Craft: large divisor → fewer lots → bigger individual footprints.
  forge:   800,
  tannery: 800,
  textile: 800,
  potters: 600,
  mill:    900,
};
const LOT_MIN: Record<DistrictRole, number> = {
  civic: 1,
  market: 2,
  harbor: 1,
  residential: 2,
  slum: 0,
  agricultural: 0,
  dock: 0,
  forge:   1,
  tannery: 1,
  textile: 1,
  potters: 1,
  mill:    1,
};
const LOT_MAX: Record<DistrictRole, number> = {
  civic: 4,
  market: 6,
  harbor: 4,
  residential: 6,
  slum: 0,
  agricultural: 0,
  dock: 0,
  forge:   3,
  tannery: 3,
  textile: 3,
  potters: 3,
  mill:    2,
};

// Setback in pixels from polygon boundary edges.
// Internal lot edges (shared between lots) always get 0 — buildings touch.
const DEFAULT_SETBACK_PX = 2;  // min space between building edge and polygon boundary
const ROAD_SETBACK_PX = 4;     // wider pavement setback along road edges

// Tolerance for classifying a lot-edge midpoint as "on the parent polygon boundary".
const BOUNDARY_TOLERANCE = 0.5; // px

// Area filters.
const MIN_PARENT_AREA = 100;    // px² — skip polygons too small to subdivide
const MIN_FOOTPRINT_AREA = 12;  // px² — skip lots whose setback collapses them

// All interior buildings are grey-filled with a black outline — solid=true is
// always emitted. The renderer ignores the `solid` field for buildings and
// always applies fill + stroke.
const SOLID_BUILDING = true;

// Max rejection-sampling attempts per seed point.
const MAX_SEED_ATTEMPTS_MULTIPLIER = 40;

// Must match cityMapEdgeGraph.ts VERTEX_PRECISION so canonical edge keys
// built here from road-path vertices match those built there.
const VERTEX_PRECISION = 100;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate `buildings: CityBuildingV2[]` for a V2 city map.
 *
 * `roads` is used to identify road edges on the parent polygon boundary so
 * they receive a wider (4 px) setback than other boundary edges (2 px).
 */
export function generateBuildings(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: CityMapDataV2['openSpaces'],
  landmarks: CityLandmarkV2[],
  roads: [number, number][][],
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

  // Build road-edge canonical-key set for 4 px setback detection.
  const roadEdgeKeys = buildRoadEdgeKeys(roads);

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

      packBuildingsInPolygon(polygon, block.role, roadEdgeKeys, rng, out);
    }
  }

  return out;
}

// ─── Core packing logic ───────────────────────────────────────────────────────

function packBuildingsInPolygon(
  polygon: CityPolygon,
  role: DistrictRole,
  roadEdgeKeys: Set<string>,
  rng: () => number,
  out: CityBuildingV2[],
): void {
  const n = clamp(
    LOT_MIN[role],
    LOT_MAX[role],
    Math.round(LOT_BASE[role] + polygon.area / LOT_DIVISOR[role]),
  );
  if (n === 0) return;

  const seeds = generateSeedsInPolygon(polygon.vertices, n, rng);
  if (seeds.length === 0) return;

  const lots = seeds.length === 1
    ? [polygon.vertices as [number, number][]]
    : subdivideToLots(polygon, seeds);

  for (const lot of lots) {
    if (polygonArea(lot) < MIN_FOOTPRINT_AREA * 4) continue;

    // [Voronoi-polygon] Classify each lot edge: boundary (set back from polygon
    // boundary) or internal (shared between lots — no setback, buildings touch).
    const edgeInsets = computeEdgeInsets(lot, polygon.vertices, roadEdgeKeys);

    const footprint = insetPolygonSelective(lot, edgeInsets);
    if (!footprint || footprint.length < 3) continue;
    if (polygonArea(footprint) < MIN_FOOTPRINT_AREA) continue;

    out.push({
      vertices: footprint,
      solid: SOLID_BUILDING,
      polygonId: polygon.id,
    });
  }
}

// ─── Edge classification ──────────────────────────────────────────────────────

/**
 * For each edge of `lotVerts`, return the setback distance in pixels:
 *   • 0  — internal edge (midpoint is strictly inside the parent polygon)
 *   • 2  — boundary edge on a non-road parent polygon edge
 *   • 4  — boundary edge that falls on a road edge
 */
function computeEdgeInsets(
  lotVerts: [number, number][],
  parentVerts: [number, number][],
  roadEdgeKeys: Set<string>,
): number[] {
  const n = lotVerts.length;
  const insets: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const a = lotVerts[i];
    const b = lotVerts[(i + 1) % n];
    const midX = (a[0] + b[0]) * 0.5;
    const midY = (a[1] + b[1]) * 0.5;

    // Check if the edge midpoint lies on the parent polygon boundary.
    const parentEdgeIdx = findNearestParentEdge([midX, midY], parentVerts, BOUNDARY_TOLERANCE);
    if (parentEdgeIdx < 0) continue; // internal edge → leave inset at 0

    // Boundary edge — determine setback based on whether it is a road.
    const pv = parentVerts[parentEdgeIdx];
    const qv = parentVerts[(parentEdgeIdx + 1) % parentVerts.length];
    insets[i] = roadEdgeKeys.has(canonicalEdgeKey(pv, qv))
      ? ROAD_SETBACK_PX
      : DEFAULT_SETBACK_PX;
  }

  return insets;
}

// Returns the index of the nearest parent polygon edge whose distance to `p`
// is < `tolerance`, or -1 if none qualifies.
function findNearestParentEdge(
  p: [number, number],
  parentVerts: [number, number][],
  tolerance: number,
): number {
  const n = parentVerts.length;
  for (let i = 0; i < n; i++) {
    const a = parentVerts[i];
    const b = parentVerts[(i + 1) % n];
    if (pointSegmentDistance(p, a, b) < tolerance) return i;
  }
  return -1;
}

// ─── Selective parallel-offset inset ─────────────────────────────────────────

/**
 * Inset a (convex) polygon by per-edge distances. For each vertex the new
 * position is the intersection of the two adjacent offset edge-lines.
 *
 *   edgeInsets[i] = setback for the edge from verts[i] to verts[(i+1)%n].
 *
 * When both adjacent edges have inset=0 the vertex is unchanged.
 * When only one adjacent edge has a non-zero inset the vertex slides along
 * the opposite (un-shifted) edge — the building footprint reaches the lot
 * boundary on the internal side and is set back on the external side.
 */
function insetPolygonSelective(
  verts: [number, number][],
  edgeInsets: number[],
): [number, number][] | null {
  const n = verts.length;
  if (n < 3) return null;

  // Centroid for inward-normal direction disambiguation.
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

    const prevInset = edgeInsets[(i - 1 + n) % n]; // inset of edge prev→curr
    const currInset = edgeInsets[i];                // inset of edge curr→next

    // Fast path: both edges internal (inset=0) → vertex unchanged.
    if (prevInset === 0 && currInset === 0) {
      result.push([curr[0], curr[1]]);
      continue;
    }

    // Inward normal for edge prev→curr.
    const d1x = curr[0] - prev[0];
    const d1y = curr[1] - prev[1];
    const len1 = Math.hypot(d1x, d1y);
    if (len1 < 1e-6) { result.push([curr[0], curr[1]]); continue; }
    let n1x = -d1y / len1;
    let n1y =  d1x / len1;
    const mid1x = (prev[0] + curr[0]) * 0.5;
    const mid1y = (prev[1] + curr[1]) * 0.5;
    if (n1x * (cx - mid1x) + n1y * (cy - mid1y) < 0) { n1x = -n1x; n1y = -n1y; }

    // Inward normal for edge curr→next.
    const d2x = next[0] - curr[0];
    const d2y = next[1] - curr[1];
    const len2 = Math.hypot(d2x, d2y);
    if (len2 < 1e-6) { result.push([curr[0], curr[1]]); continue; }
    let n2x = -d2y / len2;
    let n2y =  d2x / len2;
    const mid2x = (curr[0] + next[0]) * 0.5;
    const mid2y = (curr[1] + next[1]) * 0.5;
    if (n2x * (cx - mid2x) + n2y * (cy - mid2y) < 0) { n2x = -n2x; n2y = -n2y; }

    // Offset the two edge-lines by their respective inset amounts, then intersect.
    const a1: [number, number] = [prev[0] + n1x * prevInset, prev[1] + n1y * prevInset];
    const b1: [number, number] = [curr[0] + n1x * prevInset, curr[1] + n1y * prevInset];
    const a2: [number, number] = [curr[0] + n2x * currInset, curr[1] + n2y * currInset];
    const b2: [number, number] = [next[0] + n2x * currInset, next[1] + n2y * currInset];

    const p = lineIntersect(a1, b1, a2, b2);
    result.push(p ?? [(b1[0] + a2[0]) * 0.5, (b1[1] + a2[1]) * 0.5]);
  }

  return result.length >= 3 ? result : null;
}

// ─── Seed generation ─────────────────────────────────────────────────────────

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

// [Voronoi-polygon] Sutherland–Hodgman polygon clipping.
// Winding of `clip` is detected at runtime (positive shoelace sum = CW in
// screen-space, the D3 Voronoi convention). For each clip edge the algorithm
// uses a cross-product "inside" test consistent with the detected winding.
function sutherlandHodgmanClip(
  subject: [number, number][],
  clip: [number, number][],
): [number, number][] {
  let clipSum = 0;
  const cn = clip.length;
  for (let i = 0; i < cn; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % cn];
    clipSum += ax * by - bx * ay;
  }
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

// ─── Road edge key helpers ────────────────────────────────────────────────────

// Same precision constant as cityMapEdgeGraph.ts so keys computed from the
// same polygon vertex coordinates collate identically.
function roundV(x: number): number {
  return Math.round(x * VERTEX_PRECISION) / VERTEX_PRECISION;
}

function canonicalEdgeKey(
  a: [number, number],
  b: [number, number],
): string {
  const ka = `${roundV(a[0])},${roundV(a[1])}`;
  const kb = `${roundV(b[0])},${roundV(b[1])}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function buildRoadEdgeKeys(roads: [number, number][][]): Set<string> {
  const keys = new Set<string>();
  for (const path of roads) {
    for (let i = 0; i < path.length - 1; i++) {
      keys.add(canonicalEdgeKey(path[i], path[i + 1]));
    }
  }
  return keys;
}

// ─── Local geometry helpers ───────────────────────────────────────────────────

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

function edgeCross(
  a: [number, number],
  b: [number, number],
  p: [number, number],
): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

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

function pointSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

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
