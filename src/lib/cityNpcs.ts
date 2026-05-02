/**
 * Bulk NPC-class population layer for a city.
 *
 * Sits alongside `citychars.ts` (which rolls a small per-city PC roster of
 * named adventurer-tier characters). For every PC the city has, this module
 * adds ~10 NPC-class characters drawn from `warrior` / `expert` /
 * `aristocrat` / `adept`, capped at half the PC max level for the tier. NPCs
 * are aggregated as `(class, level, place) → count` — they have no names,
 * abilities, equipment, or popups.
 *
 * Driven by the V2 city map: every landmark and every non-residential block
 * is a candidate "place". An affinity score per (class, place) biases the
 * weighted random pick, with higher levels gravitating toward prestigious
 * slots (palace / temple / civic) — same scoring shape as the PC affiliation
 * pass in `citychars.ts:scoreCharForLandmark`.
 *
 * Determinism: rolls on its own PRNG sub-stream
 * `${worldSeed}_npcs_${cellIndex}_y${year}` so adding/removing this layer
 * never perturbs the PC roster's byte-stable output.
 *
 * Sweep-safe: nothing in this module is reachable from the worker or
 * `scripts/sweep-history.ts`. Render-only by design.
 */

import { seededPRNG } from './terrain/noise';
import { NPC_CLASS_SPECS } from './fantasy/NpcClassType';
import type { NpcClassType } from './fantasy/NpcClassType';
import { resolveCityRosterMax } from './citychars';
import type { City } from './types';
import type { CityMapDataV2, LandmarkKind, DistrictType } from './citymap';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NpcEntry {
  npcClass: NpcClassType;
  level: number;
  count: number;
}

export interface NpcPlace {
  /** Stable identifier — `landmark:<index>` or `block:<index>`. */
  id: string;
  /** Display name shown in the place row. Falls back to kind-uppercased. */
  name: string;
  /** Coarse kind label for UI grouping — landmark `kind` or block `role`. */
  kind: string;
  /** Either 'landmark' or 'block'. */
  source: 'landmark' | 'block';
  entries: NpcEntry[];
  total: number;
}

export interface NpcClassSummary {
  total: number;
  /** Aggregated across all places, sorted (level desc, classOrder). */
  byClassLevel: NpcEntry[];
  /** Per-place breakdown, sorted by total count desc. */
  places: NpcPlace[];
  /** Random-access helper for inline injections inside Wonder / Religion expands. */
  placesById: Map<string, NpcPlace>;
}

// ─── Tunables ───────────────────────────────────────────────────────────────

/**
 * Top-level (highest-level) NPC count is `pcCount × NPC_TOP_LEVEL_COEFF`. Each
 * level below has TWICE as many — so a `maxNpcLevel = 7` city ends up with
 * `topCount × (2^7 − 1) = topCount × 127` NPCs total. The geometric decay
 * mirrors a real population pyramid (lots of level-1 townsfolk, very few
 * level-N veterans) and matches the user's brief: "top levels have good
 * amounts; but each level below should have twice as many".
 */
const NPC_TOP_LEVEL_COEFF = 4;

// Stable iteration order for class buckets — rare/prestigious classes first
// so they get first pick of the prestigious place pool when generation runs
// from the highest level down.
const CLASS_ITER_ORDER: readonly NpcClassType[] = ['aristocrat', 'adept', 'warrior', 'expert'];

// Iteration / sort order for `byClassLevel` rows. Keeps the UI stable.
const CLASS_DISPLAY_ORDER: readonly NpcClassType[] = ['warrior', 'expert', 'adept', 'aristocrat'];

// The only block role we never assign NPCs to — `excluded` is the V2
// district sentinel for water / mountain / unbuildable polygons. Residential
// blocks ARE candidates: most townsfolk live there, and the user's directive
// is to distribute across ALL candidate places, not a curated subset.
const EXCLUDED_BLOCK_ROLES = new Set<DistrictType>(['excluded']);

