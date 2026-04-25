// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Phase 3 of specs/City_districts_redux.md
// Named-landmark placer (the `named` alignment group).
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Phase 3 implements the seven user-named landmark kinds:
//   civic_square, wonder, castle, palace, temple, market, park.
//
// Every placement decision references one of these `CityPolygon` primitives:
//   • polygon.id        — output identity (`LandmarkV2.polygonId`)
//   • polygon.site      — distance-from-center / wall / gate scoring
//   • polygon.neighbors — BFS expansion (parks), 1-hop amenity adjacency (palaces),
//                          minimum-hop separation (palaces, wonders)
//
// All input restricted to `ctx.candidatePool` (interior ∪ 5-hop boundary band,
// water + mountain pre-excluded by `cityMapCandidatePool.ts`). NO dependency
// on block roles — Phase 5's classifier is what grows districts OUT of these
// landmarks, not the other way around.
//
// Seven ordered passes share `used: Set<number>`. Each pass uses its own
// dedicated seeded RNG sub-stream so adding/reordering passes in later phases
// won't shift existing seeds:
//
//   1. Civic square    — deterministic, no RNG
//   2. Wonders         — `_unified_named_wonders`
//   3. Castles         — `_unified_named_castles`
//   4. Palaces         — `_unified_named_palaces`
//   5. Temples         — `_unified_named_temples`
//   6. Markets         — `_unified_named_markets`  (tie-breaks + spread fallback)
//   7. Parks           — `_unified_named_parks`    (seed pick + cluster size)
//
// Naming uses one shared sub-stream `_unified_named_names` so reordering
// placement passes does not perturb the name sequence on a per-city basis.
//
// No Math.random anywhere. Returns `LandmarkV2[]`; never mutates inputs.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityPolygon,
  CitySize,
  LandmarkKind,
  LandmarkV2,
} from './cityMapTypesV2';
import type { PlacerContext } from './cityMapLandmarksUnified';

// ─── Per-tier counts (mirror cityMapOpenSpaces.ts:66-88) ────────────────────

const MARKET_COUNT: Record<CitySize, number> = {
  small: 2,
  medium: 4,
  large: 5,
  metropolis: 8,
  megalopolis: 16,
};
const PARK_COUNT: Record<CitySize, number> = {
  small: 1,
  medium: 3,
  large: 5,
  metropolis: 7,
  megalopolis: 10,
};
const PARK_MAX_POLYGONS: Record<CitySize, number> = {
  small: 1,
  medium: 2,
  large: 2,
  metropolis: 3,
  megalopolis: 3,
};

// ─── Castle / palace tables (mirror cityMapLandmarks.ts:72-94) ──────────────

const CAPITAL_LARGE_SIZES: ReadonlySet<CitySize> = new Set<CitySize>([
  'large',
  'metropolis',
  'megalopolis',
]);

const PALACE_NON_CAPITAL_PROB: Partial<Record<CitySize, number>> = {
  medium:      0.40,
  large:       0.60,
  metropolis:  0.80,
  megalopolis: 0.95,
};

// Cumulative castle rolls for NON-CAPITAL cities. Stops at first failure.
const CASTLE_ROLLS_NON_CAPITAL: Partial<Record<CitySize, number[]>> = {
  large:       [0.50],
  metropolis:  [0.80, 0.30],
  megalopolis: [1.00, 0.60, 0.30],
};

// Extra cumulative castle rolls for CAPITAL cities (capital pass already
// places 1; these add beyond it).
const CASTLE_ROLLS_CAPITAL: Partial<Record<CitySize, number[]>> = {
  metropolis:  [0.30],
  megalopolis: [0.60, 0.30],
};

const PALACE_MIN_HOPS = 10;
const WONDER_MIN_HOPS = 2;
const CASTLE_WALL_WEIGHT = 0.7;
const PALACE_AMENITY_BONUS = 0.80;

// ─── Naming pools (PREFIX from cityMapBlocks.ts:633-639, V1 port) ───────────

