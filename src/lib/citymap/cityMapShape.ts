// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — city footprint allocation (organic shape selection)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Every city renders on a fixed 1500-polygon canvas (`CANVAS_POLYGON_COUNT`
// in `cityMapGeneratorV2.ts`). This module picks WHICH polygons make up the
// actual built city — the set the wall traces around. The number of polygons
// per size tier comes from the single-source `POLYGON_COUNTS` table in
// `cityMapGeneratorV2.ts`.
//
// Allocation grows from the canvas center outwards, biased by an organic
// shape sampled from a fixed distribution:
//
//   spheroid     50%   ellipse with random orientation + mild aspect
//   rectangle    30%   long-axis rectangle, random orientation + aspect
//   half-sphere  15%   half-ellipse cut along a random diameter
//   triangle      5%   equilateral triangle, random orientation
//
// Algorithm:
//   1. Pick a shape via the weighted RNG (`_shape` sub-stream).
//   2. Score every non-edge polygon by `shapeDistance(polygon.site - center)`
//      plus an FBM perturbation (organic, jagged outline rather than a
//      rigid mathematical curve). `shapeDistance` is normalized so 0 is at
//      the canvas center, ~1 sits on the shape boundary, and > 1 is outside
//      (with a large penalty for the wrong side of half-sphere cuts).
//   3. Sort ascending and take the lowest N polygons (N = POLYGON_COUNTS[size]).
//   4. BFS-prune to the connected component containing the most-central
//      polygon — the same trick `cityMapWalls.ts` used to use.
//   5. Hole-fill from the `polygon.isEdge` frontier inward.
//
// `polygon.isEdge` polygons (touching the canvas bbox) are intentionally
// NEVER candidates: walls + city sit inside the canvas, the outer ring
// belongs to PR 5 sprawl.
//
// The result is consumed by `cityMapWalls.ts::generateWallsAndGates` as the
// pre-computed interior set; walls no longer compute their own footprint.
//
// RNG sub-streams (both fan off the shared `${seed}_city_${cityName}_` prefix
// per the CLAUDE.md V2 streaming convention):
//   `${seed}_city_${cityName}_shape`        — shape pick + orientation + aspect
//   `${seed}_city_${cityName}_shape_noise`  — FBM perturbation samplers
// ─────────────────────────────────────────────────────────────────────────────

import { createNoiseSamplers, fbm, seededPRNG } from '../terrain/noise';
import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';

export type CityShapeType = 'spheroid' | 'rectangle' | 'half-sphere' | 'triangle';

export interface CityFootprintResult {
  /** Polygon ids that make up the actual built city. */
  interior: Set<number>;
  /** Which shape was picked for this city. */
  shapeType: CityShapeType;
}

// ─── Tuning ────────────────────────────────────────────────────────────────

// Weighted shape distribution. Cumulative thresholds make the picker a
// single `rng()` compare-chain.
const SHAPE_THRESHOLDS: Array<{ type: CityShapeType; cumulative: number }> = [
  { type: 'spheroid',    cumulative: 0.50 },
  { type: 'rectangle',   cumulative: 0.80 },
  { type: 'half-sphere', cumulative: 0.95 },
  { type: 'triangle',    cumulative: 1.00 },
];

// Spheroid aspect ratio (minor / major). Slight squash so the spheroid
// reads as "roundish" not "thin oval".
const SPHEROID_ASPECT_MIN = 0.75;
const SPHEROID_ASPECT_MAX = 1.00;

// Rectangle aspect ratio (short side / long side). The user spec says
// "one side longer than the other" — clamp short side to ≤ 65% of long.
const RECTANGLE_ASPECT_MIN = 0.40;
const RECTANGLE_ASPECT_MAX = 0.65;

// Half-sphere: aspect of the disc that gets bisected. Same range as
// spheroid so the half doesn't read as flatter than the full circle.
const HALF_SPHERE_ASPECT_MIN = 0.85;
const HALF_SPHERE_ASPECT_MAX = 1.00;

// FBM perturbation applied to each polygon's shape distance. Same scale +
// amplitude `cityMapWalls.ts` used to use for its old radial-distance score
// — produces the jagged organic outline instead of a smooth curve.
const FBM_SCALE = 0.01;
const FBM_AMPLITUDE = 0.6;

