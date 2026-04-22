// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — river (PR 3 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// The river traces polygon edges — never tile lattices. Entry and exit
// vertices come from polygons whose `isEdge` flag is set (i.e. polygons
// that touch the 720 bbox). The main channel is an A* over the polygon
// edge graph produced by `cityMapEdgeGraph.ts::buildPolygonEdgeGraph`.
// Large+ cities get a bifurcation that forks around a middle-third
// stretch of the main channel; when it rejoins, the fork enclosed by
// the two channels is detected via a polygon-graph flood (not a
// ring-of-edges check) so multi-polygon islands are found correctly.
//
// RNG stream: `${seed}_city_${cityName}_river` (per CLAUDE.md's stream
// naming rule — every PR 3 feature file adds a distinct `_<feature>`
// suffix off the shared `${seed}_city_${cityName}_` prefix).
//
// The spec uses V1 tile language ("1–2 tile offset", "3–6 tiles then
// rejoin"). Translation to polygon-space:
//   - "1–2 tile offset" → detour vertices must sit within ~1 avgEdgeLen
//     of the main stretch (prevents the A* from swinging far away).
//   - "3–6 tiles then rejoin" → main-stretch length in path-vertex count
//     is chosen in [3, 6], and the bifurcation reuses the same two
//     endpoints so it rejoins the main channel naturally.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';
import {
  aStarEdgeGraph,
  canonicalEdgeKey,
  keyPathToPoints,
  vertexKey,
  type Point,
  type PolygonEdgeGraph,
} from './cityMapEdgeGraph';

type CardinalSide = 'north' | 'south' | 'east' | 'west';

// Two sides are "non-adjacent" iff they are opposites (N/S or E/W). The
// river should cross the map, not skim a corner.
const OPPOSITE: Record<CardinalSide, CardinalSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

// Fraction of a vertex's distance to a canvas side that still qualifies
// as "on that side". Voronoi cells clipped to the bbox have their
// corner vertices pinned exactly onto the canvas edge, so a tight
// epsilon is safe — we use 0.5 px to absorb `roundV`-induced drift.
const SIDE_EPSILON_PX = 0.5;

// Only cities of `large` or above attempt bifurcation (spec: "large+").
const BIFURCATION_SIZES: ReadonlySet<CitySize> = new Set(['large', 'metropolis', 'megalopolis']);
const BIFURCATION_ATTEMPTS = 6;
const BIFURCATION_CHANCE = 0.35;
// Main-stretch length range, in main-path vertex count (3–6 edges = 4–7 vertices).
const BIFURCATION_MIN_STRETCH = 3;
const BIFURCATION_MAX_STRETCH = 6;
// Detour locality guard: every bifurcation vertex must sit within this
// many avg-edge-lengths of SOME main-stretch vertex. Translates the
// spec's "1–2 tile offset" to polygon-space.
const BIFURCATION_MAX_OFFSET_AVG_LENS = 2.5;

export interface RiverGenerationResult {
  edges: [Point, Point][];
  islandPolygonIds: number[];
}

/**
 * Generate the V2 city river.
 *
 * Returns `null` when the environment has no river (`!env.hasRiver`) or
 * when the polygon graph is too small / disconnected to support a
 * boundary-to-boundary path. The caller populates `CityMapDataV2.river`
 * with this result (or `null`).
 */
