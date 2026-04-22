// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — outside-walls sprawl (PR 5 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module lands the "outside-walls fringe" slice of the spec's PR 5
// (line 73 of specs/City_style_phases.md):
//
//   "Outside-walls fringe: sparse scattered building rects in fringe tiles."
//
// And PR 5's companion entry in the "City map components" section (line 23):
//
//   "Cities will show some sparse buildings in cells out of their area; the
//    bigger the city the more such sparse buildings."
//
// Polygon-graph translation:
//
//   SPRAWL BUILDING := a small building footprint polygon inside a `slum` or
//                      `agricultural` block polygon. The footprint is produced
//                      by shrinking the parent polygon toward its centroid and
//                      capping the result at SPRAWL_MAX_RADIUS_PX, giving an
//                      isolated hut / farmhouse effect with plenty of open
//                      space around it.
//
// Unlike the interior buildings module (`cityMapBuildings.ts`) which Voronoi-
// subdivides each polygon into multiple lots, sprawl produces AT MOST ONE
// building per polygon.  Whether a given polygon gets a building is governed
// by a per-roll probability scaled by tier and role, so megalopolis fringes
// read visibly busier than small-city fringes (spec line 23).
//
// Building size is bounded by SPRAWL_MAX_RADIUS_PX regardless of how large the
// parent polygon is — edge polygons that extend to the canvas boundary can be
// hundreds of pixels wide, but the building itself should read as a small hut,
// not as another dense block.
//
// NO tile lattice.  NO `Math.random`.  RNG: one dedicated sub-stream keyed on
// `${seed}_city_${cityName}_sprawl` — independent from `_buildings` and every
// other PR 5 sub-stream.  Iteration order is block order → polygon.id order →
// probability roll → solid roll, fully deterministic across re-runs.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CitySize } from './cityMapTypesV2';
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

type SprawlRole = 'slum' | 'agricultural';

const SPRAWL_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>([
  'slum',
  'agricultural',
]);

// Base probability (per polygon) that a building is placed, before tier scaling.
// slum clusters a bit more densely than agricultural — shanty huts vs. lone farmhouses.
const SPRAWL_PROB_BASE: Record<SprawlRole, number> = {
  slum: 0.55,
  agricultural: 0.35,
};

// Per-size-tier multiplier on the base probability (spec line 23).
const SPRAWL_TIER_SCALE: Record<CitySize, number> = {
  small: 0.5,
  medium: 0.75,
  large: 1.0,
  metropolis: 1.15,
  megalopolis: 1.3,
};

// How far toward the polygon centroid each vertex is moved (fraction of the
// vertex-to-centroid distance). Larger fraction → smaller building relative
// to its lot. 0.58 leaves each building at ~42% of the lot's extent — clearly
// "floating in the lot" and visually sparse.
const SPRAWL_SHRINK_FRACTION = 0.58;

// Hard cap on the building "radius" (max vertex-to-centroid distance after
// shrinking). Prevents edge polygons that extend to the canvas boundary from
// producing buildings that look like interior blocks.
const SPRAWL_MAX_RADIUS_PX = 14;

// Minimum area of the resulting footprint — degenerate tiny polygons are dropped.
const MIN_SPRAWL_FOOTPRINT_AREA = 9;

// Mix of solid vs. hollow — slightly more hollow than interior buildings
// so sprawl reads airier.
const SPRAWL_SOLID_PROBABILITY = 0.45;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate `sprawlBuildings: CityBuildingV2[]` for a V2 city map.
 *
 * Each building is a small polygon footprint produced by shrinking the parent
 * polygon toward its centroid and capping its radius.
 */
export function generateSprawl(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: CityMapDataV2['openSpaces'],
  landmarks: CityLandmarkV2[],
  canvasSize: number,
): CityBuildingV2[] {
  void canvasSize;

  if (polygons.length === 0 || blocks.length === 0) return [];

  const reservedPolygonIds = new Set<number>();
  for (const entry of openSpaces) {
    for (const id of entry.polygonIds) reservedPolygonIds.add(id);
  }
  for (const lm of landmarks) reservedPolygonIds.add(lm.polygonId);

  const rng = seededPRNG(`${seed}_city_${cityName}_sprawl`);
  const tierScale = SPRAWL_TIER_SCALE[env.size];
  const out: CityBuildingV2[] = [];

  for (const block of blocks) {
    if (!SPRAWL_ROLES.has(block.role)) continue;
    const role = block.role as SprawlRole;

    for (const polygonId of block.polygonIds) {
      if (reservedPolygonIds.has(polygonId)) continue;
      const polygon = polygons[polygonId];
      if (!polygon) continue;
      if (polygon.vertices.length < 3) continue;

      placeSprawlBuilding(polygon, role, tierScale, rng, out);
    }
  }

  return out;
}

// ─── Per-polygon placement ────────────────────────────────────────────────────

function placeSprawlBuilding(
  polygon: CityPolygon,
  role: SprawlRole,
  tierScale: number,
  rng: () => number,
  out: CityBuildingV2[],
): void {
  // Probabilistic placement — not every fringe polygon gets a building.
  const prob = Math.min(1, SPRAWL_PROB_BASE[role] * tierScale);
  if (rng() > prob) return;

  // [Voronoi-polygon] Shrink toward centroid to produce a small hut footprint.
  const footprint = shrinkTowardCentroid(polygon.vertices, SPRAWL_SHRINK_FRACTION);
  if (!footprint || footprint.length < 3) return;

  // [Voronoi-polygon] Cap the building radius so large edge polygons don't
  // produce oversized sprawl buildings.
  const capped = capRadius(footprint, SPRAWL_MAX_RADIUS_PX);

  if (polygonArea(capped) < MIN_SPRAWL_FOOTPRINT_AREA) return;

  out.push({
    vertices: capped,
    solid: rng() < SPRAWL_SOLID_PROBABILITY,
    polygonId: polygon.id,
  });
}

// ─── Local helpers — [Voronoi-polygon] geometry ───────────────────────────────

// [Voronoi-polygon] Move each vertex a fraction of the way toward the polygon
// centroid. `fraction` = 0 leaves the polygon unchanged; `fraction` = 1 collapses
// it to the centroid point. The result has the same shape but is uniformly
// smaller — appropriate for isolated sprawl buildings.
function shrinkTowardCentroid(
  verts: [number, number][],
  fraction: number,
): [number, number][] | null {
  const n = verts.length;
  if (n < 3) return null;

  let cx = 0;
  let cy = 0;
  for (const [x, y] of verts) { cx += x; cy += y; }
  cx /= n;
  cy /= n;

  const keep = 1 - fraction;
  return verts.map(([x, y]) => [
    cx + (x - cx) * keep,
    cy + (y - cy) * keep,
  ] as [number, number]);
}

// [Voronoi-polygon] If the polygon's maximum vertex-to-centroid distance exceeds
// `maxRadius`, scale all vertices toward the centroid uniformly so the distance
// equals `maxRadius`. Leaves polygons that are already small enough unchanged.
function capRadius(
  verts: [number, number][],
  maxRadius: number,
): [number, number][] {
  const n = verts.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of verts) { cx += x; cy += y; }
  cx /= n;
  cy /= n;

  let maxDist = 0;
  for (const [x, y] of verts) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > maxDist) maxDist = d;
  }

  if (maxDist <= maxRadius || maxDist < 1e-6) return verts;

  const scale = maxRadius / maxDist;
  return verts.map(([x, y]) => [
    cx + (x - cx) * scale,
    cy + (y - cy) * scale,
  ] as [number, number]);
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
