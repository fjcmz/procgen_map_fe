/**
 * Client-side per-city character roster generator.
 *
 * The worker simulates the world (cities, countries, religions) and ships
 * `Country.raceBias` + `ReligionDetail.deity / alignment` + `cityReligions`
 * across the postMessage boundary; this module turns those biases into a
 * deterministic D&D 3.5e PC roster the moment a city is opened in the
 * Details tab. No worker round-trip, no `HistoryStats` impact, no temporal
 * scrubbing — characters are a static seed-stable roll keyed on
 * `${worldSeed}_chars_${cellIndex}` so the same city always shows the same
 * roster within one generation run.
 *
 * Sizing per spec:
 *   small        → 3 chars, locked race / deity / alignment, narrow class mix
 *   medium       → 6 chars, 70% dominant
 *   large        → 12 chars, 50% dominant
 *   metropolis   → 24 chars, 30% dominant
 *   megalopolis  → 48 chars, 15% dominant
 *
 * "Dominant" pulls from the country's `raceBias.primary` and the city's
 * dominant religion's deity. The biased pool fills the rest using
 * `generatePcCharBiased` weight overrides.
 *
 * MUST NOT be imported from the worker — it depends on render-layer types
 * (`City`, `Country`, `ReligionDetail`) and rolls fresh PRNGs. Worker imports
 * would defeat the lazy-on-open design and balloon the postMessage payload.
 */

import { seededPRNG } from './terrain/noise';
import { generatePcCharBiased } from './fantasy/PcCharGenerator';
import { generateIllustrateName } from './history/nameGenerator';
import { DEITY_SPECS } from './fantasy/Deity';
import type { Deity } from './fantasy/Deity';
import type { RaceType } from './fantasy/RaceType';
import type { AlignmentType } from './fantasy/AlignmentType';
import type { Ability } from './fantasy/Ability';
import { abilityMod } from './fantasy/Ability';
import type { PcClassType } from './fantasy/PcClassType';
import type { ClassLevel, CombatStats, BonusType, BonusComponent } from './fantasy/Combat';
import { computeCombatStats } from './fantasy/Combat';
import type { EquipmentSet } from './fantasy/Equipment';
import { assignEquipment } from './fantasy/Equipment';
import type { CharacterSpellcasting } from './fantasy/Spellcasting';
import { rollCharacterSpellcasting } from './fantasy/Spellcasting';
import type { City, Country, ReligionDetail, IllustrateDetail } from './types';
import type { CityMapDataV2, DistrictType, LandmarkKind } from './citymap';

/** Re-exported so DetailsTab can use the same enum without re-importing the sim layer. */
export type IllustrateType = IllustrateDetail['type'];

/**
 * Pointer from a character to the district / quarter they belong to in the
 * city map. Resolved at roster-roll time from the same `CityMapDataV2` the
 * V2 popup renders, so the IDs index directly into `cityMap.blocks` and
 * `cityMap.landmarks` without further lookups.
 *
 * Low-level characters lean toward residential blocks; higher-level
 * characters lean toward landmarks / specialised quarters that align with
 * their class, race, or deity. See `pickAffiliation` below for the scoring.
 */
export interface CharacterAffiliation {
  /** 'block' for a generic district cluster; 'landmark' for a specific quarter / wonder / civic anchor. */
  kind: 'block' | 'landmark';
  /** Index into `cityMap.blocks` (when kind === 'block') or `cityMap.landmarks` (when kind === 'landmark'). */
  index: number;
  /** Display name to show in the character popup and the district modal. */
  name: string;
  /** Block role for kind === 'block'; absent for landmarks. */
  role?: DistrictType;
  /** Landmark kind for kind === 'landmark'; absent for blocks. */
  landmarkKind?: LandmarkKind;
}

/**
 * One side of a character ↔ character relationship. Stored on every
 * connected character; the link is symmetric so opening either popup shows
 * the same edge from its own perspective.
 *
 * `targetIndex` indexes into the SAME roster array `generateCityCharacters`
 * returned, so the popup can resolve `roster[rel.targetIndex]` without a
 * by-name lookup. `targetName` is duplicated for tooltip / preview rendering
 * when the roster isn't on hand. `reason` is a short flavor label derived
 * from the shared trait that scored highest at link time (deity → class →
 * alignment → race → "acquainted").
 */
export interface CharacterRelationship {
  targetIndex: number;
  targetName: string;
  reason: string;
}

/**
 * Display-friendly snapshot of one rolled character. Captures enough to render
 * a roster row plus a hover tooltip; intentionally a plain JSON-safe shape so
 * the UI doesn't need to import `PcChar` (a class with a `Map`).
 */
