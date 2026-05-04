// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — walls + gates (PR 2 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Inputs:
//   - `CityPolygon[]` (PR 1 output) — supplies `.vertices` (unclosed ring)
//     and `.neighbors` (Delaunay adjacency).
//   - `interior: Set<number>` — the pre-computed city footprint from
//     `cityMapShape.ts`. Walls trace the boundary of this set.
//   - `env.waterSide` — gate-direction skip (don't open a gate toward water).
//   - `env.size` — controls gate count (small/medium/large: up to 4;
//     metropolis: 5–6; megalopolis: 6–8) and whether an inner wall is built.
//
// Outputs: `WallGenerationResult` — wallPath, gates, interiorPolygonIds,
//   wallTowers, innerWallPath, innerGates.
//
// Polygon-edge helpers (`roundV`, `vertexKey`, `canonicalEdgeKey`, etc.) live
// in `cityMapEdgeGraph.ts` — do NOT re-declare them here.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityEnvironment, CityPolygon, CitySize } from './cityMapTypesV2';
import {
  buildEdgeOwnership,
  canonicalEdgeKey,
  vertexKey,
  type EdgeRecord,
} from './cityMapEdgeGraph';

type Point = [number, number];
type Edge = [Point, Point];
type GateDir = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

// How many edges to skip between towers along the wall path.
const TOWER_EDGE_INTERVAL = 3;
// Dot-product threshold below which a wall bend is "sharp" enough to force a tower.
const TOWER_SHARP_DOT = 0.3;

// ── Wall footprint morphological smoothing ───────────────────────────────────
// The outer wall traces a morphologically smoothed version of the city interior
// rather than the exact city footprint. This lets the wall skip minor peninsulas
// (erosion) and bridge shallow bays (dilation), producing a more circular,
// natural wall circuit. Some city polygons will sit outside the wall; some
// non-city polygons will be enclosed inside it — matching real city-wall behaviour.
//
// Dilation threshold: a non-interior polygon is pulled inside the wall when at
// least this many of its Voronoi neighbours are interior.
const WALL_DILATE_THRESHOLD = 3;
// Erosion threshold: an interior polygon is pruned from the wall footprint when
// it has this many or fewer interior neighbours (i.e. it's a thin peninsula tip).
const WALL_ERODE_THRESHOLD = 1;
// Number of dilate→erode passes. One pass is enough for clear smoothing without
// collapsing the shape; more passes would over-regularise small cities.
const WALL_SMOOTH_ITERATIONS = 1;

// Gate counts per city size tier.
// metropolis: 5-6, megalopolis: 6-8
const GATE_COUNT_MIN: Record<CitySize, number> = {
  small: 2, medium: 3, large: 4, metropolis: 5, megalopolis: 6,
};
const GATE_COUNT_MAX: Record<CitySize, number> = {
  small: 4, medium: 4, large: 4, metropolis: 6, megalopolis: 8,
};

// Minimum gates on any inner/middle wall ring.
const INNER_WALL_MIN_GATES = 3;

/**
 * Controls which wall rings are generated and at what interior fraction.
 * Determined by the caller (`generateCityMapV2`) based on city size + RNG rolls.
 *
 * hasOuterWall   — whether to generate the outer perimeter wall.
 * hasInnerWall   — whether to generate an inner core wall (citadel-style).
 * innerFraction  — fraction of interior polygons the inner core covers (0–1).
 * hasMiddleWall  — whether to generate an intermediate ring (megalopolis only).
 * middleFraction — fraction of interior polygons the middle ring covers (0–1).
 */
export interface WallConfig {
  hasOuterWall: boolean;
  hasInnerWall: boolean;
  innerFraction: number;
  hasMiddleWall: boolean;
  middleFraction: number;
}

