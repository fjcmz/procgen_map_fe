// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — open spaces (PR 4 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// PR 4 in the spec bundles three features (blocks + open spaces + landmarks).
// This module lands ONLY the "open spaces" piece — blocks and landmarks are
// deferred to a follow-up PR. The `CityBlockV2[]` and `CityLandmarkV2[]`
// fields on `CityMapDataV2` stay empty for now.
//
// The spec's open-space rules (line 65) are:
//   • 1 central civic square
//   • 1 market square per market block
//   • 1–3 parks scaling with city size
//
// Without `blocks` we translate the spec's block-anchored language into
// polygon-graph language:
//
//   Civic square — the polygon whose Voronoi `site` is closest to canvas
//                  center. Single polygon, no RNG (deterministic).
//
//   Markets      — placed on the polygon whose `site` is closest to each
//                  gate midpoint (medieval market-at-gate intuition). Extra
//                  markets (when the per-tier count exceeds the gate count)
//                  are picked to maximise distance from already-placed open
//                  spaces (Lloyd-style spread).
//
//   Parks        — clusters of 1–3 polygons grown by BFS over
//                  `polygon.neighbors`. Seeds avoid polygons adjacent to the
//                  civic square / markets so parks read as suburban green
//                  space rather than civic plazas.
//
// Every placement decision references one of these `CityPolygon` primitives:
//   • `polygon.id`         — output identity
//   • `polygon.site`       — proximity scoring (civic, markets, spread)
//   • `polygon.vertices`   — eligibility test (touches wall/river/road edge?)
//   • `polygon.neighbors`  — park BFS expansion
//   • `polygon.isEdge`     — exclude (those polygons belong to PR 5 sprawl)
//
// No tile lattice. No `Math.random`. RNG: dedicated `_openspaces` sub-streams
// (`_squares` / `_markets` / `_parks`) so future open-space kinds can be
// inserted without shifting existing scatter seeds.
//
// Output type — frozen since PR 1 (`cityMapTypesV2.ts:118-119`):
//   { kind: 'square' | 'market' | 'park'; polygonIds: number[] }[]
//
// Reference patterns:
//   • `cityMapWalls.ts`   — polygon eligibility + scoring + BFS over neighbors
//   • `cityMapRiver.ts`   — polygon-graph flood with edge constraints
//   • `cityMapNetwork.ts` — covered-edge keying via `canonicalEdgeKey`
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityEnvironment, CityMapDataV2, CityPolygon } from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';
import { canonicalEdgeKey, type Point } from './cityMapEdgeGraph';
import type { WallGenerationResult } from './cityMapWalls';
import type { RiverGenerationResult } from './cityMapRiver';

// ─── Per-tier open-space counts ─────────────────────────────────────────────
// Translate the spec's block-anchored language ("1 market per market block",
// "1–3 parks scaling with size") into raw polygon counts. The count tables
// are tuned so total open-space coverage hovers near the spec's "~10% of
// area" target on cities with 150 / 250 / 350 / 500 / 1000 polygons (since
// Lloyd-relaxed polygons have roughly uniform area).
const MARKET_COUNT: Record<CitySize, number> = {
  small: 2,
  medium: 4,
  large: 5,
  metropolis: 8,
  megalopolis: 16,
};
const PARK_COUNT: Record<CitySize, number> = {
  small: 1,
  medium: 1,
  large: 2,
  metropolis: 2,
  megalopolis: 3,
};
// Each park BFS-grows from a seed polygon up to this size cap. Larger cities
// get bigger parks so the visual proportion stays sensible.
const PARK_MAX_POLYGONS: Record<CitySize, number> = {
  small: 1,
  medium: 2,
  large: 2,
  metropolis: 3,
  megalopolis: 3,
};

export type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

/**
 * Generate the city's open spaces (squares + markets + parks).
 *
 * Operates entirely on the Voronoi polygon graph — no tiles. Returns an
 * empty array on degenerate input (no eligible polygons) so the caller can
 * spread it without special-casing.
 *
 * Wired into `cityMapGeneratorV2.ts` after `generateNetwork` because
 * eligibility filtering needs the wall / river / road edge sets.
 */