export interface CityCharacter {
  name: string;
  race: RaceType;
  pcClass: PcClassType;
  level: number;
  /**
   * Multi-class progression. Always populated; single-class characters carry
   * a length-1 list `[{ pcClass, level }]`. The combat stats below are summed
   * across this list, so adding a second class entry would automatically
   * fold its BAB / save contributions in.
   */
  classLevels: ClassLevel[];
  alignment: AlignmentType;
  /** Display name, matches `DEITY_SPECS[d].name` or 'none'. */
  deity: string;
  hitPoints: number;
  abilities: Record<Ability, number>;
  /**
   * D&D 3.5e combat-side derived stats: Base Attack Bonus, Armor Class, and
   * the three saving throws (Fort / Ref / Will). Each carries a typed
   * `components` list so the UI can show a stacking-aware breakdown when the
   * user clicks the corresponding number in the character popup.
   */
  combat: CombatStats;
  age: { currentAge: number; middleAge: number; oldAge: number; venerableAge: number; maxAge: number };
  height: number;
  weight: number;
  wealth: number;
  /**
   * District / quarter the character is associated with. Populated when
   * `generateCityCharacters` is called with a `cityMap` argument; otherwise
   * undefined (consumers should fall back to a generic display).
   */
  affiliation?: CharacterAffiliation;
  /**
   * Connections to other roster members. Always populated by
   * `generateCityCharacters` (possibly as an empty array). Each character
   * rolls a 50% outgoing chance of forming one weighted-by-similarity link;
   * the entry on both ends gets bidirectional, so popular characters
   * accumulate multiple incoming edges.
   */
  relationships?: CharacterRelationship[];
  /**
   * Starting equipment assigned from the D&D 3.5e non-magical gear catalog,
   * selected by class and constrained by wealth budget. Always populated by
   * `generateCityCharacters`. The `combat` stats above already include the
   * AC and saving-throw bonuses from worn armor and shields.
   */
  equipment: EquipmentSet;
  /**
   * Per-spellcasting-class spell slot tables and known/memorized spell
   * lists. One entry per spellcasting class in `classLevels`; absent (or
   * empty) when the character has no spellcasting class. Drives the
   * character spell popup.
   */
  spellcasting?: CharacterSpellcasting[];
  /**
   * When this character represents a simulation-generated illustrate (i.e.
   * the city has a famous historical figure currently active), these fields
   * carry the illustrate's identity so the UI can mark the row. Absent for
   * ordinary procedurally-rolled characters.
   */
  illustrateType?: IllustrateType;
  illustrateBirthYear?: number;
  illustrateDeathYear?: number | null;
}

interface SizeProfile {
  count: number;
  /** Inclusive range for level rolls (rng-uniform). */
  minLevel: number;
  maxLevel: number;
  /**
   * Probability that any given character is a "dominant" pick (race ×
   * heavy multiplier, deity ×heavy multiplier toward city/country
   * defaults). The remainder are filled from a broader pool.
   */
  dominantBias: number;
}

const SIZE_PROFILES: Record<City['size'], SizeProfile> = {
  small:       { count: 3,  minLevel: 1, maxLevel: 3,  dominantBias: 1.0  },
  medium:      { count: 6,  minLevel: 1, maxLevel: 5,  dominantBias: 0.7  },
  large:       { count: 12, minLevel: 1, maxLevel: 7,  dominantBias: 0.5  },
  metropolis:  { count: 24, minLevel: 1, maxLevel: 12, dominantBias: 0.3  },
  megalopolis: { count: 48, minLevel: 1, maxLevel: 15, dominantBias: 0.15 },
};

/**
 * Read the year-aware roster size + max level for a given city tier. Exposed
 * so adjacent generators (currently `cityNpcs.ts`) stay in lockstep with the
 * PC table without duplicating the constants.
 */
export function resolveCityRosterMax(size: City['size']): { count: number; maxLevel: number } {
  const p = SIZE_PROFILES[size];
  return { count: p.count, maxLevel: p.maxLevel };
}

/** How heavily to weight the "dominant" race / deity above their base prob. */
const DOMINANT_RACE_MULT = 12;
const SECONDARY_RACE_MULT = 4;
const DOMINANT_DEITY_MULT = 8;

/**
 * Apply ±10% deterministic jitter to a count via stochastic rounding so even
 * small counts (like the small-tier roster of 3) see variation across seeds.
 * `val × [0.9, 1.1]` is split into integer + fractional parts; the fraction
 * controls the probability of bumping the integer by 1.
 *
 * Consumes 2 RNG draws per call. Exported as a file-local helper so the NPC
 * generator can mirror the same shape (it consumes its own PRNG sub-stream).
 */
export function jitter10pct(count: number, rng: () => number): number {
  if (count <= 0) return 0;
  const factor = 0.9 + rng() * 0.2;
  const val = count * factor;
  const intPart = Math.floor(val);
  const fracPart = val - intPart;
  return intPart + (rng() < fracPart ? 1 : 0);
}

// ─── Affiliation tables ────────────────────────────────────────────────────
//
// Class / race → preferred LandmarkKinds and DistrictTypes. Used by
// `pickAffiliation` to score each (block, landmark) candidate against a
// character's identity. Higher level multiplies the specialised weights, so
// veterans gravitate toward race / class / deity-aligned quarters while
// fresh adventurers cluster in residential blocks.
//
// Tables stay `Partial<...>` so adding a new class / race in
// `lib/fantasy/PcClassType.ts` or `lib/fantasy/RaceType.ts` doesn't force a
// keyword-by-keyword fill-out — the missing entries just no-op. `human` is
// intentionally empty: the dominant race in most countries doesn't need a
// thumbprint quarter, the residential weights handle them.