export interface WallGenerationResult {
  /**
   * The longest (primary) wall segment as a polyline (first === last for closed
   * rings, open for coastal gaps). Empty when hasOuterWall=false.
   * Retained for legacy consumers that need a single representative polyline;
   * prefer `wallSegments` when you need ALL wall sections.
   */
  wallPath: Point[];
  /**
   * ALL disconnected wall segments, sorted longest-first. Each segment is a
   * polyline (closed ring or open chain). Mountains / water gaps in the city
   * footprint boundary produce multiple disjoint sections — this array holds
   * all of them so the renderer and barrier builders cover every section.
   * Empty when hasOuterWall=false.
   */
  wallSegments: Point[][];
  /** Gates distributed around the outer wall (drawn from all wall segments). */
  gates: { edge: Edge; dir: GateDir }[];
  /** Set of polygon ids that lie inside the wall footprint. */
  interiorPolygonIds: Set<number>;
  /** Outer wall tower positions (thick dots on wall vertices). */
  wallTowers: Point[];
  /** Inner core wall path (empty when hasInnerWall=false). */
  innerWallPath: Point[];
  /** Inner core wall gates (empty when hasInnerWall=false). */
  innerGates: { edge: Edge; dir: GateDir }[];
  /** Intermediate wall path between outer and inner (empty when hasMiddleWall=false). */
  middleWallPath: Point[];
  /** Intermediate wall gates (empty when hasMiddleWall=false). */
  middleGates: { edge: Edge; dir: GateDir }[];
}

/**
 * Generate the wall footprint + gate list for a V2 city.
 * Which rings are generated is controlled by `wallConfig`, computed by
 * `generateCityMapV2` from city size + probability rolls.
 *
 * `waterPolygonIds` (optional, coastal cities) suppresses wall segments
 * that would run along a water-adjacent seam — the coast-facing side of
 * a coastal city has no wall.
 */
