// D&D 3.5e combat-side derived stats for the character generator: Base Attack
// Bonus (BAB), Armor Class (AC), and the three saving throws (Fortitude,
// Reflex, Will). Each total is computed as the sum of typed component
// contributions ("base" from class/level progression, "ability" from ability
// modifiers, plus expandable slots for armor / shield / racial / magical /
// misc) so the UI can show a clean breakdown without re-deriving the math.
//
// Multi-classing: every helper takes a `ClassLevel[]` so a character with
// multiple classes is summed across them. Single-class characters are
// represented as a length-1 array, which collapses to the canonical SRD value.

import type { Ability } from './Ability';
import { abilityMod } from './Ability';
import type { PcClassType } from './PcClassType';
import type { RaceType } from './RaceType';

/**
 * A single (class, levels-in-that-class) entry. A character's full progression
 * is a list of these — single-class characters use a length-1 list.
 */
export interface ClassLevel {
  pcClass: PcClassType;
  level: number;
}

/**
 * Bonus type tags. D&D 3.5e tracks bonus types so same-type bonuses don't
 * stack (only the largest applies) while different-type bonuses do.
 * Stacking is enforced by `sumWithStacking()` below, which every
 * `computeCombat*` total funnels through. Components are still recorded
 * individually so the UI breakdown can show the suppressed entries.
 *
 * The union is intentionally open-ended so callers can extend it via
 * declaration merging or just pass any string; the literal list covers the
 * common SRD types.
 */
export type BonusType =
  | 'base'         // class/level progression (BAB or saves) — never stacks with itself
  | 'ability'      // ability score modifier (STR/DEX/CON/WIS)
  | 'size'         // size modifier (small races get +1 AC, etc.)
  | 'armor'        // worn armour
  | 'shield'       // shield
  | 'natural'      // natural armour (race / spells)
  | 'dodge'        // dodge bonus (one of the few that stacks with itself)
  | 'deflection'   // deflection (e.g. Ring of Protection)
  | 'enhancement'  // enhancement bonus (magic weapons / armour)
  | 'resistance'   // resistance bonus (Cloak of Resistance)
  | 'racial'       // race-specific bonus (e.g. halfling +1 to all saves)
  | 'morale'       // morale bonus (bardic inspiration, etc.)
  | 'luck'
  | 'sacred'
  | 'profane'
  | 'insight'
  | 'competence'
  | 'magic'        // generic magical bonus (catch-all)
  | 'misc';

/** One typed contribution to a derived total. */
export interface BonusComponent {
  /** Short, human-readable label of where the value comes from (e.g. "Fighter L5", "DEX modifier"). */
  source: string;
  /** Signed integer contribution. Negative values represent penalties. */
  value: number;
  /** Stacking-aware bonus type tag. */
  type: BonusType;
}

/**
 * Result of a `computeCombat*` call: total + the ordered list of components
 * that summed to it. Callers typically render `total` in the main UI and
 * spread `components` into a breakdown popup.
 *
 * `total` reflects the SRD stacking rules (`sumWithStacking`): same-type
 * bonuses other than `base` / `ability` / `dodge` only contribute their
 * largest positive value, while penalties (negative values) always stack.
 * `components` retains every contribution so the UI can show suppressed
 * entries alongside the effective ones.
 */
export interface DerivedStat {
  total: number;
  components: BonusComponent[];
}

/**
 * Bonus types that always stack with themselves regardless of source. Per
 * the SRD: `dodge` explicitly stacks; `base` covers per-class progression
 * (a multi-class character's BAB is the sum of per-class BAB) and per-class
 * save progression; `ability` covers ability modifiers (each is unique by
 * source — STR / DEX / CON / WIS — so multiple entries never collide in
 * practice, but the rule is still "all apply").
 *
 * Every other type uses the "highest only" rule for positive contributions.
 */
export const STACKING_BONUS_TYPES: ReadonlySet<BonusType> = new Set<BonusType>([
  'base',
  'ability',
  'dodge',
]);