// Landmark kinds that read as "punitive" or "marker" rather than employment
// places. The user's request emphasises positive places of work.
const EXCLUDED_LANDMARK_KINDS = new Set<LandmarkKind>(['gallows', 'ghetto_marker']);

// ─── Affinity scoring ───────────────────────────────────────────────────────
//
// Mirrors the shape of `scoreCharForLandmark` in `citychars.ts:304`. Higher
// score → higher pick weight. Baseline `1` keeps every place reachable so
// any NPC can land anywhere if the affinity-matched slots are saturated.

const ARISTOCRAT_LANDMARK_AFFINITY: Partial<Record<LandmarkKind, number>> = {
  palace: 8, castle: 8, civic_square: 5, wonder: 4, bankers_row: 3,
  foreign_quarter: 2, theater: 2, festival: 2, bathhouse: 2, archive: 2,
};
const ARISTOCRAT_DISTRICT_AFFINITY: Partial<Record<DistrictType, number>> = {
  residential_high: 6, civic: 5, trade: 3, entertainment: 2, market: 2,
};

const ADEPT_LANDMARK_AFFINITY: Partial<Record<LandmarkKind, number>> = {
  temple: 8, temple_quarter: 6, necropolis: 4, plague_ward: 5, archive: 3,
  academia: 3, civic_square: 2,
};
const ADEPT_DISTRICT_AFFINITY: Partial<Record<DistrictType, number>> = {
  education_faith: 5, civic: 2, residential_medium: 2, residential_low: 1,
};

const WARRIOR_LANDMARK_AFFINITY: Partial<Record<LandmarkKind, number>> = {
  barracks: 8, citadel: 7, watchmen: 6, arsenal: 5, castle: 4, palace: 3,
  caravanserai: 3, foreign_quarter: 2, gallows: 2, civic_square: 2,
};
const WARRIOR_DISTRICT_AFFINITY: Partial<Record<DistrictType, number>> = {
  military: 6, harbor: 3, dock: 3, slum: 3, residential_low: 3, residential_medium: 2,
  civic: 2, trade: 1,
};

const EXPERT_LANDMARK_AFFINITY: Partial<Record<LandmarkKind, number>> = {
  forge: 6, tannery: 5, textile: 5, potters: 5, mill: 5, workhouse: 4,
  market: 5, warehouse: 4, caravanserai: 4, bankers_row: 4, academia: 4,
  archive: 4, theater: 2, bathhouse: 2,
};
const EXPERT_DISTRICT_AFFINITY: Partial<Record<DistrictType, number>> = {
  industry: 6, market: 5, harbor: 4, dock: 4, agricultural: 4, trade: 4,
  education_faith: 3, entertainment: 2,
  residential_medium: 3, residential_low: 2, residential_high: 1,
};

function landmarkAffinity(npcClass: NpcClassType, kind: LandmarkKind): number {
  switch (npcClass) {
    case 'aristocrat': return ARISTOCRAT_LANDMARK_AFFINITY[kind] ?? 0;
    case 'adept':      return ADEPT_LANDMARK_AFFINITY[kind] ?? 0;
    case 'warrior':    return WARRIOR_LANDMARK_AFFINITY[kind] ?? 0;
    case 'expert':     return EXPERT_LANDMARK_AFFINITY[kind] ?? 0;
  }
}

function districtAffinity(npcClass: NpcClassType, role: DistrictType): number {
  switch (npcClass) {
    case 'aristocrat': return ARISTOCRAT_DISTRICT_AFFINITY[role] ?? 0;
    case 'adept':      return ADEPT_DISTRICT_AFFINITY[role] ?? 0;
    case 'warrior':    return WARRIOR_DISTRICT_AFFINITY[role] ?? 0;
    case 'expert':     return EXPERT_DISTRICT_AFFINITY[role] ?? 0;
  }
}

// ─── Place pool ─────────────────────────────────────────────────────────────

interface PlaceCandidate {
  id: string;
  name: string;
  kind: string;
  source: 'landmark' | 'block';
  /** Cached affinity per class so we don't re-switch on every NPC pick. */
  baseAffinity: Record<NpcClassType, number>;
}

