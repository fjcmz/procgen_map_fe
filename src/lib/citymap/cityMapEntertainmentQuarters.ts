// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Entertainment & Social quarter assignment
// ─────────────────────────────────────────────────────────────────────────────
// [Voronoi-polygon] Post-pass that extracts polygons from the already-classified
// block graph and reclassifies them as one of four entertainment & social
// district types drawn from `specs/City_districts_catalog.md` §2:
//
//   theater_district  — playhouses, arenas, odeons, pleasure gardens
//   bathhouse_quarter — public baths, steam rooms (needs water)
//   pleasure_quarter  — taverns, brothels, gaming houses (red lantern)
//   festival_grounds  — open field for fairs, jousts (EXTERIOR — sourced
//                       from agricultural/slum blocks, no building packing)
//
// Pattern mirrors `assignTradeFinanceRoles` in `cityMapTradeFinanceQuarters.ts`
// and the other sister assigners (craft / SFH / military):
//   • Extract single polygons from existing residential blocks (interior 3)
//     or agricultural/slum blocks (festival_grounds only)
//   • Remove the polygon from its source block (block.polygonIds shrinks)
//   • Push a new 1-polygon block with the entertainment role
//   • Block-partition invariant is preserved — every polygon stays in exactly
//     one block after the pass.
//
// Call order in `cityMapGeneratorV2.ts`:
//   generateBlocks → assignCraftRoles → generateLandmarks → assignSFHRoles
//   → assignMilitaryRoles → assignTradeFinanceRoles → assignEntertainmentRoles
//   → generateBuildings
//
// Called LAST among the assigners so it doesn't steal civic / market /
// military / trade picks. Called AFTER `generateLandmarks` so monument sites
// (city wonders) are available for theater_district's wonder bias, and BEFORE
// `generateBuildings` so the packer picks up the new interior entertainment
// roles via PACKING_ROLES.
//
// Placement biases (per user request: "biased towards the centre and markets
// and wonders of the city, and close to water for those quarters that need it"):
//   theater_district  — centerScore + monumentBoost + marketBoost × 0.5
//                       (clusters near civic core and monumental architecture)
//   bathhouse_quarter — waterBoost + centerScore × 0.5 (water-requiring)
//   pleasure_quarter  — gateScore + centerScore × 0.3 (red-lantern quarters
//                       traditionally cluster near gates / docks)
//   festival_grounds  — closest exterior polygon to canvas centre (just-
//                       outside-the-walls fairgrounds, not lost on frontier)
//
// Invariants:
//   • No Math.random() — always seededPRNG(`${seed}_city_${cityName}_entertainment`)
//   • No import of cityMapEdgeGraph.ts — placement uses Euclidean site
//     distances + gate-midpoint / market / monument / water-edge proxies only
//   • Naming is deterministic (entBlockCount % names.length), no RNG consumed
//   • Three roles are INTERIOR (sourced from `residential` blocks); the fourth
//     `festival_grounds` is EXTERIOR (sourced from `agricultural` / `slum`
//     blocks) and lives outside PACKING_ROLES — same precedent as `necropolis`
//     and `plague_ward` in cityMapSFHQuarters.ts.
//   • Priority order for type assignment is `[theater_district,
//     bathhouse_quarter, pleasure_quarter, festival_grounds]` (cycled), so the
//     central / water-anchored picks happen before the gate / exterior ones.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityEnvironment,
  CityLandmarkV2,
  CityPolygon,
  CitySize,
} from './cityMapTypesV2';

type EntertainmentRole =
  | 'theater_district' | 'bathhouse_quarter' | 'pleasure_quarter' | 'festival_grounds';

import type { OpenSpaceEntry } from './cityMapOpenSpaces';

// Local structural type so this file does not depend on `cityMapWalls.ts`
// internals. Matches the shape produced by `generateWallsAndGates`.
type GateLike = { edge: [[number, number], [number, number]] };

// ── Count ranges by city size (user spec) ──────────────────────────────────
const ENTERTAINMENT_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 0],
  medium:      [0, 1],
  large:       [1, 2],
  metropolis:  [1, 3],
  megalopolis: [2, 5],
};

// ── Medieval / festive flavour names per role ──────────────────────────────
// Picked deterministically by `(entBlockCount % names.length)`.
const ENTERTAINMENT_NAMES: Record<EntertainmentRole, string[]> = {
  theater_district:  ['THEATER ROW', 'PLAYHOUSE QUARTER', 'AMPHITHEATRE CLOSE', 'STAGE YARD', 'ODEON LANE'],
  bathhouse_quarter: ['BATHHOUSE QUARTER', 'STEAM ROW', 'WATERS CLOSE', 'CALDARIUM YARD', 'SPA LANE'],
  pleasure_quarter:  ['LANTERN QUARTER', 'TAVERN ROW', 'PLEASURE GARDENS', 'GAMING CLOSE', 'REVELERS LANE'],
  festival_grounds:  ['FESTIVAL GROUNDS', 'FAIR FIELD', 'JOUSTING GREEN', 'MAYPOLE FIELD', 'TOURNEY GROUND'],
};