export function generateWallsAndGates(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  interior: Set<number>,
  canvasSize: number,
  wallConfig: WallConfig,
  waterPolygonIds?: Set<number>,
): WallGenerationResult {
  const empty: WallGenerationResult = {
    wallPath: [], wallSegments: [], gates: [], interiorPolygonIds: new Set(),
    wallTowers: [], innerWallPath: [], innerGates: [],
    middleWallPath: [], middleGates: [],
  };
  if (interior.size < 3) return empty;

  const rng = seededPRNG(`${seed}_city_${cityName}_walls_gates`);
  const edgeOwnership = buildEdgeOwnership(polygons);
  const water = waterPolygonIds ?? new Set<number>();

  // ── Outer wall (or virtual entry points when unwalled) ──────────────────────
  // Walled cities trace the footprint boundary as a masonry wall and pick
  // gates along it. Unwalled cities skip the wall drawing but still pick the
  // same number of entry points from the footprint boundary using the same
  // angular-distribution logic — roads then connect those entry points to the
  // city centre, giving unwalled settlements a street network and proper blocks.
  //
  // Coastal cities pass `water` through to `collectWallBoundaryEdges` so seams
  // between interior polygons and water polygons are dropped — walls never
  // border water (spec). The resulting path may be an OPEN polyline instead
  // of a closed ring; `chainWallPath` handles both.
  let wallPath: Point[] = [];
  let wallSegments: Point[][] = [];
  let gates: { edge: Edge; dir: GateDir }[] = [];
  let wallTowers: Point[] = [];

  // For walled cities, smooth the wall interior before tracing: the wall
  // circuit follows a morphologically simplified polygon set rather than the
  // exact city footprint, so it skips minor peninsulas and bridges shallow bays.
  // Unwalled cities keep the original interior so their virtual gate positions
  // (road endpoints) stay on the city footprint boundary.
  const wallInterior = wallConfig.hasOuterWall
    ? smoothWallInterior(polygons, interior, water, canvasSize)
    : interior;

  const boundaryEdges = collectWallBoundaryEdges(polygons, wallInterior, edgeOwnership, water);
  // Extract ALL disconnected wall chains — mountains / water gaps in the
  // footprint boundary split it into multiple disjoint sections. The legacy
  // `chainWallPath` only returned one; `chainAllWallPaths` returns all of them
  // sorted longest-first so callers that need only the primary ring can take [0].
  const footprintSegments = chainAllWallPaths(boundaryEdges);
  const footprintPath = footprintSegments[0] ?? []; // longest segment (or empty)

  if (wallConfig.hasOuterWall) {
    wallSegments = footprintSegments;
    wallPath = footprintPath; // longest segment kept for legacy consumers
    if (wallSegments.length > 0) {
      const gateMin = GATE_COUNT_MIN[env.size];
      const gateMax = GATE_COUNT_MAX[env.size];
      const gateCount = gateMin + Math.floor(rng() * (gateMax - gateMin + 1));
      // Collect edges from ALL wall segments so gates are distributed across
      // every disconnected wall section, not only the primary ring.
      const allWallEdges = wallSegmentsToEdges(wallSegments);
      gates = pickGatesAngular(allWallEdges, env.waterSide, canvasSize, gateCount, rng);
      wallTowers = computeTowerPositionsMulti(wallSegments);
    }
  } else {
    // No outer wall: derive virtual entry points from the footprint boundary so
    // road generation has targets and block barriers are produced correctly.
    if (footprintSegments.length > 0) {
      const gateMin = GATE_COUNT_MIN[env.size];
      const gateMax = GATE_COUNT_MAX[env.size];
      const gateCount = gateMin + Math.floor(rng() * (gateMax - gateMin + 1));
      const allFootprintEdges = wallSegmentsToEdges(footprintSegments);
      gates = pickGatesAngular(allFootprintEdges, env.waterSide, canvasSize, gateCount, rng);
    }
  }

  // ── Middle wall (megalopolis intermediate ring) ──────────────────────────────
  let middleWallPath: Point[] = [];
  let middleGates: { edge: Edge; dir: GateDir }[] = [];

  if (wallConfig.hasMiddleWall && wallConfig.middleFraction > 0) {
    const middleInterior = selectWallRingInterior(
      polygons, interior, canvasSize, wallConfig.middleFraction,
    );
    if (middleInterior.size >= 3) {
      const midBoundaryEdges = collectWallBoundaryEdges(polygons, middleInterior, edgeOwnership);
      const midPath = chainWallPath(midBoundaryEdges);
      if (midPath.length >= 4) {
        middleWallPath = midPath;
        const midGateCount = Math.max(INNER_WALL_MIN_GATES, GATE_COUNT_MIN[env.size]);
        middleGates = pickGatesAngular(wallSegmentsToEdges([midPath]), env.waterSide, canvasSize, midGateCount, rng);
      }
    }
  }

  // ── Inner core wall ─────────────────────────────────────────────────────────
  let innerWallPath: Point[] = [];
  let innerGates: { edge: Edge; dir: GateDir }[] = [];

  if (wallConfig.hasInnerWall && wallConfig.innerFraction > 0) {
    const innerInterior = selectWallRingInterior(
      polygons, interior, canvasSize, wallConfig.innerFraction,
    );
    if (innerInterior.size >= 3) {
      const innerBoundaryEdges = collectWallBoundaryEdges(polygons, innerInterior, edgeOwnership);
      const innerPath = chainWallPath(innerBoundaryEdges);
      if (innerPath.length >= 4) {
        innerWallPath = innerPath;
        const innerGateCount = Math.max(INNER_WALL_MIN_GATES, GATE_COUNT_MIN[env.size]);
        innerGates = pickGatesAngular(wallSegmentsToEdges([innerPath]), env.waterSide, canvasSize, innerGateCount, rng);
      }
    }
  }

  return {
    wallPath, wallSegments, gates, interiorPolygonIds: interior,
    wallTowers, innerWallPath, innerGates, middleWallPath, middleGates,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner / middle wall interior selection
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Score interior polygons by radial distance from canvas
// center, keep the closest `fraction` of them, then BFS-prune to the connected
// component containing the most-central polygon.
function selectWallRingInterior(
  polygons: CityPolygon[],
  outerInterior: Set<number>,
  canvasSize: number,
  fraction: number,
): Set<number> {
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  type Scored = { id: number; d2: number };
  const scored: Scored[] = [];
  for (const id of outerInterior) {
    const p = polygons[id];
    if (!p) continue;
    const dx = p.site[0] - cx;
    const dy = p.site[1] - cy;
    scored.push({ id, d2: dx * dx + dy * dy });
  }
  scored.sort((a, b) => a.d2 - b.d2 || a.id - b.id);

  const targetCount = Math.max(3, Math.round(scored.length * fraction));
  const initial = new Set<number>();
  for (let i = 0; i < Math.min(targetCount, scored.length); i++) {
    initial.add(scored[i].id);
  }

  const seedId = scored[0]?.id;
  if (seedId == null) return new Set();
  const inner = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (initial.has(nb) && !inner.has(nb)) {
        inner.add(nb);
        queue.push(nb);
      }
    }
  }
  return inner;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wall footprint smoothing (morphological close → open on polygon graph)
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Derive the wall interior: a morphologically smoothed
// superset/subset of the city footprint. One pass of dilation (fills bays) +
// erosion (removes peninsulas) produces a simpler boundary that the wall
// circuit traces. Water and canvas-edge polygons are never pulled in.
// The result is BFS-pruned to stay connected, seeding from the most-central
// polygon so isolated artifacts from the erosion step are dropped.
function smoothWallInterior(
  polygons: CityPolygon[],
  interior: Set<number>,
  waterPolygonIds: Set<number>,
  canvasSize: number,
): Set<number> {
  let current = new Set<number>(interior);

  for (let iter = 0; iter < WALL_SMOOTH_ITERATIONS; iter++) {
    // Dilation: pull non-interior polygons into the wall footprint when they
    // are surrounded on most sides by interior polygons (fills bays).
    const toAdd: number[] = [];
    for (const p of polygons) {
      if (current.has(p.id) || p.isEdge || waterPolygonIds.has(p.id)) continue;
      let interiorNb = 0;
      for (const nb of p.neighbors) {
        if (current.has(nb)) interiorNb++;
      }
      if (interiorNb >= WALL_DILATE_THRESHOLD) toAdd.push(p.id);
    }
    for (const id of toAdd) current.add(id);

    // Erosion: remove tip polygons with almost no interior neighbours
    // (peninsula spikes that would make the wall unnecessarily jagged).
    const toRemove: number[] = [];
    for (const id of current) {
      const p = polygons[id];
      if (!p) continue;
      let interiorNb = 0;
      for (const nb of p.neighbors) {
        if (current.has(nb)) interiorNb++;
      }
      if (interiorNb <= WALL_ERODE_THRESHOLD) toRemove.push(id);
    }
    for (const id of toRemove) current.delete(id);
  }

  if (current.size === 0) return current;

  // BFS-prune to the connected component containing the most-central polygon.
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  let seedId = -1;
  let bestD2 = Infinity;
  for (const id of current) {
    const p = polygons[id];
    if (!p) continue;
    const dx = p.site[0] - cx;
    const dy = p.site[1] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; seedId = id; }
  }
  if (seedId === -1) return current;

  const pruned = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (current.has(nb) && !pruned.has(nb)) {
        pruned.add(nb);
        queue.push(nb);
      }
    }
  }
  return pruned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wall boundary edge collection