/**
 * Sum a list of typed bonus components under D&D 3.5e stacking rules:
 *   • `base` / `ability` / `dodge` — every entry contributes (full sum).
 *   • Penalties (value < 0) — always stack regardless of type.
 *   • All other types — only the single largest positive entry per type
 *     contributes.
 *
 * The input list is not modified; callers keep the full `components` array
 * for breakdown UIs and just use this for the displayed total.
 */
export function sumWithStacking(components: readonly BonusComponent[]): number {
  let total = 0;
  const maxByType = new Map<BonusType, number>();
  for (const c of components) {
    if (c.value < 0 || STACKING_BONUS_TYPES.has(c.type)) {
      total += c.value;
      continue;
    }
    const prev = maxByType.get(c.type) ?? 0;
    if (c.value > prev) maxByType.set(c.type, c.value);
  }
  for (const v of maxByType.values()) total += v;
  return total;
}

/** The three D&D saving throws. */
export interface Saves {
  fortitude: DerivedStat;
  reflex: DerivedStat;
  will: DerivedStat;
}

/** The full combat block surfaced on a `CityCharacter`. */
export interface CombatStats {
  bab: DerivedStat;
  ac: DerivedStat;
  saves: Saves;
}

// ─── Per-class BAB and save progressions ─────────────────────────────────

/** BAB progression rate per class, per the SRD. */
export type BabRate = 'full' | 'three_quarter' | 'half';

export const BAB_RATE_BY_CLASS: Record<PcClassType, BabRate> = {
  barbarian: 'full',
  bard: 'three_quarter',
  cleric: 'three_quarter',
  druid: 'three_quarter',
  fighter: 'full',
  monk: 'three_quarter',
  paladin: 'full',
  ranger: 'full',
  rogue: 'three_quarter',
  sorcerer: 'half',
  wizard: 'half',
};

/** "good" save = 2 + L/2; "poor" save = L/3. Per-class quality for each save. */
export type SaveQuality = 'good' | 'poor';
export interface SaveProfile {
  fortitude: SaveQuality;
  reflex: SaveQuality;
  will: SaveQuality;
}

export const SAVE_PROFILE_BY_CLASS: Record<PcClassType, SaveProfile> = {
  barbarian: { fortitude: 'good', reflex: 'poor', will: 'poor' },
  bard:      { fortitude: 'poor', reflex: 'good', will: 'good' },
  cleric:    { fortitude: 'good', reflex: 'poor', will: 'good' },
  druid:     { fortitude: 'good', reflex: 'poor', will: 'good' },
  fighter:   { fortitude: 'good', reflex: 'poor', will: 'poor' },
  monk:      { fortitude: 'good', reflex: 'good', will: 'good' },
  paladin:   { fortitude: 'good', reflex: 'poor', will: 'poor' },
  ranger:    { fortitude: 'good', reflex: 'good', will: 'poor' },
  rogue:     { fortitude: 'poor', reflex: 'good', will: 'poor' },
  sorcerer:  { fortitude: 'poor', reflex: 'poor', will: 'good' },
  wizard:    { fortitude: 'poor', reflex: 'poor', will: 'good' },
};

/** Fractional BAB contributed by `level` levels in a class with the given rate. */
export function babForClass(rate: BabRate, level: number): number {
  switch (rate) {
    case 'full':          return level;
    case 'three_quarter': return Math.floor((level * 3) / 4);
    case 'half':          return Math.floor(level / 2);
  }
}

/** Good save progression: 2 + floor(level / 2). */
export function goodSaveBase(level: number): number {
  return 2 + Math.floor(level / 2);
}

/** Poor save progression: floor(level / 3). */
export function poorSaveBase(level: number): number {
  return Math.floor(level / 3);
}

// ─── Race-derived bonuses ────────────────────────────────────────────────

/**
 * Size category for AC purposes. Halflings and gnomes are Small (+1 AC),
 * everyone else in our roster is Medium (+0). The AC-relevant size modifier
 * matches the D&D 3.5e table (Small +1, Medium +0).
 */