const CLASS_LANDMARK_AFFINITY: Partial<Record<PcClassType, LandmarkKind[]>> = {
  cleric:    ['temple', 'temple_quarter', 'civic_square', 'necropolis', 'plague_ward'],
  paladin:   ['temple', 'temple_quarter', 'citadel', 'barracks', 'civic_square', 'necropolis'],
  monk:      ['temple', 'temple_quarter', 'archive', 'civic_square'],
  wizard:    ['academia', 'archive', 'necropolis', 'plague_ward'],
  sorcerer:  ['academia', 'theater', 'wonder'],
  bard:      ['theater', 'festival', 'pleasure', 'bathhouse', 'civic_square', 'wonder'],
  fighter:   ['barracks', 'citadel', 'arsenal', 'watchmen', 'warehouse'],
  barbarian: ['barracks', 'foreign_quarter', 'gallows'],
  ranger:    ['park', 'caravanserai'],
  druid:     ['park'],
  rogue:     ['ghetto_marker', 'foreign_quarter', 'market', 'pleasure', 'gallows', 'bankers_row', 'warehouse'],
};

const CLASS_DISTRICT_AFFINITY: Partial<Record<PcClassType, DistrictType[]>> = {
  cleric:    ['civic'],
  paladin:   ['civic', 'military'],
  monk:      ['civic'],
  wizard:    ['education_faith'],
  sorcerer:  ['education_faith', 'entertainment'],
  bard:      ['entertainment'],
  fighter:   ['military'],
  barbarian: ['military', 'slum'],
  ranger:    ['agricultural'],
  druid:     ['agricultural'],
  rogue:     ['slum', 'market'],
};

const RACE_LANDMARK_AFFINITY: Partial<Record<RaceType, LandmarkKind[]>> = {
  elf:      ['temple_quarter', 'park', 'archive'],
  half_elf: ['foreign_quarter', 'park'],
  dwarf:    ['forge', 'arsenal', 'mill'],
  gnome:    ['forge', 'academia', 'potters'],
  halfling: ['market', 'caravanserai'],
  human:    [],
  half_orc: ['ghetto_marker', 'foreign_quarter', 'barracks'],
  orc:      ['ghetto_marker', 'foreign_quarter'],
};

const RACE_DISTRICT_AFFINITY: Partial<Record<RaceType, DistrictType[]>> = {
  elf:      ['residential_high'],
  half_elf: ['residential_medium'],
  dwarf:    ['industry'],
  gnome:    ['industry', 'education_faith'],
  halfling: ['residential_medium', 'market', 'agricultural'],
  human:    [],
  half_orc: ['slum', 'military'],
  orc:      ['slum'],
};

interface AffiliationCandidate {
  kind: 'block' | 'landmark';
  index: number;
  weight: number;
}

/**
 * Landmarks classified as craft / production sites — characters are NOT
 * guaranteed here (smiths and weavers aren't adventurers).
 */
const CRAFT_INDUSTRY_LANDMARK_KINDS = new Set<LandmarkKind>([
  'forge', 'tannery', 'textile', 'potters', 'mill', 'workhouse',
]);

/**
 * Priority ordering for the guaranteed-coverage pass: all non-craft/industry
 * landmark kinds, highest-priority first. When the roster is smaller than the
 * number of qualifying landmarks the most important locations are filled first.
 */
const GUARANTEED_LANDMARK_PRIORITY: readonly LandmarkKind[] = [
  'palace', 'castle',
  'temple', 'temple_quarter',
  'civic_square', 'wonder',
  'barracks', 'citadel', 'watchmen',
  'academia', 'archive',
  'market', 'foreign_quarter', 'caravanserai',
  'theater', 'festival', 'bathhouse', 'pleasure',
  'arsenal',
  'park',
  'bankers_row', 'warehouse',
  'necropolis', 'plague_ward',
  'gallows', 'ghetto_marker',
];

function makeLandmarkAffiliation(cityMap: CityMapDataV2, lmIndex: number): CharacterAffiliation {
  const lm = cityMap.landmarks[lmIndex];
  let name = lm.name;
  if (!name) {
    const containingBlock = cityMap.blocks.find(b => b.polygonIds.includes(lm.polygonId));
    name = containingBlock?.name ?? lm.kind.toUpperCase();
  }
  return { kind: 'landmark', index: lmIndex, name, landmarkKind: lm.kind };
}

/**
 * Score a single character for placement at a guaranteed landmark. Higher is
 * better. Always returns a positive baseline so any roster member can be
 * forced into the slot when the city has more guaranteed landmarks than
 * affinity-matching characters.
 */
function scoreCharForLandmark(c: CityCharacter, lmKind: LandmarkKind): number {
  const classLm = CLASS_LANDMARK_AFFINITY[c.pcClass] ?? [];
  const raceLm = RACE_LANDMARK_AFFINITY[c.race] ?? [];
  let s = 1; // baseline so the slot is always fillable
  if (classLm.includes(lmKind)) s += 5 + c.level * 0.5;
  if (raceLm.includes(lmKind))  s += 2 + c.level * 0.3;
  if (lmKind === 'temple' && c.deity !== 'none') s += 3 + c.level * 0.4;
  // Palaces / castles bias toward higher-level characters (rulers, captains).
  if (lmKind === 'palace' || lmKind === 'castle') s += c.level * 0.5;
  // Civic square: important public figures skew higher-level.
  if (lmKind === 'civic_square') s += c.level * 0.3;
  // Wonders: prestige sites skew higher-level and sorcerers / bards.
  if (lmKind === 'wonder') s += c.level * 0.2;
  // Necropolis: clerics / paladins with a deity feel at home here.
  if (lmKind === 'necropolis' && c.deity !== 'none' &&
      (c.pcClass === 'cleric' || c.pcClass === 'paladin')) s += 2 + c.level * 0.3;
  // Plague ward: healers are the obvious fit.
  if (lmKind === 'plague_ward' && c.deity !== 'none' && c.pcClass === 'cleric') {
    s += 2 + c.level * 0.3;
  }
  return s;
}

