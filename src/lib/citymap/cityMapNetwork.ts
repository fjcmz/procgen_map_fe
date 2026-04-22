// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — roads + streets + bridges (PR 3 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module owns three sibling responsibilities that all route along
// the polygon edge graph produced by `cityMapEdgeGraph.ts`:
//
//   Roads    — A* from each gate's nearest polygon vertex to the polygon
//              vertex nearest canvas center; turn penalty biases straight
//              runs; moderate cost for crossing river edges.
//   Streets  — space-filling pass that keeps adding short A* routes until
//              every interior polygon is "served" (has ≥1 edge on the
//              covered set OR a served Delaunay neighbor). Matches the
//              spec's "within ≤1 tile" constraint translated to polygon
//              adjacency.
//   Bridges  — set intersection of road edges and river edges (canonical
//              edge keys). Fully deterministic, no RNG.
//
// RNG streams:
//   `${seed}_city_${cityName}_roads`   — per-step noise + gate order.
//   `${seed}_city_${cityName}_streets` — random polygon pick + vertex pick.
// Bridges use no RNG.
//
// V1 reference (tile-based): src/lib/citymap/cityMapGenerator.ts:589-765.
// We mirror the V1 *stages* (gate→center A* with turn penalty; street
// space-fill until every interior unit is served; road∩river = bridge)
// but run them on polygon vertices + Voronoi edges, never tile corners.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';
import {
  aStarEdgeGraph,
  canonicalEdgeKey,
  keyPathToPoints,
  nearestVertexKey,
  vertexKey,
  type EdgeNeighbor,
  type Point,
  type PolygonEdgeGraph,
} from './cityMapEdgeGraph';
import type { WallGenerationResult } from './cityMapWalls';
import type { RiverGenerationResult } from './cityMapRiver';

// Turn penalty threshold. A "straight continuation" is when the dot product
// of consecutive normalized edge directions is >= this. V1 matched directly
// by (dx, dy) equality on a unit lattice; polygon edges have arbitrary
// direction so we use a normalized-dot threshold instead.
const ROAD_STRAIGHT_DOT_THRESHOLD = 0.7;
// Penalty coefficients (multiplied by edgeLen to stay dimensionally aligned
// with the main straight-line bias).
const ROAD_TURN_PENALTY_COEFF = 1.2;
const ROAD_RIVER_COST_COEFF = 0.5;
const ROAD_NOISE_COEFF = 0.1;

// Streets space-filling caps (analogous to V1's 300 iteration budget).
const STREET_MAX_ITERATIONS = 300;
// Each short-street A* is bounded to avoid pathological full-graph searches.
const STREET_MAX_EXPANSIONS = 500;
// Short-street trimming: keep at most this many edges from each A* result so
// streets stay local and not mini-highways (V1 used `slice(0, 4)` on fallback).
const STREET_MAX_SEGMENTS = 10;

export interface NetworkGenerationResult {
  /** Bold paths from gates toward canvas center (one per gate). */
  roads: Point[][];
  /** Thin paths that fill the interior until every polygon is served. */
  streets: Point[][];
  /** Road edges that overlap river edges — rendered as bridges. */
  bridges: [Point, Point][];
  /** Straight exit lines from each gate outward to the canvas boundary. */
  exitRoads: Point[][];
}

/**
 * Generate roads, streets, and bridges on the polygon edge graph.
 *
 * Consumes the PR 2 wall footprint + gates, the PR 3 river (may be null
 * for non-river cities), and the shared polygon-edge graph. Returns
 * empty arrays on degenerate input (no gates, tiny graph) so the caller
 * can always spread without special-casing.
 */
