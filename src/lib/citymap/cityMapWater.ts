// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — coastal water polygons (coast support)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// For coastal cities (`env.isCoastal && env.waterSide`), a portion of the
// canvas polygons is carved out as water along the matching canvas edge:
//
//   • Water caps at 25% of the total canvas polygons.
//   • The water set is biased toward the `env.waterSide` canvas edge (the
//     water position mirrors the world-map coastline).
//   • An FBM perturbation gives the coastline an organic outline rather
//     than a straight edge.
//   • Selection grows as the connected component containing the "most
//     waterside" polygon so water always reaches the canvas boundary.
//
// Downstream consumers treat water polygons as follows:
//   • `cityMapShape.ts`    — excludes them from city-footprint eligibility
//                            and shifts the footprint center toward the
//                            coast so the city grows from near the shore.
//   • `cityMapWalls.ts`    — skips boundary seams shared with a water
//                            polygon (no walls next to water).
//   • `cityMapNetwork.ts`  — blocks road / street / exit-road edges shared
//                            with a water polygon (roads never cross water).
//   • `cityMapBlocks.ts`   — excludes water polygons from the standard
//                            flood; only the special `dock` role (large+
//                            cities) is allowed to land on water.
//   • `cityMapRendererV2.ts` — fills water polygons with a light-blue
//                              channel colour on Layer 1.5.
//
// RNG sub-stream: `${seed}_city_${cityName}_water` — independent from every
// other V2 stream so wiring coastal support does not perturb seeds used by
// existing terrain / wall / river / network / blocks modules.
// ─────────────────────────────────────────────────────────────────────────────

import { createNoiseSamplers, fbm } from '../terrain/noise';
import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';

// Hard cap on water coverage (spec: "at most 25% of the canvas").
const WATER_MAX_FRACTION = 0.25;
// Target fraction — we try to carve this much so the coast reads as a real
// waterbody rather than a thin strip. Clamped by WATER_MAX_FRACTION.
const WATER_TARGET_FRACTION = 0.22;
// FBM tuning for the coastline perturbation — same scale family as
// `cityMapShape.ts` so the coastline and city outline look stylistically
// matched.
const FBM_SCALE = 0.01;
const FBM_AMPLITUDE = 0.55;

/**
 * Select the polygons that will render as water for this city.
 *
 * Returns an empty set for inland cities (no `env.waterSide`) or when the
 * polygon graph is degenerate. The caller stores the set as
 * `CityMapDataV2.waterPolygonIds` (array form) so it crosses the data
 * contract cleanly.
 */
export function generateWaterPolygons(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  canvasSize: number,
): Set<number> {
  if (!env.isCoastal || !env.waterSide) return new Set();
  if (polygons.length === 0) return new Set();

  const samplers = createNoiseSamplers(`${seed}_city_${cityName}_water`);

  // [Voronoi-polygon] Score each polygon by its normalized distance from the
  // water-side canvas edge (0 = on the edge, 1 = on the opposite edge) plus
  // an FBM perturbation. Lowest-scored polygons are water; highest are land.
  type Scored = { id: number; score: number };
  const scored: Scored[] = [];
  for (const p of polygons) {
    const [sx, sy] = p.site;
    const d = edgeDistance(env.waterSide, sx, sy, canvasSize);
    const noise = fbm(samplers.elevation, sx * FBM_SCALE, sy * FBM_SCALE, 4);
    const perturb = (noise - 0.5) * FBM_AMPLITUDE;
    scored.push({ id: p.id, score: d + perturb });
  }
  scored.sort((a, b) => (a.score - b.score) || (a.id - b.id));

  // [Voronoi-polygon] Take the top `targetCount` polygons as the raw water
  // pool, then BFS-prune to the connected component containing the polygon
  // closest to the coast. This guarantees a single contiguous waterbody
  // that reaches the canvas edge (no disconnected puddles inland).
  const targetFrac = Math.min(WATER_MAX_FRACTION, WATER_TARGET_FRACTION);
  const targetCount = Math.max(1, Math.floor(polygons.length * targetFrac));
  const pool = new Set<number>();
  for (let i = 0; i < targetCount; i++) pool.add(scored[i].id);

  const seedId = scored[0].id;
  const water = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (pool.has(nb) && !water.has(nb)) {
        water.add(nb);
        queue.push(nb);
      }
    }
  }

  // Never let water exceed the hard cap — safety net in case the BFS
  // accidentally absorbs stragglers via adjacency.
  const hardCap = Math.floor(polygons.length * WATER_MAX_FRACTION);
  if (water.size > hardCap) {
    // Trim the highest-scored (farthest-from-edge) polygons until we're
    // under the cap. Deterministic because `scored` is already sorted.
    const ordered = scored.filter(s => water.has(s.id));
    ordered.sort((a, b) => (b.score - a.score) || (b.id - a.id));
    for (const s of ordered) {
      if (water.size <= hardCap) break;
      water.delete(s.id);
    }
  }

  return water;
}

// [Voronoi-polygon] Normalized (0..1) distance from a point to the named
// canvas edge. Used as the primary water-placement score.
function edgeDistance(
  side: NonNullable<CityEnvironment['waterSide']>,
  x: number,
  y: number,
  canvasSize: number,
): number {
  switch (side) {
    case 'north': return y / canvasSize;
    case 'south': return (canvasSize - y) / canvasSize;
    case 'west':  return x / canvasSize;
    case 'east':  return (canvasSize - x) / canvasSize;
  }
}