/**
 * First-pass guarantee — for every non-craft/industry landmark in the city,
 * try to assign one character (best-fit, RNG tie-break). Returns the set of
 * character indices that have been pre-claimed; the caller skips them in the
 * regular affinity-weighted pass.
 *
 * Landmarks are processed in `GUARANTEED_LANDMARK_PRIORITY` order so when the
 * roster is too small to cover every landmark (e.g. a small city with 3
 * characters and 8 qualifying landmarks), the most important locations are
 * filled first. Remaining characters then run through the normal
 * affinity-weighted `pickAffiliation` pass and may land at any landmark,
 * including ones already covered by this guarantee.
 */
function assignGuaranteedLandmarks(
  out: CityCharacter[],
  cityMap: CityMapDataV2,
  rng: () => number,
): Set<number> {
  const assigned = new Set<number>();
  if (out.length === 0) return assigned;

  const priorityIndex = new Map<LandmarkKind, number>(
    GUARANTEED_LANDMARK_PRIORITY.map((k, i) => [k, i] as [LandmarkKind, number]),
  );

  // Collect all non-craft/industry landmarks and sort by priority.
  const qualifying = cityMap.landmarks
    .map((lm, i) => ({ lm, i }))
    .filter(({ lm }) => !CRAFT_INDUSTRY_LANDMARK_KINDS.has(lm.kind))
    .sort((a, b) =>
      (priorityIndex.get(a.lm.kind) ?? 999) - (priorityIndex.get(b.lm.kind) ?? 999),
    );

  for (const { lm, i: lmIdx } of qualifying) {
    // Pick the best unassigned character for this slot. Tie-break by RNG.
    let bestChar = -1;
    let bestScore = -1;
    for (let ci = 0; ci < out.length; ci++) {
      if (assigned.has(ci)) continue;
      const score = scoreCharForLandmark(out[ci], lm.kind) + rng() * 0.01;
      if (score > bestScore) { bestScore = score; bestChar = ci; }
    }
    if (bestChar < 0) {
      // Roster exhausted — remaining landmarks stay uncovered by the guarantee
      // pass, but may still receive characters from the regular affiliation
      // pass that runs afterward.
      return assigned;
    }
    out[bestChar].affiliation = makeLandmarkAffiliation(cityMap, lmIdx);
    assigned.add(bestChar);
  }
  return assigned;
}

/**
 * Score every block + landmark in the city against a character's identity and
 * pick one. Residential blocks always have a non-zero baseline so any roster
 * member is placeable, even in cities without a matching specialised quarter.
 *
 * Level shapes the curve in two ways:
 *   • residential weights shift from low → high tier as level rises (richer
 *     characters live in nicer blocks);
 *   • specialised landmark / district weights scale linearly with level, so
 *     mid- to high-level characters out-bid residential placement when their
 *     class / race / deity matches an available landmark.
 */
function pickAffiliation(
  char: Pick<CityCharacter, 'pcClass' | 'race' | 'level' | 'deity'>,
  cityMap: CityMapDataV2,
  rng: () => number,
): CharacterAffiliation | undefined {
  const blocks = cityMap.blocks;
  const landmarks = cityMap.landmarks;
  if (blocks.length === 0 && landmarks.length === 0) return undefined;

  const level = char.level;
  const classLm = CLASS_LANDMARK_AFFINITY[char.pcClass] ?? [];
  const classDist = CLASS_DISTRICT_AFFINITY[char.pcClass] ?? [];
  const raceLm = RACE_LANDMARK_AFFINITY[char.race] ?? [];
  const raceDist = RACE_DISTRICT_AFFINITY[char.race] ?? [];
  const isFaithful = char.deity !== 'none' &&
    (char.pcClass === 'cleric' || char.pcClass === 'paladin' || char.pcClass === 'monk');

  // Residential tier weights — slums skew low-level, mansions skew high-level,
  // medium peaks around level 4. The clamps guarantee every tier stays a
  // viable fallback for any level so degenerate cities (only one residential
  // tier present) never strand a character with weight 0.
  const residentialLowW  = Math.max(0.6, 2.6 - level * 0.20);
  const residentialMedW  = 1.8 + Math.max(0, 0.5 - Math.abs(level - 4) * 0.1);
  const residentialHighW = Math.min(3.0, 0.4 + level * 0.25);

  const candidates: AffiliationCandidate[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.polygonIds.length === 0) continue;
    let weight = 0;
    if (b.role === 'residential_low')         weight = residentialLowW;
    else if (b.role === 'residential_medium') weight = residentialMedW;
    else if (b.role === 'residential_high')   weight = residentialHighW;
    else {
      if (classDist.includes(b.role)) weight += 0.7 + level * 0.4;
      if (raceDist.includes(b.role))  weight += 0.4 + level * 0.25;
    }
    if (weight > 0) candidates.push({ kind: 'block', index: i, weight });
  }

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    let weight = 0;
    if (classLm.includes(lm.kind)) weight += 1.0 + level * 0.5;
    if (raceLm.includes(lm.kind))  weight += 0.5 + level * 0.3;
    if (isFaithful && (lm.kind === 'temple' || lm.kind === 'temple_quarter')) {
      weight += 0.5 + level * 0.4;
    }
    if (weight > 0) candidates.push({ kind: 'landmark', index: i, weight });
  }

  // Fallback chain: any non-empty block, then any landmark. Guarantees every
  // character gets an affiliation as long as the city has any geometry at all.
  if (candidates.length === 0) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].polygonIds.length > 0) candidates.push({ kind: 'block', index: i, weight: 1 });
    }
  }
  if (candidates.length === 0) {
    for (let i = 0; i < landmarks.length; i++) candidates.push({ kind: 'landmark', index: i, weight: 1 });
  }
  if (candidates.length === 0) return undefined;

  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let roll = rng() * total;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) { chosen = c; break; }
  }

  if (chosen.kind === 'block') {
    const b = blocks[chosen.index];
    return { kind: 'block', index: chosen.index, name: b.name, role: b.role };
  }
  const lm = landmarks[chosen.index];
  // Phase 4 quarters (forge / barracks / …) have no `lm.name` of their own —
  // they inherit the parent block's procedural name. Mirror what the V2 popup
  // tooltip does: look up the block that owns this polygon and reuse its name.
  let name = lm.name;
  if (!name) {
    const containingBlock = blocks.find(b => b.polygonIds.includes(lm.polygonId));
    name = containingBlock?.name ?? lm.kind.toUpperCase();
  }
  return { kind: 'landmark', index: chosen.index, name, landmarkKind: lm.kind };
}

