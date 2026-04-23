// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — landmarks (PR 4 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Five ordered passes share one `used:Set<number>` for de-duplication.
// Each pass uses its own dedicated seeded RNG sub-stream:
//
//   1. Capitals        — `_landmarks_capitals`
//                        small/medium capital: ONE of {castle, palace} (coin flip)
//                        large+ capital: BOTH castle AND palace, anchored on the
//                        civic polygons nearest canvas center.
//
//   2. Temples         — `_landmarks_temples`
//                        one per `env.religionCount`, random pick from
//                        civic+market+mountain pool.
//
//   3. Monuments       — `_landmarks_monuments`
//                        one per `env.wonderCount`, hybrid pool (openSpaces
//                        civic+market FIRST for ~2× pick weight, then
//                        civicAndMarket block polygons, then mountain polygons).
//
//   4. Non-capital palaces — `_landmarks_palaces`
//                        Rolled for each non-capital city by size:
//                          medium 40%, large 60%, metropolis 80%, megalopolis 95%.
//                        Placement: scored by center-proximity plus a bonus if
//                        any Delaunay neighbor is a park/market/temple/wonder
//                        polygon. Minimum PALACE_MIN_HOPS BFS separation between
//                        any two palaces.
//
//   5. Additional castles — `_landmarks_castles`
//                        Cumulative sequential rolls per size tier:
//                          non-capital large       [0.50]
//                          non-capital metropolis  [0.80, 0.30]
//                          non-capital megalopolis [1.00, 0.60, 0.30]
//                          capital metropolis      [0.30]         (capital already has 1)
//                          capital megalopolis     [0.60, 0.30]   (capital already has 1)
//                          capital large / small / medium → no extra castles
//                        Placement: scored by proximity to the innermost available
//                        wall ring (middle → inner → outer) blended with separation
//                        from already-placed castles. Falls back to farthest-point
//                        sampling from placed landmarks when no wall is available.
//
// Every placement decision references one of these `CityPolygon` primitives:
//   • `polygon.id`     — output identity (`CityLandmarkV2.polygonId`)
//   • `polygon.site`   — distance-from-center sort / proximity scoring
//   • `polygon.neighbors` — 1-hop preference adjacency for palace scoring
//
// No tile lattice. No `Math.random`.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
} from './cityMapTypesV2';
import type { CitySize } from './cityMapTypesV2';

type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

// Which size tiers receive BOTH castle and palace on capital cities.
const CAPITAL_LARGE_SIZES: ReadonlySet<CitySize> = new Set<CitySize>([
  'large',
  'metropolis',
  'megalopolis',
]);

// Non-capital palace probability by size tier. Skipped when env.isCapital.
const PALACE_NON_CAPITAL_PROB: Partial<Record<CitySize, number>> = {
  medium:      0.40,
  large:       0.60,
  metropolis:  0.80,
  megalopolis: 0.95,
};

// Cumulative castle rolls for NON-CAPITAL cities (starting from 0 castles).
// Each entry is the probability of gaining the NEXT castle given all previous
// rolls succeeded. The loop stops on the first failed roll.
const CASTLE_ROLLS_NON_CAPITAL: Partial<Record<CitySize, number[]>> = {
  large:       [0.50],
  metropolis:  [0.80, 0.30],
  megalopolis: [1.00, 0.60, 0.30],
};

// Cumulative castle rolls for CAPITAL cities. The capital pass already places
// 1 castle, so these rolls add EXTRA castles beyond the capital's first.
// Large capitals already satisfy "1 castle" via the capital pass → no extra.
const CASTLE_ROLLS_CAPITAL: Partial<Record<CitySize, number[]>> = {
  metropolis:  [0.30],
  megalopolis: [0.60, 0.30],
};

// Minimum BFS-hop distance between any two palace polygons in the same city.
const PALACE_MIN_HOPS = 10;

