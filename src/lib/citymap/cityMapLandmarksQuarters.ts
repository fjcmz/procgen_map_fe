// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Phase 4 of specs/City_districts_redux.md
// Quarter-landmark placers (industrial / military / faith_aux / entertainment
// / trade / excluded alignment groups).
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Phase 4 fills the five remaining alignment-group stubs in
// `cityMapLandmarksUnified.ts`. Fit conditions (eligibility gates, candidate
// scoring, per-tier counts) are ported from the existing block-layer quarter
// files but rewritten against the polygon candidate pool — Phase 4 placers
// must NOT depend on block roles, since Phase 5's classifier grows districts
// OUT of these landmarks (read order: candidates → landmarks → districts).
//
// Pool model:
//   • Interior subset = candidatePool ∩ wall.interiorPolygonIds, with isEdge
//     polygons defensively skipped (matches legacy residential pool semantics).
//   • Exterior subset = candidatePool \ wall.interiorPolygonIds (the 5-hop
//     boundary band). Exterior placers (necropolis / plague_ward / festival /
//     gallows) keep isEdge polygons since they live on the fringe.
//
// Six exported placers, one per alignment group. Each:
//   • Reads from `ctx.candidatePool`, never from blocks.
//   • Mutates the shared `used: Set<number>` so later groups don't double-claim.
//   • Uses its own dedicated RNG sub-stream
//     (`${seed}_city_${cityName}_unified_<group>`) so adding / reordering
//     groups in later phases won't shift existing seeds.
//   • Reads `placedNamed` (the Phase 3 output) for templeBoost / marketBoost /
//     monumentBoost — Phase 3 named markets/temples/wonders replace the
//     legacy `openSpaces` / monument-landmark queries.
//   • Leaves `LandmarkV2.name` undefined — Phase 6 (`pickProceduralName` in
//     the blocks rebuild) owns naming for these kinds.
//
// Kind-name translation vs the legacy quarter files:
//   archive_quarter   → archive          (faith_aux)
//   watchmen_precinct → watchmen         (military)
//   theater_district  → theater          (entertainment)
//   bathhouse_quarter → bathhouse        (entertainment)
//   pleasure_quarter  → pleasure         (entertainment)
//   festival_grounds  → festival         (entertainment)
//   warehouse_row     → warehouse        (trade)
//   gallows_hill      → gallows          (excluded)
//   ghetto            → ghetto_marker    (excluded)
//   (industrial kinds keep their names: forge / tannery / textile / potters / mill)
//
// No Math.random anywhere. Returns `LandmarkV2[]`; never mutates `polygons`,
// `wall`, `candidatePool`, or `placedNamed`.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityPolygon,
  CitySize,
  LandmarkKind,
  LandmarkV2,
} from './cityMapTypesV2';
import type { PlacerContext } from './cityMapLandmarksUnified';
import { canonicalEdgeKey } from './cityMapEdgeGraph';

// ─── Canvas geometry (ports CANVAS_CX/CY/SIZE from each legacy quarter file) ─

const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ─── Per-tier count tables (ports verbatim from legacy quarter files) ──────

// `cityMapBlocks.ts:713-719` (CRAFT_COUNT_RANGE)
const INDUSTRIAL_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [1, 3],
  medium:      [2, 5],
  large:       [3, 7],
  metropolis:  [5, 10],
  megalopolis: [8, 16],
};

// `cityMapMilitaryQuarters.ts:62-68` (MIL_COUNT_RANGE)
const MILITARY_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 3],
  metropolis:  [2, 4],
  megalopolis: [3, 6],
};

// `cityMapSFHQuarters.ts:47-53` (SFH_COUNT_RANGE)
const FAITH_AUX_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 3],
  metropolis:  [2, 5],
  megalopolis: [4, 8],
};

// `cityMapEntertainmentQuarters.ts:78-84` (ENTERTAINMENT_COUNT_RANGE)
const ENTERTAINMENT_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 0],
  medium:      [0, 1],
  large:       [1, 2],
  metropolis:  [1, 3],
  megalopolis: [2, 5],
};

// `cityMapTradeFinanceQuarters.ts:70-76` (TF_COUNT_RANGE)
const TRADE_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 2],
  metropolis:  [2, 5],
  megalopolis: [4, 7],
};

