// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — walls + gates (PR 2 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module scores CityPolygon candidates, walks polygon-edge boundaries,
// and picks gates from polygon edges — NEVER tile edges / tile corners. The
// spec text ("tile count", "tile corners") is legacy language from before
// PR 1 pivoted to polygons; every primitive here operates on the polygon
// graph produced by `buildCityPolygonGraph` in `cityMapGeneratorV2.ts`.
//
// Inputs:
//   - `CityPolygon[]` (PR 1 output) — supplies `.site`, `.vertices` (unclosed
//     ring), `.neighbors` (Delaunay adjacency), `.isEdge` (touches canvas
//     bbox).
//   - `env.size` (coverage ramp) and `env.waterSide` (gate-direction skip).
//   - `seededPRNG`-derived noise samplers (`createNoiseSamplers` + `fbm`)
//     from terrain/noise.ts — the same helpers the world map uses.
//
// Outputs: `{ wallPath, gates }` — drop straight into `CityMapDataV2`'s
// PR 1 `// TODO PR 2:` slots (`cityMapTypesV2.ts` lines 103-106).
//
// Reference algorithm shape: `src/lib/citymap/cityMapGenerator.ts` lines
// 109-358 (V1, tile-based). We mirror the *stages* (score → sort → cut →
// connect-prune → hole-fill → deterministic edge chain → cardinal-aligned
// gate pick) but run them on the polygon graph. Do NOT copy V1's tile
// data structures.
//
// PR 3 note: the polygon-edge helpers (`roundV`, `vertexKey`,
// `canonicalEdgeKey`, `EdgeRecord`, `buildEdgeOwnership`) used to live
// here. They were lifted into `cityMapEdgeGraph.ts` when rivers / roads /
// streets appeared as additional callers. This file now imports them
// and keeps only the wall-specific stages.
// ─────────────────────────────────────────────────────────────────────────────

import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';
import { createNoiseSamplers, fbm } from '../terrain/noise';
import {
  buildEdgeOwnership,
  canonicalEdgeKey,
  vertexKey,
  type EdgeRecord,
} from './cityMapEdgeGraph';

// Mirrors V1's file-local SIZE_TIER (cityMapGenerator.ts:37). Duplicated
// rather than imported so V1 can be retired in PR 5 without a reverse dep.
const SIZE_TIER: Record<CitySize, number> = {
  small: 0,
  medium: 0.25,
  large: 0.5,
  metropolis: 0.75,
  megalopolis: 1,
};

// Fraction of non-edge polygons that fall inside the walls. Lerp(0.50..0.85)
// over the size tier — same bounds as the V1 tile coverage, applied to the
// polygon candidate set instead of a tile grid.
const COVERAGE_MIN = 0.5;
const COVERAGE_MAX = 0.85;

// FBM perturbation applied to each polygon's radial-distance score. The
// input scale produces ~5-8 noise cycles across the 720 px canvas (matches
// V1's visual roughness of `x * 0.18` over a ~30-wide tile grid).
const FBM_SCALE = 0.01;
const FBM_AMPLITUDE = 0.6;

// Cardinal gate alignment threshold. `dot(outward_normal, cardinal) >=
// this` qualifies an edge as gate-facing. 0.99 matches V1's threshold.
const GATE_ALIGNMENT_THRESHOLD = 0.99;
// Weight used when scoring candidate gate edges: projection along the
// cardinal axis dominates perpendicular distance from center.
const GATE_PROJ_WEIGHT = 100;

type Point = [number, number];
type Edge = [Point, Point];

export interface WallGenerationResult {
  /** Closed polyline along polygon edges (first === last). Empty on degenerate input. */
  wallPath: Point[];
  /** Up to 4 gates — one per cardinal direction, skipping `env.waterSide`. */
  gates: { edge: Edge; dir: 'N' | 'S' | 'E' | 'W' }[];
}

/**
 * Generate the wall footprint + gate list for a V2 city.
 *
 * Operates entirely on the Voronoi polygon graph — no tiles, ever. RNG
 * stream: `${seed}_city_${cityName}_walls` (matches V1 convention and
 * CLAUDE.md's stream-naming rule).
 *
 * Returns `{ wallPath: [], gates: [] }` on every degenerate case (too
 * few candidates, empty interior component, failed chain) so the caller
 * can always spread the result without special-casing.
 */
