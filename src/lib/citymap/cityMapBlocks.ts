// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — block builder + name combiner (specs/City_districts_redux.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Exports:
//   buildBlocksFromDistricts — groups same-DistrictType polygons into named
//     CityBlockNewV2 clusters via polygon-adjacency BFS.
//   pickProceduralName — medieval prefix+suffix name combiner, exported so
//     future district features can generate names without re-importing the
//     word lists.
//
// NO tile lattice. NO Math.random. RNG: dedicated `_blocks_districts_names`
// stream for the name combiner (prefix + suffix).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type {
  CityBlockNewV2,
  CityPolygon,
  DistrictType,
} from './cityMapTypesV2';

// Name combiner: retry attempts before falling back to a numeric DISTRICT N.
const NAME_MAX_ATTEMPTS = 12;
// Probability of inserting a space between prefix + suffix (else concatenate).
const NAME_SPACE_JOINER_PROB = 0.35;

// ─── Medieval name combiner ────────────────────────────────────────────────
// Ported verbatim from V1 `cityMapGenerator.ts:956-969`. Pure text flavor
// data — the tile-based V1 flood algorithm is NOT ported; only the
// word lists and the attempt-retry-fallback naming shape carry over.

const NAME_PREFIXES = [
  'ELM', 'OAK', 'ASH', 'ROSE', 'BRIAR', 'THORN',
  'BLUE', 'RED', 'GOLD', 'GREEN', 'WHITE', 'BLACK', 'SILVER', 'COPPER', 'IRON',
  'OLD', 'NEW', 'HIGH', 'LOW', 'FAR',
  'STONE', 'BRICK', 'GLASS', 'BREAD', 'SALT', 'WINE', 'CORN',
  'KING', 'QUEEN', 'BISHOP', 'ABBEY', 'GUILD',
];

const SUFFIXES_CIVIC = ['CROSS', 'COURT', 'SQUARE', 'GATE'];
const SUFFIXES_MARKET = ['MARKET', 'CROSS', 'SQUARE', 'ROW'];
const SUFFIXES_HARBOR = ['DOCKS', 'QUAY', 'WHARF', 'BANK'];
const SUFFIXES_RESIDENTIAL = ['LANE', 'ROW', 'END', 'HOLM', 'SIDE', 'YARD', 'HILL', 'HEATH', 'GATE'];
const SUFFIXES_SLUM = ['ROW', 'END', 'HEATH', 'LANE', 'SIDE'];
const SUFFIXES_AGRI = ['FIELDS', 'CROFT', 'MEADOW', 'ACRES'];

// ─── Phase 6: DistrictType-keyed block builder ─────────────────────────────
// specs/City_districts_redux.md Phase 6 — "Slim cityMapBlocks.ts to
// buildBlocksFromDistricts plus exported pickProceduralName."
//
// Takes `_districtsNew: DistrictType[]` (one entry per polygon, from Phase 5's
// `assignDistricts`) and groups polygons into connected same-district components.
// Water and unabsorbed-mountain polygon ids are excluded: `assignDistricts`
// writes the sentinel `'residential_medium'` for them, and that sentinel must
// never produce a named block.
//
// RNG stream: `${seed}_city_${cityName}_blocks_districts_names` — independent
// from `_blocks_names` so these new blocks don't shift existing block names.

const SUFFIXES_DISTRICT: Record<DistrictType, string[]> = {
  civic:              SUFFIXES_CIVIC,
  market:             SUFFIXES_MARKET,
  harbor:             SUFFIXES_HARBOR,
  dock:               ['WHARF', 'QUAY', 'DOCK', 'PIER', 'BERTH'],
  residential_high:   [...SUFFIXES_RESIDENTIAL, 'HEIGHTS', 'MANOR', 'COURT'],
  residential_medium: SUFFIXES_RESIDENTIAL,
  residential_low:    [...SUFFIXES_SLUM, 'ROW', 'END'],
  industry:           ['WORKS', 'YARD', 'FORGE', 'MILL', 'TANNERY', 'QUARTER'],
  education_faith:    ['ABBEY', 'COLLEGE', 'QUARTER', 'CLOSE', 'PRIORY'],
  military:           ['KEEP', 'BARRACKS', 'QUARTER', 'FORT', 'GARRISON'],
  trade:              ['EXCHANGE', 'WHARF', 'QUARTER', 'ROW', 'BAZAAR'],
  entertainment:      ['WALK', 'GARDENS', 'QUARTER', 'CIRCUS', 'ARCADE'],
  excluded:           [...SUFFIXES_SLUM, 'YARD', 'CLOSE'],
  slum:               SUFFIXES_SLUM,
  agricultural:       SUFFIXES_AGRI,
};

/**
 * Pick a procedural medieval name for a block whose district type is `role`.
 *
 * Same shape as the private `generateBlockName` (prefix + optional space +
 * suffix, up to 12 retries, `DISTRICT N` fallback) but keyed on `DistrictType`
 * so Phase 6 `_blocksNew` blocks get district-appropriate flavour names.
 *
 * @param role  - District type that selects the suffix list.
 * @param rng   - Seeded PRNG; caller owns the stream.
 * @param used  - Set of already-used names; updated in-place on success.
 * @param index - Block index used only in the `DISTRICT N` fallback.
 */
export function pickProceduralName(
  role: DistrictType,
  rng: () => number,
  used: Set<string>,
  index: number,
): string {
  const suffixes = SUFFIXES_DISTRICT[role];
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
  const fallback = `DISTRICT ${index + 1}`;
  used.add(fallback);
  return fallback;
}

/**
 * Build `CityBlockNewV2[]` by flood-filling the polygon adjacency graph and
 * grouping polygons that share the same `DistrictType` into connected
 * components. Each component becomes one named block.
 *
 * Water and unabsorbed-mountain polygons are skipped entirely: they carry the
 * sentinel district `'residential_medium'` from `assignDistricts` and must
 * not appear in any block.
 *
 * Called in `cityMapGeneratorV2.ts` after `assignDistricts`. Output lands in
 * `_blocksNew` on the return literal; `generateBuildings` and `generateSprawl`
 * consume it in Phase 6, and Phase 7 promotes it over `blocks`.
 */
export function buildBlocksFromDistricts(
  seed: string,
  cityName: string,
  polygons: CityPolygon[],
  districtsNew: DistrictType[],
  waterPolygonIds: Set<number>,
  mountainPolygonIds: Set<number>,
): CityBlockNewV2[] {
  if (polygons.length < 4 || districtsNew.length === 0) return [];

  const rng = seededPRNG(`${seed}_city_${cityName}_blocks_districts_names`);
  const usedNames = new Set<string>();
  const visited = new Set<number>();
  const blocks: CityBlockNewV2[] = [];

  for (let startId = 0; startId < polygons.length; startId++) {
    if (visited.has(startId)) continue;
    if (waterPolygonIds.has(startId) || mountainPolygonIds.has(startId)) {
      visited.add(startId);
      continue;
    }

    const role = districtsNew[startId];
    const component: number[] = [];
    const queue: number[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const nb of polygons[curr].neighbors) {
        if (visited.has(nb)) continue;
        if (waterPolygonIds.has(nb) || mountainPolygonIds.has(nb)) {
          visited.add(nb);
          continue;
        }
        if (districtsNew[nb] === role) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    blocks.push({
      polygonIds: component,
      role,
      name: pickProceduralName(role, rng, usedNames, blocks.length),
    });
  }

  return blocks;
}
