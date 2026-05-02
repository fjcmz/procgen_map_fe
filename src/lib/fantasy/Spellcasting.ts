// D&D 3.5e spellcasting tables: spells per day, spells known, ability score
// gating, and the per-character resolver `rollCharacterSpellcasting` that
// turns a `(classLevels, abilities)` pair into ready-to-render
// `CharacterSpellcasting` entries.
//
// Scope: only level-1 player characters in v1. The tables below cover all
// 11 base classes for level 1; higher rows will land alongside higher-level
// spells in a follow-up.

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
   * `false` for spontaneous casters (sorcerer / bard): they cast directly
   * from a fixed list of spells known.
   */
  prepared: boolean;
  /**
   * `true` when the class draws from a fixed spell list of which they know
   * every spell (cleric / druid / paladin / ranger). The "spells known" tab
   * shows the full curated list for those classes; the prepared list is then
   * a sampled subset of it. `false` for wizard (limited spellbook) and the
   * spontaneous casters above.
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
 * Base spells per day at character level 1, indexed by spell level
 * (`[lvl0, lvl1, lvl2, ...]`). Bonus spells from ability score are added on
 * top in `bonusSpellsForLevel`. Bards don't get level-1 spells until their
 * second class level, and paladins / rangers don't get any spells at level 1.
 */
const BASE_SPELLS_PER_DAY_LV1: Partial<Record<PcClassType, readonly number[]>> = {
  wizard:   [3, 1],
  sorcerer: [5, 3],
  cleric:   [3, 1],
  druid:    [3, 1],
  bard:     [2],
  paladin:  [],
  ranger:   [],
};

/**
 * Base spells known at character level 1 for spontaneous casters and wizards
 * (whose spellbook starts with a fixed list of free spells). Indexed by spell
 * level. Cleric / druid / paladin / ranger draw from their full class list,
 * so they're not in this table.
 */
const BASE_SPELLS_KNOWN_LV1: Partial<Record<PcClassType, readonly number[]>> = {
  // Wizard's spellbook starts with all level-0 spells plus 3 + INT-mod
  // level-1 spells. The +INT mod is applied in `rollCharacterSpellcasting`.
  wizard:   [0, 3], // level-0 count is "all" — special-cased below
  sorcerer: [4, 2],
  bard:     [4, 0],
};

/**
 * D&D 3.5e Bonus Spells per Day table, derived analytically. Returns the
 * extra spells of `spellLevel` granted by an ability score. Cantrips (level 0)
 * never get bonus spells. Cap is enforced by callers via "max spell level you
 * can cast = ability_score - 10".
 *
 * Formula: `floor((mod + 4 - spellLevel) / 4)` when `mod >= spellLevel`, else 0.
 * Verified against PHB Table 1-1: at INT 14 (mod +2) → +1 lvl 1, +1 lvl 2;
 * at INT 20 (mod +5) → +2 lvl 1, +1 lvl 2-5.
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
 * Per-class spellcasting state baked at character-roll time.
 *
 * `slotsPerLevel[i]` is the total spells per day at spell level `i` (cantrips
 * at index 0). `memorizedPerLevel[i]` is the prepared list for that spell
 * level (only populated for prepared casters; spontaneous casters leave it
 * empty). `spellsKnown` is a flat list — for full-list classes
 * (cleric / druid / paladin / ranger) it's the full curated class list at all
 * levels the character can cast; for wizard / sorcerer / bard it's the
 * randomly rolled set.
 */
export interface CharacterSpellcasting {
  pcClass: PcClassType;
  ability: Ability;
  /** Mirror of `SPELLCASTING_CLASSES[pcClass].prepared` for UI convenience. */
  prepared: boolean;
  /** Mirror of `SPELLCASTING_CLASSES[pcClass].knowsFullList`. */
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
  // Fisher-Yates partial shuffle: pick `count` indices without replacement.
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
 * replacement when there are more slots than distinct spells in the pool
 * (a wizard with 2 level-1 slots and 5 spells in their spellbook is welcome
 * to memorize the same fireball twice).
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
 * `CharacterSpellcasting`. Non-spellcasting classes are skipped, so a fighter
 * returns `[]` and a multiclass fighter/wizard returns one entry for the
 * wizard side.
 *
 * v1 only handles level-1 class entries (the only level the spec requires)
 * — class-level rows above 1 fall back to the level-1 row with a warning
 * comment for the follow-up.
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
    if (maxLevel < 0) {
      // Even cantrips need ability ≥ 10; below that the class casts nothing.
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

    // v1: only level-1 base rows are tabulated. Higher class levels fall
    // through to the level-1 row.
    const baseSlots = BASE_SPELLS_PER_DAY_LV1[cl.pcClass] ?? [];
    const baseKnown = BASE_SPELLS_KNOWN_LV1[cl.pcClass];

    // Final slots per spell level: base + bonus spells from ability score,
    // clamped to spell levels the character can actually cast. Only spell
    // levels with a non-zero base entry get bonuses (you can't gain a slot
    // at a spell level your class doesn't grant yet).
    const slotsPerLevel: number[] = [];
    for (let lvl = 0; lvl < baseSlots.length; lvl++) {
      if (lvl > maxLevel) { slotsPerLevel.push(0); continue; }
      const base = baseSlots[lvl];
      const bonus = base > 0 ? bonusSpellsForLevel(abilityScore, lvl) : 0;
      slotsPerLevel.push(base + bonus);
    }

    // Spells known per level — different policy per class.
    const spellsKnown: Spell[] = [];
    if (info.knowsFullList) {
      // Cleric / druid / paladin / ranger know every spell on their list at
      // every level they can cast. For levels they can't cast yet there's
      // simply nothing to show.
      for (let lvl = 0; lvl < slotsPerLevel.length; lvl++) {
        if (slotsPerLevel[lvl] === 0) continue;
        spellsKnown.push(...spellsForClassAndLevel(cl.pcClass, lvl));
      }
    } else if (cl.pcClass === 'wizard') {
      // Wizard's spellbook: all level-0 spells the engine knows + 3 + INT mod
      // level-1 spells, randomly picked. Higher-level spell-knowns are added
      // when those tiers land in a follow-up.
      const cantripPool = spellsForClassAndLevel('wizard', 0);
      spellsKnown.push(...cantripPool);
      const intMod = abilityMod(abilityScore);
      for (let lvl = 1; lvl < slotsPerLevel.length; lvl++) {
        const knownCount = (baseKnown?.[lvl] ?? 0) + (lvl === 1 ? Math.max(0, intMod) : 0);
        const pool = spellsForClassAndLevel('wizard', lvl);
        spellsKnown.push(...pickDistinctSpells(pool, knownCount, rng));
      }
    } else {
      // Sorcerer / bard: known list straight from the BASE_SPELLS_KNOWN_LV1
      // table per spell level.
      for (let lvl = 0; lvl < (baseKnown?.length ?? 0); lvl++) {
        const knownCount = baseKnown?.[lvl] ?? 0;
        const pool = spellsForClassAndLevel(cl.pcClass, lvl);
        spellsKnown.push(...pickDistinctSpells(pool, knownCount, rng));
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