/**
 * Pretty-print an `AlignmentType` enum value as the conventional 2-letter
 * D&D abbreviation (LG, NG, CG, LN, NN, CN, LE, NE, CE).
 */
export function alignmentBadge(a: AlignmentType): string {
  switch (a) {
    case 'lawful_good':     return 'LG';
    case 'neutral_good':    return 'NG';
    case 'chaotic_good':    return 'CG';
    case 'lawful_neutral':  return 'LN';
    case 'neutral_neutral': return 'TN';
    case 'chaotic_neutral': return 'CN';
    case 'lawful_evil':     return 'LE';
    case 'neutral_evil':    return 'NE';
    case 'chaotic_evil':    return 'CE';
  }
}

/** Pretty-print `RaceType` for UI rows ('half_elf' → 'Half-Elf'). */
export function raceLabel(r: RaceType): string {
  return r.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('-');
}

/**
 * Roll the character roster for a city. Pure function: deterministic given the
 * same `(worldSeed, city.cellIndex, city.size, country.raceBias, religions, year)`.
 *
 * `country` may be undefined for cities outside any current country (e.g. a
 * never-incorporated outpost) — the roster falls back to a neutral race pool.
 * `religions` may be empty — the roster falls back to the country's spirit-
 * derived alignment, then to true neutral.
 *
 * `year` is mixed into the PRNG seed so the roster refreshes when the
 * Details tab's selected year changes — moving the timeline produces a
 * fresh deterministic snapshot per year. Omit (or pass undefined) to keep
 * the v1 single-snapshot behavior.
 *
 * `cityMap` enables district / quarter affiliations on each rolled
 * character. When supplied, a second isolated PRNG sub-stream
 * (`${worldSeed}_charaffil_${cellIndex}` plus the year suffix when set)
 * scores each character against every block / landmark and stamps the
 * best match into `CityCharacter.affiliation`. The year is folded into
 * this stream too so affiliations stay in lock-step with year-aware rosters.
 *
 * `illustrates` integrates the simulation's illustrate system: any
 * `IllustrateDetail` whose `cityCellIndex` matches AND that is alive at
 * `year` (`birthYear <= year <= deathYear ?? +Inf`) consumes one roster slot
 * and is rolled with `pcClass` / `pcLevel` forced to the values baked at
 * sim time. The roster size becomes `max(profile.count, activeIllustrates.length)`
 * so notable figures are always present even in small-tier cities. Filtering
 * is skipped when `year` is undefined (legacy callers preserved). Illustrate
 * characters carry `illustrateType` / `illustrateBirthYear` / `illustrateDeathYear`
 * so the UI can mark their rows.
 *
 * Returns [] on degenerate input (no worldSeed, ruined cities at the renderer
 * layer should already have skipped this call).
 */

/**
 * Fold equipment bonus components into the character's already-computed
 * CombatStats in-place. Handles ac / bab / fort / ref / will targets;
 * attribute and hp targets are stored in the EquipmentSet but not mirrored
 * into combat stats (they affect ability scores which would require a full
 * recompute — left for future work).
 */
