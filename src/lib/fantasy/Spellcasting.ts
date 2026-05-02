// D&D 3.5e spellcasting tables for all base spellcasting classes, character
// levels 1-20, spell levels 0-9. Includes spells-per-day, spells-known
// (sorcerer / bard / wizard), the bonus-spell formula, and the
// `rollCharacterSpellcasting` resolver that turns a `(classLevels, abilities)`
// pair into `CharacterSpellcasting` entries the popup can render.
//
// Domain bonus spells are not modeled — cleric base slots only.

import type { Ability } from './Ability';
import { abilityMod } from './Ability';
import type { PcClassType } from './PcClassType';
import type { Spell } from './Spell';
import { spellsForClassAndLevel } from './Spell';
import type { ClassLevel } from './Combat';

/**
 * Static description of how a class casts spells. Non-spellcasters
 * (`fighter`, `barbarian`, `rogue`, `monk`) are absent from this map.
 */
export interface SpellcastingClassInfo {
  /** Ability that gates spellcasting (bonus spells, save DCs, max spell level). */
  ability: Ability;
  /**
   * `true` for prepared casters (wizard / cleric / druid / paladin / ranger):
   * they choose which spells to memorize each morning, then cast from those.
   * `false` for spontaneous casters (sorcerer / bard).
   */
  prepared: boolean;
  /**
   * `true` when the class draws from a fixed spell list of which they know
   * every spell (cleric / druid / paladin / ranger). The "spells known" tab
   * shows the full curated list for those classes; the prepared list is
   * then a sampled subset of it. `false` for wizard (limited spellbook) and
   * the spontaneous casters above.
   */
  knowsFullList: boolean;
}

export const SPELLCASTING_CLASSES: Partial<Record<PcClassType, SpellcastingClassInfo>> = {
  wizard:   { ability: 'intelligence', prepared: true,  knowsFullList: false },
  sorcerer: { ability: 'charisma',     prepared: false, knowsFullList: false },
  cleric:   { ability: 'wisdom',       prepared: true,  knowsFullList: true  },
  druid:    { ability: 'wisdom',       prepared: true,  knowsFullList: true  },
  bard:     { ability: 'charisma',     prepared: false, knowsFullList: false },
  paladin:  { ability: 'wisdom',       prepared: true,  knowsFullList: true  },
  ranger:   { ability: 'wisdom',       prepared: true,  knowsFullList: true  },
};

/**
 * Spells per day at each character level (1..20), indexed by spell level
 * (`row[0]` = cantrips, `row[N]` = level-N slot count). The PHB tables are
 * mirrored verbatim modulo cleric domain bonuses (always +1 at the spell
 * levels the cleric can prepare; not modeled here). A `0` entry means "the
 * slot exists but provides no base spell — only ability-bonus spells fill
 * it" (e.g. paladin level 4 lvl-1 is `[0, 0]`, becoming `[0, 1]` with WIS 12).
 *
 * Empty rows ([]) mean the class has no spells at that character level
 * (e.g. paladin / ranger char-levels 1-3).
 */
type SlotRow = readonly number[];

