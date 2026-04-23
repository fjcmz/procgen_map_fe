// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Trade & Finance quarter assignment
// ─────────────────────────────────────────────────────────────────────────────
// [Voronoi-polygon] Post-pass that extracts polygons from the already-classified
// block graph and reclassifies them as one of four trade & finance district
// types drawn from `specs/City_districts_catalog.md` §2:
//
//   foreign_quarter — fondaco / enclave for non-local merchants (needs water)
//   caravanserai    — walled inn + stables + warehouse for overland traders
//   bankers_row     — counting houses, bourses, letters of credit
//   warehouse_row   — bonded storage, customs sheds, tally yards
//
// Pattern mirrors `assignMilitaryRoles` in `cityMapMilitaryQuarters.ts` and
// `assignSFHRoles` / `assignCraftRoles`:
//   • Extract single polygons from existing residential blocks
//   • Remove the polygon from its source block (block.polygonIds shrinks)
//   • Push a new 1-polygon block with the trade/finance role
//   • Block-partition invariant is preserved — every polygon stays in exactly
//     one block after the pass.
//
// Call order in `cityMapGeneratorV2.ts`:
//   generateBlocks → assignCraftRoles → generateLandmarks → assignSFHRoles
//   → assignMilitaryRoles → assignTradeFinanceRoles → generateBuildings
//
// Called AFTER `assignMilitaryRoles` so citadel / arsenal polygons have
// already been consumed (bankers_row and military citadel both compete for
// the most central interior polygon; we want the citadel to win first). Also
// called AFTER `generateLandmarks` so monument sites (city wonders) are
// available for bankers_row's wonder bias, and BEFORE `generateBuildings` so
// the packer picks up the new interior trade/finance roles via PACKING_ROLES.
//
// Placement biases (per user request: "biased towards the centre and markets
// and wonders of the city, and close to water for those quarters that need it"):
//   foreign_quarter — centerScore + marketBoost + waterBoost (water-requiring)
//   caravanserai    — gateScore + centerScore × 0.5 (road-anchored)
//   bankers_row     — centerScore + monumentBoost (central, near wonders)
//   warehouse_row   — marketBoost + centerScore × 0.5 (utility, near markets)
//
// Invariants:
//   • No Math.random() — always seededPRNG(`${seed}_city_${cityName}_trade_finance`)
//   • No import of cityMapEdgeGraph.ts — placement uses Euclidean site
//     distances + gate-midpoint / market / monument / water-edge proxies only
//   • Naming is deterministic (tfBlockCount % names.length), no RNG consumed
//   • All four roles are INTERIOR — sourced from `residential` blocks. No
//     exterior sourcing, so the sprawl generator is unaffected.
//   • Priority order for type assignment is `[bankers_row, foreign_quarter,
//     warehouse_row, caravanserai]` (cycled), so bankers_row always gets
//     first pick of the most central polygon.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
  CitySize,
} from './cityMapTypesV2';

type TradeFinanceRole = 'foreign_quarter' | 'caravanserai' | 'bankers_row' | 'warehouse_row';

type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

// Local structural type so this file does not depend on `cityMapWalls.ts`
// internals. Matches the shape produced by `generateWallsAndGates`.
type GateLike = { edge: [[number, number], [number, number]] };

// ── Count ranges by city size (user spec) ──────────────────────────────────
const TF_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 2],
  metropolis:  [2, 5],
  megalopolis: [4, 7],
};

// ── Medieval / mercantile flavour names per role ──────────────────────────
// Picked deterministically by `(tfBlockCount % names.length)`.
const TF_NAMES: Record<TradeFinanceRole, string[]> = {
  foreign_quarter: ['FONDACO', 'FOREIGN ROW', 'EMBASSY CLOSE', 'CONSUL QUARTER', 'STRANGERS YARD'],
  caravanserai:    ['CARAVANSERAI', 'STABLES YARD', 'PACKSADDLE ROW', 'WAGONERS CLOSE', 'DROVERS LANE'],
  bankers_row:     ['BANKERS ROW', 'COUNTING HOUSE', 'BOURSE YARD', 'EXCHEQUER CLOSE', 'MINT QUARTER'],
  warehouse_row:   ['WAREHOUSE ROW', 'BONDED YARD', 'CUSTOMS CLOSE', 'STOREHOUSE LANE', 'TALLY YARD'],
};

// ── Canvas geometry ─────────────────────────────────────────────────────────
const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ── Eligibility ─────────────────────────────────────────────────────────────
// Gates role availability by size + env water + capital signals. No resource
// plumbing (by design — city-map layer works from env proxies only).
function eligibleTradeFinanceTypes(env: CityEnvironment, gatesCount: number): TradeFinanceRole[] {
  const types: TradeFinanceRole[] = [];
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  const isMediumOrUp = env.size !== 'small';

  // Bankers row: large+ only — counting houses are a big-city institution.
  if (isLargeOrUp) types.push('bankers_row');

  // Foreign quarter: large+ coastal/river cities only — needs water access
  // for merchant traffic (fondaco = Venetian sea-trade enclave).
  if (isLargeOrUp && (env.isCoastal || env.hasRiver)) types.push('foreign_quarter');

  // Warehouse row: medium+ — bonded storage / customs sheds.
  if (isMediumOrUp) types.push('warehouse_row');

  // Caravanserai: medium+ with at least one gate — anchored on road traffic.
  if (isMediumOrUp && gatesCount > 0) types.push('caravanserai');

  // Small-city fallback: allow a lone warehouse_row so small cities can
  // still roll up to 1 trade/finance quarter per the user's 0–1 count range.
  if (types.length === 0 && env.size === 'small') {
    types.push('warehouse_row');
  }
  return types;
}