// ─────────────────────────────────────────────────────────────────────────────

function collectWallBoundaryEdges(
  polygons: CityPolygon[],
  interior: Set<number>,
  edgeOwnership: Map<string, EdgeRecord>,
  waterPolygonIds?: Set<number>,
): Edge[] {
  const water = waterPolygonIds ?? new Set<number>();
  const edges: Edge[] = [];
  for (const rec of edgeOwnership.values()) {
    let insideCount = 0;
    for (const id of rec.polyIds) {
      if (interior.has(id)) insideCount++;
    }
    if (insideCount !== 1) continue;

    let interiorId = -1;
    let otherId = -1;
    for (const id of rec.polyIds) {
      if (interior.has(id)) interiorId = id;
      else otherId = id;
    }
    if (interiorId === -1) continue;
    // [Voronoi-polygon] Coastal skip: if the non-interior neighbor is a
    // water polygon, this seam is the coastline — no wall is built here.
    if (otherId !== -1 && water.has(otherId)) continue;
    const owner = polygons[interiorId];
    const verts = owner.vertices;
    const vn = verts.length;
    let emitted = false;
    for (let i = 0; i < vn; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % vn];
      if (canonicalEdgeKey(a, b) === canonicalEdgeKey(rec.a, rec.b)) {
        edges.push([[a[0], a[1]], [b[0], b[1]]]);
        emitted = true;
        break;
      }
    }
    if (!emitted) edges.push([[rec.a[0], rec.a[1]], [rec.b[0], rec.b[1]]]);
  }
  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wall path chaining
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Flatten a list of wall-path segments into a single list
// of directed edges. Used to feed all wall sections into `pickGatesAngular`
// and barrier-key builders without assuming the segments are connected.
function wallSegmentsToEdges(segments: Point[][]): Edge[] {
  const edges: Edge[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      edges.push([[seg[i][0], seg[i][1]], [seg[i + 1][0], seg[i + 1][1]]]);
    }
  }
  return edges;
}