function buildPlaceCandidates(cityMap: CityMapDataV2 | undefined): PlaceCandidate[] {
  if (!cityMap) return [];
  const out: PlaceCandidate[] = [];

  for (let i = 0; i < cityMap.landmarks.length; i++) {
    const lm = cityMap.landmarks[i];
    if (EXCLUDED_LANDMARK_KINDS.has(lm.kind)) continue;
    let name = lm.name;
    if (!name) {
      const containing = cityMap.blocks.find(b => b.polygonIds.includes(lm.polygonId));
      name = containing?.name ?? lm.kind.toUpperCase();
    }
    out.push({
      id: `landmark:${i}`,
      name,
      kind: lm.kind,
      source: 'landmark',
      baseAffinity: {
        warrior:    landmarkAffinity('warrior',    lm.kind),
        expert:     landmarkAffinity('expert',     lm.kind),
        adept:      landmarkAffinity('adept',      lm.kind),
        aristocrat: landmarkAffinity('aristocrat', lm.kind),
      },
    });
  }

  for (let i = 0; i < cityMap.blocks.length; i++) {
    const blk = cityMap.blocks[i];
    if (EXCLUDED_BLOCK_ROLES.has(blk.role)) continue;
    if (blk.polygonIds.length === 0) continue;
    out.push({
      id: `block:${i}`,
      name: blk.name || blk.role.toUpperCase(),
      kind: blk.role,
      source: 'block',
      baseAffinity: {
        warrior:    districtAffinity('warrior',    blk.role),
        expert:     districtAffinity('expert',     blk.role),
        adept:      districtAffinity('adept',      blk.role),
        aristocrat: districtAffinity('aristocrat', blk.role),
      },
    });
  }

  return out;
}

/**
 * Weighted-random place pick. Score = baseAffinity + 1 (so every place is
 * reachable) + level-scaled prestige bias for matching aristocrat/adept
 * picks. Tie-break with a tiny RNG nudge so equal-score places shuffle.
 */
