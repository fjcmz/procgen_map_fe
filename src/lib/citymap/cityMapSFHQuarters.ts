// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Scholarship / Faith / Health quarter assignment
// ─────────────────────────────────────────────────────────────────────────────
// [Voronoi-polygon] Post-pass that extracts polygons from the already-classified
// block graph and reclassifies them as one of five SFH district types drawn from
// `specs/City_districts_catalog.md`:
//
//   temple_quarter  — faith: concentration of religious buildings near temples
//   necropolis      — faith/morbid: burial ground, exterior block
//   academia        — scholarship: colleges / libraries, interior
//   plague_ward     — health: quarantine hospital, exterior, near water
//   archive_quarter — scholarship: records / chancery, interior, capital only
//
// Pattern mirrors `assignCraftRoles` in `cityMapBlocks.ts`:
//   • Extract single polygons from existing blocks (residential / agricultural / slum)
//   • Remove the polygon from its source block (block.polygonIds shrinks)
//   • Push a new 1-polygon block with the SFH role
//   • Block-partition invariant is preserved — every polygon stays in exactly one block
//
// Call order in `cityMapGeneratorV2.ts`:
//   generateBlocks → assignCraftRoles → generateLandmarks → assignSFHRoles → generateBuildings
//
// Called AFTER `generateLandmarks` so temple positions can bias `temple_quarter`
// placement. Called BEFORE `generateBuildings` so the building packer sees the
// updated roles (interior SFH roles are in PACKING_ROLES in cityMapBuildings.ts).
//
// Invariants:
//   • No Math.random() — always seededPRNG(`${seed}_city_${cityName}_sfh`)
//   • No import of cityMapEdgeGraph.ts — placement uses Euclidean site distances
//   • Naming is deterministic (sfhBlockCount % names.length), zero RNG consumed
//   • necropolis and plague_ward are exterior — buildings.ts skips them (not in PACKING_ROLES)
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityBlockV2, CityEnvironment, CityLandmarkV2, CityPolygon, CitySize, DistrictRole } from './cityMapTypesV2';

type SFHRole = 'temple_quarter' | 'necropolis' | 'academia' | 'plague_ward' | 'archive_quarter';

// ── Interior vs exterior placement classification ───────────────────────────
// Interior types are sourced from `residential` blocks (inside the city walls).
// Exterior types are sourced from `agricultural` and `slum` blocks (outside).
const INTERIOR_SFH: ReadonlySet<SFHRole> = new Set<SFHRole>([
  'temple_quarter', 'academia', 'archive_quarter',
]);

// ── Count ranges by city size ───────────────────────────────────────────────
const SFH_COUNT_RANGE: Record<CitySize, [number, number]> = {
  small:       [0, 1],
  medium:      [0, 2],
  large:       [1, 3],
  metropolis:  [2, 5],
  megalopolis: [4, 8],
};

// ── Medieval / historical flavour names per SFH role ───────────────────────
// Picked deterministically by `(sfhBlockCount % names.length)` — no RNG consumed.
const SFH_NAMES: Record<SFHRole, string[]> = {
  temple_quarter:  ['PRIORY CLOSE', 'ABBEY LANE', 'MINSTER ROW', 'CLOISTER YARD', 'MONKS QUARTER'],
  necropolis:      ['BONEYARD', 'CHARNEL CLOSE', 'BARROW FIELDS', 'MAUSOLEUM ROW', 'POTTERS FIELD'],
  academia:        ['SCHOLARS ROW', 'COLLEGE CLOSE', 'SCRIPTORIUM YARD', 'LIBRARY LANE', 'UNIVERSITY CLOSE'],
  plague_ward:     ['LAZAR CLOSE', 'PEST HOUSE ROW', 'QUARANTINE YARD', 'INFIRMARY LANE', 'SANCTUM QUARTER'],
  archive_quarter: ['CHANCERY CLOSE', 'RECORDS ROW', 'SCRIBES YARD', 'ANNALS LANE', 'REGISTRY CLOSE'],
};