// Penalty added to the shape distance for polygons sitting on the wrong
// side of a half-sphere cut. Anything > 1 is "outside the shape"; this
// pushes wrong-side polygons all the way to the back of the sort so they
// only get picked if N exceeds the half's polygon capacity.
const HALF_SPHERE_WRONG_SIDE_PENALTY = 100;

/**
 * Pick a city shape and allocate `POLYGON_COUNTS[env.size]` polygons for the
 * built city, growing outward from the canvas center.
 *
 * Returns `{ interior: new Set(), shapeType: 'spheroid' }` on degenerate
 * input (no eligible non-edge polygons) so callers can always pass the
 * result through without special-casing.
 */
export function selectCityFootprint(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  canvasSize: number,
  cityPolygonCount: number,
): CityFootprintResult {
  // Reserved for future shape-orientation hooks (e.g. align the rectangle's
  // long axis with `env.waterSide`). Unused today.
  void env;

  const rng = seededPRNG(`${seed}_city_${cityName}_shape`);
  const samplers = createNoiseSamplers(`${seed}_city_${cityName}_shape_noise`);

  const shape = pickShape(rng);

  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const maxR = canvasSize / 2;

  type Scored = { id: number; score: number };
  const scored: Scored[] = [];
  for (const p of polygons) {
    if (p.isEdge) continue;
    const [sx, sy] = p.site;
    const sd = shape.distance(sx - cx, sy - cy, maxR);
    const noise = fbm(samplers.elevation, sx * FBM_SCALE, sy * FBM_SCALE, 4);
    const perturb = (noise - 0.5) * FBM_AMPLITUDE;
    scored.push({ id: p.id, score: sd + perturb });
  }
  if (scored.length === 0) return { interior: new Set(), shapeType: shape.type };

  // Deterministic order: score ascending, then id ascending as tie-breaker.
  scored.sort((a, b) => (a.score - b.score) || (a.id - b.id));

  const targetCount = Math.max(1, Math.min(cityPolygonCount, scored.length));
  const initial = new Set<number>();
  for (let i = 0; i < targetCount; i++) {
    initial.add(scored[i].id);
  }

  // BFS-prune to the connected component containing the most-central
  // (lowest-scored) polygon. Mirrors the discarded coverage logic in
  // `cityMapWalls.ts::selectInteriorPolygons` but seeded from the
  // best-scoring candidate rather than a "closest to center" recompute.
  const seedId = scored[0].id;
  const interior = new Set<number>();
  interior.add(seedId);
  const queue: number[] = [seedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (initial.has(nb) && !interior.has(nb)) {
        interior.add(nb);
        queue.push(nb);
      }
    }
  }

  // Hole-fill: flood from the `polygon.isEdge` frontier inward over
  // non-interior polygons. Anything the flood can't reach AND isn't
  // already interior must be a hole — flip it to interior so the wall
  // trace doesn't loop around it.
  const exterior = new Set<number>();
  const exQueue: number[] = [];
  for (const p of polygons) {
    if (p.isEdge && !interior.has(p.id)) {
      exterior.add(p.id);
      exQueue.push(p.id);
    }
  }
  while (exQueue.length > 0) {
    const id = exQueue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (interior.has(nb) || exterior.has(nb)) continue;
      exterior.add(nb);
      exQueue.push(nb);
    }
  }
  for (const p of polygons) {
    if (!interior.has(p.id) && !exterior.has(p.id)) {
      interior.add(p.id);
    }
  }

  return { interior, shapeType: shape.type };
}

// ─── Shape definitions ─────────────────────────────────────────────────────

interface ShapeFn {
  type: CityShapeType;
  /**
   * Normalized "distance" from canvas center under the shape:
   *   ≈ 0 at center, ≈ 1 at the shape boundary, > 1 outside.
   * `dx` / `dy` are pixel offsets from the canvas center; `maxR` is
   * `canvasSize / 2` so the function can normalize against canvas scale.
   */
  distance(dx: number, dy: number, maxR: number): number;
}