// [Voronoi-polygon] Chain ALL disconnected boundary components into separate
// polylines. Mountains / water gaps in the footprint boundary split it into
// multiple disjoint sections; this function returns one chain per section,
// sorted longest-first so callers that only need the primary ring take [0].
// Each chain is produced by the same CW-turn walking logic as `chainWallPath`.
function chainAllWallPaths(edges: Edge[]): Point[][] {
  if (edges.length === 0) return [];

  // Build an undirected adjacency map from vertex key → neighbour keys so we
  // can BFS the edge graph and group vertices into connected components.
  const adjVertices = new Map<string, string[]>();
  for (const [a, b] of edges) {
    const ka = vertexKey(a);
    const kb = vertexKey(b);
    if (!adjVertices.has(ka)) adjVertices.set(ka, []);
    if (!adjVertices.has(kb)) adjVertices.set(kb, []);
    adjVertices.get(ka)!.push(kb);
    adjVertices.get(kb)!.push(ka);
  }

  // BFS to partition vertex keys into connected components.
  const visitedVertices = new Set<string>();
  const componentVertexSets: Set<string>[] = [];
  for (const vk of adjVertices.keys()) {
    if (visitedVertices.has(vk)) continue;
    const component = new Set<string>();
    const queue: string[] = [vk];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visitedVertices.has(curr)) continue;
      visitedVertices.add(curr);
      component.add(curr);
      for (const nb of adjVertices.get(curr) ?? []) {
        if (!visitedVertices.has(nb)) queue.push(nb);
      }
    }
    componentVertexSets.push(component);
  }

  // For each component, collect its edges and chain them into a polyline.
  // Checking only vertex `a` is sufficient — both endpoints of every edge
  // belong to the same component so no edge is missed.
  const chains: Point[][] = [];
  for (const vertexSet of componentVertexSets) {
    const compEdges = edges.filter(([a]) => vertexSet.has(vertexKey(a)));
    const chain = chainWallPath(compEdges);
    if (chain.length >= 4) chains.push(chain);
  }

  chains.sort((a, b) => b.length - a.length);
  return chains;
}