// ── Canvas geometry ─────────────────────────────────────────────────────────
const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ── Eligibility ─────────────────────────────────────────────────────────────
// Gates role availability by size + capital signals. No resource plumbing
// (by design — city-map layer works from env proxies only).
function eligibleEntertainmentTypes(env: CityEnvironment): EntertainmentRole[] {
  const types: EntertainmentRole[] = [];
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  const isMediumOrUp = env.size !== 'small';

  // Theater district: large+ — playhouses are a big-city institution.
  if (isLargeOrUp) types.push('theater_district');

  // Bathhouse quarter: large+ OR capital — also caps at one of the two
  // signals to ensure bathhouses appear in capital cities of any tier.
  if (isLargeOrUp || env.isCapital) types.push('bathhouse_quarter');

  // Pleasure quarter: medium+ — taverns and gaming houses.
  if (isMediumOrUp) types.push('pleasure_quarter');

  // Festival grounds: medium+ — exterior fairground field.
  if (isMediumOrUp) types.push('festival_grounds');

  return types;
}

/**
 * Extract individual polygons from `residential` blocks (interior roles) and
 * `agricultural` / `slum` blocks (festival_grounds) and re-wrap each as a new
 * 1-polygon entertainment & social district. Mutates the `blocks` array in-
 * place (shrinks source blocks, appends new entertainment blocks). The overall
 * block partition invariant is preserved.
 */
