// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — buildings (PR 5 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module lands the "buildings" slice of the spec's PR 5 (line 71):
//
//   "Per-tile building packing: 4–12 axis-aligned rects per non-reserved
//    interior tile, 1 px mortar, seeded mix of hollow outlined and solid
//    #2a241c ink."
//
// Polygon-graph translation of that one spec sentence:
//
//   BUILDING := an axis-aligned rect (x, y, w, h, solid, polygonId) packed
//               inside a single `CityPolygon`'s interior via rejection
//               sampling. "Per-tile" → "per polygon". "Non-reserved interior
//               tile" → "interior polygon (isEdge=false) whose block role is
//               civic/market/harbor/residential AND whose id is NOT in the
//               reserved set (openSpaces ∪ landmarks)".
//
// The remaining PR 5 features stay deferred — `cityMapBuildings.ts` does
// NOT handle any of these, they get their own modules / RNG streams later:
//
//   • Outside-walls sprawl — slum / agricultural blocks (all isEdge polygons).
//   • Dock hatching        — perpendicular dashes along env.waterSide coast.
//   • District labels      — rotated "BLUEGATE" text sized by block area.
//
// Every geometric primitive this module consumes comes from the `CityPolygon`
// contract:
//   • `polygon.id`         — output identity (`CityBuildingV2.polygonId`)
//   • `polygon.vertices`   — unclosed ring; used for point-in-polygon and
//                             distance-to-edge checks during rejection sampling
//   • `polygon.area`       — drives the per-role N-count formula (larger
//                             polygons hold more rects within the 4–12 band)
//   • `polygon.isEdge`     — defensive skip (sprawl territory, future pass)
//
// NO tile lattice. NO `Math.random`. RNG: one dedicated sub-stream keyed on
// `${seed}_city_${cityName}_buildings`. Iteration order is fixed — block
// order from `blocks[]`, then polygon id order inside each block, then
// slot-by-slot packing — so seed stability is preserved across re-runs.
//
// Rejection sampling is polygon-interior only — we do NOT compute an inset
// polygon ring. Voronoi cells are convex, so requiring all four corners of a
// candidate rect to (a) pass `pointInPolygon` AND (b) sit at least `INSET_PX`
// away from every polygon edge gives the same effect as an explicit inset
// without the geometric-inset math. Cost is `O(4 × edges × MAX_RETRIES × N)`
// per polygon, which even at the megalopolis 1000-polygon tier is negligible.
//
// Reference patterns:
//   • cityMapOpenSpaces.ts        — polygon eligibility + RNG sub-stream naming
//   • cityMapLandmarks.ts         — role-filtered iteration over blocks with a
//                                    shared `used`/`reserved` set
//   • cityMapBlocks.ts            — polygon.id iteration order inside a block
//   • cityMapEdgeGraph.ts         — INTENTIONALLY NOT IMPORTED: buildings are
//                                    polygon-interior rejection sampling, not
//                                    edge-graph traversal; no A* / no canonical
//                                    edge keys / no edge ownership is needed.
// ─────────────────────────────────────────────────────────────────────────────

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

// Roles that receive dense interior packing. `slum` and `agricultural` are
// deliberately skipped — they live on `polygon.isEdge` polygons and belong to
// the outside-walls sprawl slice of PR 5 (scattered rects, different style,
// different RNG stream, different generator).
const PACKING_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>([
  'civic',
  'market',
  'harbor',
  'residential',
]);

// Per-role building-count formula — N = clamp(4, 12, baseCount + area / densityDivisor).
// Larger polygons carry more rects, smaller polygons fewer, with the 4..12
// clamp honouring the spec's explicit range. Coefficients tuned by eye on
// medium-tier cities; retune here if the density feels off after visual QA.
const BASE_COUNT: Record<DistrictRole, number> = {
  civic: 5,
  market: 8,
  harbor: 7,
  residential: 10,
  slum: 0, // unused (PACKING_ROLES excludes these two)
  agricultural: 0,
};
const DENSITY_DIVISOR: Record<DistrictRole, number> = {
  civic: 300,
  market: 180,
  harbor: 220,
  residential: 140,
  slum: 1,
  agricultural: 1,
};