function sizeAcModifier(race: RaceType): number {
  switch (race) {
    case 'halfling':
    case 'gnome':
      return 1;
    default:
      return 0;
  }
}

/**
 * Returns a list of racial save bonuses to apply on top of the base + ability
 * modifier components. Currently encodes the headline 3.5e race save bonuses;
 * less common ones (e.g. dwarven +2 vs poison, gnome +2 vs illusion) are
 * conditional on the kind of save being attempted and don't apply to a flat
 * "save total", so they're omitted here. The shape leaves room to expand.
 */
function racialSaveBonuses(race: RaceType): {
  fortitude: BonusComponent[];
  reflex: BonusComponent[];
  will: BonusComponent[];
} {
  const out = { fortitude: [] as BonusComponent[], reflex: [] as BonusComponent[], will: [] as BonusComponent[] };
  if (race === 'halfling') {
    // Halflings get a +1 racial bonus on ALL saving throws.
    out.fortitude.push({ source: 'Halfling racial', value: 1, type: 'racial' });
    out.reflex.push({ source: 'Halfling racial', value: 1, type: 'racial' });
    out.will.push({ source: 'Halfling racial', value: 1, type: 'racial' });
  }
  return out;
}

// ─── Computation ─────────────────────────────────────────────────────────

/** Pretty class name for breakdown labels: "fighter" → "Fighter". */
function classLabel(c: PcClassType): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Read an ability score with a safe default of 10 (modifier 0). */
function score(abilities: Map<Ability, number> | Record<Ability, number>, ab: Ability): number {
  if (abilities instanceof Map) return abilities.get(ab) ?? 10;
  return abilities[ab] ?? 10;
}

/** Compute Base Attack Bonus, summing per-class BAB across the multiclass list. */
export function computeBAB(
  classLevels: readonly ClassLevel[],
  _abilities?: Map<Ability, number> | Record<Ability, number>,
  extraComponents: readonly BonusComponent[] = [],
): DerivedStat {
  const components: BonusComponent[] = [];
  for (const cl of classLevels) {
    const rate = BAB_RATE_BY_CLASS[cl.pcClass];
    const bab = babForClass(rate, cl.level);
    if (bab !== 0 || classLevels.length === 1) {
      components.push({
        source: `${classLabel(cl.pcClass)} L${cl.level}`,
        value: bab,
        type: 'base',
      });
    }
  }
  // BAB intentionally does NOT include STR / DEX modifiers — those apply at
  // attack-roll time (melee vs ranged), not to the BAB itself. The UI can
  // still show "BAB +X (melee +Y / ranged +Z)" by adding the relevant
  // ability mod on top; we expose ability modifiers via `extraComponents`
  // when callers want them in the same total.
  for (const c of extraComponents) components.push(c);
  return { total: sumWithStacking(components), components };
}

/**
 * Compute Armor Class. The minimum reflects an unarmored character with no
 * shield: 10 + Dex + size + race-relevant modifiers + caller-supplied extras
 * (armor, shield, magical, etc).
 */
export function computeAC(
  abilities: Map<Ability, number> | Record<Ability, number>,
  race: RaceType,
  extraComponents: readonly BonusComponent[] = [],
): DerivedStat {
  const components: BonusComponent[] = [];
  components.push({ source: 'Base', value: 10, type: 'base' });

  const dexMod = abilityMod(score(abilities, 'dexterity'));
  if (dexMod !== 0) {
    components.push({ source: 'DEX modifier', value: dexMod, type: 'ability' });
  }

  const sizeMod = sizeAcModifier(race);
  if (sizeMod !== 0) {
    components.push({ source: 'Small size', value: sizeMod, type: 'size' });
  }

  for (const c of extraComponents) components.push(c);
  return { total: sumWithStacking(components), components };
}