export function generateWallsAndGates(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  canvasSize: number,
): WallGenerationResult {
  const samplers = createNoiseSamplers(`${seed}_city_${cityName}_walls`);

  const interior = selectInteriorPolygons(polygons, env, canvasSize, samplers);
  if (interior.size < 3) return { wallPath: [], gates: [] };

  const edgeOwnership = buildEdgeOwnership(polygons);
  const boundaryEdges = collectWallBoundaryEdges(polygons, interior, edgeOwnership);
  const wallPath = chainWallPath(boundaryEdges);
  if (wallPath.length < 4) return { wallPath: [], gates: [] };

  const gates = pickGates(wallPath, env.waterSide, canvasSize);
  return { wallPath, gates };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — polygon selection (wall footprint)
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Score every non-edge polygon by `radial distance from
// canvas center + FBM perturbation sampled at the polygon's site`. Lower
// score = more central / more likely to fall inside the walls. No tile
// grid — scoring is per `CityPolygon`, FBM samples `polygon.site` (pixel
// coords, not tile indices). Then BFS-prune to the single connected
// component over `polygon.neighbors` and hole-fill from the isEdge frontier.
function selectInteriorPolygons(
  polygons: CityPolygon[],
  env: CityEnvironment,
  canvasSize: number,
  samplers: ReturnType<typeof createNoiseSamplers>,
): Set<number> {
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const maxR = canvasSize / 2;

  // Only non-edge polygons are walled candidates: the wall must sit inside
  // the canvas, so `isEdge` polygons (touching the 720 bbox) stay outside.
  type Scored = { id: number; score: number };
  const scored: Scored[] = [];
  for (const p of polygons) {
    if (p.isEdge) continue;
    const [sx, sy] = p.site;
    const dx = sx - cx;
    const dy = sy - cy;
    const r = Math.sqrt(dx * dx + dy * dy) / maxR;
    const noise = fbm(samplers.elevation, sx * FBM_SCALE, sy * FBM_SCALE, 4);
    const perturb = (noise - 0.5) * FBM_AMPLITUDE;
    scored.push({ id: p.id, score: r + perturb });
  }
  if (scored.length === 0) return new Set();

  // Deterministic order: score ascending, then id ascending as tie-breaker.
  scored.sort((a, b) => (a.score - b.score) || (a.id - b.id));

  const tier = SIZE_TIER[env.size];
  const coverage = COVERAGE_MIN + (COVERAGE_MAX - COVERAGE_MIN) * tier;
  const targetCount = Math.max(1, Math.round(coverage * scored.length));

  const initial = new Set<number>();
  for (let i = 0; i < targetCount && i < scored.length; i++) {
    initial.add(scored[i].id);
  }

  // BFS-prune: keep the connected component containing the most-central
  // interior polygon. Traversal is restricted to polygon.neighbors that
  // are also in `initial` — the polygon graph plays the role V1's 4-way
  // tile lattice played.
  let seedId = -1;
  let bestDist = Infinity;
  for (const id of initial) {
    const [sx, sy] = polygons[id].site;
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < bestDist) {
      bestDist = d;
      seedId = id;
    }
  }
  if (seedId === -1) return new Set();

  const interior = new Set<number>();
  const queue: number[] = [seedId];
  interior.add(seedId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (initial.has(nb) && !interior.has(nb)) {
        interior.add(nb);
        queue.push(nb);
      }
    }
  }

  // Hole-fill: flood from the `isEdge` frontier inward over non-interior
  // polygons. Anything the flood can't reach AND isn't already interior
  // must be a hole enclosed by interior — flip it to interior. Mirrors
  // V1's exterior-flood strategy (cityMapGenerator.ts:183-215), but the
  // "boundary" is the polygon.isEdge set instead of the tile border row.
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

  return interior;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — polygon-edge ownership map
