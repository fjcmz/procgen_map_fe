// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — shared polygon-edge graph (PR 3 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module is the single home for the helpers that walk, key, and index
// Voronoi polygon edges. PR 2 originally scoped these to `cityMapWalls.ts`
// with a TODO to lift them once a second caller appeared — PR 3 is that
// caller (rivers + roads + streets all need edge-weighted A* over the
// polygon graph). The extraction was announced in `cityMapGeneratorV2.ts`
// before this file existed; see that file's PR 1 header comments.
//
// Exports:
//   roundV / vertexKey / canonicalEdgeKey  — float-drift-safe string keys
//   EdgeRecord                             — 1-or-2-polygon edge record
//   buildEdgeOwnership(polygons)           — edgeKey → EdgeRecord (shared edges)
//   buildPolygonEdgeGraph(polygons)        — vertex-graph + edge lookup for A*
//   aStarEdgeGraph(graph, start, end, ...) — A* over polygon vertices
//
// Every primitive here operates on the polygon graph — polygon vertices are
// the graph NODES, polygon edges (Voronoi cell edges, shared between at
// most 2 adjacent cells) are the graph EDGES. No tile corners, no tile
// lattice: the spec's tile language is translated to polygon/edge language
// inside each caller.
// ─────────────────────────────────────────────────────────────────────────────

import type { CityPolygon } from './cityMapTypesV2';

export type Point = [number, number];

// Round(v * VERTEX_PRECISION) / VERTEX_PRECISION before stringifying so
// shared edges between adjacent polygons collapse to the same canonical
// key. D3-Delaunay's clip step can introduce sub-ULP float differences.
const VERTEX_PRECISION = 1000;

export function roundV(v: number): number {
  return Math.round(v * VERTEX_PRECISION) / VERTEX_PRECISION;
}

export function vertexKey(p: Point): string {
  return `${roundV(p[0])},${roundV(p[1])}`;
}

export function canonicalEdgeKey(a: Point, b: Point): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export interface EdgeRecord {
  /** Polygon ids that share this edge. Length 1 = graph boundary; 2 = interior. */
  polyIds: number[];
  /** Raw (un-rounded) endpoints — preserve sub-pixel precision downstream. */
  a: Point;
  b: Point;
}

