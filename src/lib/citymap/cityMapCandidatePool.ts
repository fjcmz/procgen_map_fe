// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Phase 2 of specs/City_districts_redux.md
// Candidate pool for the unified landmark placer (`cityMapLandmarksUnified.ts`).
// ─────────────────────────────────────────────────────────────────────────────
// Returns the polygon ids the unified placer is allowed to consider:
// the city interior PLUS a 5-hop ring of exterior polygons reachable via
// `polygon.neighbors`. Water and mountain polygons are excluded (mountain-
// adjacent landmarks are handled by the existing `findNearMountainPolygons`
// path in `cityMapGeneratorV2.ts`).
//
// Algorithm mirrors `findNearMountainPolygons` in `cityMapGeneratorV2.ts:217`
// — multi-source BFS over `polygon.neighbors`, no edge-graph traversal.
// ─────────────────────────────────────────────────────────────────────────────

import type { CityPolygon } from './cityMapTypesV2';
import type { WallGenerationResult } from './cityMapWalls';
import type { PolygonEdgeGraph } from './cityMapEdgeGraph';

/** Hops to expand outward from `wall.interiorPolygonIds`. Spec: "5-hop boundary band". */
const BOUNDARY_HOPS = 5;

/**
 * Build the unified-placer candidate pool: interior ∪ 5-hop boundary band,
 * minus excluded water and mountain polygons.
 *
 * `_edgeGraph` is reserved for Phase 3+ scoring (gate proximity, wall-edge
 * counts) — Phase 2's BFS only needs `polygon.neighbors`.
 */
export function buildCandidatePool(
  wall: WallGenerationResult,
  polygons: CityPolygon[],
  _edgeGraph: PolygonEdgeGraph,
  exclude: { waterPolygonIds: Set<number>; mountainPolygonIds: Set<number> },
): Set<number> {
  const interior = wall.interiorPolygonIds;
  if (interior.size === 0) return new Set<number>();

  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const pid of interior) {
    dist.set(pid, 0);
    queue.push(pid);
  }
  let head = 0;
  while (head < queue.length) {
    const pid = queue[head++];
    const d = dist.get(pid)!;
    if (d >= BOUNDARY_HOPS) continue;
    for (const nb of polygons[pid].neighbors) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }

  const pool = new Set<number>();
  for (const [pid] of dist) {
    if (exclude.waterPolygonIds.has(pid)) continue;
    if (exclude.mountainPolygonIds.has(pid)) continue;
    pool.add(pid);
  }
  return pool;
}