function pickShape(rng: () => number): ShapeFn {
  const r = rng();
  let type: CityShapeType = 'spheroid';
  for (const t of SHAPE_THRESHOLDS) {
    if (r < t.cumulative) { type = t.type; break; }
  }

  const theta = rng() * Math.PI * 2;

  switch (type) {
    case 'spheroid': {
      const aspect = lerp(SPHEROID_ASPECT_MIN, SPHEROID_ASPECT_MAX, rng());
      return spheroidShape(theta, aspect);
    }
    case 'rectangle': {
      const aspect = lerp(RECTANGLE_ASPECT_MIN, RECTANGLE_ASPECT_MAX, rng());
      return rectangleShape(theta, aspect);
    }
    case 'half-sphere': {
      const aspect = lerp(HALF_SPHERE_ASPECT_MIN, HALF_SPHERE_ASPECT_MAX, rng());
      return halfSphereShape(theta, aspect);
    }
    case 'triangle': {
      return triangleShape(theta);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Ellipse with major axis along `theta` and minor/major = `aspect`.
function spheroidShape(theta: number, aspect: number): ShapeFn {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    type: 'spheroid',
    distance(dx, dy, maxR) {
      // Rotate into shape-local frame.
      const x =  dx * c + dy * s;
      const y = -dx * s + dy * c;
      // Anisotropic norm: minor axis = `aspect * major`. Scale the y
      // component so the boundary ellipse becomes a unit circle.
      const r = Math.sqrt(x * x + (y / aspect) * (y / aspect));
      return r / maxR;
    },
  };
}

// Long rectangle with long axis along `theta`. `aspect` is short/long.
function rectangleShape(theta: number, aspect: number): ShapeFn {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    type: 'rectangle',
    distance(dx, dy, maxR) {
      const x =  dx * c + dy * s;
      const y = -dx * s + dy * c;
      // Chebyshev metric, anisotropic in the short axis.
      return Math.max(Math.abs(x), Math.abs(y) / aspect) / maxR;
    },
  };
}

// Half-ellipse cut along the diameter at angle `theta`. The "kept" half is
// the half-plane where the projection along the cut-perpendicular axis is
// non-negative; the other half receives a large penalty so it sorts last.
function halfSphereShape(theta: number, aspect: number): ShapeFn {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    type: 'half-sphere',
    distance(dx, dy, maxR) {
      // x = along the diameter, y = perpendicular to it.
      const x =  dx * c + dy * s;
      const y = -dx * s + dy * c;
      const r = Math.sqrt(x * x + (y / aspect) * (y / aspect)) / maxR;
      // Wrong half: y < 0. Penalize so it only gets picked after the
      // entire correct half is exhausted.
      return y >= 0 ? r : r + HALF_SPHERE_WRONG_SIDE_PENALTY;
    },
  };
}

// Equilateral triangle centered at the canvas center, with one vertex at
// angle `theta` (and the other two at `theta ± 2π/3`) inscribed in the
// circle of radius `maxR`.
function triangleShape(theta: number): ShapeFn {
  // The three edge midpoints sit at `theta + π/3 + k·2π/3`. The polygon's
  // boundary distance in any direction `a` is the inscribed radius (R/2)
  // divided by the cosine of the angle between `a` and the nearest edge
  // midpoint direction.
  const midpointAngleOffset = theta + Math.PI / 3;
  const SECTOR = (2 * Math.PI) / 3;
  const HALF_SECTOR = Math.PI / 3;
  return {
    type: 'triangle',
    distance(dx, dy, maxR) {
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r === 0) return 0;
      const a = Math.atan2(dy, dx);
      // Wrap (a - midpointAngleOffset) into [-HALF_SECTOR, +HALF_SECTOR].
      let delta = (a - midpointAngleOffset) % SECTOR;
      if (delta >  HALF_SECTOR) delta -= SECTOR;
      if (delta < -HALF_SECTOR) delta += SECTOR;
      // Boundary radius (relative to triangle circumradius = 1): 0.5
      // toward an edge midpoint, 1.0 toward a vertex.
      const boundaryR = 0.5 / Math.cos(delta);
      // Triangle is inscribed in the canvas-radius circle, so absolute
      // boundary radius is `boundaryR * maxR`.
      return r / (boundaryR * maxR);
    },
  };
}