// [Voronoi-polygon] Chain the boundary edges into the longest polyline we
// can walk. Returns a closed ring for fully-walled footprints (typical
// inland cities) OR an open polyline for coastal cities where the
// water-facing seam has been dropped from the edge set. The caller treats
// a polyline with `path[0] !== path[last]` as open and renders it as-is.
function chainWallPath(edges: Edge[]): Point[] {
  if (edges.length === 0) return [];

  const adj = new Map<string, Point[]>();
  for (const [a, b] of edges) {
    const k = vertexKey(a);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push([b[0], b[1]]);
  }

  // Prefer to start at a vertex with exactly one outgoing edge — that's
  // an endpoint of an OPEN chain (an uncut ring has in/out degree 2 at
  // every vertex). If no endpoints exist, fall back to the previous
  // lex-min starting rule so inland cities remain byte-stable.
  const inDegree = new Map<string, number>();
  for (const [, b] of edges) {
    const k = vertexKey(b);
    inDegree.set(k, (inDegree.get(k) ?? 0) + 1);
  }
  let start: Point | null = null;
  for (const [a] of edges) {
    const k = vertexKey(a);
    const outDeg = adj.get(k)?.length ?? 0;
    const inDeg = inDegree.get(k) ?? 0;
    if (outDeg === 1 && inDeg === 0) {
      if (!start || a[1] < start[1] || (a[1] === start[1] && a[0] < start[0])) {
        start = [a[0], a[1]];
      }
    }
  }
  if (!start) {
    start = edges[0][0];
    for (const [a] of edges) {
      if (a[1] < start[1] || (a[1] === start[1] && a[0] < start[0])) {
        start = [a[0], a[1]];
      }
    }
  }

  const path: Point[] = [[start[0], start[1]]];
  let prev: Point | null = null;
  let current: Point = [start[0], start[1]];
  const totalEdges = edges.length;

  for (let step = 0; step < totalEdges + 1; step++) {
    const k = vertexKey(current);
    const outs = adj.get(k);
    if (!outs || outs.length === 0) break;

    let chosenIdx = 0;
    if (outs.length > 1 && prev) {
      const inDx = current[0] - prev[0];
      const inDy = current[1] - prev[1];
      const inLen = Math.hypot(inDx, inDy) || 1;
      const inNx = inDx / inLen;
      const inNy = inDy / inLen;
      let bestScore = -Infinity;
      for (let i = 0; i < outs.length; i++) {
        const dx = outs[i][0] - current[0];
        const dy = outs[i][1] - current[1];
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        const dot = inNx * nx + inNy * ny;
        const cross = inNx * ny - inNy * nx;
        const score = dot * 2 + cross;
        if (score > bestScore) {
          bestScore = score;
          chosenIdx = i;
        }
      }
    }

    const next = outs[chosenIdx];
    outs.splice(chosenIdx, 1);
    path.push([next[0], next[1]]);
    prev = current;
    current = next;
    if (vertexKey(current) === vertexKey(start)) break;
  }

  if (path.length < 4) return [];
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Angular-sector gate selection (supports 2–8 gates)
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Divide 360° into `gateCount` equal angular sectors centred
// on the canvas centre. For each sector, pick the wall edge whose outward normal
// best aligns to the sector's centre angle. Skip sectors facing `waterSide`.
// The `rng` is used to add a small random offset to sector start angles so the
// distribution is less grid-rigid. Uses angular closeness rather than a strict
// threshold so any reasonable wall topology produces the requested gate count.
// Accepts a flat `wallEdges` list so it works across multiple disconnected wall
// sections — call `wallSegmentsToEdges(segments)` to flatten before passing.
function pickGatesAngular(
  wallEdges: Edge[],
  waterSide: CityEnvironment['waterSide'],
  canvasSize: number,
  gateCount: number,
  rng: () => number,
): { edge: Edge; dir: GateDir }[] {
  if (wallEdges.length === 0) return [];

  const center: Point = [canvasSize / 2, canvasSize / 2];
  // Small random rotation of the sector grid so gates don't always land exactly
  // on cardinal axes. Bounded to ±half a sector so sectors never overlap.
  const sectorSize = (Math.PI * 2) / gateCount;
  const rotOffset = (rng() - 0.5) * sectorSize * 0.3;

  // Water-side angle to skip (if set).
  const waterAngle = waterSide ? waterSideAngle(waterSide) : null;

  const gates: { edge: Edge; dir: GateDir }[] = [];
  const usedEdgeKeys = new Set<string>();

  for (let s = 0; s < gateCount; s++) {
    const targetAngle = s * sectorSize + rotOffset;
    // Outward direction for this sector: from center toward outside.
    const tDir: Point = [Math.cos(targetAngle), Math.sin(targetAngle)];

    // Skip if this sector faces water.
    if (waterAngle !== null && Math.abs(angleDiff(targetAngle, waterAngle)) < sectorSize * 0.6) continue;

    let bestEdge: Edge | null = null;
    let bestScore = -Infinity;

    for (const [a, b] of wallEdges) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      // Outward normal for CW traversal in y-down coords.
      const nx = dy / len;
      const ny = -dx / len;
      // How well does this edge's outward normal align with the sector direction?
      const dot = nx * tDir[0] + ny * tDir[1];

      const key = canonicalEdgeKey(a, b);
      if (usedEdgeKeys.has(key)) continue;

      // Score: alignment dot + small penalty for deviation from sector midpoint,
      // minus perpendicular distance from center so the gate sits near the
      // sector's radial midline.
      const midx = (a[0] + b[0]) / 2;
      const midy = (a[1] + b[1]) / 2;
      const edgeAngle = Math.atan2(ny, nx);
      const angularCloseness = Math.cos(angleDiff(edgeAngle, targetAngle));
      const perpDist = Math.abs((midx - center[0]) * tDir[1] - (midy - center[1]) * tDir[0]);
      const score = dot * 3 + angularCloseness - perpDist / 100;

      if (dot > 0.1 && score > bestScore) {
        bestScore = score;
        bestEdge = [[a[0], a[1]], [b[0], b[1]]];
      }
    }

    if (bestEdge) {
      usedEdgeKeys.add(canonicalEdgeKey(bestEdge[0], bestEdge[1]));
      gates.push({ edge: bestEdge, dir: angleToDir(targetAngle) });
    }
  }

  return gates;
}

