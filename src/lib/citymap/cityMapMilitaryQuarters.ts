// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Military & security quarter assignment
// ─────────────────────────────────────────────────────────────────────────────
// [Voronoi-polygon] Post-pass that extracts polygons from the already-classified
// block graph and reclassifies them as one of four military & security district
// types drawn from `specs/City_districts_catalog.md`:
//
//   barracks          — standing-army quarters, armories, drill yards
//   citadel           — inner fortress / last-resort keep (metropolis+)
//   arsenal           — state weapon storage / powder magazine (capital + large+)
//   watchmen_precinct — city guard barracks + holding cells
//
// Pattern mirrors `assignSFHRoles` in `cityMapSFHQuarters.ts` and
// `assignCraftRoles` in `cityMapBlocks.ts`:
//   • Extract single polygons from existing residential blocks
//   • Remove the polygon from its source block (block.polygonIds shrinks)
//   • Push a new 1-polygon block with the military role
//   • Block-partition invariant is preserved — every polygon stays in exactly
//     one block after the pass.
//
// Call order in `cityMapGeneratorV2.ts`:
//   generateBlocks → assignCraftRoles → generateLandmarks → assignSFHRoles
//   → assignMilitaryRoles → generateBuildings
//
// Called AFTER `assignSFHRoles` so temple landmark positions AND temple_quarter
// blocks can bias military placement, and BEFORE `generateBuildings` so the
// packer picks up the new interior military roles via PACKING_ROLES.
//
// Placement biases (per spec: "biased toward the centre and temples of the
// city, and close to water for those quarters that need it"):
//   citadel           — pure centerScore (nearest polygon to canvas centre)
//   arsenal           — centerScore + templeBoost + waterBoost (when hasRiver
//                       or isCoastal); the one role "that needs water"
//   barracks          — gateScore (wall/gate adjacency per spec) with
//                       centerScore fallback for unwalled cities
//   watchmen_precinct — pure centerScore; later slots drift outward naturally
//                       as central polygons are consumed
//
// Invariants:
//   • No Math.random() — always seededPRNG(`${seed}_city_${cityName}_military`)
//   • No import of cityMapEdgeGraph.ts — placement uses Euclidean site
//     distances + gate-midpoint distances only
//   • Naming is deterministic (militaryBlockCount % names.length), no RNG
//   • All four roles are INTERIOR — sourced from `residential` blocks. No
//     exterior sourcing, so the sprawl generator is unaffected.
//   • Priority order for type assignment is `[citadel, arsenal, barracks,
//     watchmen_precinct]` (cycled), so citadel always gets first pick of the
//     most central polygon.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityBlockV2, CityEnvironment, CityLandmarkV2, CityPolygon, CitySize } from './cityMapTypesV2';

type MilitaryRole = 'barracks' | 'citadel' | 'arsenal' | 'watchmen_precinct';

// Local structural type so this file does not depend on `cityMapWalls.ts`
// internals. `gates` as produced by `generateWallsAndGates` matches this
// shape (edge = [[x1,y1],[x2,y2]]).
type GateLike = { edge: [[number, number], [number, number]] };

// ── Count ranges by city size (user spec) ──────────────────────────────────
const MIL_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 3],
  metropolis:  [2, 4],
  megalopolis: [3, 6],
};

// ── Medieval / military flavour names per role ────────────────────────────
// Picked deterministically by `(militaryBlockCount % names.length)`.
const MIL_NAMES: Record<MilitaryRole, string[]> = {
  barracks:          ['GARRISON ROW', 'BARRACK CLOSE', 'DRILL YARD', 'LEGION QUARTER', 'MUSTER FIELD'],
  citadel:           ['CITADEL', 'KEEP CLOSE', 'STRONGHOLD YARD', 'DONJON', 'THE BASTION'],
  arsenal:           ['ARSENAL ROW', 'ARMORY CLOSE', 'POWDER YARD', 'MAGAZINE QUARTER', 'ORDNANCE CLOSE'],
  watchmen_precinct: ['WATCH ROW', 'CONSTABLES CLOSE', 'PRECINCT YARD', 'WARDENS QUARTER', 'GUARD CLOSE'],
};

// ── Canvas geometry ─────────────────────────────────────────────────────────
const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ── Eligibility ─────────────────────────────────────────────────────────────
// Gating is size + `isCapital` only. No Spirit / militaryTech plumbing in this
// pass — the four roles naturally fan out across the size tiers the user
// specified (small 0-1 up to megalopolis 3-6).
function eligibleMilitaryTypes(env: CityEnvironment): MilitaryRole[] {
  const types: MilitaryRole[] = [];
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  const isMetropolisOrUp = env.size === 'metropolis' || env.size === 'megalopolis';
  const isMediumOrUp = env.size !== 'small';

  // Citadel first in priority order so it gets first pick of the central polygon.
  if (isMetropolisOrUp) types.push('citadel');
  if (isLargeOrUp && env.isCapital) types.push('arsenal');
  if (isMediumOrUp) types.push('barracks');
  if (isMediumOrUp) types.push('watchmen_precinct');

  // Small cities can still roll a watchmen_precinct on a lucky count pull.
  if (types.length === 0 && env.size === 'small') {
    types.push('watchmen_precinct');
  }
  return types;
}