const NAME_PREFIXES = [
  'ELM', 'OAK', 'ASH', 'ROSE', 'BRIAR', 'THORN',
  'BLUE', 'RED', 'GOLD', 'GREEN', 'WHITE', 'BLACK', 'SILVER', 'COPPER', 'IRON',
  'OLD', 'NEW', 'HIGH', 'LOW', 'FAR',
  'STONE', 'BRICK', 'GLASS', 'BREAD', 'SALT', 'WINE', 'CORN',
  'KING', 'QUEEN', 'BISHOP', 'ABBEY', 'GUILD',
];

const SUFFIXES_CIVIC_SQUARE = ['SQUARE', 'PLAZA', 'FORUM', 'CROSS'];
const SUFFIXES_CASTLE = ['KEEP', 'FORTRESS', 'BASTION', 'STRONGHOLD', 'CITADEL'];
const SUFFIXES_PALACE = ['PALACE', 'MANOR', 'COURT', 'HALL'];
const SUFFIXES_TEMPLE = ['TEMPLE', 'SHRINE', 'SANCTUM', 'CHAPEL'];
const SUFFIXES_MARKET = ['MARKET', 'BAZAAR', 'EXCHANGE', 'ROW'];
const SUFFIXES_PARK = ['PARK', 'GARDENS', 'GROVE', 'MEADOW', 'COMMONS'];

const NAME_MAX_ATTEMPTS = 12;
const NAME_SPACE_JOINER_PROB = 0.35;

function suffixesFor(kind: LandmarkKind): string[] {
  switch (kind) {
    case 'civic_square': return SUFFIXES_CIVIC_SQUARE;
    case 'castle':       return SUFFIXES_CASTLE;
    case 'palace':       return SUFFIXES_PALACE;
    case 'temple':       return SUFFIXES_TEMPLE;
    case 'market':       return SUFFIXES_MARKET;
    case 'park':         return SUFFIXES_PARK;
    default:             return SUFFIXES_CIVIC_SQUARE;
  }
}