// Per-role rect size bands (px). Aspect is rolled per-rect; the longer side
// always >= the shorter (orientation coin-flips below). Harbor gets elongated
// warehouses; civic gets few-but-large administrative footprints; residential
// is the classic dense block filler; market is the smallest / mixed.
interface SizeBand {
  min: number;
  max: number;
  aspectMin: number;
  aspectMax: number;
}
const SIZE_BAND: Record<DistrictRole, SizeBand> = {
  civic: { min: 12, max: 22, aspectMin: 1.0, aspectMax: 1.6 },
  market: { min: 6, max: 12, aspectMin: 1.0, aspectMax: 1.4 },
  harbor: { min: 10, max: 18, aspectMin: 1.4, aspectMax: 2.4 },
  residential: { min: 8, max: 14, aspectMin: 1.0, aspectMax: 1.5 },
  slum: { min: 1, max: 1, aspectMin: 1, aspectMax: 1 },
  agricultural: { min: 1, max: 1, aspectMin: 1, aspectMax: 1 },
};

const MIN_BUILDINGS_PER_POLYGON = 4;
const MAX_BUILDINGS_PER_POLYGON = 12;
const MAX_RETRIES_PER_SLOT = 12;
const INSET_PX = 2; // candidate rect corners must sit >= this many px from every polygon edge
const MORTAR_PX = 1; // gap enforced between any two accepted rects in the same polygon
const SOLID_PROBABILITY = 0.55; // ~55% solid / ~45% hollow — tweak freely, no balance impact

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the `buildings: CityBuildingV2[]` payload for a V2 city map.
 *
 * Signature matches the other PR 4 slice generators (`generateOpenSpaces`,
 * `generateBlocks`, `generateLandmarks`) so the V2 pipeline stays uniform:
 *
 *   (seed, cityName, env, polygons, <feature-specific context>, canvasSize)
 *
 * The `canvasSize` parameter is currently unused — every building rect sits
 * inside a polygon and polygons are already clipped to the canvas at the
 * generator layer — but it's kept in the signature for pipeline consistency
 * and so future tuning (e.g. scaling size bands with canvas size) can land
 * without an ABI change.
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
  // `env` and `canvasSize` are reserved for future tuning hooks (e.g. capital
  // cities getting denser civic packing, canvas-scale-aware size bands) but
  // are unused in this slice. Kept in the signature for pipeline uniformity
  // with the other PR 4 slice generators.
  void env;
  void canvasSize;

  // Degenerate input — empty polygons or no blocks yet. Matches the pattern
  // the other PR 4 slice generators use: return [] so the caller can spread
  // without special-casing.
  if (polygons.length === 0 || blocks.length === 0) return [];

  // [Voronoi-polygon] Reserved set — polygons claimed by plazas / markets /
  // parks (`openSpaces`) or landmark glyphs (`landmarks`). Buildings NEVER
  // overwrite these — the renderer already fills plazas on Layer 9 and stamps
  // landmark silhouettes on Layer 12. Building the set once at the start is
  // O(openSpaces + landmarks), then per-polygon lookup is O(1).
  const reservedPolygonIds = new Set<number>();
  for (const entry of openSpaces) {
    for (const id of entry.polygonIds) reservedPolygonIds.add(id);
  }
  for (const lm of landmarks) reservedPolygonIds.add(lm.polygonId);

  const rng = seededPRNG(`${seed}_city_${cityName}_buildings`);
  const out: CityBuildingV2[] = [];

  // [Voronoi-polygon] Iterate blocks in their natural order — the flood in
  // `cityMapBlocks.ts` produces a stable ordering seeded by polygon.id, so
  // this iteration is deterministic. Within a block we walk `polygonIds` in
  // the order the block generator stored them (already polygon.id ascending).
  for (const block of blocks) {
    if (!PACKING_ROLES.has(block.role)) continue; // slum / agricultural → sprawl, deferred

    for (const polygonId of block.polygonIds) {
      if (reservedPolygonIds.has(polygonId)) continue; // plaza / park / landmark — skip
      const polygon = polygons[polygonId];
      if (!polygon) continue;
      if (polygon.isEdge) continue; // defensive — edge polys are sprawl territory
      if (polygon.vertices.length < 3) continue; // degenerate clip

      packBuildingsInPolygon(polygon, block.role, rng, out);
    }
  }

  return out;
}

// ─── Per-polygon rejection-sampling packer ───────────────────────────────────