export function generateRiver(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  graph: PolygonEdgeGraph,
  canvasSize: number,
): RiverGenerationResult | null {
  if (!env.hasRiver) return null;

  const rng = seededPRNG(`${seed}_city_${cityName}_river`);

  // ── Boundary buckets ──────────────────────────────────────────────────
  // [Voronoi-polygon] A river endpoint must sit on a canvas side that
  // we're willing to reach. Candidates are the ring vertices of `isEdge`
  // polygons (polygons touching the canvas bbox). For each such vertex we
  // test which canvas side it lies on (within SIDE_EPSILON_PX) and bucket
  // it there. A vertex exactly at a corner could qualify for two sides —
  // we still bucket it into both; the side picker chooses non-adjacent
  // sides so corner cases resolve naturally.
  const buckets: Record<CardinalSide, string[]> = {
    north: [],
    south: [],
    east: [],
    west: [],
  };
  const seen = new Set<string>();
  for (const poly of polygons) {
    if (!poly.isEdge) continue;
    for (const v of poly.vertices) {
      const key = vertexKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      const [vx, vy] = v;
      if (vy <= SIDE_EPSILON_PX) buckets.north.push(key);
      if (vy >= canvasSize - SIDE_EPSILON_PX) buckets.south.push(key);
      if (vx <= SIDE_EPSILON_PX) buckets.west.push(key);
      if (vx >= canvasSize - SIDE_EPSILON_PX) buckets.east.push(key);
    }
  }

  // Filter sides to those the river can use.
  // Rule: skip `env.waterSide` unless it's the ONLY way to satisfy the
  // "finish on the coast" spec clause. For a coast+river city we make
  // `waterSide` the mandatory endpoint side (spec: "if the city is on
  // the coast the river must finish on the coast"). Otherwise the river
  // avoids the water side entirely.
  const availableSides: CardinalSide[] = (['north', 'south', 'east', 'west'] as CardinalSide[])
    .filter(s => buckets[s].length > 0);
  if (availableSides.length < 2) return null;

  let sideA: CardinalSide | null = null;
  let sideB: CardinalSide | null = null;

  if (env.waterSide && buckets[env.waterSide].length > 0) {
    // Coastal city: one endpoint is forced onto the water side, the
    // other is chosen from non-adjacent (opposite) sides that remain.
    sideA = env.waterSide;
    const opp = OPPOSITE[env.waterSide];
    if (buckets[opp].length > 0) {
      sideB = opp;
    } else {
      // Fallback: any non-water, non-adjacent side. "Non-adjacent" here
      // relaxes to "any other available side" when the opposite is empty.
      const others = availableSides.filter(s => s !== env.waterSide);
      if (others.length === 0) return null;
      sideB = others[Math.floor(rng() * others.length)];
    }
  } else {
    // Inland city: pick two opposites, skipping waterSide if set.
    const candidates = availableSides.filter(s => s !== env.waterSide);
    if (candidates.length < 2) return null;
    // Prefer opposite pair (N/S or E/W). Try each candidate in random
    // order, accept the first one whose opposite is also available.
    const shuffled = candidates.slice().sort(() => rng() - 0.5);
    for (const c of shuffled) {
      if (candidates.includes(OPPOSITE[c])) {
        sideA = c;
        sideB = OPPOSITE[c];
        break;
      }
    }
    // Fallback: any two distinct sides (adjacent OK as last resort).
    if (!sideA || !sideB) {
      sideA = shuffled[0];
      sideB = shuffled[1];
    }
  }

  if (!sideA || !sideB) return null;
  if (buckets[sideA].length === 0 || buckets[sideB].length === 0) return null;

  const startKey = buckets[sideA][Math.floor(rng() * buckets[sideA].length)];
  const endKey = buckets[sideB][Math.floor(rng() * buckets[sideB].length)];
  if (startKey === endKey) return null;

  // ── Main channel A* ───────────────────────────────────────────────────
  // Meander cost is a per-step random additive scaled by avg edge length
  // so it's dimensionally consistent with the straight-line bias.
  const meanderWeight = 0.4 * graph.avgEdgeLen;
  const mainCost = (
    _currKey: string,
    _currPoint: Point,
    nb: { edgeLen: number },
  ) => nb.edgeLen + rng() * meanderWeight;
  const mainKeys = aStarEdgeGraph(graph, startKey, endKey, mainCost);
  if (!mainKeys || mainKeys.length < 2) return null;

  // Accumulate river edges by canonical key so the branch pass can cheaply
  // check for duplicates.
  const riverEdgeKeys = new Set<string>();
  const riverEdgesRaw: [Point, Point][] = [];
  const mainPoints = keyPathToPoints(graph, mainKeys);
  const addEdgePair = (a: Point, b: Point) => {
    const k = canonicalEdgeKey(a, b);
    if (riverEdgeKeys.has(k)) return;
    riverEdgeKeys.add(k);
    riverEdgesRaw.push([[a[0], a[1]], [b[0], b[1]]]);
  };
  for (let i = 0; i < mainPoints.length - 1; i++) {
    addEdgePair(mainPoints[i], mainPoints[i + 1]);
  }

  // ── Bifurcation (large+ cities, per spec) ─────────────────────────────
  // [Voronoi-polygon] Pick a middle-third stretch of the main key-path,
  // block the stretch's interior vertex keys, then A* an alternate route
  // from stretch-start to stretch-end. If A* finds a disjoint route
  // whose vertices stay within BIFURCATION_MAX_OFFSET_AVG_LENS of the
  // original stretch (spec's "1–2 tile offset" intent), append its edges
  // to the river set. The enclosed polygons become islands — detected by
  // the polygon-flood pass below, not by a ring-check.
  if (BIFURCATION_SIZES.has(env.size) && mainKeys.length > BIFURCATION_MIN_STRETCH + 2) {
    const loIdx = Math.max(1, Math.floor(mainKeys.length * 0.25));
    const hiIdx = Math.min(mainKeys.length - 2, Math.floor(mainKeys.length * 0.75));
    const maxOffsetPx = BIFURCATION_MAX_OFFSET_AVG_LENS * graph.avgEdgeLen;

    for (let attempt = 0; attempt < BIFURCATION_ATTEMPTS; attempt++) {
      if (rng() > BIFURCATION_CHANCE) continue;
      if (hiIdx - loIdx < BIFURCATION_MIN_STRETCH + 1) break;
      const stretchLen =
        BIFURCATION_MIN_STRETCH +
        Math.floor(rng() * (BIFURCATION_MAX_STRETCH - BIFURCATION_MIN_STRETCH + 1));
      const startIdx = loIdx + Math.floor(rng() * Math.max(1, hiIdx - loIdx - stretchLen));
      const endIdx = startIdx + stretchLen;
      if (endIdx >= mainKeys.length) continue;

      // Block the interior vertices of the stretch so A* must detour.
      const blocked = new Set<string>();
      for (let i = startIdx + 1; i < endIdx; i++) blocked.add(mainKeys[i]);

      // Locality filter: reject detours that stray far from the stretch.
      const stretchPoints: Point[] = [];
      for (let i = startIdx; i <= endIdx; i++) {
        const p = graph.vertexPoints.get(mainKeys[i]);
        if (p) stretchPoints.push(p);
      }
      const maxOffsetSq = maxOffsetPx * maxOffsetPx;
      // Meander cost with a heavy penalty for straying beyond the locality
      // radius — this biases A* toward a parallel detour without forbidding
      // vertex candidates outright (forbidding would make A* fail more often).
      const branchCost = (
        _currKey: string,
        _currPoint: Point,
        nb: { point: Point; edgeLen: number },
      ) => {
        let minD2 = Infinity;
        for (const sp of stretchPoints) {
          const dx = nb.point[0] - sp[0];
          const dy = nb.point[1] - sp[1];
          const d2 = dx * dx + dy * dy;
          if (d2 < minD2) minD2 = d2;
        }
        const offsetPenalty = minD2 > maxOffsetSq ? (minD2 - maxOffsetSq) * 0.01 : 0;
        return nb.edgeLen + rng() * meanderWeight + offsetPenalty;
      };

      const branchKeys = aStarEdgeGraph(graph, mainKeys[startIdx], mainKeys[endIdx], branchCost, {
        blockedKeys: blocked,
      });
      if (!branchKeys || branchKeys.length < 3) continue;

      // Reject the branch if any detour vertex falls outside the locality
      // budget (cost function only biases, doesn't forbid).
      let outOfRange = false;
      for (let i = 1; i < branchKeys.length - 1; i++) {
        const p = graph.vertexPoints.get(branchKeys[i]);
        if (!p) continue;
        let minD2 = Infinity;
        for (const sp of stretchPoints) {
          const dx = p[0] - sp[0];
          const dy = p[1] - sp[1];
          const d2 = dx * dx + dy * dy;
          if (d2 < minD2) minD2 = d2;
        }
        if (minD2 > maxOffsetSq) {
          outOfRange = true;
          break;
        }
      }
      if (outOfRange) continue;

      const branchPoints = keyPathToPoints(graph, branchKeys);
      for (let i = 0; i < branchPoints.length - 1; i++) {
        addEdgePair(branchPoints[i], branchPoints[i + 1]);
      }
      break; // One bifurcation per river, per spec ("per stretch" applies across attempts).
    }
  }

  // ── Island polygons via flood ─────────────────────────────────────────
  // [Voronoi-polygon] Flood the polygon graph via `polygon.neighbors`,
  // seeded from every `isEdge` polygon, BUT: a flood step cannot cross
  // an edge that is in the river set (we look up the canonical key of
  // the shared edge between the two polygons). Anything the flood can't
  // reach is walled off by the river on all sides — those are islands.
  //
  // Notes:
  //   - A single-polygon island happens when a polygon's ring is fully
  //     traced by river edges (the flood can't enter from any neighbor).
  //   - A multi-polygon island happens when the bifurcation encloses a
  //     cluster; ring-check can't find this, flood can.
  //   - Polygons with no river edges at all are always reachable via a
  //     spanning tree rooted at the canvas boundary — correctly not an
  //     island.
  const islandPolygonIds = floodDetectIslands(polygons, riverEdgeKeys);

  return { edges: riverEdgesRaw, islandPolygonIds };
}