function pickName(
  kind: LandmarkKind,
  index: number,
  rng: () => number,
  used: Set<string>,
): string {
  const suffixes = suffixesFor(kind);
  for (let attempt = 0; attempt < NAME_MAX_ATTEMPTS; attempt++) {
    const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const suffix = suffixes[Math.floor(rng() * suffixes.length)];
    const joiner = rng() < NAME_SPACE_JOINER_PROB ? ' ' : '';
    const name = prefix + joiner + suffix;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${kind.toUpperCase()} ${index + 1}`;
  used.add(fallback);
  return fallback;
}

// ─── Geometry helpers ───────────────────────────────────────────────────────
// [Voronoi-polygon] Duplicated by V2 convention — each slice keeps its own
// helpers to avoid float-tolerance drift across modules (see CLAUDE.md).

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

// Min distance from `site` to ANY edge across ALL wall segments. Returns
// Infinity for empty input. Iterating every disjoint section handles coastal
// gaps and mountain-broken walls cleanly.
function distToWallSegments(
  site: [number, number],
  segments: [number, number][][],
): number {
  if (segments.length === 0) return Infinity;
  let min = Infinity;
  for (const seg of segments) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i++) {
      const d = ptSegDist(
        site[0], site[1],
        seg[i][0], seg[i][1],
        seg[i + 1][0], seg[i + 1][1],
      );
      if (d < min) min = d;
    }
  }
  return min;
}

// BFS over `polygon.neighbors`: true iff `candidate` is within `maxHops`
// of any polygon in `targets`.
function isWithinHops(
  candidate: number,
  targets: Iterable<number>,
  polygons: CityPolygon[],
  maxHops: number,
): boolean {
  const targetSet = new Set<number>(targets);
  if (targetSet.size === 0) return false;
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

// ─── Pool helpers ───────────────────────────────────────────────────────────

function eligible(
  candidatePool: Set<number>,
  used: Set<number>,
): number[] {
  const out: number[] = [];
  for (const pid of candidatePool) {
    if (!used.has(pid)) out.push(pid);
  }
  out.sort((a, b) => a - b); // stable iteration order across runs
  return out;
}

function nearestPolygonBySite(
  pool: number[],
  polygons: CityPolygon[],
  target: [number, number],
): number {
  let bestId = -1;
  let bestDist = Infinity;
  for (const pid of pool) {
    const [sx, sy] = polygons[pid].site;
    const dx = sx - target[0];
    const dy = sy - target[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist || (d === bestDist && pid < bestId)) {
      bestDist = d;
      bestId = pid;
    }
  }
  return bestId;
}

// Lloyd-style spread pick: returns the polygon whose site maximises the
// minimum distance to any site in `anchors`. RNG only used to break exact
// ties (almost never fires; keeps determinism robust to FP edge cases).
function farthestPolygonBySite(
  pool: number[],
  polygons: CityPolygon[],
  anchors: [number, number][],
  rng: () => number,
): number {
  if (pool.length === 0) return -1;
  if (anchors.length === 0) {
    return pool[Math.floor(rng() * pool.length)];
  }
  let bestId = -1;
  let bestMinDist = -Infinity;
  for (const pid of pool) {
    const [sx, sy] = polygons[pid].site;
    let minD = Infinity;
    for (const [ax, ay] of anchors) {
      const d = (sx - ax) * (sx - ax) + (sy - ay) * (sy - ay);
      if (d < minD) minD = d;
    }
    if (minD > bestMinDist || (minD === bestMinDist && pid < bestId)) {
      bestMinDist = minD;
      bestId = pid;
    }
  }
  return bestId;
}

// Park seed: prefer a polygon whose Delaunay neighbors are all unused;
// fall back to "any unused candidate" so megalopolis cities don't run dry.
function pickParkSeed(
  candidatePool: Set<number>,
  used: Set<number>,
  polygons: CityPolygon[],
  rng: () => number,
): number {
  const usedNeighborSet = new Set<number>();
  for (const usedId of used) {
    for (const nb of polygons[usedId].neighbors) usedNeighborSet.add(nb);
  }
  const strict: number[] = [];
  const fallback: number[] = [];
  for (const pid of candidatePool) {
    if (used.has(pid)) continue;
    fallback.push(pid);
    if (!usedNeighborSet.has(pid)) strict.push(pid);
  }
  const pool = strict.length > 0 ? strict : fallback;
  if (pool.length === 0) return -1;
  pool.sort((a, b) => a - b);
  return pool[Math.floor(rng() * pool.length)];
}

// BFS over polygon.neighbors from seedId, only absorbing eligible
// (in-pool, not-used) polygons. Stops at targetSize.
function bfsParkCluster(
  candidatePool: Set<number>,
  used: Set<number>,
  polygons: CityPolygon[],
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
      if (!candidatePool.has(nb)) continue;
      if (used.has(nb)) continue;
      cluster.push(nb);
      queue.push(nb);
    }
  }
  return cluster;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 3 named-landmark placer. Runs seven ordered passes against
 * `ctx.candidatePool` to produce wonder/palace/castle/civic_square/temple/
 * market/park `LandmarkV2` records. Mutates `used` as it claims polygons so
 * later alignment groups (Phase 4) don't double-claim. Returns `[]` on empty
 * input.
 */
export function placeNamedLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const canvasCenter: [number, number] = [500, 500]; // canvas is 1000×1000 (cityMapTypesV2:189)
  const canvasDiag = Math.hypot(1000, 1000);
  const out: LandmarkV2[] = [];
  const usedNames = new Set<string>();
  const namesRng = seededPRNG(`${seed}_city_${cityName}_unified_named_names`);

  // [Voronoi-polygon] Interior-only subset of the candidate pool. Parks,
  // markets, temples, castles, and palaces must always land inside the city
  // footprint (`wall.interiorPolygonIds`) — the 5-hop boundary band is
  // reserved for civic_square / wonder (which don't restrict here, the
  // center-bias keeps them interior-leaning) and the Phase 4 quarter placers.
  // Falls back to the full candidate pool if the footprint is degenerate so
  // we don't silently produce zero named landmarks.
  const interiorPool = new Set<number>();
  for (const pid of candidatePool) {
    if (wall.interiorPolygonIds.has(pid)) interiorPool.add(pid);
  }
  const insidePool = interiorPool.size > 0 ? interiorPool : candidatePool;

  // Tracks polygons placed in this group, by kind, for amenity-adjacency
  // bonuses (palace prefers neighbors of civic_square/wonder/castle/palace).
  const placedByKind: Partial<Record<LandmarkKind, number[]>> = {};
  const trackPlaced = (kind: LandmarkKind, pid: number) => {
    (placedByKind[kind] ??= []).push(pid);
  };

  // ── Pass 1: civic square (deterministic) ─────────────────────────────────
  {
    const pool = eligible(candidatePool, used);
    if (pool.length > 0) {
      const pid = nearestPolygonBySite(pool, polygons, canvasCenter);
      if (pid !== -1) {
        out.push({
          polygonId: pid,
          kind: 'civic_square',
          name: pickName('civic_square', 0, namesRng, usedNames),
        });
        used.add(pid);
        trackPlaced('civic_square', pid);
      }
    }
  }

  // ── Pass 2: wonders (one per env.wonderNames) ────────────────────────────
  // Score = squared distance from canvas center (smaller better). Reject
  // anything within WONDER_MIN_HOPS of an already-placed wonder/castle/palace
  // so wonders don't pile up on a single block. Names come from the world-
  // sim verbatim — no procedural naming needed for wonders.
  if (env.wonderNames.length > 0) {
    const wonderRng = seededPRNG(`${seed}_city_${cityName}_unified_named_wonders`);
    for (let i = 0; i < env.wonderNames.length; i++) {
      const pool = eligible(candidatePool, used);
      if (pool.length === 0) break;
      const placedPrestige = [
        ...(placedByKind['wonder'] ?? []),
        ...(placedByKind['castle'] ?? []),
        ...(placedByKind['palace'] ?? []),
      ];
      type Cand = { pid: number; score: number };
      const cands: Cand[] = [];
      for (const pid of pool) {
        if (isWithinHops(pid, placedPrestige, polygons, WONDER_MIN_HOPS)) continue;
        const [sx, sy] = polygons[pid].site;
        const dx = sx - canvasCenter[0];
        const dy = sy - canvasCenter[1];
        cands.push({ pid, score: dx * dx + dy * dy });
      }
      // Fall back to ignoring the separation rule when it eliminates everything.
      const sourcePool: Cand[] = cands.length > 0
        ? cands
        : pool.map(pid => {
            const [sx, sy] = polygons[pid].site;
            const dx = sx - canvasCenter[0];
            const dy = sy - canvasCenter[1];
            return { pid, score: dx * dx + dy * dy };
          });
      sourcePool.sort((a, b) => a.score - b.score || a.pid - b.pid);
      // Among polygons whose center-distance ties exactly with the leader
      // (rare but possible at integer-pixel sites), pick one via RNG so
      // visually-equivalent positions don't always collapse to the lowest id.
      const leaderScore = sourcePool[0].score;
      const tied: number[] = [];
      for (const c of sourcePool) {
        if (c.score === leaderScore) tied.push(c.pid);
        else break;
      }
      const chosen = tied.length === 1
        ? tied[0]
        : tied[Math.floor(wonderRng() * tied.length)];
      out.push({
        polygonId: chosen,
        kind: 'wonder',
        name: env.wonderNames[i],
      });
      used.add(chosen);
      trackPlaced('wonder', chosen);
    }
  }

  // ── Pass 3: castles ──────────────────────────────────────────────────────
  // Capital cities always get at least 1 castle. Capital large+ + non-capital
  // size tiers add cumulative rolls. Score = wall-proximity (weight 0.7) +
  // castle-separation (weight 0.3). Falls back to farthest-point sampling
  // when no walls exist.
  {
    const castleRng = seededPRNG(`${seed}_city_${cityName}_unified_named_castles`);

    // Determine castle count.
    let castleCount = 0;
    if (env.isCapital) {
      castleCount = 1;
      const extra = CASTLE_ROLLS_CAPITAL[env.size] ?? [];
      for (const prob of extra) {
        if (castleRng() < prob) castleCount++;
        else break;
      }
    } else {
      const rolls = CASTLE_ROLLS_NON_CAPITAL[env.size] ?? [];
      for (const prob of rolls) {
        if (castleRng() < prob) castleCount++;
        else break;
      }
    }

    const segments = wall.wallSegments;
    const hasWall = segments.length > 0 && segments.some(s => s.length >= 2);
    const placedCastleSites: [number, number][] = [];

    for (let c = 0; c < castleCount; c++) {
      const pool = eligible(insidePool, used);
      if (pool.length === 0) break;

      let chosen = -1;
      if (hasWall) {
        let bestScore = -Infinity;
        for (const pid of pool) {
          const site = polygons[pid].site;
          const wallDist = distToWallSegments(site, segments);
          const wallScore = wallDist === Infinity
            ? 0
            : Math.max(0, 1 - wallDist / 500); // 500 = canvasSize/2
          let minSep: number;
          if (placedCastleSites.length === 0) {
            minSep = canvasDiag * 0.5;
          } else {
            minSep = canvasDiag;
            for (const [cx, cy] of placedCastleSites) {
              const d = Math.hypot(site[0] - cx, site[1] - cy);
              if (d < minSep) minSep = d;
            }
          }
          const sepScore = Math.min(1, minSep / canvasDiag);
          const score = CASTLE_WALL_WEIGHT * wallScore + (1 - CASTLE_WALL_WEIGHT) * sepScore;
          if (score > bestScore || (score === bestScore && pid < chosen)) {
            bestScore = score;
            chosen = pid;
          }
        }
      } else {
        // No wall: farthest-point sampling from canvas center + placed castles.
        const anchors: [number, number][] = [canvasCenter, ...placedCastleSites];
        chosen = farthestPolygonBySite(pool, polygons, anchors, castleRng);
      }

      if (chosen === -1) break;
      out.push({
        polygonId: chosen,
        kind: 'castle',
        name: pickName('castle', (placedByKind['castle']?.length ?? 0), namesRng, usedNames),
      });
      used.add(chosen);
      trackPlaced('castle', chosen);
      placedCastleSites.push(polygons[chosen].site);
    }
  }

  // ── Pass 4: palaces ──────────────────────────────────────────────────────
  // Capital large+ → always 1. Capital small/medium → 50% coin flip (bonus).
  // Non-capital → probability table by size. Multiple palaces enforce
  // PALACE_MIN_HOPS BFS separation. Score: center-proximity, with a 20%
  // effective-distance bonus when any Delaunay neighbor is in the amenity
  // set (civic_square / wonder / castle / palace).
  {
    const palaceRng = seededPRNG(`${seed}_city_${cityName}_unified_named_palaces`);

    let palaceCount = 0;
    if (env.isCapital) {
      if (CAPITAL_LARGE_SIZES.has(env.size)) {
        palaceCount = 1;
      } else {
        // small/medium capital: 50/50 bonus palace
        if (palaceRng() < 0.5) palaceCount = 1;
      }
    } else {
      const prob = PALACE_NON_CAPITAL_PROB[env.size] ?? 0;
      if (prob > 0 && palaceRng() < prob) palaceCount = 1;
    }

    const placedPalaceIds: number[] = [];
    for (let p = 0; p < palaceCount; p++) {
      const pool = eligible(insidePool, used);
      if (pool.length === 0) break;

      // Build amenity preference set: civic_square + wonder + castle + palace,
      // expanded by 1 hop so "close to" reads as a real adjacency.
      const rawPref = new Set<number>([
        ...(placedByKind['civic_square'] ?? []),
        ...(placedByKind['wonder'] ?? []),
        ...(placedByKind['castle'] ?? []),
        ...(placedByKind['palace'] ?? []),
      ]);
      const preferenceSet = new Set<number>(rawPref);
      for (const pid of rawPref) {
        for (const nb of polygons[pid].neighbors) preferenceSet.add(nb);
      }

      type Cand = { pid: number; adjDist: number };
      const cands: Cand[] = [];
      for (const pid of pool) {
        if (isWithinHops(pid, placedPalaceIds, polygons, PALACE_MIN_HOPS)) continue;
        const [sx, sy] = polygons[pid].site;
        const dist = Math.hypot(sx - canvasCenter[0], sy - canvasCenter[1]);
        const adjDist = preferenceSet.has(pid) ? dist * PALACE_AMENITY_BONUS : dist;
        cands.push({ pid, adjDist });
      }
      if (cands.length === 0) break;
      cands.sort((a, b) => a.adjDist - b.adjDist || a.pid - b.pid);

      const chosen = cands[0].pid;
      out.push({
        polygonId: chosen,
        kind: 'palace',
        name: pickName('palace', (placedByKind['palace']?.length ?? 0), namesRng, usedNames),
      });
      used.add(chosen);
      trackPlaced('palace', chosen);
      placedPalaceIds.push(chosen);
    }
  }

  // ── Pass 5: temples (one per env.religionCount, scattered) ───────────────
  if (env.religionCount > 0) {
    const templeRng = seededPRNG(`${seed}_city_${cityName}_unified_named_temples`);
    for (let i = 0; i < env.religionCount; i++) {
      const pool = eligible(insidePool, used);
      if (pool.length === 0) break;
      const pid = pool[Math.floor(templeRng() * pool.length)];
      out.push({
        polygonId: pid,
        kind: 'temple',
        name: pickName('temple', i, namesRng, usedNames),
      });
      used.add(pid);
      trackPlaced('temple', pid);
    }
  }

  // ── Pass 6: markets (gate-anchored + Lloyd spread) ───────────────────────
  // Per-tier count. For each gate, pick the eligible polygon nearest the gate
  // edge midpoint. Once gate count is exhausted, spread-fill picking the
  // polygon farthest from already-placed market sites.
  {
    const marketRng = seededPRNG(`${seed}_city_${cityName}_unified_named_markets`);
    const target = MARKET_COUNT[env.size];
    const placedMarketSites: [number, number][] = [];
    let placed = 0;

    // Gate-anchored picks first.
    for (const gate of wall.gates) {
      if (placed >= target) break;
      const pool = eligible(insidePool, used);
      if (pool.length === 0) break;
      const [ga, gb] = gate.edge;
      const mid: [number, number] = [(ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2];
      const pid = nearestPolygonBySite(pool, polygons, mid);
      if (pid === -1) continue;
      out.push({
        polygonId: pid,
        kind: 'market',
        name: pickName('market', placed, namesRng, usedNames),
      });
      used.add(pid);
      trackPlaced('market', pid);
      placedMarketSites.push(polygons[pid].site);
      placed++;
    }

    // Spread fallback for the remainder.
    while (placed < target) {
      const pool = eligible(insidePool, used);
      if (pool.length === 0) break;
      const pid = farthestPolygonBySite(pool, polygons, placedMarketSites, marketRng);
      if (pid === -1) break;
      out.push({
        polygonId: pid,
        kind: 'market',
        name: pickName('market', placed, namesRng, usedNames),
      });
      used.add(pid);
      trackPlaced('market', pid);
      placedMarketSites.push(polygons[pid].site);
      placed++;
    }
  }

  // ── Pass 7: parks (BFS clusters) ─────────────────────────────────────────
  {
    const parkRng = seededPRNG(`${seed}_city_${cityName}_unified_named_parks`);
    const parkTarget = PARK_COUNT[env.size];
    const parkMaxSize = PARK_MAX_POLYGONS[env.size];

    for (let i = 0; i < parkTarget; i++) {
      const seedId = pickParkSeed(insidePool, used, polygons, parkRng);
      if (seedId === -1) break;
      const targetSize = 1 + Math.floor(parkRng() * parkMaxSize);
      const cluster = bfsParkCluster(insidePool, used, polygons, seedId, targetSize);
      out.push({
        polygonId: seedId,
        kind: 'park',
        name: pickName('park', i, namesRng, usedNames),
        polygonIds: cluster,
      });
      for (const pid of cluster) used.add(pid);
      trackPlaced('park', seedId);
    }
  }

  return out;
}
