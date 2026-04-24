// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Excluded / outcast quarter assignment
// ─────────────────────────────────────────────────────────────────────────────
// [Voronoi-polygon] Post-pass that extracts polygons from the already-classified
// block graph and reclassifies them as one of three excluded / outcast district
// types drawn from `specs/City_districts_catalog.md` §2 (lines 86-93):
//
//   ghetto        — walled minority quarter, religious/ethnic enclave gated
//                   at night (INTERIOR — large+ with env.religionCount >= 2)
//   workhouse     — institutional poverty: almshouses, charity kitchens
//                   (INTERIOR — large+)
//   gallows_hill  — legal-death space: scaffold, gibbet cages, potters' field
//                   (EXTERIOR — sourced from agricultural/slum blocks, no
//                   building packing, no district icon)
//
// Pattern mirrors `assignEntertainmentRoles` in `cityMapEntertainmentQuarters.ts`
// and the other sister assigners (craft / SFH / military / trade):
//   • Extract single polygons from existing residential blocks (ghetto,
//     workhouse) or agricultural/slum blocks (gallows_hill)
//   • Remove the polygon from its source block (block.polygonIds shrinks)
//   • Push a new 1-polygon block with the excluded role
//   • Block-partition invariant is preserved — every polygon stays in exactly
//     one block after the pass.
//
// Call order in `cityMapGeneratorV2.ts`:
//   generateBlocks → assignCraftRoles → generateLandmarks → assignSFHRoles
//   → assignMilitaryRoles → assignTradeFinanceRoles → assignEntertainmentRoles
//   → assignExcludedRoles → generateBuildings
//
// Called LAST among the assigners so it doesn't steal civic / market /
// military / trade / entertainment picks. Called AFTER `generateLandmarks`
// so monument sites (city wonders) are available for workhouse's wonder
// bias, and BEFORE `generateBuildings` so the packer picks up the new
// interior excluded roles via PACKING_ROLES.
//
// Placement biases (per user request: "biased towards the centre and markets
// and wonders of the city, and close to water for those quarters that need it"):
//   ghetto       — centerScore + marketBoost + waterBoost × 0.5
//                  (Venice-style walled enclave, historically near commerce
//                  and often on or near water)
//   workhouse    — centerScore + monumentBoost × 0.3 + waterBoost × 0.5
//                  (institutional civic core with labour/water needs —
//                  almshouses ran laundries and kitchens)
//   gallows_hill — closest exterior polygon to canvas centre (just-outside-
//                  the-walls hill, mirrors festival_grounds' exterior rule)
//
// Count ranges by size (user spec):
//   small:0, medium:0-1, large:1-2, metropolis:1-3, megalopolis:2-5
// At medium size only `gallows_hill` is eligible, so medium cities with
// count=1 always get exactly one gallows_hill — matches spec intent that
// execution grounds exist even in smaller towns.
//
// Invariants:
//   • No Math.random() — always seededPRNG(`${seed}_city_${cityName}_excluded`)
//   • No import of cityMapEdgeGraph.ts — placement uses Euclidean site
//     distances + market / monument / water-edge proxies only
//   • Naming is deterministic (excBlockCount % names.length), no RNG consumed
//   • Two roles are INTERIOR (sourced from `residential` blocks); the third
//     `gallows_hill` is EXTERIOR (sourced from `agricultural` / `slum`
//     blocks) and lives outside PACKING_ROLES — same precedent as
//     `festival_grounds` / `necropolis` / `plague_ward`.
//   • Priority order for type assignment is `[ghetto, workhouse, gallows_hill]`
//     (cycled), so the central / market-anchored picks happen before the
//     exterior one.
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

type ExcludedRole = 'ghetto' | 'workhouse' | 'gallows_hill';

type OpenSpaceEntry = CityMapDataV2['openSpaces'][number];

// ── Count ranges by city size (user spec) ──────────────────────────────────
const EXCLUDED_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 0],
  medium:      [0, 1],
  large:       [1, 2],
  metropolis:  [1, 3],
  megalopolis: [2, 5],
};

// ── Medieval / somber flavour names per role ───────────────────────────────
// Picked deterministically by `(excBlockCount % names.length)`.
const EXCLUDED_NAMES: Record<ExcludedRole, string[]> = {
  ghetto:       ['GHETTO', 'OUTCAST QUARTER', 'WALLED ENCLAVE', 'STRANGERS CLOSE', 'IRON GATE ROW'],
  workhouse:    ['WORKHOUSE', 'POORHOUSE YARD', 'ALMS HALL', 'LABOUR CLOSE', 'PAUPERS ROW'],
  gallows_hill: ['GALLOWS HILL', 'GIBBET MOUND', 'EXECUTION GROUND', 'HANGMANS KNOLL', 'RAVENS FIELD'],
};