function applyEquipmentToCombat(char: CityCharacter): void {
  const eq = char.equipment;
  for (const item of Object.values(eq)) {
    if (!item) continue;
    for (const bonus of item.bonuses) {
      const comp = (): BonusComponent => ({
        source: item.name,
        value:  bonus.value,
        type:   (bonus.type ?? 'misc') as BonusType,
      });
      switch (bonus.target) {
        case 'ac':
          char.combat.ac.total += bonus.value;
          char.combat.ac.components.push(comp());
          break;
        case 'bab':
          char.combat.bab.total += bonus.value;
          char.combat.bab.components.push(comp());
          break;
        case 'fort':
          char.combat.saves.fortitude.total += bonus.value;
          char.combat.saves.fortitude.components.push(comp());
          break;
        case 'ref':
          char.combat.saves.reflex.total += bonus.value;
          char.combat.saves.reflex.components.push(comp());
          break;
        case 'will':
          char.combat.saves.will.total += bonus.value;
          char.combat.saves.will.components.push(comp());
          break;
        case 'hp':
          char.hitPoints += bonus.value;
          break;
        case 'str': {
          const old = abilityMod(char.abilities.strength    ?? 10);
          char.abilities.strength    = (char.abilities.strength    ?? 10) + bonus.value;
          const d = abilityMod(char.abilities.strength) - old;
          if (d) { char.combat.bab.total += d; char.combat.bab.components.push({ source: item.name + ' (STR)', value: d, type: 'ability' as BonusType }); }
          break;
        }
        case 'dex': {
          const old = abilityMod(char.abilities.dexterity   ?? 10);
          char.abilities.dexterity   = (char.abilities.dexterity   ?? 10) + bonus.value;
          const d = abilityMod(char.abilities.dexterity) - old;
          if (d) {
            char.combat.ac.total += d; char.combat.ac.components.push({ source: item.name + ' (DEX)', value: d, type: 'ability' as BonusType });
            char.combat.saves.reflex.total += d; char.combat.saves.reflex.components.push({ source: item.name + ' (DEX)', value: d, type: 'ability' as BonusType });
          }
          break;
        }
        case 'con': {
          const old = abilityMod(char.abilities.constitution ?? 10);
          char.abilities.constitution = (char.abilities.constitution ?? 10) + bonus.value;
          const d = abilityMod(char.abilities.constitution) - old;
          if (d) {
            char.hitPoints += d * char.level;
            char.combat.saves.fortitude.total += d; char.combat.saves.fortitude.components.push({ source: item.name + ' (CON)', value: d, type: 'ability' as BonusType });
          }
          break;
        }
        case 'wis': {
          const old = abilityMod(char.abilities.wisdom      ?? 10);
          char.abilities.wisdom      = (char.abilities.wisdom      ?? 10) + bonus.value;
          const d = abilityMod(char.abilities.wisdom) - old;
          if (d) { char.combat.saves.will.total += d; char.combat.saves.will.components.push({ source: item.name + ' (WIS)', value: d, type: 'ability' as BonusType }); }
          break;
        }
        case 'int':
          char.abilities.intelligence = (char.abilities.intelligence ?? 10) + bonus.value;
          break;
        case 'cha':
          char.abilities.charisma    = (char.abilities.charisma    ?? 10) + bonus.value;
          break;
        case 'spell_slots':
          if (char.spellcasting?.length) {
            const lvl = bonus.spellLevel ?? 1;
            for (const sc of char.spellcasting) {
              while (sc.slotsPerLevel.length <= lvl) sc.slotsPerLevel.push(0);
              sc.slotsPerLevel[lvl] += bonus.value;
            }
          }
          break;
        case 'caster_level':
          if (char.spellcasting?.length) {
            for (const sc of char.spellcasting) sc.casterLevelBonus += bonus.value;
          }
          break;
      }
    }
  }
}