// ── Source block roles per placement class ──────────────────────────────────
const INTERIOR_SOURCE_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>(['residential']);
const EXTERIOR_SOURCE_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>(['agricultural', 'slum']);

// ── Canvas geometry ─────────────────────────────────────────────────────────
const CANVAS_CX = 500;
const CANVAS_CY = 500;
const CANVAS_SIZE = 1000;

// ── Eligibility ─────────────────────────────────────────────────────────────
function eligibleSFHTypes(env: CityEnvironment): SFHRole[] {
  const types: SFHRole[] = ['necropolis']; // any size
  if (env.religionCount >= 2 && env.size !== 'small') types.push('temple_quarter');
  if (env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis') {
    types.push('academia');
    if (env.isCoastal || env.hasRiver) types.push('plague_ward');
    if (env.isCapital) types.push('archive_quarter');
  }
  return types;
}

/**
 * Extract individual polygons from `residential`, `agricultural`, and `slum`
 * blocks and re-wrap each as a new 1-polygon scholarship / faith / health
 * district. Mutates the `blocks` array in-place (shrinks source blocks, appends
 * new SFH blocks). The overall block partition invariant is preserved.
 *
 * Called after `generateLandmarks` (so temple sites are available for
 * `temple_quarter` placement bias) and before `generateBuildings`.
 */
