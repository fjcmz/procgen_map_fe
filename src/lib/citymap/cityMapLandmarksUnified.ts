// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Phase 2 of specs/City_districts_redux.md
// Unified landmark placer scaffold + alignment table.
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 ships:
//   - LANDMARK_ALIGNMENT: single source of truth grouping every LandmarkKind
//     into one of seven AlignmentGroups. Drives Phase 5's district BFS
//     classifier and Phase 7's renderer label policy.
//   - PlacerContext: argument struct shared by every group placer. Phase 3+
//     fills in bodies as pure body-fills against this fixed signature.
//   - Seven empty placer stubs (one per AlignmentGroup) — Phase 3 fills the
//     `named` group, Phase 4 fills the rest.
//   - placeUnifiedLandmarks: top-level entry point. Calls every placer in
//     fixed order, threading a shared `used: Set<number>` for de-dup
//     (mirrors `cityMapLandmarks.ts`'s 5-pass `used` pattern).
//
// RNG sub-stream convention claimed for Phase 3+:
//   ${seed}_city_${cityName}_unified_<group>
// All RNG must go through `seededPRNG` from `terrain/noise.ts` — no
// `Math.random` anywhere under `src/lib/citymap/`.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CityEnvironment,
  CityPolygon,
  LandmarkKind,
  LandmarkV2,
} from './cityMapTypesV2';
import type { WallGenerationResult } from './cityMapWalls';
import type { PolygonEdgeGraph } from './cityMapEdgeGraph';

export type AlignmentGroup =
  | 'named'
  | 'industrial'
  | 'military'
  | 'faith_aux'
  | 'entertainment'
  | 'trade'
  | 'excluded';

/**
 * Single source of truth mapping each `LandmarkKind` to its alignment group.
 * Exhaustive over `LandmarkKind` — adding a new kind without updating this
 * table is a TypeScript compile-time error.
 */
export const LANDMARK_ALIGNMENT: Record<LandmarkKind, AlignmentGroup> = {
  // Named (Phase 3)
  wonder: 'named',
  palace: 'named',
  castle: 'named',
  civic_square: 'named',
  temple: 'named',
  market: 'named',
  park: 'named',
  // Industrial (Phase 4)
  forge: 'industrial',
  tannery: 'industrial',
  textile: 'industrial',
  potters: 'industrial',
  mill: 'industrial',
  // Military (Phase 4)
  barracks: 'military',
  citadel: 'military',
  arsenal: 'military',
  watchmen: 'military',
  // Faith aux (Phase 4)
  temple_quarter: 'faith_aux',
  necropolis: 'faith_aux',
  plague_ward: 'faith_aux',
  academia: 'faith_aux',
  archive: 'faith_aux',
  // Entertainment (Phase 4)
  theater: 'entertainment',
  bathhouse: 'entertainment',
  pleasure: 'entertainment',
  festival: 'entertainment',
  // Trade (Phase 4)
  foreign_quarter: 'trade',
  caravanserai: 'trade',
  bankers_row: 'trade',
  warehouse: 'trade',
  // Excluded (Phase 4)
  gallows: 'excluded',
  workhouse: 'excluded',
  ghetto_marker: 'excluded',
};

export interface PlacerContext {
  seed: string;
  cityName: string;
  env: CityEnvironment;
  polygons: CityPolygon[];
  candidatePool: Set<number>;
  wall: WallGenerationResult;
  edgeGraph: PolygonEdgeGraph;
  waterPolygonIds: Set<number>;
  mountainPolygonIds: Set<number>;
}

// Phase 2 placer stubs — empty arrays, no RNG, no candidate-pool reads.
// Each placer is responsible for adding its own polygon ids to `used` before
// returning so later passes don't double-claim.

function placeNamedLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeIndustrialLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeMilitaryLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeFaithAuxLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeEntertainmentLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeTradeLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

function placeExcludedLandmarks(_ctx: PlacerContext, _used: Set<number>): LandmarkV2[] {
  return [];
}

/**
 * Phase 2 entry point. Calls every group placer in fixed order, threading a
 * shared `used: Set<number>` for cross-placer de-duplication. Returns the
 * concatenation of all placer outputs — always `[]` in Phase 2.
 *
 * Order: named → industrial → military → faith_aux → entertainment → trade
 *        → excluded.
 *
 * Named runs first so Phase 3's wonder / palace / castle placers can claim
 * the most central / civic polygons before the alignment groups consume the
 * boundary band.
 */
export function placeUnifiedLandmarks(ctx: PlacerContext): LandmarkV2[] {
  const used = new Set<number>();
  return [
    ...placeNamedLandmarks(ctx, used),
    ...placeIndustrialLandmarks(ctx, used),
    ...placeMilitaryLandmarks(ctx, used),
    ...placeFaithAuxLandmarks(ctx, used),
    ...placeEntertainmentLandmarks(ctx, used),
    ...placeTradeLandmarks(ctx, used),
    ...placeExcludedLandmarks(ctx, used),
  ];
}
