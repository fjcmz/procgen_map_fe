// Spell data model and a hand-curated v1 list of D&D 3.5e SRD level-1 spells.
//
// Scope: only spell name / level / school for now (per spec — "others will
// come later"). Each spell is tagged with the classes that have it on their
// spell list so the spellcasting layer can pick known/memorized spells per
// character. Higher-level spells will land in a follow-up.

import type { PcClassType } from './PcClassType';

export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

export const SPELL_SCHOOLS: readonly SpellSchool[] = [
  'abjuration', 'conjuration', 'divination', 'enchantment',
  'evocation', 'illusion', 'necromancy', 'transmutation',
];

export interface Spell {
  name: string;
  level: number;
  school: SpellSchool;
  /** Classes that include this spell on their spell list. */
  classes: readonly PcClassType[];
}

/**
 * Curated list of D&D 3.5e SRD level-1 spells. Each entry tags the classes
 * that have the spell on their spell list (Wizard / Sorcerer share a list).
 *
 * Level-0 (cantrips/orisons) and levels 2-9 are intentionally empty for v1 —
 * the popup will show those rows as "0 known" / "0 per day" until a follow-up
 * adds them.
 */
export const LEVEL_1_SPELLS: readonly Spell[] = [
  // ─── Abjuration ──────────────────────────────────────────────────────────
  { name: 'Shield',                level: 1, school: 'abjuration',    classes: ['wizard', 'sorcerer'] },
  { name: 'Sanctuary',             level: 1, school: 'abjuration',    classes: ['cleric'] },
  { name: 'Protection from Evil',  level: 1, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'cleric', 'paladin'] },
  { name: 'Protection from Good',  level: 1, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'cleric'] },
  { name: 'Shield of Faith',       level: 1, school: 'abjuration',    classes: ['cleric', 'paladin'] },
  { name: 'Endure Elements',       level: 1, school: 'abjuration',    classes: ['cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'wizard'] },

  // ─── Conjuration ─────────────────────────────────────────────────────────
  { name: 'Mage Armor',            level: 1, school: 'conjuration',   classes: ['wizard', 'sorcerer'] },
  { name: 'Grease',                level: 1, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Summon Monster I',      level: 1, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'cleric', 'bard'] },
  { name: "Summon Nature's Ally I",level: 1, school: 'conjuration',   classes: ['druid', 'ranger'] },
  { name: 'Cure Light Wounds',     level: 1, school: 'conjuration',   classes: ['cleric', 'druid', 'bard', 'paladin', 'ranger'] },
  { name: 'Inflict Light Wounds',  level: 1, school: 'conjuration',   classes: ['cleric'] },
  { name: 'Obscuring Mist',        level: 1, school: 'conjuration',   classes: ['cleric', 'druid', 'sorcerer', 'wizard'] },
  { name: 'Entropic Shield',       level: 1, school: 'conjuration',   classes: ['cleric'] },

  // ─── Divination ──────────────────────────────────────────────────────────
  { name: 'Identify',              level: 1, school: 'divination',    classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Comprehend Languages',  level: 1, school: 'divination',    classes: ['wizard', 'sorcerer', 'bard', 'cleric'] },
  { name: 'True Strike',           level: 1, school: 'divination',    classes: ['wizard', 'sorcerer'] },
  { name: 'Detect Secret Doors',   level: 1, school: 'divination',    classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Detect Evil',           level: 1, school: 'divination',    classes: ['cleric'] },
  { name: 'Detect Undead',         level: 1, school: 'divination',    classes: ['cleric', 'paladin', 'sorcerer', 'wizard'] },
  { name: 'Speak with Animals',    level: 1, school: 'divination',    classes: ['druid', 'ranger', 'bard'] },

  // ─── Enchantment ─────────────────────────────────────────────────────────
  { name: 'Charm Person',          level: 1, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Sleep',                 level: 1, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Hideous Laughter',      level: 1, school: 'enchantment',   classes: ['bard', 'wizard', 'sorcerer'] },
  { name: 'Bless',                 level: 1, school: 'enchantment',   classes: ['cleric', 'paladin'] },
  { name: 'Bane',                  level: 1, school: 'enchantment',   classes: ['cleric'] },
  { name: 'Command',               level: 1, school: 'enchantment',   classes: ['cleric'] },

  // ─── Evocation ───────────────────────────────────────────────────────────
  { name: 'Magic Missile',         level: 1, school: 'evocation',     classes: ['wizard', 'sorcerer'] },
  { name: 'Burning Hands',         level: 1, school: 'evocation',     classes: ['wizard', 'sorcerer'] },
  { name: 'Floating Disk',         level: 1, school: 'evocation',     classes: ['wizard', 'sorcerer'] },
  { name: 'Faerie Fire',           level: 1, school: 'evocation',     classes: ['druid'] },
  { name: 'Produce Flame',         level: 1, school: 'evocation',     classes: ['druid'] },
  { name: 'Divine Favor',          level: 1, school: 'evocation',     classes: ['cleric', 'paladin'] },

  // ─── Illusion ────────────────────────────────────────────────────────────
  { name: 'Color Spray',           level: 1, school: 'illusion',      classes: ['wizard', 'sorcerer'] },
  { name: 'Disguise Self',         level: 1, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Silent Image',          level: 1, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Magic Aura',            level: 1, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },

  // ─── Necromancy ──────────────────────────────────────────────────────────
  { name: 'Cause Fear',            level: 1, school: 'necromancy',    classes: ['wizard', 'sorcerer', 'cleric', 'bard'] },
  { name: 'Ray of Enfeeblement',   level: 1, school: 'necromancy',    classes: ['wizard', 'sorcerer'] },
  { name: 'Doom',                  level: 1, school: 'necromancy',    classes: ['cleric'] },

  // ─── Transmutation ───────────────────────────────────────────────────────
  { name: 'Enlarge Person',        level: 1, school: 'transmutation', classes: ['wizard', 'sorcerer'] },
  { name: 'Reduce Person',         level: 1, school: 'transmutation', classes: ['wizard', 'sorcerer'] },
  { name: 'Feather Fall',          level: 1, school: 'transmutation', classes: ['wizard', 'sorcerer'] },
  { name: 'Expeditious Retreat',   level: 1, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Magic Weapon',          level: 1, school: 'transmutation', classes: ['cleric', 'paladin'] },
  { name: 'Entangle',              level: 1, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Goodberry',             level: 1, school: 'transmutation', classes: ['druid'] },
  { name: 'Pass Without Trace',    level: 1, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Magic Fang',            level: 1, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Longstrider',           level: 1, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Animal Messenger',      level: 1, school: 'transmutation', classes: ['druid', 'ranger', 'bard'] },
];

/**
 * All spells the engine knows about, currently just `LEVEL_1_SPELLS`. Future
 * level-0 / level-2+ additions append to this list and the rest of the
 * spellcasting layer picks them up automatically via the `level` field.
 */
export const ALL_SPELLS: readonly Spell[] = LEVEL_1_SPELLS;

/**
 * Index spells by `(class, level)` for fast lookup at character-roll time.
 * Returned arrays are stable references; do not mutate.
 */
export function spellsForClassAndLevel(pcClass: PcClassType, spellLevel: number): readonly Spell[] {
  return ALL_SPELLS.filter(s => s.level === spellLevel && s.classes.includes(pcClass));
}