/**
 * Extract individual polygons from `residential` blocks and re-wrap each as a
 * new 1-polygon trade & finance district. Mutates the `blocks` array in-place
 * (shrinks source blocks, appends new trade/finance blocks). The overall
 * block partition invariant is preserved.
 */
export function assignTradeFinanceRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  landmarks: CityLandmarkV2[],
  openSpaces: OpenSpaceEntry[],
  gates: GateLike[],
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_trade_finance`);

  // ── Eligibility ─────────────────────────────────────────────────────────
  const eligible = eligibleTradeFinanceTypes(env, gates.length);
  if (eligible.length === 0) return;

  const [minCount, maxCount] = TF_COUNT_RANGE[env.size];
  if (maxCount === 0) return;

  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return;

  // ── Priority-ordered type list (fixed, not shuffled) ────────────────────
  // Bankers row first so it gets first pick of the most central polygon.
  // Foreign quarter second (water + central). Warehouse row third (near
  // market). Caravanserai last (gate adjacency, naturally edgy).
  const PRIORITY: TradeFinanceRole[] = ['bankers_row', 'foreign_quarter', 'warehouse_row', 'caravanserai'];
  const priorityEligible = PRIORITY.filter(r => eligible.includes(r));
  if (priorityEligible.length === 0) return;

  const typeList: TradeFinanceRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(priorityEligible[i % priorityEligible.length]);
  }

  // ── Precompute market open-space sites for marketBoost ──────────────────
  // [Voronoi-polygon] Sites of every polygon referenced by a `market`
  // open-space entry. Markets are the primary commercial anchors on the
  // city map — trade/finance districts cluster around them per the user's
  // "biased towards markets" directive.
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
    return 1 / (1 + minDist2 / 10_000); // ~0.5 at 100 px away
  }

  // ── Precompute monument landmark sites for monumentBoost ────────────────
  // [Voronoi-polygon] Monuments on the city canvas = wonders on the world
  // map (cityMapLandmarks.ts maps env.wonderCount → monument landmarks).
  // Used for bankers_row's "biased towards wonders" directive.
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

  // ── Gate midpoints for caravanserai's gateScore ─────────────────────────
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

  // ── Water-edge proximity for foreign_quarter's waterBoost ───────────────
  // Mirrors the pattern in cityMapMilitaryQuarters.ts arsenal waterBoost.
  // Only contributes when env.waterSide is set (coastal) or hasRiver is
  // true with a derivable side.
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
    marketBoost: number;
    monumentBoost: number;
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
        marketBoost: marketBoost(p.site),
        monumentBoost: monumentBoost(p.site),
        waterBoost: waterBoost(p.site),
      });
    }
  }
  if (candidates.length === 0) return;

  // Sorted lists per role, each descending on that role's bias. Stable tie-
  // break on polygon id keeps output seed-deterministic across the lists.
  const idTieBreak = (a: Candidate, b: Candidate) => a.polygonId - b.polygonId;

  const bankersList = candidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.monumentBoost) -
      (a.centerScore + a.monumentBoost) ||
      idTieBreak(a, b),
  );
  const foreignList = candidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.marketBoost + b.waterBoost) -
      (a.centerScore + a.marketBoost + a.waterBoost) ||
      idTieBreak(a, b),
  );
  const warehouseList = candidates.slice().sort(
    (a, b) =>
      (b.marketBoost + b.centerScore * 0.5) -
      (a.marketBoost + a.centerScore * 0.5) ||
      idTieBreak(a, b),
  );
  const caravanList = candidates.slice().sort(
    (a, b) =>
      (b.gateScore + b.centerScore * 0.5) -
      (a.gateScore + a.centerScore * 0.5) ||
      idTieBreak(a, b),
  );

  function listFor(role: TradeFinanceRole): Candidate[] {
    switch (role) {
      case 'bankers_row': return bankersList;
      case 'foreign_quarter': return foreignList;
      case 'warehouse_row': return warehouseList;
      case 'caravanserai': return caravanList;
    }
  }

  // ── Assign roles — greedy pick with shared used-polygon set ─────────────
  const usedPolygonIds = new Set<number>();
  let tfBlockCount = 0;

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

    // Push a new 1-polygon trade/finance block.
    const names = TF_NAMES[role];
    blocks.push({
      polygonIds: [pickedPolygonId],
      role,
      name: names[tfBlockCount % names.length],
    });
    tfBlockCount++;
  }
}