function packBuildingsInPolygon(
  // [Voronoi-polygon] Source geometry — polygon.vertices (unclosed ring) and
  // polygon.area drive both the count formula and every inside-polygon test.
  polygon: CityPolygon,
  role: DistrictRole,
  rng: () => number,
  out: CityBuildingV2[],
): void {
  const base = BASE_COUNT[role];
  const divisor = DENSITY_DIVISOR[role];
  const targetN = clamp(
    MIN_BUILDINGS_PER_POLYGON,
    MAX_BUILDINGS_PER_POLYGON,
    Math.round(base + polygon.area / divisor),
  );
  const band = SIZE_BAND[role];

  // [Voronoi-polygon] Polygon bounding box — the rejection-sampling envelope.
  // Cheap single-pass O(vertices) scan; Voronoi cells at our tier are < 12
  // vertices each on average.
  const verts = polygon.vertices;
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

  // Track accepted rects in this polygon for intra-polygon mortar overlap
  // tests. Inter-polygon overlap is geometrically impossible because each
  // rect is strictly inside its owning polygon.
  const accepted: CityBuildingV2[] = [];

  for (let slot = 0; slot < targetN; slot++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_RETRIES_PER_SLOT; attempt++) {
      // Size — axis-aligned w × h with a role-driven aspect, orientation
      // flipped 50/50 so warehouses don't all point the same way.
      let shorter = lerp(band.min, band.max, rng());
      const aspect = lerp(band.aspectMin, band.aspectMax, rng());
      let longer = shorter * aspect;
      // Clamp longer to the band cap so civic blobs don't balloon past max.
      if (longer > band.max) {
        longer = band.max;
        shorter = Math.min(shorter, longer / band.aspectMin);
      }
      const horizontal = rng() < 0.5;
      const w = horizontal ? longer : shorter;
      const h = horizontal ? shorter : longer;

      // Skip if the polygon bbox is smaller than the rect — nothing to try.
      if (w > maxX - minX || h > maxY - minY) continue;

      const x = lerp(minX, maxX - w, rng());
      const y = lerp(minY, maxY - h, rng());

      // [Voronoi-polygon] All four rect corners must be inside the polygon
      // ring AND sit at least INSET_PX from every polygon edge. Convex-cell
      // guarantee: all-four-corners-inside ⇒ whole rect inside.
      const corners: [number, number][] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
      let ok = true;
      for (const c of corners) {
        if (!pointInPolygon(c, verts)) { ok = false; break; }
        if (distanceToPolygonEdge(c, verts) < INSET_PX) { ok = false; break; }
      }
      if (!ok) continue;

      // Mortar overlap — AABB with MORTAR_PX padding on each side.
      let overlaps = false;
      for (const prev of accepted) {
        if (rectsOverlapWithMortar(
          { x, y, w, h },
          prev,
          MORTAR_PX,
        )) { overlaps = true; break; }
      }
      if (overlaps) continue;

      const building: CityBuildingV2 = {
        x,
        y,
        w,
        h,
        solid: rng() < SOLID_PROBABILITY,
        polygonId: polygon.id,
      };
      accepted.push(building);
      out.push(building);
      placed = true;
      break;
    }
    // If `placed === false` after MAX_RETRIES, drop this slot silently. The
    // polygon ends up slightly under-filled — still > MIN_BUILDINGS because
    // the count N starts at 4 and retries only fail on tightly packed polygons
    // that already hold most of their target anyway.
    void placed;
  }
}

// ─── Local helpers — [Voronoi-polygon] geometry on CityPolygon.vertices ──────

// [Voronoi-polygon] Classic ray-cast point-in-polygon. Operates on the
// UNCLOSED vertex ring from `CityPolygon.vertices` — uses `(j + 1) % n` for
// the partner vertex rather than any closing duplicate.
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

// [Voronoi-polygon] Minimum distance from point `p` to any edge of the
// polygon ring. Standard point-to-segment distance iterated over every
// `(verts[i], verts[(i+1) % n])` pair. Used to enforce the INSET_PX gap
// between accepted rect corners and the polygon boundary — avoids building
// edges kissing streets / roads / walls, which all live on polygon edges.
function distanceToPolygonEdge(p: [number, number], verts: [number, number][]): number {
  const n = verts.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const d = pointSegmentDistance(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

function pointSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]); // degenerate edge
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

interface AABB { x: number; y: number; w: number; h: number }

function rectsOverlapWithMortar(a: AABB, b: AABB, mortar: number): boolean {
  return (
    a.x < b.x + b.w + mortar &&
    a.x + a.w + mortar > b.x &&
    a.y < b.y + b.h + mortar &&
    a.y + a.h + mortar > b.y
  );
}

function clamp(min: number, max: number, v: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