// ─────────────────────────────────────────────────────────────────────────────
// `buildEdgeOwnership`, `roundV`, `vertexKey`, `canonicalEdgeKey`, and the
// `EdgeRecord` shape live in `cityMapEdgeGraph.ts` — lifted out of this file
// in PR 3 when rivers/roads/streets became additional callers. The pre-lift
// helpers were here in PR 2. Do NOT duplicate them again.

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — collect wall boundary edges
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] An edge is on the wall iff exactly one of its owning
// polygons is in `interior`. We emit the edge in the polygon's own vertex
// walk order; the chain step below re-orders into a deterministic CW loop,
// so we don't need to flip orientations here.
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

    // Figure out which owner is the interior one, and emit the edge in
    // that polygon's local walk direction. This gives `chainWallPath`
    // a consistent half-edge orientation to stitch from.
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
    // Fallback (shouldn't trigger — owner must contain the edge by construction).
    if (!emitted) edges.push([[rec.a[0], rec.a[1]], [rec.b[0], rec.b[1]]]);
  }
  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — chain edges into a closed wall polyline
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Adjacency walk keyed by canonicalized vertex strings
// (polygon corners in pixel coords, NOT tile corners). Mirrors V1's
// `chainWallPath` (cityMapGenerator.ts:237-293) but operates on the
// polygon-edge graph.
function chainWallPath(edges: Edge[]): Point[] {
  if (edges.length === 0) return [];

  const adj = new Map<string, Point[]>();
  for (const [a, b] of edges) {
    const k = vertexKey(a);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push([b[0], b[1]]);
  }

  // Deterministic start — smallest (y, x) across all outgoing-edge origins.
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
      // At forks, prefer straight (dot) then CW turn (cross, y-down). Same
      // scoring used by V1; because polygon edges are not unit-length, we
      // normalize both the incoming and candidate outgoing vectors so the
      // score compares like with like.
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

  // Require a closed polyline. Degenerate inputs (e.g. disconnected
  // boundary fragments) return empty so the renderer draws nothing.
  if (path.length < 4) return [];
  if (vertexKey(path[0]) !== vertexKey(path[path.length - 1])) return [];
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — gate selection
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Same cardinal-alignment scoring V1 uses, but the edge
// endpoints come from polygon corners rather than tile corners. Polygon
// edges are not unit-length, so the outward normal is normalized before
// the dot-product threshold. Each cardinal direction contributes at most
// one gate; `env.waterSide` (if set) skips the matching direction entirely.
function pickGates(
  wallPath: Point[],
  waterSide: CityEnvironment['waterSide'],
  canvasSize: number,
): { edge: Edge; dir: 'N' | 'S' | 'E' | 'W' }[] {
  if (wallPath.length < 2) return [];

  const dirs: Array<{
    dir: 'N' | 'S' | 'E' | 'W';
    normal: [number, number];
    waterKey: 'north' | 'south' | 'east' | 'west';
  }> = [
    { dir: 'N', normal: [0, -1], waterKey: 'north' },
    { dir: 'S', normal: [0, 1],  waterKey: 'south' },
    { dir: 'E', normal: [1, 0],  waterKey: 'east'  },
    { dir: 'W', normal: [-1, 0], waterKey: 'west'  },
  ];

  const center = canvasSize / 2;
  const gates: { edge: Edge; dir: 'N' | 'S' | 'E' | 'W' }[] = [];
  const used = new Set<string>();

  for (const d of dirs) {
    if (waterSide === d.waterKey) continue;

    let bestEdge: Edge | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < wallPath.length - 1; i++) {
      const a = wallPath[i];
      const b = wallPath[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      // Outward normal for a CW polygon traversed in y-down coords: (dy, -dx).
      // V2 wall paths are CW by construction of `chainWallPath` (deterministic
      // start + straight/CW scoring).
      const nx = dy / len;
      const ny = -dx / len;
      const dot = nx * d.normal[0] + ny * d.normal[1];
      if (dot < GATE_ALIGNMENT_THRESHOLD) continue;

      const midx = (a[0] + b[0]) / 2;
      const midy = (a[1] + b[1]) / 2;
      const proj = midx * d.normal[0] + midy * d.normal[1];
      const perpDist = d.normal[0] !== 0 ? Math.abs(midy - center) : Math.abs(midx - center);
      const score = proj * GATE_PROJ_WEIGHT - perpDist;

      const k = canonicalEdgeKey(a, b);
      if (used.has(k)) continue;

      if (score > bestScore) {
        bestScore = score;
        bestEdge = [[a[0], a[1]], [b[0], b[1]]];
      }
    }

    if (bestEdge) {
      gates.push({ edge: bestEdge, dir: d.dir });
      used.add(canonicalEdgeKey(bestEdge[0], bestEdge[1]));
    }
  }

  return gates;
}