export function generateCityCharacters(
  worldSeed: string,
  city: Pick<City, 'cellIndex' | 'size' | 'isRuin'>,
  country: Pick<Country, 'raceBias'> | undefined,
  religions: ReligionDetail[],
  year?: number,
  cityMap?: CityMapDataV2,
  illustrates?: IllustrateDetail[],
): CityCharacter[] {
  if (!worldSeed) return [];
  if (city.isRuin) return [];

  const profile = SIZE_PROFILES[city.size];
  const yearKey = year != null ? `_y${year}` : '';
  const rng = seededPRNG(worldSeed + '_chars_' + city.cellIndex + yearKey);
  const usedNames = new Set<string>();

  const dominantRace = country?.raceBias?.primary ?? 'human';
  const secondaryRace = country?.raceBias?.secondary;

  // The city's effective alignment: dominant religion's deity → that deity's
  // alignment; else neutral. Also record the dominant deity for weight bias.
  const dominantReligion = religions[0];
  const cityAlignment: AlignmentType = dominantReligion?.alignment ?? 'neutral_neutral';
  const dominantDeity: Deity | null = dominantReligion?.deity ?? null;
  // Build a deity-weight multiplier biased toward all hosted religions' deities,
  // dominant first. Each religion contributes proportionally less.
  const deityWeights: Partial<Record<Deity, number>> = {};
  religions.forEach((rel, idx) => {
    const mult = idx === 0
      ? DOMINANT_DEITY_MULT
      : Math.max(1.5, DOMINANT_DEITY_MULT / (idx + 1));
    deityWeights[rel.deity] = Math.max(deityWeights[rel.deity] ?? 0, mult);
  });

  // Active-at-year illustrates living in this city. Each consumes one roster
  // slot; ordinary characters fill the rest. When the active count exceeds
  // `profile.count`, the roster expands to fit them all (no illustrate is
  // ever omitted) — see plan: "always include all active illustrates, expand
  // roster".
  const activeIllustrates: IllustrateDetail[] = (() => {
    if (!illustrates || illustrates.length === 0 || year == null) return [];
    return illustrates.filter(il =>
      il.cityCellIndex === city.cellIndex &&
      il.birthYear <= year &&
      (il.deathYear == null || il.deathYear >= year),
    );
  })();
  // Reserve illustrate names so the ordinary roller never picks the same one.
  for (const il of activeIllustrates) usedNames.add(il.name);

  const ordinaryCount = Math.max(0, jitter10pct(profile.count, rng) - activeIllustrates.length);

  const out: CityCharacter[] = [];

  // 1) Illustrate-derived characters (forced class, baked level, real name).
  for (const il of activeIllustrates) {
    const isDominant = rng() < profile.dominantBias;
    const raceWeights: Partial<Record<RaceType, number>> = isDominant
      ? { [dominantRace]: DOMINANT_RACE_MULT, ...(secondaryRace ? { [secondaryRace]: SECONDARY_RACE_MULT } : {}) }
      : { [dominantRace]: 2, ...(secondaryRace ? { [secondaryRace]: 1.5 } : {}) };

    const effectiveDeityWeights: Partial<Record<Deity, number>> | undefined =
      city.size === 'small' && dominantDeity
        ? { [dominantDeity]: 100 }
        : (Object.keys(deityWeights).length > 0 ? deityWeights : undefined);

    const pc = generatePcCharBiased(il.pcLevel, cityAlignment, rng, {
      raceWeights,
      deityWeights: effectiveDeityWeights,
      classWeights: { [il.pcClass]: 1000 },
    });

    const abilities = {} as Record<Ability, number>;
    pc.abilities.forEach((v, k) => { abilities[k] = v; });

    const classLevels: ClassLevel[] = [{ pcClass: pc.pcClass, level: pc.level }];
    const combat = computeCombatStats(classLevels, abilities, pc.race);

    const equipment = assignEquipment(pc.pcClass, pc.level, pc.wealth, abilities);
    const char: CityCharacter = {
      name: il.name,
      race: pc.race,
      pcClass: pc.pcClass,
      level: pc.level,
      classLevels,
      combat,
      alignment: pc.alignment,
      deity: pc.deity,
      hitPoints: pc.hitPoints,
      abilities,
      age: pc.age,
      height: pc.height,
      weight: pc.weight,
      wealth: pc.wealth,
      equipment,
      illustrateType: il.type,
      illustrateBirthYear: il.birthYear,
      illustrateDeathYear: il.deathYear,
    };
    applyEquipmentToCombat(char);
    out.push(char);
  }

  // 2) Ordinary characters fill the remaining slots.
  for (let i = 0; i < ordinaryCount; i++) {
    const isDominant = rng() < profile.dominantBias;
    const raceWeights: Partial<Record<RaceType, number>> = isDominant
      ? { [dominantRace]: DOMINANT_RACE_MULT, ...(secondaryRace ? { [secondaryRace]: SECONDARY_RACE_MULT } : {}) }
      : { [dominantRace]: 2, ...(secondaryRace ? { [secondaryRace]: 1.5 } : {}) };

    const level = profile.minLevel + Math.floor(rng() * (profile.maxLevel - profile.minLevel + 1));

    // Small cities lock the deity to the dominant religion's choice when one
    // exists. Bigger cities use the broader weighted pool.
    const effectiveDeityWeights: Partial<Record<Deity, number>> | undefined =
      city.size === 'small' && dominantDeity
        ? { [dominantDeity]: 100 }
        : (Object.keys(deityWeights).length > 0 ? deityWeights : undefined);

    const pc = generatePcCharBiased(level, cityAlignment, rng, {
      raceWeights,
      deityWeights: effectiveDeityWeights,
    });

    // Convert ability Map → plain Record for serializable display.
    const abilities = {} as Record<Ability, number>;
    pc.abilities.forEach((v, k) => { abilities[k] = v; });

    const classLevels: ClassLevel[] = [{ pcClass: pc.pcClass, level: pc.level }];
    const combat = computeCombatStats(classLevels, abilities, pc.race);

    const equipment = assignEquipment(pc.pcClass, pc.level, pc.wealth, abilities);
    const char: CityCharacter = {
      name: generateIllustrateName(rng, usedNames),
      race: pc.race,
      pcClass: pc.pcClass,
      level: pc.level,
      classLevels,
      combat,
      alignment: pc.alignment,
      deity: pc.deity,
      hitPoints: pc.hitPoints,
      abilities,
      age: pc.age,
      height: pc.height,
      weight: pc.weight,
      wealth: pc.wealth,
      equipment,
    };
    applyEquipmentToCombat(char);
    out.push(char);
  }

  // Affiliation pass — runs on its own isolated PRNG sub-stream so adding /
  // tweaking the affiliation tables never shifts the existing roster (the
  // core character roll above stays byte-stable for legacy callers that
  // don't pass `cityMap`). Two phases:
  //   1. `assignGuaranteedLandmarks` — pre-claim one character per palace /
  //      castle / temple (best fit, RNG tie-break, round-robin by kind).
  //      May leave guaranteed slots empty if the roster is too small; the
  //      explicit allowance is "some places might not have a character".
  //   2. The remaining roster runs through `pickAffiliation`, which can
  //      still land additional characters at the same palace / castle /
  //      temple — so a single guaranteed slot may end up with multiple
  //      characters via this second pass.
  if (cityMap) {
    const affilRng = seededPRNG(worldSeed + '_charaffil_' + city.cellIndex + yearKey);
    const claimed = assignGuaranteedLandmarks(out, cityMap, affilRng);
    for (let i = 0; i < out.length; i++) {
      if (claimed.has(i)) continue;
      out[i].affiliation = pickAffiliation(out[i], cityMap, affilRng);
    }
  }

  // Relationship pass — also on its own PRNG sub-stream. Always runs (even
  // without a cityMap) since relationships only depend on the rolled roster
  // identities, not on the city map. Single-character rosters skip the pass
  // because there's no candidate target to link to.
  if (out.length >= 2) {
    const relRng = seededPRNG(worldSeed + '_charrel_' + city.cellIndex);
    assignRelationships(out, relRng);
  } else {
    for (const c of out) c.relationships = [];
  }

  // Spellcasting pass — isolated PRNG sub-stream per character so adding
  // future class slots / higher spell levels can't shift existing roster
  // output. Resolves spell slots, known spells (random for wizard / sorcerer
  // / bard, full class list for cleric / druid / paladin / ranger), and
  // memorized spells for prepared casters. Non-spellcasting classes get an
  // empty array.
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const spellRng = seededPRNG(worldSeed + '_charspells_' + city.cellIndex + '_' + i + yearKey);
    c.spellcasting = rollCharacterSpellcasting(c.classLevels, c.abilities, spellRng);
  }

  return out;
}