/**
 * Extract individual polygons from `residential` blocks and re-wrap each as a
 * new 1-polygon military & security district. Mutates the `blocks` array
 * in-place (shrinks source blocks, appends new military blocks). The overall
 * block partition invariant is preserved.
 */
export function assignMilitaryRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  landmarks: CityLandmarkV2[],
  gates: GateLike[],
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_military`);

  // ── Eligibility ─────────────────────────────────────────────────────────
  const eligible = eligibleMilitaryTypes(env);
  if (eligible.length === 0) return;

  const [minCount, maxCount] = MIL_COUNT_RANGE[env.size];
  if (maxCount === 0) return;

  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return;

  // ── Priority-ordered type list (fixed, not shuffled) ────────────────────
  // Citadel first so it always consumes the most central polygon. Arsenal
  // second so it lands near centre + temple + water. Barracks third (gate
  // adjacency). Watchmen last (distributes outward as centre fills).
  const PRIORITY: MilitaryRole[] = ['citadel', 'arsenal', 'barracks', 'watchmen_precinct'];
  const priorityEligible = PRIORITY.filter(r => eligible.includes(r));
  if (priorityEligible.length === 0) return;

  const typeList: MilitaryRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(priorityEligible[i % priorityEligible.length]);
  }

  // ── Precompute temple landmark sites for arsenal's templeBoost ───────────
  // [Voronoi-polygon] Euclidean distance from polygon site to nearest temple.
  const templeSites: [number, number][] = landmarks
    .filter(lm => lm.type === 'temple')
    .map(lm => polygons[lm.polygonId]?.site ?? [CANVAS_CX, CANVAS_CY]);

  function templeBoost(site: [number, number]): number {
    if (templeSites.length === 0) return 0;
    let minDist2 = Infinity;
    for (const [tx, ty] of templeSites) {
      const d2 = (site[0] - tx) ** 2 + (site[1] - ty) ** 2;
      if (d2 < minDist2) minDist2 = d2;
    }
    return 1 / (1 + minDist2 / 10_000); // ~0.5 at 100 px away
  }

  // ── Gate midpoints for barracks' gateScore ──────────────────────────────
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

  // ── Water edge distance for arsenal's waterBoost ────────────────────────
  // Mirrors `waterEdgeDist` from cityMapSFHQuarters.ts. Only contributes when
  // env.waterSide is set (coastal) or hasRiver is true with a derivable side.
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
    return 1 / (1 + dist / 50); // ~0.5 at 50 px from the water edge
  }

  // ── Build the candidate list over residential-block polygons ────────────
  type Candidate = {
    polygonId: number;
    blockIndex: number;
    centerScore: number;
    gateScore: number;
    templeBoost: number;
    waterBoost: number;
  };

  const candidates: Candidate[] = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.role !== 'residential') continue;
    for (const pid of block.polygonIds) {
      const p = polygons[pid];
      if (!p || p.isEdge) continue;
      const [px, py] = p.site;
      const dist2 = (px - CANVAS_CX) ** 2 + (py - CANVAS_CY) ** 2;
      candidates.push({
        polygonId: pid,
        blockIndex: bi,
        centerScore: 1 / (1 + dist2 / 10_000),
        gateScore: gateScore(p.site),
        templeBoost: templeBoost(p.site),
        waterBoost: waterBoost(p.site),
      });
    }
  }
  if (candidates.length === 0) return;

  // Sorted lists per role, each descending on that role's bias. Stable tie-
  // break on polygon id keeps output seed-deterministic across the four lists.
  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;

  const citadelList = candidates.slice().sort(
    (a, b) => b.centerScore - a.centerScore || idTieBreak(a, b),
  );
  const arsenalList = candidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.templeBoost + b.waterBoost) -
      (a.centerScore + a.templeBoost + a.waterBoost) ||
      idTieBreak(a, b),
  );
  // Barracks: gate adjacency primary, center as fallback when unwalled.
  const barracksList = candidates.slice().sort(
    (a, b) =>
      (gateMidpoints.length > 0 ? b.gateScore - a.gateScore : b.centerScore - a.centerScore) ||
      idTieBreak(a, b),
  );
  const watchList = candidates.slice().sort(
    (a, b) => b.centerScore - a.centerScore || idTieBreak(a, b),
  );

  function listFor(role: MilitaryRole): Candidate[] {
    switch (role) {
      case 'citadel': return citadelList;
      case 'arsenal': return arsenalList;
      case 'barracks': return barracksList;
      case 'watchmen_precinct': return watchList;
    }
  }

  // ── Assign roles — greedy pick with shared used-polygon set ─────────────
  const usedPolygonIds = new Set<number>();
  let militaryBlockCount = 0;

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
    if (pickedPolygonId === -1) break; // pool exhausted

    usedPolygonIds.add(pickedPolygonId);

    // Remove the polygon from its source residential block. The block may
    // become empty — harmless for downstream consumers that iterate polygonIds.
    const srcBlock = blocks[pickedBlockIndex];
    srcBlock.polygonIds = srcBlock.polygonIds.filter(pid => pid !== pickedPolygonId);

    // Push a new 1-polygon military block.
    const names = MIL_NAMES[role];
    blocks.push({
      polygonIds: [pickedPolygonId],
      role,
      name: names[militaryBlockCount % names.length],
    });
    militaryBlockCount++;
  }
}