function pickPlace(
  candidates: PlaceCandidate[],
  npcClass: NpcClassType,
  level: number,
  rng: () => number,
): PlaceCandidate {
  let totalW = 0;
  const weights = new Array<number>(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const base = cand.baseAffinity[npcClass];
    // Higher levels lean harder on affinity matches — a level-1 warrior is
    // happy in any block; a level-7 captain prefers a citadel.
    const levelBoost = base > 0 ? base * level * 0.15 : 0;
    const w = 1 + base + levelBoost + rng() * 0.05;
    weights[i] = w;
    totalW += w;
  }
  const target = rng() * totalW;
  let acc = 0;
  for (let i = 0; i < candidates.length; i++) {
    acc += weights[i];
    if (target <= acc) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Multinomial draw: split `count` items across the four NPC classes. */
function allocateClassCounts(count: number, rng: () => number): Record<NpcClassType, number> {
  const out: Record<NpcClassType, number> = { warrior: 0, expert: 0, aristocrat: 0, adept: 0 };
  if (count <= 0) return out;
  const totalProb = NPC_CLASS_TYPES_TOTAL_PROB;
  for (let i = 0; i < count; i++) {
    const target = rng() * totalProb;
    let acc = 0;
    for (const c of CLASS_ITER_ORDER) {
      acc += NPC_CLASS_SPECS[c].prob;
      if (target <= acc) { out[c]++; break; }
    }
  }
  return out;
}

const NPC_CLASS_TYPES_TOTAL_PROB =
  NPC_CLASS_SPECS.warrior.prob +
  NPC_CLASS_SPECS.expert.prob +
  NPC_CLASS_SPECS.aristocrat.prob +
  NPC_CLASS_SPECS.adept.prob;

// ─── Main entry point ──────────────────────────────────────────────────────

export function generateCityNpcs(
  worldSeed: string,
  city: Pick<City, 'cellIndex' | 'size' | 'isRuin'>,
  pcCount: number,
  year: number,
  cityMap: CityMapDataV2 | undefined,
): NpcClassSummary {
  const empty: NpcClassSummary = { total: 0, byClassLevel: [], places: [], placesById: new Map() };
  if (!worldSeed) return empty;
  if (city.isRuin) return empty;
  if (pcCount <= 0) return empty;

  const candidates = buildPlaceCandidates(cityMap);
  // No V2 city map / no candidate places → no NPCs. The DistrictModal in
  // CityMapPopupV2 is the source of truth for "which places exist", so we
  // never synthesise a generic bucket — once the city map loads the place
  // pool fills in.
  if (candidates.length === 0) return empty;

  const { maxLevel: maxPcLevel } = resolveCityRosterMax(city.size);
  const maxNpcLevel = Math.max(1, Math.floor(maxPcLevel / 2));
  const rng = seededPRNG(`${worldSeed}_npcs_${city.cellIndex}_y${year}`);

  // Geometric distribution: top level = `pcCount × NPC_TOP_LEVEL_COEFF`, each
  // level below has TWICE as many. Total = topCount × (2^maxNpcLevel − 1).
  // Per the user's spec: "the top levels have good amounts; but each level
  // below should have twice as many".
  const topCount = Math.max(1, Math.round(pcCount * NPC_TOP_LEVEL_COEFF));
  const perLevel = new Array<number>(maxNpcLevel + 1).fill(0);
  let totalNpcs = 0;
  for (let l = maxNpcLevel; l >= 1; l--) {
    const factor = 1 << (maxNpcLevel - l); // 1, 2, 4, 8, ...
    perLevel[l] = topCount * factor;
    totalNpcs += perLevel[l];
  }

  // (placeId → class → level → count) accumulator.
  const counter = new Map<string, Map<NpcClassType, Map<number, number>>>();

  // Iterate from the highest level down: level-N aristocrats and adepts get
  // first crack at scarce prestigious slots before level-1 expert apprentices
  // flood the same pool. The pickPlace weighted draw still admits low-level
  // characters everywhere — exhaustion is statistical, not hard.
  for (let level = maxNpcLevel; level >= 1; level--) {
    const split = allocateClassCounts(perLevel[level], rng);
    for (const cls of CLASS_ITER_ORDER) {
      const n = split[cls];
      for (let i = 0; i < n; i++) {
        const place = pickPlace(candidates, cls, level, rng);
        let byClass = counter.get(place.id);
        if (!byClass) { byClass = new Map(); counter.set(place.id, byClass); }
        let byLevel = byClass.get(cls);
        if (!byLevel) { byLevel = new Map(); byClass.set(cls, byLevel); }
        byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
      }
    }
  }

  // ── Materialize ──
  const places: NpcPlace[] = [];
  const placesById = new Map<string, NpcPlace>();
  const overall = new Map<string, NpcEntry>(); // class+level → row

  for (const cand of candidates) {
    const byClass = counter.get(cand.id);
    if (!byClass) continue;
    const entries: NpcEntry[] = [];
    let placeTotal = 0;
    for (const cls of CLASS_DISPLAY_ORDER) {
      const byLevel = byClass.get(cls);
      if (!byLevel) continue;
      const sortedLevels = [...byLevel.keys()].sort((a, b) => b - a);
      for (const lvl of sortedLevels) {
        const c = byLevel.get(lvl)!;
        if (c <= 0) continue;
        entries.push({ npcClass: cls, level: lvl, count: c });
        placeTotal += c;

        const key = `${cls}:${lvl}`;
        const existing = overall.get(key);
        if (existing) existing.count += c;
        else overall.set(key, { npcClass: cls, level: lvl, count: c });
      }
    }
    if (placeTotal === 0) continue;
    const place: NpcPlace = {
      id: cand.id, name: cand.name, kind: cand.kind, source: cand.source,
      entries, total: placeTotal,
    };
    places.push(place);
    placesById.set(cand.id, place);
  }

  places.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const byClassLevel = [...overall.values()].sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return CLASS_DISPLAY_ORDER.indexOf(a.npcClass) - CLASS_DISPLAY_ORDER.indexOf(b.npcClass);
  });

  return { total: totalNpcs, byClassLevel, places, placesById };
}