// [Voronoi-polygon] Flood the polygon adjacency graph from every `isEdge`
// polygon, but treat any shared edge in `riverEdgeKeys` as a wall. Any
// non-edge polygon the flood can't reach is an island.
function floodDetectIslands(
  polygons: CityPolygon[],
  riverEdgeKeys: Set<string>,
): number[] {
  // Build polygon→polygon shared-edge lookup so we don't rebuild
  // canonical keys at every flood step.
  const sharedEdgeKey = new Map<string, string>(); // "a,b" (a<b) → canonical edge key
  for (const poly of polygons) {
    const verts = poly.vertices;
    const n = verts.length;
    if (n < 3) continue;
    for (const nb of poly.neighbors) {
      const lo = Math.min(poly.id, nb);
      const hi = Math.max(poly.id, nb);
      const pairKey = `${lo},${hi}`;
      if (sharedEdgeKey.has(pairKey)) continue;
      // Find the canonical edge whose both endpoints belong to both polygons.
      // Cheapest: iterate this polygon's edges, find the one whose
      // canonical key also appears in the neighbor's edge set.
      const nbPoly = polygons[nb];
      const nbVerts = nbPoly?.vertices;
      if (!nbVerts || nbVerts.length < 3) continue;
      const nbEdgeKeys = new Set<string>();
      for (let j = 0; j < nbVerts.length; j++) {
        const a = nbVerts[j];
        const b = nbVerts[(j + 1) % nbVerts.length];
        nbEdgeKeys.add(canonicalEdgeKey(a, b));
      }
      for (let i = 0; i < n; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % n];
        const k = canonicalEdgeKey(a, b);
        if (nbEdgeKeys.has(k)) {
          sharedEdgeKey.set(pairKey, k);
          break;
        }
      }
    }
  }

  const reachable = new Set<number>();
  const queue: number[] = [];
  for (const p of polygons) {
    if (p.isEdge) {
      reachable.add(p.id);
      queue.push(p.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const poly = polygons[id];
    for (const nb of poly.neighbors) {
      if (reachable.has(nb)) continue;
      const lo = Math.min(id, nb);
      const hi = Math.max(id, nb);
      const eKey = sharedEdgeKey.get(`${lo},${hi}`);
      if (eKey && riverEdgeKeys.has(eKey)) continue; // blocked by river
      reachable.add(nb);
      queue.push(nb);
    }
  }

  const islands: number[] = [];
  for (const p of polygons) {
    if (p.isEdge) continue;
    if (!reachable.has(p.id)) islands.push(p.id);
  }
  return islands;
}