export function assignEntertainmentRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  landmarks: CityLandmarkV2[],
  openSpaces: OpenSpaceEntry[],
  gates: GateLike[],
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_entertainment`);

  // ── Eligibility ─────────────────────────────────────────────────────────
  const eligible = eligibleEntertainmentTypes(env);
  if (eligible.length === 0) return;

  const [minCount, maxCount] = ENTERTAINMENT_COUNT_RANGE[env.size];
  if (maxCount === 0) return;

  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return;

  // ── Priority-ordered type list (fixed, not shuffled) ────────────────────
  // Theater first so it gets first pick of the most central polygon. Bathhouse
  // second (water + central). Pleasure quarter third (gate-anchored).
  // Festival grounds last (exterior, naturally on the fringe).
  const PRIORITY: EntertainmentRole[] = [
    'theater_district', 'bathhouse_quarter', 'pleasure_quarter', 'festival_grounds',
  ];
  const priorityEligible = PRIORITY.filter(r => eligible.includes(r));
  if (priorityEligible.length === 0) return;

  const typeList: EntertainmentRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(priorityEligible[i % priorityEligible.length]);
  }

  // ── Precompute market open-space sites for marketBoost ──────────────────
  // [Voronoi-polygon] Sites of every polygon referenced by a `market`
  // open-space entry. Used for theater_district's "biased towards markets"
  // contribution.
  const marketSites: [number, number][] = [];
  for (const os of openSpaces) {
    if (os.kind !== 'market') continue;
    for (const pid of os.polygonIds) {
      const p = polygons[pid];
      if (p) marketSites.push(p.site);
    }
  }

  function marketBoost(site: [number, number]): number {
    if (marketSites.length === 0) return 0;
    let minDist2 = Infinity;
    for (const [mx, my] of marketSites) {
      const d2 = (site[0] - mx) ** 2 + (site[1] - my) ** 2;
      if (d2 < minDist2) minDist2 = d2;
    }
    return 1 / (1 + minDist2 / 10_000);
  }

  // ── Precompute monument landmark sites for monumentBoost ────────────────
  // [Voronoi-polygon] Monuments on the city canvas = wonders on the world
  // map (cityMapLandmarks.ts maps env.wonderCount → monument landmarks).
  // Used for theater_district's "biased towards wonders" contribution.
  const monumentSites: [number, number][] = landmarks
    .filter(lm => lm.type === 'monument')
    .map(lm => polygons[lm.polygonId]?.site ?? [CANVAS_CX, CANVAS_CY]);

  function monumentBoost(site: [number, number]): number {
    if (monumentSites.length === 0) return 0;
    let minDist2 = Infinity;
    for (const [mx, my] of monumentSites) {
      const d2 = (site[0] - mx) ** 2 + (site[1] - my) ** 2;
      if (d2 < minDist2) minDist2 = d2;
    }
    return 1 / (1 + minDist2 / 10_000);
  }

  // ── Gate midpoints for pleasure_quarter's gateScore ─────────────────────
  const gateMidpoints: [number, number][] = gates.map(g => [
    (g.edge[0][0] + g.edge[1][0]) / 2,
    (g.edge[0][1] + g.edge[1][1]) / 2,
  ]);

  function gateScore(site: [number, number]): number {
    if (gateMidpoints.length === 0) return 0;
    let minDist2 = Infinity;
    for (const [gx, gy] of gateMidpoints) {
      const d2 = (site[0] - gx) ** 2 + (site[1] - gy) ** 2;
      if (d2 < minDist2) minDist2 = d2;
    }
    return 1 / (1 + minDist2 / 10_000);
  }

  // ── Water-edge proximity for bathhouse_quarter's waterBoost ─────────────
  // Mirrors the pattern in cityMapTradeFinanceQuarters.ts foreign_quarter and
  // cityMapMilitaryQuarters.ts arsenal. Only contributes when env.waterSide
  // is set (coastal) or hasRiver is true with a derivable side.
  function waterBoost(site: [number, number]): number {
    if (!env.isCoastal && !env.hasRiver) return 0;
    const [sx, sy] = site;
    let dist: number;
    switch (env.waterSide) {
      case 'north': dist = sy; break;
      case 'south': dist = CANVAS_SIZE - sy; break;
      case 'east':  dist = CANVAS_SIZE - sx; break;
      case 'west':  dist = sx; break;
      default:      return 0; // river present but no directional side — no bias
    }
    return 1 / (1 + dist / 50);
  }

  // ── Build the candidate list — one entry per eligible polygon ───────────
  // Two pools because festival_grounds sources from EXTERIOR (agricultural /
  // slum) blocks while the other three source from `residential`.
  type Candidate = {
    polygonId: number;
    blockIndex: number;
    centerScore: number;
    gateScore: number;
    marketBoost: number;
    monumentBoost: number;
    waterBoost: number;
  };

  const interiorCandidates: Candidate[] = [];
  const exteriorCandidates: Candidate[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const isResidential = block.role === 'residential';
    const isExterior = block.role === 'agricultural' || block.role === 'slum';
    if (!isResidential && !isExterior) continue;

    for (const pid of block.polygonIds) {
      const p = polygons[pid];
      if (!p) continue;
      // Interior pool excludes isEdge polygons (sprawl territory). Exterior
      // pool keeps isEdge polygons since exterior blocks live on the fringe.
      if (isResidential && p.isEdge) continue;
      const [px, py] = p.site;
      const dist2 = (px - CANVAS_CX) ** 2 + (py - CANVAS_CY) ** 2;
      const cand: Candidate = {
        polygonId: pid,
        blockIndex: bi,
        centerScore: 1 / (1 + dist2 / 10_000),
        gateScore: gateScore(p.site),
        marketBoost: marketBoost(p.site),
        monumentBoost: monumentBoost(p.site),
        waterBoost: waterBoost(p.site),
      };
      if (isResidential) {
        interiorCandidates.push(cand);
      } else {
        exteriorCandidates.push(cand);
      }
    }
  }

  // Sorted lists per role, each descending on that role's bias. Stable tie-
  // break on polygon id keeps output seed-deterministic across the lists.
  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;

  const theaterList = interiorCandidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.monumentBoost + b.marketBoost * 0.5) -
      (a.centerScore + a.monumentBoost + a.marketBoost * 0.5) ||
      idTieBreak(a, b),
  );
  const bathhouseList = interiorCandidates.slice().sort(
    (a, b) =>
      (b.waterBoost + b.centerScore * 0.5) -
      (a.waterBoost + a.centerScore * 0.5) ||
      idTieBreak(a, b),
  );
  const pleasureList = interiorCandidates.slice().sort(
    (a, b) =>
      (b.gateScore + b.centerScore * 0.3) -
      (a.gateScore + a.centerScore * 0.3) ||
      idTieBreak(a, b),
  );
  // Festival grounds: closest exterior polygon to the canvas centre — reads as
  // a just-outside-the-walls fairground rather than a lost frontier field.
  const festivalList = exteriorCandidates.slice().sort(
    (a, b) =>
      b.centerScore - a.centerScore ||
      idTieBreak(a, b),
  );

  function listFor(role: EntertainmentRole): Candidate[] {
    switch (role) {
      case 'theater_district':  return theaterList;
      case 'bathhouse_quarter': return bathhouseList;
      case 'pleasure_quarter':  return pleasureList;
      case 'festival_grounds':  return festivalList;
    }
  }

  // ── Assign roles — greedy pick with shared used-polygon set ─────────────
  // Interior and exterior roles share the `usedPolygonIds` set even though
  // they draw from disjoint pools — keeps the contract simple and cheap.
  const usedPolygonIds = new Set<number>();
  let entBlockCount = 0;

  for (const role of typeList) {
    const list = listFor(role);
    let pickedPolygonId = -1;
    let pickedBlockIndex = -1;

    for (const c of list) {
      if (!usedPolygonIds.has(c.polygonId)) {
        pickedPolygonId = c.polygonId;
        pickedBlockIndex = c.blockIndex;
        break;
      }
    }
    if (pickedPolygonId === -1) continue; // pool for this role exhausted; try next

    usedPolygonIds.add(pickedPolygonId);

    // Remove the polygon from its source block (residential for interior
    // roles, agricultural/slum for festival_grounds). The block may become
    // empty — harmless for downstream consumers that iterate polygonIds.
    const srcBlock = blocks[pickedBlockIndex];
    srcBlock.polygonIds = srcBlock.polygonIds.filter(pid => pid !== pickedPolygonId);

    // Push a new 1-polygon entertainment block.
    const names = ENTERTAINMENT_NAMES[role];
    blocks.push({
      polygonIds: [pickedPolygonId],
      role,
      name: names[entBlockCount % names.length],
    });
    entBlockCount++;
  }
}