// [Voronoi-polygon] Build a lookup from every polygon edge to the 1 or 2
// polygons that share it. Voronoi cells share exact edges with each of
// their Delaunay neighbors; canonicalizing endpoints via `roundV` collapses
// any float drift from d3's clip step so the same shared edge always maps
// to the same key. An edge owned by exactly two polygons is internal; an
// edge owned by exactly one is on the polygon-graph boundary.
export function buildEdgeOwnership(polygons: CityPolygon[]): Map<string, EdgeRecord> {
  const map = new Map<string, EdgeRecord>();
  for (const p of polygons) {
    const verts = p.vertices;
    const n = verts.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      const key = canonicalEdgeKey(a, b);
      const existing = map.get(key);
      if (existing) {
        existing.polyIds.push(p.id);
      } else {
        map.set(key, { polyIds: [p.id], a: [a[0], a[1]], b: [b[0], b[1]] });
      }
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Polygon-edge graph for A* (rivers, roads, streets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One adjacency entry: from the owning vertex key to a neighbor vertex.
 * `edgeKey` is the canonical (undirected) key shared by both directions;
 * `edgeLen` is precomputed so cost functions never re-hypot().
 */
export interface EdgeNeighbor {
  neighborKey: string;
  point: Point;
  edgeKey: string;
  edgeLen: number;
}

/**
 * Polygon-edge graph. NODES are polygon vertices (canonicalized by
 * `vertexKey`). EDGES are polygon edges (shared cell boundaries). Every
 * field is read-only after construction; A* consumers may mutate only
 * their own `blockedKeys` Set to temporarily exclude vertices (used by
 * river bifurcation to force a disjoint detour without mutating the graph).
 */
export interface PolygonEdgeGraph {
  /** vertexKey → raw (un-rounded) point. Source of truth for path reconstruction. */
  vertexPoints: Map<string, Point>;
  /** vertexKey → list of outgoing edges. */
  adjacency: Map<string, EdgeNeighbor[]>;
  /** canonicalEdgeKey → EdgeRecord (polygon ownership). */
  edges: Map<string, EdgeRecord>;
  /** canonicalEdgeKey → Euclidean length, precomputed. */
  edgeLen: Map<string, number>;
  /** Mean edge length across the graph (used as a natural distance unit). */
  avgEdgeLen: number;
}

// [Voronoi-polygon] Construct the shared edge graph from a polygon list.
// Called once per city after `buildCityPolygonGraph` — every PR 3 feature
// (river, roads, streets) reads this structure. `avgEdgeLen` is exported
// so downstream cost functions can mix in dimensionless randomness
// (e.g. `rng() * 0.4 * avgEdgeLen`) without assuming a fixed edge length.
export function buildPolygonEdgeGraph(polygons: CityPolygon[]): PolygonEdgeGraph {
  const edges = buildEdgeOwnership(polygons);

  const vertexPoints = new Map<string, Point>();
  const adjacency = new Map<string, EdgeNeighbor[]>();
  const edgeLen = new Map<string, number>();

  let totalLen = 0;
  let edgeCount = 0;

  for (const [eKey, rec] of edges) {
    const { a, b } = rec;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    edgeLen.set(eKey, len);
    totalLen += len;
    edgeCount++;

    const ka = vertexKey(a);
    const kb = vertexKey(b);
    if (!vertexPoints.has(ka)) vertexPoints.set(ka, [a[0], a[1]]);
    if (!vertexPoints.has(kb)) vertexPoints.set(kb, [b[0], b[1]]);

    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push({ neighborKey: kb, point: [b[0], b[1]], edgeKey: eKey, edgeLen: len });
    adjacency.get(kb)!.push({ neighborKey: ka, point: [a[0], a[1]], edgeKey: eKey, edgeLen: len });
  }

  const avgEdgeLen = edgeCount > 0 ? totalLen / edgeCount : 1;

  return { vertexPoints, adjacency, edges, edgeLen, avgEdgeLen };
}

// ─────────────────────────────────────────────────────────────────────────────
// A* over the polygon-edge graph
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-edge cost function for A*. `prevKey` is `null` on the first expansion
 * so direction-dependent costs (turn penalties) can special-case the seed.
 * Must return a NON-NEGATIVE cost; returning Infinity silently blocks the
 * edge.
 */
export type EdgeCostFn = (
  currKey: string,
  currPoint: Point,
  nb: EdgeNeighbor,
  prevKey: string | null,
) => number;

export interface AStarOptions {
  /** Vertex keys that must not appear in the path (river bifurcation uses this). */
  blockedKeys?: Set<string>;
  /** Hard cap on expansions; safety net for the 300-iter streets pass. */
  maxExpansions?: number;
}

// [Voronoi-polygon] A* over the polygon-vertex graph. Priority queue is a
// plain binary min-heap keyed by `f = g + h`; heuristic is straight-line
// Euclidean distance to the end point (admissible because every edge cost
// is ≥ edgeLen ≥ Euclidean distance on a straight line). Returns the
// reconstructed vertex-key path or `null` if the graph is disconnected /
// the expansion cap trips first.
export function aStarEdgeGraph(
  graph: PolygonEdgeGraph,
  startKey: string,
  endKey: string,
  costFn: EdgeCostFn,
  options?: AStarOptions,
): string[] | null {
  if (startKey === endKey) return [startKey];
  const startPoint = graph.vertexPoints.get(startKey);
  const endPoint = graph.vertexPoints.get(endKey);
  if (!startPoint || !endPoint) return null;

  const blocked = options?.blockedKeys;
  if (blocked && (blocked.has(startKey) || blocked.has(endKey))) return null;
  const maxExp = options?.maxExpansions ?? Infinity;

  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();

  // Min-heap of { key, f }. Small and simple — ~3000 nodes max per city.
  type HeapItem = { key: string; f: number };
  const heap: HeapItem[] = [];
  const heapPush = (item: HeapItem) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= heap[i].f) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const heapPop = (): HeapItem | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < n && heap[l].f < heap[best].f) best = l;
        if (r < n && heap[r].f < heap[best].f) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top;
  };

  const h0 = Math.hypot(startPoint[0] - endPoint[0], startPoint[1] - endPoint[1]);
  heapPush({ key: startKey, f: h0 });

  let expansions = 0;
  while (heap.length > 0) {
    const top = heapPop()!;
    if (top.key === endKey) {
      const path: string[] = [];
      let c: string | undefined = top.key;
      while (c !== undefined) {
        path.unshift(c);
        c = cameFrom.get(c);
      }
      return path;
    }
    expansions++;
    if (expansions > maxExp) return null;

    const currKey = top.key;
    const currPoint = graph.vertexPoints.get(currKey)!;
    const currG = gScore.get(currKey) ?? Infinity;
    const prevKey = cameFrom.get(currKey) ?? null;

    const neighbors = graph.adjacency.get(currKey);
    if (!neighbors) continue;

    for (const nb of neighbors) {
      if (blocked && blocked.has(nb.neighborKey) && nb.neighborKey !== endKey) continue;
      const step = costFn(currKey, currPoint, nb, prevKey);
      if (!Number.isFinite(step) || step < 0) continue;
      const ng = currG + step;
      if (ng < (gScore.get(nb.neighborKey) ?? Infinity)) {
        gScore.set(nb.neighborKey, ng);
        cameFrom.set(nb.neighborKey, currKey);
        const h = Math.hypot(nb.point[0] - endPoint[0], nb.point[1] - endPoint[1]);
        heapPush({ key: nb.neighborKey, f: ng + h });
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an A* key-path back into pixel points (for renderer consumption)
 * using `graph.vertexPoints` as the source of truth. Stable, deterministic.
 */
export function keyPathToPoints(graph: PolygonEdgeGraph, keys: string[]): Point[] {
  const out: Point[] = [];
  for (const k of keys) {
    const p = graph.vertexPoints.get(k);
    if (p) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Find the vertex-key whose raw point is closest (Euclidean) to `target`.
 * Linear scan — vertex count peaks at ~3000 for megalopolis, which is fine
 * and avoids pulling in a spatial index for one call per gate.
 */
export function nearestVertexKey(graph: PolygonEdgeGraph, target: Point): string | null {
  let bestKey: string | null = null;
  let bestD2 = Infinity;
  for (const [k, p] of graph.vertexPoints) {
    const dx = p[0] - target[0];
    const dy = p[1] - target[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestKey = k;
    }
  }
  return bestKey;
}