export function generateOpenSpaces(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  wall: WallGenerationResult,
  river: RiverGenerationResult | null,
  roads: Point[][],
  canvasSize: number,
): OpenSpaceEntry[] {
  // ── Eligibility — interior polygons not already taken by infrastructure ──
  // [Voronoi-polygon] We exclude:
  //   1. polygon.isEdge === true       (PR 5 outside-walls sprawl)
  //   2. polygons whose ring touches a wall / river / road polygon edge
  //      (canonical edge keys looked up against pre-built sets — same
  //       float-drift-safe keying every other V2 module uses)
  //
  // Streets are NOT in the exclusion set: plazas / markets *should* front
  // streets, and parks pressed up against a street still read fine.
  const blockedEdgeKeys = new Set<string>();
  for (let i = 0; i < wall.wallPath.length - 1; i++) {
    blockedEdgeKeys.add(canonicalEdgeKey(wall.wallPath[i], wall.wallPath[i + 1]));
  }
  if (river) {
    for (const [a, b] of river.edges) {
      blockedEdgeKeys.add(canonicalEdgeKey(a, b));
    }
  }
  for (const path of roads) {
    for (let i = 0; i < path.length - 1; i++) {
      blockedEdgeKeys.add(canonicalEdgeKey(path[i], path[i + 1]));
    }
  }

  const hasWalls = wall.wallPath.length > 0;
  const eligible = new Set<number>();
  for (const p of polygons) {
    if (p.isEdge) continue;
    if (hasWalls && !wall.interiorPolygonIds.has(p.id)) continue;
    if (touchesBlockedEdge(p, blockedEdgeKeys)) continue;
    eligible.add(p.id);
  }
  if (eligible.size === 0) return [];

  // Used set tracks every polygon already assigned to an open space so the
  // subsequent picks (markets after the civic square; parks after both) can
  // skip them. Iteration order is fixed: civic → markets → parks.
  const used = new Set<number>();
  const result: OpenSpaceEntry[] = [];

  // ── Civic square — single, deterministic ────────────────────────────────
  // [Voronoi-polygon] Polygon whose `site` is nearest canvas center.
  const center: Point = [canvasSize / 2, canvasSize / 2];
  const civicId = nearestPolygonBySite(polygons, eligible, center, used);
  if (civicId !== -1) {
    result.push({ kind: 'square', polygonIds: [civicId] });
    used.add(civicId);
  }

  // ── Markets — gate-anchored first, spread-fill the remainder ────────────
  // [Voronoi-polygon] For each gate, pick the eligible polygon whose `site`
  // is nearest the gate midpoint. Once the per-tier market count exceeds
  // the number of gates, fall through to a spread pass that picks polygons
  // maximising the minimum distance to any already-used polygon site.
  const marketRng = seededPRNG(`${seed}_city_${cityName}_openspaces_markets`);
  const marketTarget = MARKET_COUNT[env.size];
  const marketIds: number[] = [];
  for (const gate of wall.gates) {
    if (marketIds.length >= marketTarget) break;
    const [ga, gb] = gate.edge;
    const midpoint: Point = [(ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2];
    const id = nearestPolygonBySite(polygons, eligible, midpoint, used);
    if (id === -1) continue;
    marketIds.push(id);
    used.add(id);
  }
  while (marketIds.length < marketTarget) {
    const id = farthestPolygonBySite(polygons, eligible, used, marketRng);
    if (id === -1) break;
    marketIds.push(id);
    used.add(id);
  }
  for (const id of marketIds) {
    result.push({ kind: 'market', polygonIds: [id] });
  }

  // ── Parks — BFS clusters seeded away from the civic / market polygons ──
  // [Voronoi-polygon] Seed polygons are eligible polygons NOT adjacent to
  // any already-used polygon (so parks aren't visually swallowed by the
  // civic core). Each park then BFS-grows over `polygon.neighbors` up to
  // `PARK_MAX_POLYGONS[env.size]`, only absorbing eligible / unused
  // neighbors. RNG picks both the seed and the actual cluster size.
  const parkRng = seededPRNG(`${seed}_city_${cityName}_openspaces_parks`);
  const parkTarget = PARK_COUNT[env.size];
  const parkMaxSize = PARK_MAX_POLYGONS[env.size];

  for (let i = 0; i < parkTarget; i++) {
    const seedId = pickParkSeed(polygons, eligible, used, parkRng);
    if (seedId === -1) break;

    // Cluster size: anywhere in [1, parkMaxSize] inclusive.
    const targetSize = 1 + Math.floor(parkRng() * parkMaxSize);
    const cluster = bfsCluster(polygons, eligible, used, seedId, targetSize);
    result.push({ kind: 'park', polygonIds: cluster });
    for (const id of cluster) used.add(id);
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// [Voronoi-polygon] True iff any of `polygon.vertices`'s consecutive edges
// hashes to a key in `blockedEdgeKeys`. Mirrors the cityMapNetwork.ts:107
// pattern of pre-keying wall edges before street eligibility.
function touchesBlockedEdge(polygon: CityPolygon, blockedEdgeKeys: Set<string>): boolean {
  const verts = polygon.vertices;
  const n = verts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    if (blockedEdgeKeys.has(canonicalEdgeKey(a, b))) return true;
  }
  return false;
}

// [Voronoi-polygon] Linear scan over `eligible` polygons returning the id
// whose `site` is closest to `target`. Skips anything in `used`. Uses a
// stable id tie-break so two equally-distant candidates always resolve the
// same way (matches the `cityMapWalls.ts` sort convention).
function nearestPolygonBySite(
  polygons: CityPolygon[],
  eligible: Set<number>,
  target: Point,
  used: Set<number>,
): number {
  let bestId = -1;
  let bestDist = Infinity;
  for (const id of eligible) {
    if (used.has(id)) continue;
    const [sx, sy] = polygons[id].site;
    const dx = sx - target[0];
    const dy = sy - target[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist || (d === bestDist && id < bestId)) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}

// [Voronoi-polygon] Lloyd-style spread pick: returns the eligible polygon
// whose `site` is FARTHEST from any already-used polygon's site. Used to
// place "extra" markets beyond the gate count so they spread evenly across
// the city interior. RNG only used to break exact ties (almost never fires
// in practice but keeps determinism robust to floating-point edge cases).
function farthestPolygonBySite(
  polygons: CityPolygon[],
  eligible: Set<number>,
  used: Set<number>,
  rng: () => number,
): number {
  if (used.size === 0) {
    // No anchor yet — pick a random eligible polygon.
    const candidates: number[] = [];
    for (const id of eligible) if (!used.has(id)) candidates.push(id);
    if (candidates.length === 0) return -1;
    candidates.sort((a, b) => a - b);
    return candidates[Math.floor(rng() * candidates.length)];
  }

  let bestId = -1;
  let bestMinDist = -Infinity;
  for (const id of eligible) {
    if (used.has(id)) continue;
    const [sx, sy] = polygons[id].site;
    let minDist = Infinity;
    for (const usedId of used) {
      const [ux, uy] = polygons[usedId].site;
      const dx = sx - ux;
      const dy = sy - uy;
      const d = dx * dx + dy * dy;
      if (d < minDist) minDist = d;
    }
    if (minDist > bestMinDist || (minDist === bestMinDist && id < bestId)) {
      bestMinDist = minDist;
      bestId = id;
    }
  }
  return bestId;
}

// [Voronoi-polygon] A park seed must be eligible, unused, and not a Delaunay
// neighbor of any already-used polygon. Falling back to "any unused
// eligible" prevents megalopolis cities (with many used polygons clustered
// around the centre) from running out of seeds and emitting fewer parks
// than the per-tier target.
function pickParkSeed(
  polygons: CityPolygon[],
  eligible: Set<number>,
  used: Set<number>,
  rng: () => number,
): number {
  const usedNeighborSet = new Set<number>();
  for (const usedId of used) {
    for (const nb of polygons[usedId].neighbors) usedNeighborSet.add(nb);
  }

  const strict: number[] = [];
  const fallback: number[] = [];
  for (const id of eligible) {
    if (used.has(id)) continue;
    fallback.push(id);
    if (!usedNeighborSet.has(id)) strict.push(id);
  }
  const pool = strict.length > 0 ? strict : fallback;
  if (pool.length === 0) return -1;
  // Stable sort so the same `eligible` / `used` state always indexes into
  // the same candidate list across runs.
  pool.sort((a, b) => a - b);
  return pool[Math.floor(rng() * pool.length)];
}

// [Voronoi-polygon] BFS over `polygon.neighbors` from `seedId`, only
// absorbing polygons that are eligible AND not yet used. Stops at
// `targetSize` polygons or when no more candidates exist. Same shape as
// the wall-interior BFS in `cityMapWalls.ts:181-192`.
function bfsCluster(
  polygons: CityPolygon[],
  eligible: Set<number>,
  used: Set<number>,
  seedId: number,
  targetSize: number,
): number[] {
  const cluster: number[] = [seedId];
  const visited = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  while (queue.length > 0 && cluster.length < targetSize) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (cluster.length >= targetSize) break;
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (!eligible.has(nb)) continue;
      if (used.has(nb)) continue;
      cluster.push(nb);
      queue.push(nb);
    }
  }
  return cluster;
}