// ─── Relationship pass ─────────────────────────────────────────────────────

const RELATIONSHIP_CHANCE = 0.5;

/**
 * For each character, roll a 50% chance of "having a relationship". On a
 * hit, score every other character by shared traits (deity > class >
 * alignment > race) and pick one weighted-random target. Both endpoints
 * receive the link so popular characters accumulate multiple incoming
 * edges — matching the spec's "may have several relationships if several
 * other characters get related to them".
 *
 * A level gate filters out wildly mismatched pairs: a relationship can
 * only form when the lower-level character is at least HALF the level of
 * the higher-level one (`2 * min(La, Lb) >= max(La, Lb)`). The gate is
 * symmetric, so it removes both outgoing and incoming candidates in one
 * place.
 *
 * Symmetric: the same edge appears on both characters' lists with the same
 * `reason` label (the shared trait is symmetric by construction). Each
 * (i, j) pair is recorded at most once via a per-character `Set<number>` so
 * mutual outgoing rolls (A → B and B → A in the same year) don't duplicate.
 *
 * The link reason is derived from whichever shared trait has the strongest
 * score weight, falling back to "Acquainted" when nothing matches (the
 * weighted pick still allows a stranger pairing thanks to the +1 base
 * weight in the score table).
 */
function assignRelationships(characters: CityCharacter[], rng: () => number): void {
  const links: Set<number>[] = characters.map(() => new Set<number>());

  for (let i = 0; i < characters.length; i++) {
    if (rng() >= RELATIONSHIP_CHANCE) continue;

    const me = characters[i];
    let total = 0;
    const candidates: { index: number; weight: number }[] = [];
    for (let j = 0; j < characters.length; j++) {
      if (i === j) continue;
      const other = characters[j];
      // Level gate: relationships only form when one character is at
      // least half the level of the other (i.e. `2 * min >= max`).
      // Keeps level-1 commoners from being best friends with level-15
      // archmages while letting reasonable mentor / peer pairings
      // through (e.g. L4 ↔ L8 OK, L2 ↔ L5 not OK). Symmetric by
      // construction, so this also filters incoming edges.
      const minL = Math.min(me.level, other.level);
      const maxL = Math.max(me.level, other.level);
      if (2 * minL < maxL) continue;
      // Base 1 ensures any character can connect to any other (rare, but
      // not impossible). Deity is the strongest cue because it's the most
      // distinctive identity marker; race is the weakest because it
      // overlaps heavily with the country's race bias.
      let w = 1;
      if (me.deity !== 'none' && other.deity === me.deity) w += 4;
      if (other.pcClass === me.pcClass)                     w += 2;
      if (other.alignment === me.alignment)                 w += 3;
      if (other.race === me.race)                           w += 1;
      candidates.push({ index: j, weight: w });
      total += w;
    }
    if (candidates.length === 0 || total <= 0) continue;

    let roll = rng() * total;
    let chosen = candidates[candidates.length - 1].index;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) { chosen = c.index; break; }
    }

    links[i].add(chosen);
    links[chosen].add(i);
  }

  for (let i = 0; i < characters.length; i++) {
    const me = characters[i];
    me.relationships = Array.from(links[i])
      .sort((a, b) => a - b) // Stable ordering — index-ascending is deterministic
      .map(j => ({
        targetIndex: j,
        targetName: characters[j].name,
        reason: deriveRelationshipReason(me, characters[j]),
      }));
  }
}

/**
 * Pick the strongest shared trait between two characters and turn it into
 * a short display label. Same trait order as the scoring function: deity
 * first (rarest / most flavorful), then class (shared profession), then
 * alignment (shared moral compass), then race (shared kin), with a
 * neutral "Acquainted" fallback for stranger pairings.
 */
function deriveRelationshipReason(a: CityCharacter, b: CityCharacter): string {
  if (a.deity !== 'none' && a.deity === b.deity) return `Faith of ${a.deity}`;
  if (a.pcClass === b.pcClass) return `Fellow ${a.pcClass}`;
  if (a.alignment === b.alignment) return 'Same alignment';
  if (a.race === b.race) return `Kin (${raceLabel(a.race)})`;
  return 'Acquainted';
}

/**
 * Resolve the city's effective alignment for header-badge display, mirroring
 * the rule used inside `generateCityCharacters`. UI calls this independently
 * so it can render the badge even before scrolling the roster table into view.
 */
export function deriveCityAlignment(religions: ReligionDetail[]): AlignmentType {
  return religions[0]?.alignment ?? 'neutral_neutral';
}

/** Look up the deity display name for a `Deity` enum value. */
export function deityDisplayName(d: Deity): string {
  return DEITY_SPECS[d].name;
}