export function generateNetwork(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  graph: PolygonEdgeGraph,
  wall: WallGenerationResult,
  river: RiverGenerationResult | null,
  canvasSize: number,
  waterPolygonIds?: Set<number>,
): NetworkGenerationResult {
  void env; // Reserved — PR 4+ may want to branch on env.size / env.waterSide here.

  if (polygons.length < 4) {
    return { roads: [], streets: [], bridges: [], exitRoads: [] };
  }

  // Precompute the river-edge key set so road cost + bridge detection are
  // O(1) lookups. Empty set when there's no river.
  const riverEdgeKeySet = new Set<string>();
  if (river) {
    for (const [a, b] of river.edges) {
      riverEdgeKeySet.add(canonicalEdgeKey(a, b));
    }
  }

  // Precompute the wall-edge key set for street-served coverage.
  const wallEdgeKeySet = new Set<string>();
  for (let i = 0; i < wall.wallPath.length - 1; i++) {
    wallEdgeKeySet.add(canonicalEdgeKey(wall.wallPath[i], wall.wallPath[i + 1]));
  }

  // [Voronoi-polygon] Precompute the water-edge key set — any polygon edge
  // whose ownership touches a water polygon. Roads / streets / exit-roads
  // must never cross water, so every cost function returns Infinity for
  // such edges (A* silently drops them per the cost-fn contract).
  const water = waterPolygonIds ?? new Set<number>();
  const waterEdgeKeySet = new Set<string>();
  if (water.size > 0) {
    for (const [eKey, rec] of graph.edges) {
      for (const pid of rec.polyIds) {
        if (water.has(pid)) { waterEdgeKeySet.add(eKey); break; }
      }
    }
  }

  // Target for every road: polygon vertex closest to canvas center.
  const centerTargetKey = nearestVertexKey(graph, [canvasSize / 2, canvasSize / 2]);
  if (!centerTargetKey) return { roads: [], streets: [], bridges: [], exitRoads: [] };

  // ── Roads ─────────────────────────────────────────────────────────────
  const roadRng = seededPRNG(`${seed}_city_${cityName}_roads`);
  const roadNoiseWeight = ROAD_NOISE_COEFF * graph.avgEdgeLen;
  const turnPenalty = ROAD_TURN_PENALTY_COEFF * graph.avgEdgeLen;
  const riverCost = ROAD_RIVER_COST_COEFF * graph.avgEdgeLen;

  const roads: Point[][] = [];
  const roadEdgeKeySet = new Set<string>();

  for (const gate of wall.gates) {
    const [ga, gb] = gate.edge;
    const midpoint: Point = [(ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2];
    const startKey = nearestVertexKey(graph, midpoint);
    if (!startKey || startKey === centerTargetKey) continue;

    // Road cost: edgeLen + turn penalty (if direction changes sharply) +
    // river-crossing nudge (allowed but mildly expensive) + small noise.
    // Water-polygon-adjacent edges return Infinity — roads never cross water.
    // The turn penalty uses the normalized edge direction so polygon edges
    // of different lengths are compared fairly.
    const roadCost = (
      currKey: string,
      currPoint: Point,
      nb: EdgeNeighbor,
      prevKey: string | null,
    ): number => {
      if (waterEdgeKeySet.has(nb.edgeKey)) return Infinity;
      let penalty = 0;
      if (prevKey !== null) {
        const prev = graph.vertexPoints.get(prevKey);
        if (prev) {
          const pdx = currPoint[0] - prev[0];
          const pdy = currPoint[1] - prev[1];
          const plen = Math.hypot(pdx, pdy) || 1;
          const edx = nb.point[0] - currPoint[0];
          const edy = nb.point[1] - currPoint[1];
          const elen = Math.hypot(edx, edy) || 1;
          const dot = (pdx * edx + pdy * edy) / (plen * elen);
          if (dot < ROAD_STRAIGHT_DOT_THRESHOLD) penalty += turnPenalty;
        }
      }
      if (riverEdgeKeySet.has(nb.edgeKey)) penalty += riverCost;
      void currKey;
      return nb.edgeLen + penalty + roadRng() * roadNoiseWeight;
    };

    const pathKeys = aStarEdgeGraph(graph, startKey, centerTargetKey, roadCost);
    if (!pathKeys || pathKeys.length < 2) continue;
    const pathPoints = keyPathToPoints(graph, pathKeys);
    roads.push(pathPoints);
    for (let i = 0; i < pathPoints.length - 1; i++) {
      roadEdgeKeySet.add(canonicalEdgeKey(pathPoints[i], pathPoints[i + 1]));
    }
  }

  // ── Streets ───────────────────────────────────────────────────────────
  // [Voronoi-polygon] "Served polygon" = has ≥1 ring edge in coveredEdges
  // (walls ∪ roads ∪ river). "Eligible for street" = not-served AND
  // no Delaunay neighbor is served. This translates the spec's "every
  // interior tile touches a street within ≤1 tile" to polygon-adjacency
  // distance.
  //
  // `isEdge` polygons are skipped because they're outside the walls and
  // will host PR 5's sprawl, not a walk-friendly street network.
  const streetRng = seededPRNG(`${seed}_city_${cityName}_streets`);
  const coveredEdgeKeys = new Set<string>([
    ...wallEdgeKeySet,
    ...roadEdgeKeySet,
    ...riverEdgeKeySet,
  ]);

  // Per-polygon canonical ring edge keys (computed once so the served check
  // stays O(ringLen) instead of O(ringLen) + string ops per iteration).
  const polygonEdgeKeys: string[][] = polygons.map(poly => {
    const keys: string[] = [];
    const verts = poly.vertices;
    const n = verts.length;
    if (n < 3) return keys;
    for (let i = 0; i < n; i++) {
      keys.push(canonicalEdgeKey(verts[i], verts[(i + 1) % n]));
    }
    return keys;
  });

  const isPolygonServed = (id: number): boolean => {
    const keys = polygonEdgeKeys[id];
    for (const k of keys) if (coveredEdgeKeys.has(k)) return true;
    return false;
  };

  const isEligibleFrontier = (id: number): boolean => {
    const poly = polygons[id];
    if (poly.isEdge) return false;
    if (water.has(id)) return false; // streets never route onto water
    if (isPolygonServed(id)) return false;
    for (const nb of poly.neighbors) {
      if (isPolygonServed(nb)) return false;
    }
    return true;
  };

  const collectFrontier = (): number[] => {
    const out: number[] = [];
    for (const poly of polygons) {
      if (isEligibleFrontier(poly.id)) out.push(poly.id);
    }
    return out;
  };

  // Streets cost: distance-biased with tiny noise. No turn penalty (city
  // streets can be windy); river-crossing is moderately discouraged so
  // streets don't pile bridges the renderer can't afford to draw.
  // Water-polygon-adjacent edges return Infinity — streets never cross water.
  const streetCost = (
    _currKey: string,
    _currPoint: Point,
    nb: EdgeNeighbor,
  ): number => {
    if (waterEdgeKeySet.has(nb.edgeKey)) return Infinity;
    const riverPenalty = riverEdgeKeySet.has(nb.edgeKey) ? riverCost : 0;
    return nb.edgeLen + riverPenalty + streetRng() * roadNoiseWeight;
  };

  const streets: Point[][] = [];
  let iter = 0;
  let frontier = collectFrontier();
  while (frontier.length > 0 && iter < STREET_MAX_ITERATIONS) {
    iter++;
    const pickId = frontier[Math.floor(streetRng() * frontier.length)];
    const poly = polygons[pickId];
    const verts = poly.vertices;
    if (verts.length < 3) {
      // Defensive — drop this polygon so the loop terminates.
      frontier = frontier.filter(id => id !== pickId);
      continue;
    }

    // Pick any ring vertex as the start.
    const startVertex = verts[Math.floor(streetRng() * verts.length)];
    const startKey = vertexKey(startVertex);

    // Target: nearest served vertex. "Served vertex" = any endpoint of a
    // covered edge. Linear scan, bounded by graph size.
    let targetKey: string | null = null;
    let bestD2 = Infinity;
    const [sx, sy] = startVertex;
    for (const eKey of coveredEdgeKeys) {
      // Each canonical key has form "x,y|x,y" — reconstruct both vertex
      // keys. Cheap because we reuse the coveredEdgeKeys strings.
      const sep = eKey.indexOf('|');
      if (sep < 0) continue;
      const vkA = eKey.slice(0, sep);
      const vkB = eKey.slice(sep + 1);
      for (const vk of [vkA, vkB]) {
        const p = graph.vertexPoints.get(vk);
        if (!p) continue;
        const dx = p[0] - sx;
        const dy = p[1] - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          targetKey = vk;
        }
      }
    }
    if (!targetKey || targetKey === startKey) {
      // Fall back to the canvas-center target so we always make progress.
      targetKey = centerTargetKey;
    }

    const pathKeys = aStarEdgeGraph(graph, startKey, targetKey, streetCost, {
      maxExpansions: STREET_MAX_EXPANSIONS,
    });
    if (!pathKeys || pathKeys.length < 2) {
      // Couldn't route — remove this polygon from the frontier so the loop
      // doesn't livelock. Rebuild at end of iteration.
      frontier = collectFrontier();
      continue;
    }

    // Trim to keep streets local.
    const trimmed = pathKeys.length > STREET_MAX_SEGMENTS + 1
      ? pathKeys.slice(0, STREET_MAX_SEGMENTS + 1)
      : pathKeys;
    const trimmedPoints = keyPathToPoints(graph, trimmed);
    streets.push(trimmedPoints);
    for (let i = 0; i < trimmedPoints.length - 1; i++) {
      coveredEdgeKeys.add(canonicalEdgeKey(trimmedPoints[i], trimmedPoints[i + 1]));
    }

    frontier = collectFrontier();
  }

  // ── Bridges ───────────────────────────────────────────────────────────
  // [Voronoi-polygon] Bridges are road edges whose canonical key also
  // appears in the river edge set. Deterministic, no RNG. Duplicate
  // detection is implicit because we iterate over the unique `roads` list
  // segment by segment and track bridge keys via a Set.
  const bridges: [Point, Point][] = [];
  if (riverEdgeKeySet.size > 0 && roadEdgeKeySet.size > 0) {
    const seenBridge = new Set<string>();
    for (const road of roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i];
        const b = road[i + 1];
        const k = canonicalEdgeKey(a, b);
        if (riverEdgeKeySet.has(k) && !seenBridge.has(k)) {
          seenBridge.add(k);
          bridges.push([[a[0], a[1]], [b[0], b[1]]]);
        }
      }
    }
  }

  // ── Exit roads ────────────────────────────────────────────────────────
  // [Voronoi-polygon] For each gate, A* along polygon edges from the gate's
  // nearest vertex to the nearest canvas-boundary vertex in the gate's outward
  // direction. Gives exit roads the same organic polygon-edge character as
  // internal roads instead of straight ray-casts.

  // Collect all canvas-boundary vertices (within 1 px of any canvas edge).
  const BOUNDARY_EPS = 1.0;
  const boundaryVertexKeys: string[] = [];
  for (const [k, p] of graph.vertexPoints) {
    if (
      p[0] <= BOUNDARY_EPS || p[0] >= canvasSize - BOUNDARY_EPS ||
      p[1] <= BOUNDARY_EPS || p[1] >= canvasSize - BOUNDARY_EPS
    ) {
      boundaryVertexKeys.push(k);
    }
  }

  const exitRoads: Point[][] = [];
  for (const gate of wall.gates) {
    const [ga, gb] = gate.edge;
    const mx = (ga[0] + gb[0]) / 2;
    const my = (ga[1] + gb[1]) / 2;

    // Outward normal (CW wall, y-down): perpendicular to edge direction.
    const dx = gb[0] - ga[0];
    const dy = gb[1] - ga[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;

    // Project outward to find the expected canvas-boundary exit point.
    let tBest = Infinity;
    if (nx > 0) tBest = Math.min(tBest, (canvasSize - mx) / nx);
    if (nx < 0) tBest = Math.min(tBest, -mx / nx);
    if (ny > 0) tBest = Math.min(tBest, (canvasSize - my) / ny);
    if (ny < 0) tBest = Math.min(tBest, -my / ny);
    if (!isFinite(tBest) || tBest <= 0 || boundaryVertexKeys.length === 0) continue;

    const ex = mx + nx * tBest;
    const ey = my + ny * tBest;

    // Find the nearest canvas-boundary vertex to the projected exit point.
    let exitTargetKey: string | null = null;
    let bestExitD2 = Infinity;
    for (const k of boundaryVertexKeys) {
      const p = graph.vertexPoints.get(k)!;
      const ddx = p[0] - ex;
      const ddy = p[1] - ey;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestExitD2) {
        bestExitD2 = d2;
        exitTargetKey = k;
      }
    }
    if (!exitTargetKey) continue;

    const startKey = nearestVertexKey(graph, [mx, my]);
    if (!startKey || startKey === exitTargetKey) continue;

    // Simple distance cost — A*'s outward heuristic naturally keeps the path
    // heading toward the canvas boundary without needing a turn penalty.
    // Water edges are rejected so exit roads never sprint out into the sea.
    const pathKeys = aStarEdgeGraph(
      graph, startKey, exitTargetKey,
      (_currKey, _currPoint, nb) => waterEdgeKeySet.has(nb.edgeKey) ? Infinity : nb.edgeLen,
    );
    if (!pathKeys || pathKeys.length < 2) continue;
    exitRoads.push(keyPathToPoints(graph, pathKeys));
  }

  return { roads, streets, bridges, exitRoads };
}