// ── Canvas geometry ─────────────────────────────────────────────────────────
const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ── Eligibility ─────────────────────────────────────────────────────────────
// Gates role availability by size + religionCount signal.
function eligibleExcludedTypes(env: CityEnvironment): ExcludedRole[] {
  const types: ExcludedRole[] = [];
  const isLargeOrUp = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  const isMediumOrUp = env.size !== 'small';

  // Ghetto: large+ AND at least two religions present — walled enclaves for
  // religious minorities require a dominant faith AND a dissenting one.
  if (isLargeOrUp && env.religionCount >= 2) types.push('ghetto');

  // Workhouse: large+ — institutional poverty is a big-city phenomenon.
  if (isLargeOrUp) types.push('workhouse');

  // Gallows hill: medium+ — needs an exterior block to live on. The spec
  // places these on the fringe ("Exterior block, a single landmark inside an
  // otherwise unremarkable slum"). Small cities skip entirely.
  if (isMediumOrUp) types.push('gallows_hill');

  return types;
}

/**
 * Extract individual polygons from `residential` blocks (ghetto, workhouse)
 * and `agricultural` / `slum` blocks (gallows_hill) and re-wrap each as a new
 * 1-polygon excluded & outcast district. Mutates the `blocks` array in-place
 * (shrinks source blocks, appends new excluded blocks). The overall block
 * partition invariant is preserved.
 */
export function assignExcludedRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  landmarks: CityLandmarkV2[],
  openSpaces: OpenSpaceEntry[],
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_excluded`);

  // ── Eligibility ─────────────────────────────────────────────────────────
  const eligible = eligibleExcludedTypes(env);
  if (eligible.length === 0) return;

  const [minCount, maxCount] = EXCLUDED_COUNT_RANGE[env.size];
  if (maxCount === 0) return;

  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return;

  // ── Priority-ordered type list (fixed, not shuffled) ────────────────────
  // Ghetto first so it gets first pick of the most central residential
  // polygon. Workhouse second (central + monumental). Gallows hill last
  // (exterior, naturally on the fringe).
  const PRIORITY: ExcludedRole[] = ['ghetto', 'workhouse', 'gallows_hill'];
  const priorityEligible = PRIORITY.filter(r => eligible.includes(r));
  if (priorityEligible.length === 0) return;

  const typeList: ExcludedRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(priorityEligible[i % priorityEligible.length]);
  }

  // ── Precompute market open-space sites for marketBoost ──────────────────
  // [Voronoi-polygon] Sites of every polygon referenced by a `market`
  // open-space entry. Used for ghetto's "biased towards markets" contribution.
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
  // Used for workhouse's "biased towards wonders" contribution.
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

  // ── Water-edge proximity for ghetto / workhouse's waterBoost ────────────
  // Mirrors the pattern in cityMapEntertainmentQuarters.ts bathhouse_quarter.
  // Only contributes when env.waterSide is set (coastal) or hasRiver is true
  // with a derivable side.
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
  // Two pools because gallows_hill sources from EXTERIOR (agricultural /
  // slum) blocks while the other two source from `residential`.
  type Candidate = {
    polygonId: number;
    blockIndex: number;
    centerScore: number;
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

  const ghettoList = interiorCandidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.marketBoost + b.waterBoost * 0.5) -
      (a.centerScore + a.marketBoost + a.waterBoost * 0.5) ||
      idTieBreak(a, b),
  );
  const workhouseList = interiorCandidates.slice().sort(
    (a, b) =>
      (b.centerScore + b.monumentBoost * 0.3 + b.waterBoost * 0.5) -
      (a.centerScore + a.monumentBoost * 0.3 + a.waterBoost * 0.5) ||
      idTieBreak(a, b),
  );
  // Gallows hill: closest exterior polygon to the canvas centre — reads as
  // a just-outside-the-walls hill rather than a lost frontier field.
  const gallowsList = exteriorCandidates.slice().sort(
    (a, b) =>
      b.centerScore - a.centerScore ||
      idTieBreak(a, b),
  );

  function listFor(role: ExcludedRole): Candidate[] {
    switch (role) {
      case 'ghetto':       return ghettoList;
      case 'workhouse':    return workhouseList;
      case 'gallows_hill': return gallowsList;
    }
  }

  // ── Assign roles — greedy pick with shared used-polygon set ─────────────
  // Interior and exterior roles share the `usedPolygonIds` set even though
  // they draw from disjoint pools — keeps the contract simple and cheap.
  const usedPolygonIds = new Set<number>();
  let excBlockCount = 0;

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
    // roles, agricultural/slum for gallows_hill). The block may become
    // empty — harmless for downstream consumers that iterate polygonIds.
    const srcBlock = blocks[pickedBlockIndex];
    srcBlock.polygonIds = srcBlock.polygonIds.filter(pid => pid !== pickedPolygonId);

    // Push a new 1-polygon excluded block.
    const names = EXCLUDED_NAMES[role];
    blocks.push({
      polygonIds: [pickedPolygonId],
      role,
      name: names[excBlockCount % names.length],
    });
    excBlockCount++;
  }
}