export function assignSFHRoles(
  blocks: CityBlockV2[],
  env: CityEnvironment,
  polygons: CityPolygon[],
  landmarks: CityLandmarkV2[],
  seed: string,
  cityName: string,
): void {
  const rng = seededPRNG(`${seed}_city_${cityName}_sfh`);

  // ── Eligibility ─────────────────────────────────────────────────────────
  const eligible = eligibleSFHTypes(env);
  if (eligible.length === 0) return;

  const [minCount, maxCount] = SFH_COUNT_RANGE[env.size];
  if (maxCount === 0) return;

  const count = minCount + Math.floor(rng() * (maxCount - minCount + 1));
  if (count === 0) return;

  // ── Shuffle eligible types (seeded Fisher-Yates) ────────────────────────
  const shuffled = eligible.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Build type assignment list — cycle eligible types if count exceeds pool.
  const typeList: SFHRole[] = [];
  for (let i = 0; i < count; i++) {
    typeList.push(shuffled[i % shuffled.length]);
  }

  // ── Precompute temple landmark sites for temple_quarter bias ────────────
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
    return 1 / (1 + minDist2 / 10_000); // normalised so 100px away ≈ 0.5 boost
  }

  // ── Water-edge distance for plague_ward ─────────────────────────────────
  // Use the canvas-edge in env.waterSide direction. Falls back to 0 (no bias)
  // when waterSide is null (city has river but no coastal side).
  function waterEdgeDist(site: [number, number]): number {
    const [sx, sy] = site;
    switch (env.waterSide) {
      case 'north': return sy;                      // smaller = closer to top
      case 'south': return CANVAS_SIZE - sy;
      case 'east':  return CANVAS_SIZE - sx;
      case 'west':  return sx;
      default:      return Math.hypot(sx - CANVAS_CX, sy - CANVAS_CY); // centre fallback
    }
  }

  // ── Build candidate lists ───────────────────────────────────────────────
  // [Voronoi-polygon] One candidate entry per eligible polygon in source blocks.
  // isEdge polygons are excluded — they belong to the outside-walls sprawl layer.

  type InteriorCandidate = {
    polygonId: number;
    blockIndex: number;
    centerScore: number;   // higher = closer to canvas centre
    templeBoost: number;   // extra score for temple_quarter
  };

  type ExteriorCandidate = {
    polygonId: number;
    blockIndex: number;
    centerDist: number;    // distance from centre — higher = farther (necropolis)
    waterScore: number;    // higher = closer to water edge (plague_ward)
  };

  const interiorCandidates: InteriorCandidate[] = [];
  const exteriorCandidates: ExteriorCandidate[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (INTERIOR_SOURCE_ROLES.has(block.role)) {
      for (const pid of block.polygonIds) {
        const p = polygons[pid];
        if (!p || p.isEdge) continue;
        const [px, py] = p.site;
        const dist2 = (px - CANVAS_CX) ** 2 + (py - CANVAS_CY) ** 2;
        interiorCandidates.push({
          polygonId: pid,
          blockIndex: bi,
          centerScore: 1 / (1 + dist2 / 10_000),
          templeBoost: templeBoost(p.site),
        });
      }
    } else if (EXTERIOR_SOURCE_ROLES.has(block.role)) {
      for (const pid of block.polygonIds) {
        const p = polygons[pid];
        if (!p || p.isEdge) continue;
        const [px, py] = p.site;
        exteriorCandidates.push({
          polygonId: pid,
          blockIndex: bi,
          centerDist: Math.hypot(px - CANVAS_CX, py - CANVAS_CY),
          waterScore: 1 / (1 + waterEdgeDist(p.site) / 50), // 50px ≈ 0.5 score
        });
      }
    }
  }

  // Sort interior candidates: temple_quarter uses (centerScore + templeBoost)
  // descending; for other interior types (academia, archive_quarter) sort by
  // centerScore descending — prefer central polygons (unlike craft's outskirt-first).
  // Stable polygon-id tie-break in all cases.
  interiorCandidates.sort((a, b) =>
    (b.centerScore + b.templeBoost) - (a.centerScore + a.templeBoost) || a.polygonId - b.polygonId
  );

  // Sort exterior candidates by necropolis preference (farthest from centre)
  // as the primary key. plague_ward re-ranks at pick time via waterScore.
  exteriorCandidates.sort((a, b) =>
    b.centerDist - a.centerDist || a.polygonId - b.polygonId
  );

  // plague_ward sorted list — near water edge preferred.
  const plagueWardCandidates = exteriorCandidates.slice().sort(
    (a, b) => b.waterScore - a.waterScore || a.polygonId - b.polygonId
  );

  // ── Assign SFH roles — one polygon per slot ─────────────────────────────
  const usedPolygonIds = new Set<number>();
  let sfhBlockCount = 0;

  for (const type of typeList) {
    const isInterior = INTERIOR_SFH.has(type);
    let pickedPolygonId = -1;
    let pickedBlockIndex = -1;

    if (isInterior) {
      for (const c of interiorCandidates) {
        if (!usedPolygonIds.has(c.polygonId)) {
          pickedPolygonId = c.polygonId;
          pickedBlockIndex = c.blockIndex;
          break;
        }
      }
    } else if (type === 'plague_ward') {
      for (const c of plagueWardCandidates) {
        if (!usedPolygonIds.has(c.polygonId)) {
          pickedPolygonId = c.polygonId;
          pickedBlockIndex = c.blockIndex;
          break;
        }
      }
    } else {
      // necropolis — prefer farthest from centre (already sorted that way)
      for (const c of exteriorCandidates) {
        if (!usedPolygonIds.has(c.polygonId)) {
          pickedPolygonId = c.polygonId;
          pickedBlockIndex = c.blockIndex;
          break;
        }
      }
    }

    if (pickedPolygonId === -1) break; // pool exhausted

    usedPolygonIds.add(pickedPolygonId);

    // Remove the polygon from its source block. The block may become empty —
    // that is harmless (downstream consumers iterate polygonIds).
    const srcBlock = blocks[pickedBlockIndex];
    srcBlock.polygonIds = srcBlock.polygonIds.filter(pid => pid !== pickedPolygonId);

    // Push a new 1-polygon SFH block.
    const names = SFH_NAMES[type];
    blocks.push({
      polygonIds: [pickedPolygonId],
      role: type,
      name: names[sfhBlockCount % names.length],
    });
    sfhBlockCount++;
  }
}