// `cityMapExcludedQuarters.ts:82-88` (EXCLUDED_COUNT_RANGE)
const EXCLUDED_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 0],
  medium:      [0, 1],
  large:       [1, 2],
  metropolis:  [1, 3],
  megalopolis: [2, 5],
};

// ─── Shared helpers ────────────────────────────────────────────────────────
// [Voronoi-polygon] Duplicated by V2 convention — each slice keeps its own
// helpers to avoid float-tolerance drift across modules (see CLAUDE.md).

/**
 * Split the candidate pool into an interior list (inside the city footprint,
 * isEdge polygons defensively skipped) and an exterior list (the 5-hop
 * boundary band; isEdge polygons retained for fringe placement). Both are
 * polygon-id sorted for deterministic iteration.
 */
function splitPoolByInteriority(
  candidatePool: Set<number>,
  interiorPolygonIds: Set<number>,
  polygons: CityPolygon[],
): { interior: number[]; exterior: number[] } {
  const interior: number[] = [];
  const exterior: number[] = [];
  for (const pid of candidatePool) {
    const poly = polygons[pid];
    if (!poly) continue;
    if (interiorPolygonIds.has(pid)) {
      if (!poly.isEdge) interior.push(pid);
    } else {
      exterior.push(pid);
    }
  }
  interior.sort((a, b) => a - b);
  exterior.sort((a, b) => a - b);
  return { interior, exterior };
}

function centerScore(site: [number, number]): number {
  const dx = site[0] - CANVAS_CX;
  const dy = site[1] - CANVAS_CY;
  return 1 / (1 + (dx * dx + dy * dy) / 10_000);
}

function centerDist(site: [number, number]): number {
  return Math.hypot(site[0] - CANVAS_CX, site[1] - CANVAS_CY);
}

// Boost from a list of anchor sites — `1 / (1 + minDist²/10_000)`. Returns 0
// when anchors is empty (no boost contribution). Mirrors the templeBoost /
// marketBoost / monumentBoost shape across every legacy quarter file.
function siteBoost(site: [number, number], anchors: [number, number][]): number {
  if (anchors.length === 0) return 0;
  let minDist2 = Infinity;
  for (const [ax, ay] of anchors) {
    const d2 = (site[0] - ax) ** 2 + (site[1] - ay) ** 2;
    if (d2 < minDist2) minDist2 = d2;
  }
  return 1 / (1 + minDist2 / 10_000);
}

// Gate-midpoint boost — same shape, populated from `wall.gates` edge midpoints.
function computeGateMidpoints(
  gates: PlacerContext['wall']['gates'],
): [number, number][] {
  return gates.map(g => [
    (g.edge[0][0] + g.edge[1][0]) / 2,
    (g.edge[0][1] + g.edge[1][1]) / 2,
  ]);
}

// Water-edge proximity. Mirrors `waterBoost` from every legacy quarter file:
// only contributes when `env.waterSide` is set; rivers without a derivable
// side return 0 (no bias).
function waterBoost(
  site: [number, number],
  env: PlacerContext['env'],
): number {
  if (!env.isCoastal && !env.hasRiver) return 0;
  const [sx, sy] = site;
  let dist: number;
  switch (env.waterSide) {
    case 'north': dist = sy; break;
    case 'south': dist = CANVAS_SIZE - sy; break;
    case 'east':  dist = CANVAS_SIZE - sx; break;
    case 'west':  dist = sx; break;
    default:      return 0;
  }
  return 1 / (1 + dist / 50);
}

// Collect anchor sites for each named-landmark kind (`temple`, `market`,
// `wonder`). Phase 3 markets/temples are single-polygon entries; wonders are
// also single-polygon. Equivalent to the legacy `templeBoost` / market
// `openSpaces` / monument-landmark site collections.
function collectKindSites(
  placedNamed: LandmarkV2[],
  polygons: CityPolygon[],
  kind: LandmarkKind,
): [number, number][] {
  const out: [number, number][] = [];
  for (const lm of placedNamed) {
    if (lm.kind !== kind) continue;
    const poly = polygons[lm.polygonId];
    if (poly) out.push(poly.site);
  }
  return out;
}