const TABLE_WIZARD: readonly SlotRow[] = [
  /*  1 */ [3, 1],
  /*  2 */ [4, 2],
  /*  3 */ [4, 2, 1],
  /*  4 */ [4, 3, 2],
  /*  5 */ [4, 3, 2, 1],
  /*  6 */ [4, 3, 3, 2],
  /*  7 */ [4, 4, 3, 2, 1],
  /*  8 */ [4, 4, 3, 3, 2],
  /*  9 */ [4, 4, 4, 3, 2, 1],
  /* 10 */ [4, 4, 4, 3, 3, 2],
  /* 11 */ [4, 4, 4, 4, 3, 2, 1],
  /* 12 */ [4, 4, 4, 4, 3, 3, 2],
  /* 13 */ [4, 4, 4, 4, 4, 3, 2, 1],
  /* 14 */ [4, 4, 4, 4, 4, 3, 3, 2],
  /* 15 */ [4, 4, 4, 4, 4, 4, 3, 2, 1],
  /* 16 */ [4, 4, 4, 4, 4, 4, 3, 3, 2],
  /* 17 */ [4, 4, 4, 4, 4, 4, 4, 3, 2, 1],
  /* 18 */ [4, 4, 4, 4, 4, 4, 4, 3, 3, 2],
  /* 19 */ [4, 4, 4, 4, 4, 4, 4, 4, 3, 3],
  /* 20 */ [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
];

const TABLE_SORCERER: readonly SlotRow[] = [
  /*  1 */ [5, 3],
  /*  2 */ [6, 4],
  /*  3 */ [6, 5],
  /*  4 */ [6, 6, 3],
  /*  5 */ [6, 6, 4],
  /*  6 */ [6, 6, 5, 3],
  /*  7 */ [6, 6, 6, 4],
  /*  8 */ [6, 6, 6, 5, 3],
  /*  9 */ [6, 6, 6, 6, 4],
  /* 10 */ [6, 6, 6, 6, 5, 3],
  /* 11 */ [6, 6, 6, 6, 6, 4],
  /* 12 */ [6, 6, 6, 6, 6, 5, 3],
  /* 13 */ [6, 6, 6, 6, 6, 6, 4],
  /* 14 */ [6, 6, 6, 6, 6, 6, 5, 3],
  /* 15 */ [6, 6, 6, 6, 6, 6, 6, 4],
  /* 16 */ [6, 6, 6, 6, 6, 6, 6, 5, 3],
  /* 17 */ [6, 6, 6, 6, 6, 6, 6, 6, 4],
  /* 18 */ [6, 6, 6, 6, 6, 6, 6, 6, 5, 3],
  /* 19 */ [6, 6, 6, 6, 6, 6, 6, 6, 6, 4],
  /* 20 */ [6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
];

const TABLE_CLERIC: readonly SlotRow[] = [
  /*  1 */ [3, 1],
  /*  2 */ [4, 2],
  /*  3 */ [4, 2, 1],
  /*  4 */ [5, 3, 2],
  /*  5 */ [5, 3, 2, 1],
  /*  6 */ [5, 3, 3, 2],
  /*  7 */ [6, 4, 3, 2, 1],
  /*  8 */ [6, 4, 3, 3, 2],
  /*  9 */ [6, 4, 4, 3, 2, 1],
  /* 10 */ [6, 4, 4, 3, 3, 2],
  /* 11 */ [6, 5, 4, 4, 3, 2, 1],
  /* 12 */ [6, 5, 4, 4, 3, 3, 2],
  /* 13 */ [6, 5, 5, 4, 4, 3, 2, 1],
  /* 14 */ [6, 5, 5, 4, 4, 3, 3, 2],
  /* 15 */ [6, 5, 5, 5, 4, 4, 3, 2, 1],
  /* 16 */ [6, 5, 5, 5, 4, 4, 3, 3, 2],
  /* 17 */ [6, 5, 5, 5, 5, 4, 4, 3, 2, 1],
  /* 18 */ [6, 5, 5, 5, 5, 4, 4, 3, 3, 2],
  /* 19 */ [6, 5, 5, 5, 5, 5, 4, 4, 3, 3],
  /* 20 */ [6, 5, 5, 5, 5, 5, 4, 4, 4, 4],
];

const TABLE_DRUID: readonly SlotRow[] = TABLE_CLERIC; // PHB druid table mirrors cleric base counts.

const TABLE_BARD: readonly SlotRow[] = [
  /*  1 */ [2],
  /*  2 */ [3, 0],
  /*  3 */ [3, 1],
  /*  4 */ [3, 2, 0],
  /*  5 */ [3, 3, 1],
  /*  6 */ [3, 3, 2],
  /*  7 */ [3, 3, 2, 0],
  /*  8 */ [3, 3, 3, 1],
  /*  9 */ [3, 3, 3, 2],
  /* 10 */ [3, 3, 3, 2, 0],
  /* 11 */ [3, 3, 3, 3, 1],
  /* 12 */ [3, 3, 3, 3, 2],
  /* 13 */ [3, 3, 3, 3, 2, 0],
  /* 14 */ [4, 3, 3, 3, 3, 1],
  /* 15 */ [4, 4, 3, 3, 3, 2],
  /* 16 */ [4, 4, 4, 3, 3, 2, 0],
  /* 17 */ [4, 4, 4, 4, 3, 3, 1],
  /* 18 */ [4, 4, 4, 4, 4, 3, 2],
  /* 19 */ [4, 4, 4, 4, 4, 4, 3],
  /* 20 */ [4, 4, 4, 4, 4, 4, 4],
];

const TABLE_PALADIN: readonly SlotRow[] = [
  /*  1 */ [],
  /*  2 */ [],
  /*  3 */ [],
  /*  4 */ [0, 0],
  /*  5 */ [0, 0],
  /*  6 */ [0, 1],
  /*  7 */ [0, 1],
  /*  8 */ [0, 1, 0],
  /*  9 */ [0, 1, 0],
  /* 10 */ [0, 1, 1],
  /* 11 */ [0, 1, 1, 0],
  /* 12 */ [0, 1, 1, 1],
  /* 13 */ [0, 1, 1, 1, 0],
  /* 14 */ [0, 2, 1, 1, 1],
  /* 15 */ [0, 2, 1, 1, 1],
  /* 16 */ [0, 2, 2, 1, 1],
  /* 17 */ [0, 2, 2, 2, 1],
  /* 18 */ [0, 3, 2, 2, 1],
  /* 19 */ [0, 3, 3, 3, 2],
  /* 20 */ [0, 3, 3, 3, 3],
];

const TABLE_RANGER: readonly SlotRow[] = TABLE_PALADIN; // SRD ranger spell-progression mirrors paladin.

const SPELLS_PER_DAY: Partial<Record<PcClassType, readonly SlotRow[]>> = {
  wizard:   TABLE_WIZARD,
  sorcerer: TABLE_SORCERER,
  cleric:   TABLE_CLERIC,
  druid:    TABLE_DRUID,
  bard:     TABLE_BARD,
  paladin:  TABLE_PALADIN,
  ranger:   TABLE_RANGER,
};

/**
 * Spells known per character level for spontaneous casters (sorcerer, bard)
 * and the wizard's pre-roll spellbook seed. Indexed by spell level. Cleric
 * / druid / paladin / ranger draw from the full class list and need no
 * spells-known table.
 */
const SPELLS_KNOWN_SORCERER: readonly SlotRow[] = [
  /*  1 */ [4, 2],
  /*  2 */ [5, 2],
  /*  3 */ [5, 3],
  /*  4 */ [6, 3, 1],
  /*  5 */ [6, 4, 2],
  /*  6 */ [7, 4, 2, 1],
  /*  7 */ [7, 5, 3, 2],
  /*  8 */ [8, 5, 3, 2, 1],
  /*  9 */ [8, 5, 4, 3, 2],
  /* 10 */ [9, 5, 4, 3, 2, 1],
  /* 11 */ [9, 5, 5, 4, 3, 2],
  /* 12 */ [9, 5, 5, 4, 3, 2, 1],
  /* 13 */ [9, 5, 5, 4, 4, 3, 2],
  /* 14 */ [9, 5, 5, 4, 4, 3, 2, 1],
  /* 15 */ [9, 5, 5, 4, 4, 4, 3, 2],
  /* 16 */ [9, 5, 5, 4, 4, 4, 3, 2, 1],
  /* 17 */ [9, 5, 5, 4, 4, 4, 3, 3, 2],
  /* 18 */ [9, 5, 5, 4, 4, 4, 3, 3, 2, 1],
  /* 19 */ [9, 5, 5, 4, 4, 4, 3, 3, 3, 2],
  /* 20 */ [9, 5, 5, 4, 4, 4, 3, 3, 3, 3],
];

const SPELLS_KNOWN_BARD: readonly SlotRow[] = [
  /*  1 */ [4, 2],
  /*  2 */ [5, 3],
  /*  3 */ [6, 3],
  /*  4 */ [6, 3, 2],
  /*  5 */ [6, 4, 3],
  /*  6 */ [6, 4, 3],
  /*  7 */ [6, 4, 4, 2],
  /*  8 */ [6, 4, 4, 3],
  /*  9 */ [6, 4, 4, 3],
  /* 10 */ [6, 4, 4, 4, 2],
  /* 11 */ [6, 4, 4, 4, 3],
  /* 12 */ [6, 4, 4, 4, 3],
  /* 13 */ [6, 4, 4, 4, 4, 2],
  /* 14 */ [6, 4, 4, 4, 4, 3],
  /* 15 */ [6, 4, 4, 4, 4, 3],
  /* 16 */ [6, 5, 4, 4, 4, 4, 2],
  /* 17 */ [6, 5, 5, 4, 4, 4, 3],
  /* 18 */ [6, 5, 5, 5, 4, 4, 3],
  /* 19 */ [6, 5, 5, 5, 5, 4, 4],
  /* 20 */ [6, 5, 5, 5, 5, 5, 4],
];

const SPELLS_KNOWN: Partial<Record<PcClassType, readonly SlotRow[]>> = {
  sorcerer: SPELLS_KNOWN_SORCERER,
  bard:     SPELLS_KNOWN_BARD,
};

/**
 * D&D 3.5e Bonus Spells per Day, derived analytically. Returns the extra
 * spells of `spellLevel` granted by an ability score. Cantrips (level 0)
 * never get bonus spells. Cap is enforced by callers via "max spell level
 * you can cast = ability_score - 10".
 *
 * Formula: `floor((mod + 4 - spellLevel) / 4)` when `mod >= spellLevel`, else 0.
 */
export function bonusSpellsForLevel(abilityScore: number, spellLevel: number): number {
  if (spellLevel <= 0) return 0;
  const mod = abilityMod(abilityScore);
  if (mod < spellLevel) return 0;
  return Math.floor((mod + 4 - spellLevel) / 4);
}

/**
 * Highest spell level a character can cast: must have ability score ≥
 * `10 + spellLevel`. Returns `-1` when the character can't even cast
 * cantrips (ability score below 10).
 */
export function maxSpellLevelForAbility(abilityScore: number): number {
  return abilityScore - 10;
}

/**
 * Read a row from a class table at a clamped character level (`1..20`).
 * Returns an empty array when the class has no entry at that level (the
 * outer code treats that as "no spells").
 */
function rowForLevel(table: readonly SlotRow[] | undefined, charLevel: number): SlotRow {
  if (!table) return [];
  const idx = Math.max(0, Math.min(table.length - 1, charLevel - 1));
  return table[idx] ?? [];
}

/**
 * Per-class spellcasting state baked at character-roll time.
 *
 * `slotsPerLevel[i]` is the total spells per day at spell level `i` (cantrips
 * at index 0). `memorizedPerLevel[i]` is the prepared list for that spell
 * level (only populated for prepared casters; spontaneous casters leave it
 * empty). `spellsKnown` is a flat list — for full-list classes
 * (cleric / druid / paladin / ranger) it's every spell on the class list at
 * each spell level the character can cast; for wizard / sorcerer / bard
 * it's the rolled set.
 */
export interface CharacterSpellcasting {
  pcClass: PcClassType;
  ability: Ability;
  prepared: boolean;
  knowsFullList: boolean;
  slotsPerLevel: number[];
  memorizedPerLevel: Spell[][];
  spellsKnown: Spell[];
  /** Cumulative caster level bonus from equipped items (e.g. Orange Prism Ioun Stone). */
  casterLevelBonus: number;
}

/**
 * Pick `count` distinct spells from `pool` using `rng`. When `count >= pool.length`
 * the entire pool is returned (in pool order). Stable result for a given
 * `(pool, count, rng)` triple.
 */
function pickDistinctSpells(pool: readonly Spell[], count: number, rng: () => number): Spell[] {
  if (count <= 0 || pool.length === 0) return [];
  if (count >= pool.length) return pool.slice();
  const indices = pool.map((_, i) => i);
  const out: Spell[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
    out.push(pool[indices[i]]);
  }
  return out;
}

/**
 * For prepared casters, choose which spells to memorize from the day's
 * spellbook / class list. Returns up to `slots` spells, sampling with
 * replacement when there are more slots than distinct spells in the pool.
 */
function pickMemorized(pool: readonly Spell[], slots: number, rng: () => number): Spell[] {
  if (slots <= 0 || pool.length === 0) return [];
  const out: Spell[] = [];
  for (let i = 0; i < slots; i++) {
    out.push(pool[Math.floor(rng() * pool.length)]);
  }
  return out;
}

/**
 * Resolve every spellcasting class on a character into a renderable
 * `CharacterSpellcasting`. Non-spellcasting classes are skipped.
 *
 * The ability bonus is applied to every spell-level slot present in the
 * base table (including `0` entries — that's how paladin / ranger / bard
 * gain their first castable level), capped at the highest spell level the
 * relevant ability can support (`score - 10`).
 */
export function rollCharacterSpellcasting(
  classLevels: readonly ClassLevel[],
  abilities: Record<Ability, number>,
  rng: () => number,
): CharacterSpellcasting[] {
  const out: CharacterSpellcasting[] = [];
  for (const cl of classLevels) {
    const info = SPELLCASTING_CLASSES[cl.pcClass];
    if (!info) continue;

    const abilityScore = abilities[info.ability] ?? 10;
    const maxLevel = maxSpellLevelForAbility(abilityScore);

    const baseSlots = rowForLevel(SPELLS_PER_DAY[cl.pcClass], cl.level);
    const baseKnown = SPELLS_KNOWN[cl.pcClass]
      ? rowForLevel(SPELLS_KNOWN[cl.pcClass], cl.level)
      : undefined;

    // No spell rows at all (e.g. paladin level 1-3) → empty entry.
    if (baseSlots.length === 0 || maxLevel < 0) {
      out.push({
        pcClass: cl.pcClass,
        ability: info.ability,
        prepared: info.prepared,
        knowsFullList: info.knowsFullList,
        slotsPerLevel: [],
        memorizedPerLevel: [],
        spellsKnown: [],
        casterLevelBonus: 0,
      });
      continue;
    }

    // Final slots per spell level: base + bonus spells from ability score,
    // applied to every spell-level slot present in the base row, clamped to
    // spell levels the character's ability supports. Cantrips (level 0)
    // never get bonus spells.
    const slotsPerLevel: number[] = [];
    for (let lvl = 0; lvl < baseSlots.length; lvl++) {
      if (lvl > maxLevel) { slotsPerLevel.push(0); continue; }
      const base = baseSlots[lvl];
      const bonus = bonusSpellsForLevel(abilityScore, lvl);
      slotsPerLevel.push(base + bonus);
    }

    // Spells known per level — different policy per class.
    const spellsKnown: Spell[] = [];
    if (info.knowsFullList) {
      // Cleric / druid / paladin / ranger know every spell on their list at
      // every level they can cast.
      for (let lvl = 0; lvl < slotsPerLevel.length; lvl++) {
        if (slotsPerLevel[lvl] === 0) continue;
        spellsKnown.push(...spellsForClassAndLevel(cl.pcClass, lvl));
      }
    } else if (cl.pcClass === 'wizard') {
      // Wizard's spellbook seeded with all level-0 spells plus a base of
      // `3 + INT mod` random spells per non-cantrip spell level the wizard
      // can cast (a flat-rate approximation of the SRD's "2 free spells per
      // level" accumulation rule). The level-1 row gets a `+2 per character
      // level past 1` bonus on top so high-level wizards have visibly fatter
      // spellbooks at their starting tier.
      spellsKnown.push(...spellsForClassAndLevel('wizard', 0));
      const intMod = abilityMod(abilityScore);
      for (let lvl = 1; lvl < slotsPerLevel.length; lvl++) {
        if (slotsPerLevel[lvl] === 0) continue;
        const baseCount = 3 + Math.max(0, intMod);
        const bonusForCharLevel = lvl === 1 ? Math.max(0, cl.level - 1) : 0;
        const knownCount = baseCount + bonusForCharLevel;
        const pool = spellsForClassAndLevel('wizard', lvl);
        spellsKnown.push(...pickDistinctSpells(pool, knownCount, rng));
      }
    } else {
      // Sorcerer / bard — fixed counts per spell level from the spells-known
      // table. Each row is sized for the SRD canon; only spell levels
      // present in the row are sampled.
      if (baseKnown) {
        for (let lvl = 0; lvl < baseKnown.length; lvl++) {
          if (lvl > maxLevel) continue;
          const knownCount = baseKnown[lvl];
          if (knownCount <= 0) continue;
          const pool = spellsForClassAndLevel(cl.pcClass, lvl);
          spellsKnown.push(...pickDistinctSpells(pool, knownCount, rng));
        }
      }
    }

    // Memorized list per spell level (prepared casters only). Drawn from
    // `spellsKnown` filtered by spell level.
    const memorizedPerLevel: Spell[][] = [];
    for (let lvl = 0; lvl < slotsPerLevel.length; lvl++) {
      if (!info.prepared || slotsPerLevel[lvl] === 0) {
        memorizedPerLevel.push([]);
        continue;
      }
      const pool = spellsKnown.filter(s => s.level === lvl);
      memorizedPerLevel.push(pickMemorized(pool, slotsPerLevel[lvl], rng));
    }

    out.push({
      pcClass: cl.pcClass,
      ability: info.ability,
      prepared: info.prepared,
      knowsFullList: info.knowsFullList,
      slotsPerLevel,
      memorizedPerLevel,
      spellsKnown,
      casterLevelBonus: 0,
    });
  }
  return out;
}
