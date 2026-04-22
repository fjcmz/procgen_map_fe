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

// Gate counts per city size tier.
// metropolis: 5-6, megalopolis: 6-8
const GATE_COUNT_MIN: Record<CitySize, number> = {
  small: 2, medium: 3, large: 4, metropolis: 5, megalopolis: 6,
};
const GATE_COUNT_MAX: Record<CitySize, number> = {
  small: 4, medium: 4, large: 4, metropolis: 6, megalopolis: 8,
};

// Inner wall only for metropolis+.
const INNER_WALL_SIZES: ReadonlySet<CitySize> = new Set<CitySize>(['metropolis', 'megalopolis']);
// Fraction of interior polygon count used for inner wall (central core).
const INNER_WALL_FRACTION = 0.42;
// Minimum gates on the inner wall.
const INNER_WALL_MIN_GATES = 3;

export interface WallGenerationResult {
  /** Closed polyline along polygon edges (first === last). Empty on degenerate input. */
  wallPath: Point[];
  /** Gates distributed around the wall (up to 8 for metropolis+). */
  gates: { edge: Edge; dir: GateDir }[];
  /** Set of polygon ids that lie inside the wall footprint. */
  interiorPolygonIds: Set<number>;
  /** Outer wall tower positions (thick dots on wall vertices). */
  wallTowers: Point[];
  /** Inner wall path for metropolis+ (empty for smaller cities). */
  innerWallPath: Point[];
  /** Inner wall gates (≥3 for metropolis+, empty for smaller cities). */
  innerGates: { edge: Edge; dir: GateDir }[];
}

/**
 * Generate the wall footprint + gate list for a V2 city.
 */
export function generateWallsAndGates(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  interior: Set<number>,
  canvasSize: number,
): WallGenerationResult {
  const empty: WallGenerationResult = {
    wallPath: [], gates: [], interiorPolygonIds: new Set(),
    wallTowers: [], innerWallPath: [], innerGates: [],
  };
  if (interior.size < 3) return empty;

  const rng = seededPRNG(`${seed}_city_${cityName}_walls_gates`);

  const edgeOwnership = buildEdgeOwnership(polygons);
  const boundaryEdges = collectWallBoundaryEdges(polygons, interior, edgeOwnership);
  const wallPath = chainWallPath(boundaryEdges);
  if (wallPath.length < 4) return empty;

  // Determine gate count for this city size.
  const gateMin = GATE_COUNT_MIN[env.size];
  const gateMax = GATE_COUNT_MAX[env.size];
  const gateCount = gateMin + Math.floor(rng() * (gateMax - gateMin + 1));

  const gates = pickGatesAngular(wallPath, env.waterSide, canvasSize, gateCount, rng);
  const wallTowers = computeTowerPositions(wallPath);

  // Inner wall for metropolis+.
  let innerWallPath: Point[] = [];
  let innerGates: { edge: Edge; dir: GateDir }[] = [];

  if (INNER_WALL_SIZES.has(env.size)) {
    const innerInterior = selectInnerInterior(polygons, interior, canvasSize);
    if (innerInterior.size >= 3) {
      const innerBoundaryEdges = collectWallBoundaryEdges(polygons, innerInterior, edgeOwnership);
      const innerPath = chainWallPath(innerBoundaryEdges);
      if (innerPath.length >= 4) {
        innerWallPath = innerPath;
        const innerGateCount = Math.max(INNER_WALL_MIN_GATES, GATE_COUNT_MIN[env.size]);
        innerGates = pickGatesAngular(innerPath, env.waterSide, canvasSize, innerGateCount, rng);
      }
    }
  }

  return { wallPath, gates, interiorPolygonIds: interior, wallTowers, innerWallPath, innerGates };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner wall interior selection
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Score interior polygons by radial distance from canvas
// center and keep the closest INNER_WALL_FRACTION of them. BFS-prune to
// connected component containing the most-central polygon.
function selectInnerInterior(
  polygons: CityPolygon[],
  outerInterior: Set<number>,
  canvasSize: number,
): Set<number> {
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  // Score interior polygons by squared distance from canvas center.
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

  const targetCount = Math.max(3, Math.round(scored.length * INNER_WALL_FRACTION));
  const initial = new Set<number>();
  for (let i = 0; i < Math.min(targetCount, scored.length); i++) {
    initial.add(scored[i].id);
  }

  // BFS-prune to connected component from most-central polygon.
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
// Wall boundary edge collection
// ─────────────────────────────────────────────────────────────────────────────

function collectWallBoundaryEdges(
  polygons: CityPolygon[],
  interior: Set<number>,
  edgeOwnership: Map<string, EdgeRecord>,
): Edge[] {
  const edges: Edge[] = [];
  for (const rec of edgeOwnership.values()) {
    let insideCount = 0;
    for (const id of rec.polyIds) {
      if (interior.has(id)) insideCount++;
    }
    if (insideCount !== 1) continue;

    let interiorId = -1;
    for (const id of rec.polyIds) {
      if (interior.has(id)) { interiorId = id; break; }
    }
    if (interiorId === -1) continue;
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

function chainWallPath(edges: Edge[]): Point[] {
  if (edges.length === 0) return [];

  const adj = new Map<string, Point[]>();
  for (const [a, b] of edges) {
    const k = vertexKey(a);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push([b[0], b[1]]);
  }

  let start: Point = edges[0][0];
  for (const [a] of edges) {
    if (a[1] < start[1] || (a[1] === start[1] && a[0] < start[0])) {
      start = [a[0], a[1]];
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
  if (vertexKey(path[0]) !== vertexKey(path[path.length - 1])) return [];
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
function pickGatesAngular(
  wallPath: Point[],
  waterSide: CityEnvironment['waterSide'],
  canvasSize: number,
  gateCount: number,
  rng: () => number,
): { edge: Edge; dir: GateDir }[] {
  if (wallPath.length < 2) return [];

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

    for (let i = 0; i < wallPath.length - 1; i++) {
      const a = wallPath[i];
      const b = wallPath[i + 1];
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

  const n = wallPath.length - 1; // exclude closing duplicate
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