// River-adjacency set — polygon ids whose vertex ring shares any canonical
// edge key with the river strand. Empty when river is null or has no edges.
// Ports the helper inside `cityMapBlocks.ts::assignCraftRoles` (lines 759-782).
function buildRiverAdjacentSet(
  river: PlacerContext['river'],
  polygons: CityPolygon[],
): Set<number> {
  const out = new Set<number>();
  if (!river || river.edges.length === 0) return out;
  const riverKeys = new Set<string>();
  for (const [a, b] of river.edges) {
    riverKeys.add(canonicalEdgeKey(a, b));
  }
  for (const polygon of polygons) {
    const verts = polygon.vertices;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const key = canonicalEdgeKey(verts[i], verts[(i + 1) % n]);
      if (riverKeys.has(key)) {
        out.add(polygon.id);
        break;
      }
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Industrial placer (forge / tannery / textile / potters / mill)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapBlocks.ts::assignCraftRoles` (lines 711–893) onto the candidate
// pool. Outskirt-first sort — opposite of the central bias used by the named
// and military placers. River-requiring kinds (mill / tannery / textile)
// prefer river-adjacent polygons before falling back to any outskirt polygon.
//
// Eligibility:
//   potters → always
//   forge   → size >= medium
//   mill    → hasRiver
//   tannery → hasRiver && size >= medium
//   textile → hasRiver && size >= medium
//
// Pool: interior split of candidate pool. Per legacy semantics, isEdge
// polygons are skipped (sprawl territory).

type IndustrialKind = 'forge' | 'tannery' | 'textile' | 'potters' | 'mill';

const INDUSTRIAL_RIVER_REQUIRING: ReadonlySet<IndustrialKind> = new Set<IndustrialKind>([
  'tannery', 'textile', 'mill',
]);

function eligibleIndustrialKinds(env: PlacerContext['env']): IndustrialKind[] {
  const out: IndustrialKind[] = ['potters'];
  if (env.size !== 'small') out.push('forge');
  if (env.hasRiver) {
    out.push('mill');
    if (env.size !== 'small') {
      out.push('tannery');
      out.push('textile');
    }
  }
  return out;
}

export function placeIndustrialLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  _placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall, river } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleIndustrialKinds(env);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = INDUSTRIAL_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_industrial`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  // Seeded Fisher-Yates shuffle (mirrors `assignCraftRoles` lines 800-805).
  const shuffled = eligibleKinds.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Cycle the shuffled list when count > eligibleKinds.length.
  const kindList: IndustrialKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(shuffled[i % shuffled.length]);
  }

  // Interior pool only — outskirt-first sort (descending centerDist), stable
  // polygon-id tie-break.
  const { interior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);
  if (interior.length === 0) return [];

  type Candidate = {
    polygonId: number;
    outskirt: number;
    riverAdjacent: boolean;
  };
  const riverAdjacent = buildRiverAdjacentSet(river, polygons);
  const candidates: Candidate[] = interior.map(pid => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      outskirt: centerDist(site),
      riverAdjacent: riverAdjacent.has(pid),
    };
  });
  candidates.sort((a, b) => b.outskirt - a.outskirt || a.polygonId - b.polygonId);

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    const needsRiver = INDUSTRIAL_RIVER_REQUIRING.has(kind);

    let picked: Candidate | null = null;
    if (needsRiver && riverAdjacent.size > 0) {
      for (const c of candidates) {
        if (used.has(c.polygonId)) continue;
        if (c.riverAdjacent) { picked = c; break; }
      }
    }
    if (!picked) {
      for (const c of candidates) {
        if (!used.has(c.polygonId)) { picked = c; break; }
      }
    }
    if (!picked) break;

    used.add(picked.polygonId);
    out.push({ polygonId: picked.polygonId, kind });
  }

  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Military placer (barracks / citadel / arsenal / watchmen)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapMilitaryQuarters.ts::assignMilitaryRoles` (lines 88–292) onto
// the candidate pool. Interior pool only. Priority order is fixed (citadel →
// arsenal → barracks → watchmen) so the central polygon is always claimed by
// citadel first when both are eligible.
//
// Eligibility:
//   citadel  → size in {metropolis, megalopolis}
//   arsenal  → isCapital && size in {large, metropolis, megalopolis}
//   barracks → size >= medium
//   watchmen → size >= medium  (fallback for small if nothing else lands)
//
// Bias:
//   citadel  → centerScore
//   arsenal  → centerScore + templeBoost + waterBoost
//   barracks → gateScore (fallback to centerScore when no gates)
//   watchmen → centerScore
//
// Kind-name translation: `watchmen_precinct` (legacy) → `watchmen` (Phase 4).

type MilitaryKind = 'barracks' | 'citadel' | 'arsenal' | 'watchmen';

const MILITARY_PRIORITY: readonly MilitaryKind[] = [
  'citadel', 'arsenal', 'barracks', 'watchmen',
] as const;

function eligibleMilitaryKinds(env: PlacerContext['env']): MilitaryKind[] {
  const out: MilitaryKind[] = [];
  const isMediumOrUp = env.size !== 'small';
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  const isMetropolisOrUp = env.size === 'metropolis' || env.size === 'megalopolis';

  if (isMetropolisOrUp) out.push('citadel');
  if (isLargeOrUp && env.isCapital) out.push('arsenal');
  if (isMediumOrUp) out.push('barracks');
  if (isMediumOrUp) out.push('watchmen');

  // Small-city fallback so a lucky count pull still produces a watchmen post.
  if (out.length === 0 && env.size === 'small') {
    out.push('watchmen');
  }
  return out;
}

export function placeMilitaryLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleMilitaryKinds(env);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = MILITARY_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_military`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  // Cycle the priority list (no shuffle — citadel always wins the first slot).
  const priorityEligible = MILITARY_PRIORITY.filter(k => eligibleKinds.includes(k));
  if (priorityEligible.length === 0) return [];
  const kindList: MilitaryKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(priorityEligible[i % priorityEligible.length]);
  }

  const { interior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);
  if (interior.length === 0) return [];

  const templeSites = collectKindSites(placedNamed, polygons, 'temple');
  const gateMidpoints = computeGateMidpoints(wall.gates);

  type Candidate = {
    polygonId: number;
    centerScore: number;
    gateScore: number;
    templeBoost: number;
    waterBoost: number;
  };
  const candidates: Candidate[] = interior.map(pid => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerScore: centerScore(site),
      gateScore: siteBoost(site, gateMidpoints),
      templeBoost: siteBoost(site, templeSites),
      waterBoost: waterBoost(site, env),
    };
  });
  if (candidates.length === 0) return [];

  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;
  const citadelList = candidates.slice().sort((a, b) =>
    b.centerScore - a.centerScore || idTieBreak(a, b),
  );
  const arsenalList = candidates.slice().sort((a, b) =>
    (b.centerScore + b.templeBoost + b.waterBoost) -
    (a.centerScore + a.templeBoost + a.waterBoost) ||
    idTieBreak(a, b),
  );
  const barracksList = candidates.slice().sort((a, b) =>
    (gateMidpoints.length > 0 ? b.gateScore - a.gateScore : b.centerScore - a.centerScore) ||
    idTieBreak(a, b),
  );
  const watchmenList = candidates.slice().sort((a, b) =>
    b.centerScore - a.centerScore || idTieBreak(a, b),
  );

  const listFor = (kind: MilitaryKind): Candidate[] => {
    switch (kind) {
      case 'citadel':  return citadelList;
      case 'arsenal':  return arsenalList;
      case 'barracks': return barracksList;
      case 'watchmen': return watchmenList;
    }
  };

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    const list = listFor(kind);
    let picked = -1;
    for (const c of list) {
      if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
    }
    if (picked === -1) break;
    used.add(picked);
    out.push({ polygonId: picked, kind });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Faith aux placer (temple_quarter / necropolis / plague_ward / academia /
// archive)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapSFHQuarters.ts::assignSFHRoles` (lines 75–281) onto the
// candidate pool. Mixed interior + exterior pool (necropolis and plague_ward
// live on the fringe; the other three are central). Uses seeded Fisher-Yates
// to shuffle eligible kinds, then cycles the shuffled list to fill `count`
// slots — same shape as legacy SFH.
//
// Eligibility:
//   necropolis     → always
//   temple_quarter → size >= medium && religionCount >= 2
//   academia       → size >= large
//   plague_ward    → size >= large && (isCoastal || hasRiver)
//   archive        → size >= large && isCapital
//
// Bias:
//   Interior kinds (temple_quarter / academia / archive)
//                  → centerScore + templeBoost (descending)
//   necropolis     → exterior, centerDist descending (far from center)
//   plague_ward    → exterior, waterBoost descending (near water edge)
//
// Kind-name translation: `archive_quarter` (legacy) → `archive` (Phase 4).

type FaithAuxKind = 'temple_quarter' | 'necropolis' | 'plague_ward' | 'academia' | 'archive';

const FAITH_AUX_INTERIOR: ReadonlySet<FaithAuxKind> = new Set<FaithAuxKind>([
  'temple_quarter', 'academia', 'archive',
]);

function eligibleFaithAuxKinds(env: PlacerContext['env']): FaithAuxKind[] {
  const out: FaithAuxKind[] = ['necropolis'];
  if (env.size !== 'small' && env.religionCount >= 2) out.push('temple_quarter');
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  if (isLargeOrUp) {
    out.push('academia');
    if (env.isCoastal || env.hasRiver) out.push('plague_ward');
    if (env.isCapital) out.push('archive');
  }
  return out;
}

export function placeFaithAuxLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleFaithAuxKinds(env);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = FAITH_AUX_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_faith_aux`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  // Seeded Fisher-Yates shuffle, then cycle the shuffled list (legacy SFH parity).
  const shuffled = eligibleKinds.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const kindList: FaithAuxKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(shuffled[i % shuffled.length]);
  }

  const { interior, exterior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);

  const templeSites = collectKindSites(placedNamed, polygons, 'temple');

  type InteriorCandidate = { polygonId: number; centerScore: number; templeBoost: number };
  type ExteriorCandidate = { polygonId: number; centerDist: number; waterBoost: number };

  const interiorCandidates: InteriorCandidate[] = interior.map(pid => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerScore: centerScore(site),
      templeBoost: siteBoost(site, templeSites),
    };
  });
  const exteriorCandidates: ExteriorCandidate[] = exterior.map(pid => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerDist: centerDist(site),
      waterBoost: waterBoost(site, env),
    };
  });

  const interiorIdTieBreak = (a: InteriorCandidate, b: InteriorCandidate) => a.polygonId - b.polygonId;
  const exteriorIdTieBreak = (a: ExteriorCandidate, b: ExteriorCandidate) => a.polygonId - b.polygonId;

  interiorCandidates.sort((a, b) =>
    (b.centerScore + b.templeBoost) - (a.centerScore + a.templeBoost) || interiorIdTieBreak(a, b),
  );
  // Necropolis prefers farthest exterior polygon from center.
  const necropolisList = exteriorCandidates.slice().sort((a, b) =>
    b.centerDist - a.centerDist || exteriorIdTieBreak(a, b),
  );
  // Plague ward prefers exterior polygon nearest the water edge.
  const plagueList = exteriorCandidates.slice().sort((a, b) =>
    b.waterBoost - a.waterBoost || exteriorIdTieBreak(a, b),
  );

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    let picked = -1;
    if (FAITH_AUX_INTERIOR.has(kind)) {
      for (const c of interiorCandidates) {
        if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
      }
    } else if (kind === 'plague_ward') {
      for (const c of plagueList) {
        if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
      }
    } else {
      // necropolis
      for (const c of necropolisList) {
        if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
      }
    }
    if (picked === -1) break;
    used.add(picked);
    out.push({ polygonId: picked, kind });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Entertainment placer (theater / bathhouse / pleasure / festival)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapEntertainmentQuarters.ts::assignEntertainmentRoles`
// (lines 103–366) onto the candidate pool. Mixed interior + exterior pool —
// festival sources from the boundary band (just-outside-the-walls fairgrounds)
// while the other three are interior. Priority order is fixed
// (theater → bathhouse → pleasure → festival).
//
// Eligibility:
//   theater   → size >= large
//   bathhouse → size >= large || isCapital
//   pleasure  → size >= medium
//   festival  → size >= medium  (exterior pool)
//
// Bias:
//   theater   → centerScore + monumentBoost + 0.5 × marketBoost
//   bathhouse → waterBoost + 0.5 × centerScore
//   pleasure  → gateScore + 0.3 × centerScore
//   festival  → centerScore (exterior pool — closest exterior polygon to
//               canvas center reads as just-outside-walls)
//
// Kind-name translations:
//   theater_district  → theater
//   bathhouse_quarter → bathhouse
//   pleasure_quarter  → pleasure
//   festival_grounds  → festival

type EntertainmentKind = 'theater' | 'bathhouse' | 'pleasure' | 'festival';

const ENTERTAINMENT_PRIORITY: readonly EntertainmentKind[] = [
  'theater', 'bathhouse', 'pleasure', 'festival',
] as const;

function eligibleEntertainmentKinds(env: PlacerContext['env']): EntertainmentKind[] {
  const out: EntertainmentKind[] = [];
  const isMediumOrUp = env.size !== 'small';
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';

  if (isLargeOrUp) out.push('theater');
  if (isLargeOrUp || env.isCapital) out.push('bathhouse');
  if (isMediumOrUp) out.push('pleasure');
  if (isMediumOrUp) out.push('festival');
  return out;
}

export function placeEntertainmentLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleEntertainmentKinds(env);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = ENTERTAINMENT_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_entertainment`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  const priorityEligible = ENTERTAINMENT_PRIORITY.filter(k => eligibleKinds.includes(k));
  if (priorityEligible.length === 0) return [];
  const kindList: EntertainmentKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(priorityEligible[i % priorityEligible.length]);
  }

  const { interior, exterior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);

  const marketSites = collectKindSites(placedNamed, polygons, 'market');
  const wonderSites = collectKindSites(placedNamed, polygons, 'wonder');
  const gateMidpoints = computeGateMidpoints(wall.gates);

  type Candidate = {
    polygonId: number;
    centerScore: number;
    gateScore: number;
    marketBoost: number;
    monumentBoost: number;
    waterBoost: number;
  };
  const buildCand = (pid: number): Candidate => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerScore: centerScore(site),
      gateScore: siteBoost(site, gateMidpoints),
      marketBoost: siteBoost(site, marketSites),
      monumentBoost: siteBoost(site, wonderSites),
      waterBoost: waterBoost(site, env),
    };
  };
  const interiorCandidates: Candidate[] = interior.map(buildCand);
  const exteriorCandidates: Candidate[] = exterior.map(buildCand);

  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;
  const theaterList = interiorCandidates.slice().sort((a, b) =>
    (b.centerScore + b.monumentBoost + b.marketBoost * 0.5) -
    (a.centerScore + a.monumentBoost + a.marketBoost * 0.5) ||
    idTieBreak(a, b),
  );
  const bathhouseList = interiorCandidates.slice().sort((a, b) =>
    (b.waterBoost + b.centerScore * 0.5) -
    (a.waterBoost + a.centerScore * 0.5) ||
    idTieBreak(a, b),
  );
  const pleasureList = interiorCandidates.slice().sort((a, b) =>
    (b.gateScore + b.centerScore * 0.3) -
    (a.gateScore + a.centerScore * 0.3) ||
    idTieBreak(a, b),
  );
  const festivalList = exteriorCandidates.slice().sort((a, b) =>
    b.centerScore - a.centerScore || idTieBreak(a, b),
  );

  const listFor = (kind: EntertainmentKind): Candidate[] => {
    switch (kind) {
      case 'theater':   return theaterList;
      case 'bathhouse': return bathhouseList;
      case 'pleasure':  return pleasureList;
      case 'festival':  return festivalList;
    }
  };

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    const list = listFor(kind);
    let picked = -1;
    for (const c of list) {
      if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
    }
    // Match legacy entertainment behaviour: skip exhausted role, try next slot.
    if (picked === -1) continue;
    used.add(picked);
    out.push({ polygonId: picked, kind });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Trade placer (foreign_quarter / caravanserai / bankers_row / warehouse)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapTradeFinanceQuarters.ts::assignTradeFinanceRoles` (lines
// 95–342) onto the candidate pool. Interior pool only. Priority order is
// fixed (bankers_row → foreign_quarter → warehouse → caravanserai).
//
// Eligibility:
//   bankers_row     → size >= large
//   foreign_quarter → size >= large && (isCoastal || hasRiver)
//   warehouse       → size >= medium
//   caravanserai    → size >= medium && wall.gates.length > 0
//   (small-city fallback: lone warehouse so the 0-1 count range can fire)
//
// Bias:
//   bankers_row     → centerScore + monumentBoost
//   foreign_quarter → centerScore + marketBoost + waterBoost
//   warehouse       → marketBoost + 0.5 × centerScore
//   caravanserai    → gateScore + 0.5 × centerScore
//
// Kind-name translation: `warehouse_row` (legacy) → `warehouse` (Phase 4).

type TradeKind = 'foreign_quarter' | 'caravanserai' | 'bankers_row' | 'warehouse';

const TRADE_PRIORITY: readonly TradeKind[] = [
  'bankers_row', 'foreign_quarter', 'warehouse', 'caravanserai',
] as const;

function eligibleTradeKinds(env: PlacerContext['env'], gatesCount: number): TradeKind[] {
  const out: TradeKind[] = [];
  const isMediumOrUp = env.size !== 'small';
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';

  if (isLargeOrUp) out.push('bankers_row');
  if (isLargeOrUp && (env.isCoastal || env.hasRiver)) out.push('foreign_quarter');
  if (isMediumOrUp) out.push('warehouse');
  if (isMediumOrUp && gatesCount > 0) out.push('caravanserai');

  // Small-city fallback so the 0-1 count range can still produce one warehouse.
  if (out.length === 0 && env.size === 'small') {
    out.push('warehouse');
  }
  return out;
}

export function placeTradeLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleTradeKinds(env, wall.gates.length);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = TRADE_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_trade`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  const priorityEligible = TRADE_PRIORITY.filter(k => eligibleKinds.includes(k));
  if (priorityEligible.length === 0) return [];
  const kindList: TradeKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(priorityEligible[i % priorityEligible.length]);
  }

  const { interior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);
  if (interior.length === 0) return [];

  const marketSites = collectKindSites(placedNamed, polygons, 'market');
  const wonderSites = collectKindSites(placedNamed, polygons, 'wonder');
  const gateMidpoints = computeGateMidpoints(wall.gates);

  type Candidate = {
    polygonId: number;
    centerScore: number;
    gateScore: number;
    marketBoost: number;
    monumentBoost: number;
    waterBoost: number;
  };
  const candidates: Candidate[] = interior.map(pid => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerScore: centerScore(site),
      gateScore: siteBoost(site, gateMidpoints),
      marketBoost: siteBoost(site, marketSites),
      monumentBoost: siteBoost(site, wonderSites),
      waterBoost: waterBoost(site, env),
    };
  });
  if (candidates.length === 0) return [];

  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;
  const bankersList = candidates.slice().sort((a, b) =>
    (b.centerScore + b.monumentBoost) -
    (a.centerScore + a.monumentBoost) ||
    idTieBreak(a, b),
  );
  const foreignList = candidates.slice().sort((a, b) =>
    (b.centerScore + b.marketBoost + b.waterBoost) -
    (a.centerScore + a.marketBoost + a.waterBoost) ||
    idTieBreak(a, b),
  );
  const warehouseList = candidates.slice().sort((a, b) =>
    (b.marketBoost + b.centerScore * 0.5) -
    (a.marketBoost + a.centerScore * 0.5) ||
    idTieBreak(a, b),
  );
  const caravanList = candidates.slice().sort((a, b) =>
    (b.gateScore + b.centerScore * 0.5) -
    (a.gateScore + a.centerScore * 0.5) ||
    idTieBreak(a, b),
  );

  const listFor = (kind: TradeKind): Candidate[] => {
    switch (kind) {
      case 'bankers_row':     return bankersList;
      case 'foreign_quarter': return foreignList;
      case 'warehouse':       return warehouseList;
      case 'caravanserai':    return caravanList;
    }
  };

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    const list = listFor(kind);
    let picked = -1;
    for (const c of list) {
      if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
    }
    if (picked === -1) break;
    used.add(picked);
    out.push({ polygonId: picked, kind });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Excluded placer (gallows / workhouse / ghetto_marker)
// ═════════════════════════════════════════════════════════════════════════════
// Ports `cityMapExcludedQuarters.ts::assignExcludedRoles` (lines 105–337) onto
// the candidate pool. Mixed interior + exterior pool — gallows lives on the
// fringe, ghetto_marker and workhouse are interior. Priority order is fixed
// (ghetto_marker → workhouse → gallows).
//
// Eligibility:
//   ghetto_marker → size >= large && religionCount >= 2
//   workhouse     → size >= large
//   gallows       → size >= medium  (exterior pool)
//
// Bias:
//   ghetto_marker → centerScore + marketBoost + 0.5 × waterBoost
//   workhouse     → centerScore + 0.3 × monumentBoost + 0.5 × waterBoost
//   gallows       → centerScore (exterior pool)
//
// Kind-name translations:
//   ghetto       → ghetto_marker
//   gallows_hill → gallows

type ExcludedKind = 'ghetto_marker' | 'workhouse' | 'gallows';

const EXCLUDED_PRIORITY: readonly ExcludedKind[] = [
  'ghetto_marker', 'workhouse', 'gallows',
] as const;

function eligibleExcludedKinds(env: PlacerContext['env']): ExcludedKind[] {
  const out: ExcludedKind[] = [];
  const isMediumOrUp = env.size !== 'small';
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';

  if (isLargeOrUp && env.religionCount >= 2) out.push('ghetto_marker');
  if (isLargeOrUp) out.push('workhouse');
  if (isMediumOrUp) out.push('gallows');
  return out;
}

export function placeExcludedLandmarks(
  ctx: PlacerContext,
  used: Set<number>,
  placedNamed: LandmarkV2[],
): LandmarkV2[] {
  const { seed, cityName, env, polygons, candidatePool, wall } = ctx;
  if (candidatePool.size === 0) return [];

  const eligibleKinds = eligibleExcludedKinds(env);
  if (eligibleKinds.length === 0) return [];

  const [minCount, maxCount] = EXCLUDED_COUNT_RANGE[env.size];
  if (maxCount === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_unified_excluded`);
  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return [];

  const priorityEligible = EXCLUDED_PRIORITY.filter(k => eligibleKinds.includes(k));
  if (priorityEligible.length === 0) return [];
  const kindList: ExcludedKind[] = [];
  for (let i = 0; i < count; i++) {
    kindList.push(priorityEligible[i % priorityEligible.length]);
  }

  const { interior, exterior } = splitPoolByInteriority(candidatePool, wall.interiorPolygonIds, polygons);

  const marketSites = collectKindSites(placedNamed, polygons, 'market');
  const wonderSites = collectKindSites(placedNamed, polygons, 'wonder');

  type Candidate = {
    polygonId: number;
    centerScore: number;
    marketBoost: number;
    monumentBoost: number;
    waterBoost: number;
  };
  const buildCand = (pid: number): Candidate => {
    const site = polygons[pid].site;
    return {
      polygonId: pid,
      centerScore: centerScore(site),
      marketBoost: siteBoost(site, marketSites),
      monumentBoost: siteBoost(site, wonderSites),
      waterBoost: waterBoost(site, env),
    };
  };
  const interiorCandidates: Candidate[] = interior.map(buildCand);
  const exteriorCandidates: Candidate[] = exterior.map(buildCand);

  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;
  const ghettoList = interiorCandidates.slice().sort((a, b) =>
    (b.centerScore + b.marketBoost + b.waterBoost * 0.5) -
    (a.centerScore + a.marketBoost + a.waterBoost * 0.5) ||
    idTieBreak(a, b),
  );
  const workhouseList = interiorCandidates.slice().sort((a, b) =>
    (b.centerScore + b.monumentBoost * 0.3 + b.waterBoost * 0.5) -
    (a.centerScore + a.monumentBoost * 0.3 + a.waterBoost * 0.5) ||
    idTieBreak(a, b),
  );
  const gallowsList = exteriorCandidates.slice().sort((a, b) =>
    b.centerScore - a.centerScore || idTieBreak(a, b),
  );

  const listFor = (kind: ExcludedKind): Candidate[] => {
    switch (kind) {
      case 'ghetto_marker': return ghettoList;
      case 'workhouse':     return workhouseList;
      case 'gallows':       return gallowsList;
    }
  };

  const out: LandmarkV2[] = [];
  for (const kind of kindList) {
    const list = listFor(kind);
    let picked = -1;
    for (const c of list) {
      if (!used.has(c.polygonId)) { picked = c.polygonId; break; }
    }
    // Match legacy excluded behaviour: skip exhausted role, try next slot.
    if (picked === -1) continue;
    used.add(picked);
    out.push({ polygonId: picked, kind });
  }
  return out;
}