/**
 * Compute the three saving throws. Each save sums:
 *   • base  — sum across classes of `good` or `poor` progression at the
 *             relevant level (multi-class characters add per-class totals);
 *   • ability — CON for Fortitude, DEX for Reflex, WIS for Will;
 *   • racial — race-specific bonuses (e.g. halfling +1 to all saves);
 *   • extra — caller-supplied items (Cloak of Resistance, etc).
 */
export function computeSaves(
  classLevels: readonly ClassLevel[],
  abilities: Map<Ability, number> | Record<Ability, number>,
  race: RaceType,
  extras: { fortitude?: readonly BonusComponent[]; reflex?: readonly BonusComponent[]; will?: readonly BonusComponent[] } = {},
): Saves {
  const fortComponents: BonusComponent[] = [];
  const refComponents: BonusComponent[] = [];
  const willComponents: BonusComponent[] = [];

  for (const cl of classLevels) {
    const profile = SAVE_PROFILE_BY_CLASS[cl.pcClass];
    const fortBase = profile.fortitude === 'good' ? goodSaveBase(cl.level) : poorSaveBase(cl.level);
    const refBase  = profile.reflex    === 'good' ? goodSaveBase(cl.level) : poorSaveBase(cl.level);
    const willBase = profile.will      === 'good' ? goodSaveBase(cl.level) : poorSaveBase(cl.level);
    const label = `${classLabel(cl.pcClass)} L${cl.level} (${profile.fortitude}/${profile.reflex}/${profile.will})`;
    fortComponents.push({ source: label, value: fortBase, type: 'base' });
    refComponents.push({  source: label, value: refBase,  type: 'base' });
    willComponents.push({ source: label, value: willBase, type: 'base' });
  }

  const conMod = abilityMod(score(abilities, 'constitution'));
  const dexMod = abilityMod(score(abilities, 'dexterity'));
  const wisMod = abilityMod(score(abilities, 'wisdom'));
  if (conMod !== 0) fortComponents.push({ source: 'CON modifier', value: conMod, type: 'ability' });
  if (dexMod !== 0) refComponents.push({  source: 'DEX modifier', value: dexMod, type: 'ability' });
  if (wisMod !== 0) willComponents.push({ source: 'WIS modifier', value: wisMod, type: 'ability' });

  const racial = racialSaveBonuses(race);
  for (const c of racial.fortitude) fortComponents.push(c);
  for (const c of racial.reflex)    refComponents.push(c);
  for (const c of racial.will)      willComponents.push(c);

  if (extras.fortitude) for (const c of extras.fortitude) fortComponents.push(c);
  if (extras.reflex)    for (const c of extras.reflex)    refComponents.push(c);
  if (extras.will)      for (const c of extras.will)      willComponents.push(c);

  return {
    fortitude: { total: sumWithStacking(fortComponents), components: fortComponents },
    reflex:    { total: sumWithStacking(refComponents),  components: refComponents  },
    will:      { total: sumWithStacking(willComponents), components: willComponents },
  };
}

/**
 * One-stop computation of BAB + AC + Saves for a character. `extras` lets
 * callers thread typed equipment / magical bonuses through without
 * recomputing the per-stat math. All slots are optional; with no extras the
 * output is the canonical "level-and-ability-only" baseline.
 */
export function computeCombatStats(
  classLevels: readonly ClassLevel[],
  abilities: Map<Ability, number> | Record<Ability, number>,
  race: RaceType,
  extras: {
    bab?: readonly BonusComponent[];
    ac?: readonly BonusComponent[];
    fortitude?: readonly BonusComponent[];
    reflex?: readonly BonusComponent[];
    will?: readonly BonusComponent[];
  } = {},
): CombatStats {
  return {
    bab: computeBAB(classLevels, abilities, extras.bab),
    ac:  computeAC(abilities, race, extras.ac),
    saves: computeSaves(classLevels, abilities, race, {
      fortitude: extras.fortitude,
      reflex:    extras.reflex,
      will:      extras.will,
    }),
  };
}