function waterSideAngle(waterSide: NonNullable<CityEnvironment['waterSide']>): number {
  switch (waterSide) {
    case 'north': return -Math.PI / 2;
    case 'south': return Math.PI / 2;
    case 'east':  return 0;
    case 'west':  return Math.PI;
  }
}

// Signed smallest angle difference in [-π, π].
function angleDiff(a: number, b: number): number {
  let d = ((a - b) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return d;
}

function angleToDir(angle: number): GateDir {
  // Normalize to [0, 2π)
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const deg = (a * 180) / Math.PI;
  // 8 sectors of 45° each, starting from 0° = East
  // Map to compass dirs (y-down, 0°=E, 90°=S, 180°=W, 270°=N)
  if (deg < 22.5 || deg >= 337.5) return 'E';
  if (deg < 67.5)  return 'SE';
  if (deg < 112.5) return 'S';
  if (deg < 157.5) return 'SW';
  if (deg < 202.5) return 'W';
  if (deg < 247.5) return 'NW';
  if (deg < 292.5) return 'N';
  return 'NE';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tower position computation
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Walk the wall path and emit tower positions:
//   1. Every TOWER_EDGE_INTERVAL edges (the "every ~3 edges" rule).
//   2. Any vertex where the wall makes a sharp bend (dot < TOWER_SHARP_DOT).
// The first vertex is always a tower (anchor). The closing repeated vertex
// is never a duplicate tower (skip it if it's the same as the start).
function computeTowerPositions(wallPath: Point[]): Point[] {
  const towers: Point[] = [];
  if (wallPath.length < 2) return towers;

  // Closed rings carry a repeated vertex at the end; open chains don't.
  // Probe both endpoints and drop the closing duplicate only when present,
  // so open coast-facing walls don't lose their last real tower vertex.
  const closed = vertexKey(wallPath[0]) === vertexKey(wallPath[wallPath.length - 1]);
  const n = closed ? wallPath.length - 1 : wallPath.length;
  const towerSet = new Set<string>();

  const addTower = (pt: Point) => {
    const k = vertexKey(pt);
    if (towerSet.has(k)) return;
    towerSet.add(k);
    towers.push([pt[0], pt[1]]);
  };

  // First vertex always gets a tower.
  addTower(wallPath[0]);

  for (let i = 1; i < n; i++) {
    // Every TOWER_EDGE_INTERVAL edges.
    if (i % TOWER_EDGE_INTERVAL === 0) {
      addTower(wallPath[i]);
      continue;
    }

    // Sharp bend check.
    if (i > 0 && i < n - 1) {
      const prev = wallPath[i - 1];
      const curr = wallPath[i];
      const next = wallPath[i + 1];
      const ax = curr[0] - prev[0];
      const ay = curr[1] - prev[1];
      const bx = next[0] - curr[0];
      const by = next[1] - curr[1];
      const aLen = Math.hypot(ax, ay) || 1;
      const bLen = Math.hypot(bx, by) || 1;
      const dot = (ax * bx + ay * by) / (aLen * bLen);
      if (dot < TOWER_SHARP_DOT) {
        addTower(wallPath[i]);
      }
    }
  }

  return towers;
}

// [Voronoi-polygon] Compute tower positions for ALL wall segments and
// concatenate them into a single list. Towers are deduplicated globally
// so a shared vertex between two (nearly touching) segments is not doubled.
function computeTowerPositionsMulti(segments: Point[][]): Point[] {
  const allTowers: Point[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    for (const pt of computeTowerPositions(seg)) {
      const k = vertexKey(pt);
      if (seen.has(k)) continue;
      seen.add(k);
      allTowers.push(pt);
    }
  }
  return allTowers;
}