// Scoring weight: wall proximity vs castle separation for inner-wall castle
// placement. 0.7 means closer to wall is the dominant signal.
const CASTLE_WALL_WEIGHT = 0.7;

// Spec: mountain polygons get 2× pick weight in temple + monument pools.
const MOUNTAIN_LANDMARK_WEIGHT = 2;

// Block roles that constitute the interior of the city (inside the wall
// footprint). Used to build the castle candidate pool beyond civic/market.
const INTERIOR_ROLES: ReadonlySet<string> = new Set([
  'civic', 'market', 'harbor', 'residential',
]);

// ── Geometry helpers ────────────────────────────────────────────────────────
// [Voronoi-polygon] Duplicated by convention (each V2 slice keeps its own
// geometry helpers — do not import from cityMapBuildings.ts / cityMapSprawl.ts).

function ptSegDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Minimum distance from a point to a polyline defined by consecutive segments.
function distToPolyline(site: [number, number], wall: [number, number][]): number {
  if (wall.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < wall.length - 1; i++) {
    const d = ptSegDist(
      site[0], site[1],
      wall[i][0], wall[i][1],
      wall[i + 1][0], wall[i + 1][1],
    );
    if (d < min) min = d;
  }
  return min;
}

// BFS: returns true if `candidate` is within `maxHops` polygon-graph hops of
// any polygon in `targets`. Used to enforce the palace minimum-distance rule.
function isWithinHops(
  candidate: number,
  targets: number[],
  polygons: CityPolygon[],
  maxHops: number,
): boolean {
  if (targets.length === 0) return false;
  const targetSet = new Set(targets);
  if (targetSet.has(candidate)) return true;
  const visited = new Set<number>([candidate]);
  let frontier = [candidate];
  for (let d = 0; d < maxHops; d++) {
    const next: number[] = [];
    for (const pid of frontier) {
      for (const nb of polygons[pid].neighbors) {
        if (visited.has(nb)) continue;
        if (targetSet.has(nb)) return true;
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return false;
}

/**
 * Generate the city's landmarks (castle / palace / temple / monument).
 *
 * Five ordered passes in `used`-shared de-duplication order:
 *   1. Capital castle/palace (unchanged from original implementation)
 *   2. Temples per `env.religionCount`
 *   3. Monuments per `env.wonderCount`
 *   4. Non-capital palace (probability by size, preference for amenities)
 *   5. Additional castles (probability by size, placement near inner wall)
 *
 * Returns `[]` on degenerate input (no blocks). Otherwise returns zero or more
 * `CityLandmarkV2` entries, each anchored to exactly one `CityPolygon.id`.
 */
export function generateLandmarks(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: OpenSpaceEntry[],
  canvasSize: number,
  mountainPolygonIds?: Set<number>,
  innerWallPath?: [number, number][],
  middleWallPath?: [number, number][],
  outerWallPath?: [number, number][],
): CityLandmarkV2[] {
  if (blocks.length === 0) return [];
  const mountains = mountainPolygonIds ?? new Set<number>();

  // ── Build candidate pools from block roles ───────────────────────────────
  // [Voronoi-polygon] Pools are disjoint: each polygon appears in exactly one
  // block (flood-fill guarantee in cityMapBlocks.ts), so no polygon can appear
  // in both civicPool and marketPool. allInteriorPool is a superset of
  // civicAndMarket used for the broader castle candidate pool.
  const civicPool: number[] = [];
  const marketPool: number[] = [];
  const allInteriorPool: number[] = [];
  for (const block of blocks) {
    if (block.role === 'civic') {
      for (const pid of block.polygonIds) civicPool.push(pid);
    } else if (block.role === 'market') {
      for (const pid of block.polygonIds) marketPool.push(pid);
    }
    if (INTERIOR_ROLES.has(block.role)) {
      for (const pid of block.polygonIds) allInteriorPool.push(pid);
    }
  }
  const civicAndMarket: number[] = [...civicPool, ...marketPool];

  // Mountain polygons repeated MOUNTAIN_LANDMARK_WEIGHT times for ~2× pick
  // weight in temple and monument pools.
  const mountainWeighted: number[] = [];
  if (mountains.size > 0) {
    const sorted = Array.from(mountains).sort((a, b) => a - b);
    for (const pid of sorted) {
      for (let i = 0; i < MOUNTAIN_LANDMARK_WEIGHT; i++) {
        mountainWeighted.push(pid);
      }
    }
  }

  const used = new Set<number>();
  const landmarks: CityLandmarkV2[] = [];

  // Track placed palace polygon IDs for the minimum-hop-distance check.
  const placedPalaceIds: number[] = [];

  // ── Pass 1: capital castle/palace (unchanged) ────────────────────────────
  // [Voronoi-polygon] Sort civic pool by squared distance from canvas center
  // so the capital anchors to the most-central civic polygon(s). Stable id
  // tie-break for determinism.
  if (env.isCapital && civicPool.length > 0) {
    const capitalRng = seededPRNG(`${seed}_city_${cityName}_landmarks_capitals`);
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const sortedCivic = civicPool.slice().sort((a, b) => {
      const [ax, ay] = polygons[a].site;
      const [bx, by] = polygons[b].site;
      const da = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
      const db = (bx - cx) * (bx - cx) + (by - cy) * (by - cy);
      if (da !== db) return da - db;
      return a - b;
    });

    const large = CAPITAL_LARGE_SIZES.has(env.size);
    const capitalTypes: ('castle' | 'palace')[] = large
      ? ['castle', 'palace']
      : [capitalRng() < 0.5 ? 'castle' : 'palace'];

    let sortedIdx = 0;
    for (const type of capitalTypes) {
      while (sortedIdx < sortedCivic.length && used.has(sortedCivic[sortedIdx])) {
        sortedIdx++;
      }
      if (sortedIdx >= sortedCivic.length) break;
      const pid = sortedCivic[sortedIdx++];
      landmarks.push({ polygonId: pid, type });
      used.add(pid);
      if (type === 'palace') placedPalaceIds.push(pid);
    }
  }

  // ── Pass 2: temples (unchanged) ──────────────────────────────────────────
  const templePool = [...civicAndMarket, ...mountainWeighted];
  if (env.religionCount > 0 && templePool.length > 0) {
    const templeRng = seededPRNG(`${seed}_city_${cityName}_landmarks_temples`);
    for (let i = 0; i < env.religionCount; i++) {
      const candidates = filterUnused(templePool, used);
      if (candidates.length === 0) break;
      const pid = candidates[Math.floor(templeRng() * candidates.length)];
      landmarks.push({ polygonId: pid, type: 'temple' });
      used.add(pid);
    }
  }

  // ── Pass 3: monuments (unchanged) ────────────────────────────────────────
  // [Voronoi-polygon] Hybrid pool: openSpaces civic+market polygons FIRST so
  // plaza-polygon ids appear twice (once from squarePool, once from
  // civicAndMarket), giving them ~2× random-pick weight per V1 parity.
  if (env.wonderCount > 0) {
    const squarePool: number[] = [];
    for (const entry of openSpaces) {
      if (entry.kind === 'square' || entry.kind === 'market') {
        for (const pid of entry.polygonIds) squarePool.push(pid);
      }
    }
    const fullPool: number[] = [...squarePool, ...civicAndMarket, ...mountainWeighted];
    if (fullPool.length > 0) {
      const monumentRng = seededPRNG(`${seed}_city_${cityName}_landmarks_monuments`);
      for (let i = 0; i < env.wonderCount; i++) {
        const candidates = filterUnused(fullPool, used);
        if (candidates.length === 0) break;
        const pid = candidates[Math.floor(monumentRng() * candidates.length)];
        landmarks.push({ polygonId: pid, type: 'monument' });
        used.add(pid);
      }
    }
  }

  // ── Pass 4: non-capital palaces ──────────────────────────────────────────
  // [Voronoi-polygon] Runs only for non-capital cities. One probabilistic roll
  // per city. Placement scores candidates on two axes:
  //   • Center proximity  — lower squared dist from canvas center = better
  //   • Amenity adjacency — any Delaunay neighbor in the amenity set
  //     (parks + market open-spaces + already-placed temples + monuments)
  //     earns a proximity bonus equal to 20% of the center distance, making
  //     the polygon "appear" 20% closer to center in the ranking.
  // Additionally, any candidate within PALACE_MIN_HOPS BFS hops of an
  // already-placed palace polygon is excluded (minimum-distance rule).
  if (!env.isCapital) {
    const palaceProb = PALACE_NON_CAPITAL_PROB[env.size] ?? 0;
    if (palaceProb > 0 && civicAndMarket.length > 0) {
      const palaceRng = seededPRNG(`${seed}_city_${cityName}_landmarks_palaces`);
      if (palaceRng() < palaceProb) {
        // Build amenity preference set from already-placed landmarks and open spaces.
        // Expand by 1 hop so "closeness" includes polygons one edge away from a plaza.
        const rawPref = new Set<number>();
        for (const entry of openSpaces) {
          if (entry.kind === 'park' || entry.kind === 'market') {
            for (const pid of entry.polygonIds) rawPref.add(pid);
          }
        }
        for (const lm of landmarks) {
          if (lm.type === 'temple' || lm.type === 'monument') {
            rawPref.add(lm.polygonId);
          }
        }
        // 1-hop expansion so adjacency reads as "close to" not just "touching".
        const preferenceSet = new Set<number>(rawPref);
        for (const pid of rawPref) {
          for (const nb of polygons[pid].neighbors) preferenceSet.add(nb);
        }

        const cx = canvasSize / 2;
        const cy = canvasSize / 2;

        type Candidate = { pid: number; adjDist: number };
        const candidates: Candidate[] = [];
        for (const pid of civicAndMarket) {
          if (used.has(pid)) continue;
          if (isWithinHops(pid, placedPalaceIds, polygons, PALACE_MIN_HOPS)) continue;
          const [px, py] = polygons[pid].site;
          const dist = Math.hypot(px - cx, py - cy);
          // Amenity-adjacent polygons get a 20% effective-distance bonus.
          const adjDist = preferenceSet.has(pid) ? dist * 0.80 : dist;
          candidates.push({ pid, adjDist });
        }

        // Pick the candidate with the lowest adjusted distance (closest to center
        // with a bias toward amenity-adjacent polygons). Stable pid tie-break.
        candidates.sort((a, b) => a.adjDist - b.adjDist || a.pid - b.pid);

        if (candidates.length > 0) {
          const { pid } = candidates[0];
          landmarks.push({ polygonId: pid, type: 'palace' });
          used.add(pid);
          placedPalaceIds.push(pid);
        }
      }
    }
  }

  // ── Pass 5: additional castles ────────────────────────────────────────────
  // [Voronoi-polygon] Determines extra castle count via sequential cumulative
  // rolls, then places each castle on the best available interior polygon.
  //
  // Placement scoring (when a reference wall path is available):
  //   wallScore  = 1 − min(1, distToWall / (canvasSize × 0.5))
  //   sepScore   = min(1, minDistFromPlacedCastles / canvasDiag)
  //   totalScore = CASTLE_WALL_WEIGHT × wallScore + (1 − CASTLE_WALL_WEIGHT) × sepScore
  //
  // Reference wall: middleWallPath → innerWallPath → outerWallPath → none.
  // When no wall is available, pure farthest-point sampling from placed castle
  // sites (seeded with canvas center so the first castle separates from center).
  //
  // Capital cities already have 1 castle from pass 1; CASTLE_ROLLS_CAPITAL
  // provides the extra rolls beyond that count. Non-capital cities start from 0.
  const castleRolls = env.isCapital
    ? (CASTLE_ROLLS_CAPITAL[env.size] ?? [])
    : (CASTLE_ROLLS_NON_CAPITAL[env.size] ?? []);

  if (castleRolls.length > 0 && allInteriorPool.length > 0) {
    const castleRng = seededPRNG(`${seed}_city_${cityName}_landmarks_castles`);

    // Sequential cumulative rolls — stop at first failure.
    let castleCount = 0;
    for (const prob of castleRolls) {
      if (castleRng() < prob) castleCount++;
      else break;
    }

    if (castleCount > 0) {
      // Pick the innermost available wall ring as the reference.
      const refWall: [number, number][] =
        (middleWallPath && middleWallPath.length >= 2) ? middleWallPath
        : (innerWallPath && innerWallPath.length >= 2) ? innerWallPath
        : (outerWallPath && outerWallPath.length >= 2) ? outerWallPath
        : [];
      const hasWall = refWall.length >= 2;
      const canvasDiag = Math.hypot(canvasSize, canvasSize);

      // Placed castle sites for separation scoring. Seed with canvas center
      // so the first castle is pushed away from the center (no-wall case) or
      // the wall-scoring already handles positioning (wall case).
      const placedCastleSites: [number, number][] = [];
      if (!hasWall) {
        placedCastleSites.push([canvasSize / 2, canvasSize / 2]);
      }

      for (let c = 0; c < castleCount; c++) {
        const available = filterUnused(allInteriorPool, used);
        if (available.length === 0) break;

        let chosenPid = available[0];

        if (hasWall) {
          let bestScore = -Infinity;
          for (const pid of available) {
            const site = polygons[pid].site;
            const wallDist = distToPolyline(site, refWall);
            // wallScore is high when close to wall, 0 when ≥ half canvas away.
            const wallScore = wallDist === Infinity
              ? 0
              : Math.max(0, 1 - wallDist / (canvasSize * 0.5));

            // sepScore is high when far from already-placed castles.
            let minSep: number;
            if (placedCastleSites.length === 0) {
              minSep = canvasDiag * 0.5; // neutral when no reference
            } else {
              minSep = canvasDiag;
              for (const cs of placedCastleSites) {
                const d = Math.hypot(site[0] - cs[0], site[1] - cs[1]);
                if (d < minSep) minSep = d;
              }
            }
            const sepScore = Math.min(1, minSep / canvasDiag);

            const score = CASTLE_WALL_WEIGHT * wallScore + (1 - CASTLE_WALL_WEIGHT) * sepScore;
            if (score > bestScore || (score === bestScore && pid < chosenPid)) {
              bestScore = score;
              chosenPid = pid;
            }
          }
        } else {
          // No wall: farthest-point sampling from placed castle sites.
          let bestDist = -1;
          for (const pid of available) {
            const [px, py] = polygons[pid].site;
            let minSep = Infinity;
            for (const [cx2, cy2] of placedCastleSites) {
              const d = Math.hypot(px - cx2, py - cy2);
              if (d < minSep) minSep = d;
            }
            if (minSep > bestDist || (minSep === bestDist && pid < chosenPid)) {
              bestDist = minSep;
              chosenPid = pid;
            }
          }
        }

        landmarks.push({ polygonId: chosenPid, type: 'castle' });
        used.add(chosenPid);
        placedCastleSites.push(polygons[chosenPid].site);
      }
    }
  }

  return landmarks;
}

// [Voronoi-polygon] Build a fresh array of polygon IDs from `source` that
// are NOT in `used`. Inlined helper so the passes share one filter shape.
function filterUnused(source: number[], used: Set<number>): number[] {
  const out: number[] = [];
  for (const pid of source) {
    if (!used.has(pid)) out.push(pid);
  }
  return out;
}
