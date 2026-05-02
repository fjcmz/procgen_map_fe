// Spell data model and a curated D&D 3.5e SRD spell list spanning levels 0-9
// across all spellcasting classes.
//
// Coverage targets ~5-8 spells per (class, spell level) so the in-game spell
// popup has visible variety per row. Class membership is the canonical SRD
// list; spells appearing on multiple class lists at the SAME spell level are
// listed once with a multi-class array. Spells whose level differs between
// classes (e.g. Hold Person — wizard 3rd, cleric/bard 2nd) get one entry per
// effective spell level.
//
// 3.5e has a "universal" school used by a handful of spells (Prestidigitation,
// Arcane Mark, Permanency); we map those onto `transmutation` since the
// `SpellSchool` union is intentionally limited to the eight named schools.

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
  /** Classes that include this spell on their spell list at `level`. */
  classes: readonly PcClassType[];
}

// Class-list shorthand to keep the data block compact.
const WS  : readonly PcClassType[] = ['wizard', 'sorcerer'];
const WSB : readonly PcClassType[] = ['wizard', 'sorcerer', 'bard'];
const WSC : readonly PcClassType[] = ['wizard', 'sorcerer', 'cleric'];
const WSCB: readonly PcClassType[] = ['wizard', 'sorcerer', 'cleric', 'bard'];
const WSBD: readonly PcClassType[] = ['wizard', 'sorcerer', 'bard', 'druid'];
const WSCD: readonly PcClassType[] = ['wizard', 'sorcerer', 'cleric', 'druid'];
const WSCDPR: readonly PcClassType[] = ['wizard', 'sorcerer', 'cleric', 'druid', 'paladin', 'ranger'];
const WSCBD: readonly PcClassType[] = ['wizard', 'sorcerer', 'cleric', 'bard', 'druid'];
const CD  : readonly PcClassType[] = ['cleric', 'druid'];
const CP  : readonly PcClassType[] = ['cleric', 'paladin'];
const DR  : readonly PcClassType[] = ['druid', 'ranger'];
const C   : readonly PcClassType[] = ['cleric'];
const D   : readonly PcClassType[] = ['druid'];

/**
 * Master spell list. Each entry is one (spell, class-level) pair: spells
 * appearing on multiple class lists at the SAME spell level share one entry,
 * those at different levels get one entry per spell level.
 */
export const ALL_SPELLS: readonly Spell[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 0 — Cantrips (arcane) / Orisons (divine). Paladins and rangers
  // have no level-0 spell list.
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Acid Splash',           level: 0, school: 'conjuration',   classes: WS },
  { name: 'Daze',                  level: 0, school: 'enchantment',   classes: WSB },
  { name: 'Detect Magic',          level: 0, school: 'divination',    classes: WSCBD },
  { name: 'Detect Poison',         level: 0, school: 'divination',    classes: WSCD },
  { name: 'Disrupt Undead',        level: 0, school: 'necromancy',    classes: WS },
  { name: 'Flare',                 level: 0, school: 'evocation',     classes: WSBD },
  { name: 'Ghost Sound',           level: 0, school: 'illusion',      classes: WSB },
  { name: 'Light',                 level: 0, school: 'evocation',     classes: WSCB },
  { name: 'Mage Hand',             level: 0, school: 'transmutation', classes: WSB },
  { name: 'Mending',               level: 0, school: 'transmutation', classes: WSCBD },
  { name: 'Message',               level: 0, school: 'transmutation', classes: WSB },
  { name: 'Open/Close',            level: 0, school: 'transmutation', classes: WSB },
  { name: 'Prestidigitation',      level: 0, school: 'transmutation', classes: WSB },
  { name: 'Ray of Frost',          level: 0, school: 'evocation',     classes: WS },
  { name: 'Read Magic',            level: 0, school: 'divination',    classes: WSCBD },
  { name: 'Resistance',            level: 0, school: 'abjuration',    classes: WSCBD },
  { name: 'Touch of Fatigue',      level: 0, school: 'necromancy',    classes: WS },
  { name: 'Arcane Mark',           level: 0, school: 'abjuration',    classes: WS },
  { name: 'Dancing Lights',        level: 0, school: 'evocation',     classes: WSB },
  { name: 'Lullaby',               level: 0, school: 'enchantment',   classes: ['bard'] },
  { name: 'Summon Instrument',     level: 0, school: 'conjuration',   classes: ['bard'] },
  { name: 'Create Water',          level: 0, school: 'conjuration',   classes: CD },
  { name: 'Cure Minor Wounds',     level: 0, school: 'conjuration',   classes: CD },
  { name: 'Guidance',              level: 0, school: 'divination',    classes: CD },
  { name: 'Inflict Minor Wounds',  level: 0, school: 'necromancy',    classes: C },
  { name: 'Purify Food and Drink', level: 0, school: 'transmutation', classes: CD },
  { name: 'Virtue',                level: 0, school: 'transmutation', classes: CD },
  { name: 'Know Direction',        level: 0, school: 'divination',    classes: ['druid', 'bard'] },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 1
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Shield',                level: 1, school: 'abjuration',    classes: WS },
  { name: 'Sanctuary',             level: 1, school: 'abjuration',    classes: C },
  { name: 'Protection from Evil',  level: 1, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'cleric', 'paladin'] },
  { name: 'Protection from Good',  level: 1, school: 'abjuration',    classes: WSC },
  { name: 'Shield of Faith',       level: 1, school: 'abjuration',    classes: CP },
  { name: 'Endure Elements',       level: 1, school: 'abjuration',    classes: WSCDPR },
  // Conjuration
  { name: 'Mage Armor',             level: 1, school: 'conjuration',   classes: WS },
  { name: 'Grease',                 level: 1, school: 'conjuration',   classes: WSB },
  { name: 'Summon Monster I',       level: 1, school: 'conjuration',   classes: WSCB },
  { name: "Summon Nature's Ally I", level: 1, school: 'conjuration',   classes: DR },
  { name: 'Cure Light Wounds',      level: 1, school: 'conjuration',   classes: ['cleric', 'druid', 'bard', 'paladin', 'ranger'] },
  { name: 'Inflict Light Wounds',   level: 1, school: 'conjuration',   classes: C },
  { name: 'Obscuring Mist',         level: 1, school: 'conjuration',   classes: WSCD },
  { name: 'Entropic Shield',        level: 1, school: 'conjuration',   classes: C },
  // Divination
  { name: 'Identify',              level: 1, school: 'divination',    classes: WSB },
  { name: 'Comprehend Languages',  level: 1, school: 'divination',    classes: WSCB },
  { name: 'True Strike',           level: 1, school: 'divination',    classes: WS },
  { name: 'Detect Secret Doors',   level: 1, school: 'divination',    classes: WSB },
  { name: 'Detect Evil',           level: 1, school: 'divination',    classes: C },
  { name: 'Detect Undead',         level: 1, school: 'divination',    classes: ['cleric', 'paladin', 'sorcerer', 'wizard'] },
  { name: 'Speak with Animals',    level: 1, school: 'divination',    classes: ['druid', 'ranger', 'bard'] },
  // Enchantment
  { name: 'Charm Person',          level: 1, school: 'enchantment',   classes: WSB },
  { name: 'Sleep',                 level: 1, school: 'enchantment',   classes: WSB },
  { name: 'Hideous Laughter',      level: 1, school: 'enchantment',   classes: ['bard', 'wizard', 'sorcerer'] },
  { name: 'Bless',                 level: 1, school: 'enchantment',   classes: CP },
  { name: 'Bane',                  level: 1, school: 'enchantment',   classes: C },
  { name: 'Command',               level: 1, school: 'enchantment',   classes: C },
  // Evocation
  { name: 'Magic Missile',         level: 1, school: 'evocation',     classes: WS },
  { name: 'Burning Hands',         level: 1, school: 'evocation',     classes: WS },
  { name: 'Floating Disk',         level: 1, school: 'evocation',     classes: WS },
  { name: 'Faerie Fire',           level: 1, school: 'evocation',     classes: D },
  { name: 'Produce Flame',         level: 1, school: 'evocation',     classes: D },
  { name: 'Divine Favor',          level: 1, school: 'evocation',     classes: CP },
  // Illusion
  { name: 'Color Spray',           level: 1, school: 'illusion',      classes: WS },
  { name: 'Disguise Self',         level: 1, school: 'illusion',      classes: WSB },
  { name: 'Silent Image',          level: 1, school: 'illusion',      classes: WSB },
  { name: 'Magic Aura',            level: 1, school: 'illusion',      classes: WSB },
  // Necromancy
  { name: 'Cause Fear',            level: 1, school: 'necromancy',    classes: WSCB },
  { name: 'Ray of Enfeeblement',   level: 1, school: 'necromancy',    classes: WS },
  { name: 'Doom',                  level: 1, school: 'necromancy',    classes: C },
  // Transmutation
  { name: 'Enlarge Person',        level: 1, school: 'transmutation', classes: WS },
  { name: 'Reduce Person',         level: 1, school: 'transmutation', classes: WS },
  { name: 'Feather Fall',          level: 1, school: 'transmutation', classes: WS },
  { name: 'Expeditious Retreat',   level: 1, school: 'transmutation', classes: WSB },
  { name: 'Magic Weapon',          level: 1, school: 'transmutation', classes: CP },
  { name: 'Entangle',              level: 1, school: 'transmutation', classes: DR },
  { name: 'Goodberry',             level: 1, school: 'transmutation', classes: D },
  { name: 'Pass Without Trace',    level: 1, school: 'transmutation', classes: DR },
  { name: 'Magic Fang',            level: 1, school: 'transmutation', classes: DR },
  { name: 'Longstrider',           level: 1, school: 'transmutation', classes: DR },
  { name: 'Animal Messenger',      level: 1, school: 'transmutation', classes: ['druid', 'ranger', 'bard'] },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 2
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Resist Energy',         level: 2, school: 'abjuration',    classes: ['cleric', 'druid', 'ranger', 'sorcerer', 'wizard'] },
  { name: 'Protection from Arrows',level: 2, school: 'abjuration',    classes: WS },
  { name: 'Obscure Object',        level: 2, school: 'abjuration',    classes: WSCB },
  { name: 'Shield Other',          level: 2, school: 'abjuration',    classes: CP },
  { name: 'Undetectable Alignment',level: 2, school: 'abjuration',    classes: ['bard', 'cleric', 'paladin'] },
  // Conjuration
  { name: 'Acid Arrow',            level: 2, school: 'conjuration',   classes: WS },
  { name: 'Web',                   level: 2, school: 'conjuration',   classes: WS },
  { name: 'Glitterdust',           level: 2, school: 'conjuration',   classes: WSB },
  { name: 'Summon Swarm',          level: 2, school: 'conjuration',   classes: WSBD },
  { name: 'Summon Monster II',     level: 2, school: 'conjuration',   classes: WSCB },
  { name: "Summon Nature's Ally II", level: 2, school: 'conjuration', classes: DR },
  { name: 'Fog Cloud',             level: 2, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Cure Moderate Wounds',  level: 2, school: 'conjuration',   classes: ['cleric', 'druid', 'bard', 'paladin', 'ranger'] },
  { name: 'Inflict Moderate Wounds', level: 2, school: 'conjuration', classes: C },
  { name: 'Delay Poison',          level: 2, school: 'conjuration',   classes: ['cleric', 'druid', 'paladin', 'ranger', 'bard'] },
  { name: 'Lesser Restoration',    level: 2, school: 'conjuration',   classes: ['cleric', 'paladin', 'druid'] },
  { name: 'Remove Paralysis',      level: 2, school: 'conjuration',   classes: CP },
  // Divination
  { name: 'Detect Thoughts',       level: 2, school: 'divination',    classes: WSB },
  { name: 'See Invisibility',      level: 2, school: 'divination',    classes: WSB },
  { name: 'Locate Object',         level: 2, school: 'divination',    classes: WSCB },
  { name: 'Find Traps',            level: 2, school: 'divination',    classes: C },
  { name: 'Augury',                level: 2, school: 'divination',    classes: C },
  { name: 'Status',                level: 2, school: 'divination',    classes: C },
  // Enchantment
  { name: 'Daze Monster',          level: 2, school: 'enchantment',   classes: WSB },
  { name: 'Touch of Idiocy',       level: 2, school: 'enchantment',   classes: WS },
  { name: 'Hold Person',           level: 2, school: 'enchantment',   classes: ['cleric', 'bard'] },
  { name: 'Calm Emotions',         level: 2, school: 'enchantment',   classes: ['cleric', 'bard'] },
  { name: 'Suggestion',            level: 2, school: 'enchantment',   classes: ['bard'] },
  { name: 'Enthrall',              level: 2, school: 'enchantment',   classes: ['bard', 'cleric'] },
  { name: 'Animal Trance',         level: 2, school: 'enchantment',   classes: ['bard', 'druid'] },
  { name: 'Hold Animal',           level: 2, school: 'enchantment',   classes: DR },
  { name: 'Aid',                   level: 2, school: 'enchantment',   classes: CP },
  { name: 'Zone of Truth',         level: 2, school: 'enchantment',   classes: CP },
  // Evocation
  { name: 'Continual Flame',       level: 2, school: 'evocation',     classes: WSC },
  { name: 'Darkness',              level: 2, school: 'evocation',     classes: WSCB },
  { name: 'Flaming Sphere',        level: 2, school: 'evocation',     classes: WSCD },
  { name: 'Scorching Ray',         level: 2, school: 'evocation',     classes: WS },
  { name: 'Shatter',               level: 2, school: 'evocation',     classes: WSCB },
  { name: 'Sound Burst',           level: 2, school: 'evocation',     classes: ['cleric', 'bard'] },
  { name: 'Gust of Wind',          level: 2, school: 'evocation',     classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Flame Blade',           level: 2, school: 'evocation',     classes: D },
  { name: 'Spiritual Weapon',      level: 2, school: 'evocation',     classes: C },
  { name: 'Consecrate',            level: 2, school: 'evocation',     classes: C },
  // Illusion
  { name: 'Blur',                  level: 2, school: 'illusion',      classes: WSB },
  { name: 'Hypnotic Pattern',      level: 2, school: 'illusion',      classes: WSB },
  { name: 'Invisibility',          level: 2, school: 'illusion',      classes: WSB },
  { name: 'Magic Mouth',           level: 2, school: 'illusion',      classes: WSB },
  { name: 'Mirror Image',          level: 2, school: 'illusion',      classes: WSB },
  { name: 'Misdirection',          level: 2, school: 'illusion',      classes: WSB },
  { name: 'Minor Image',           level: 2, school: 'illusion',      classes: WSB },
  { name: 'Silence',               level: 2, school: 'illusion',      classes: ['bard', 'cleric'] },
  // Necromancy
  { name: 'False Life',            level: 2, school: 'necromancy',    classes: WS },
  { name: 'Ghoul Touch',           level: 2, school: 'necromancy',    classes: WS },
  { name: 'Spectral Hand',         level: 2, school: 'necromancy',    classes: WS },
  { name: 'Blindness/Deafness',    level: 2, school: 'necromancy',    classes: WSCB },
  { name: 'Command Undead',        level: 2, school: 'necromancy',    classes: WS },
  { name: 'Scare',                 level: 2, school: 'necromancy',    classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Death Knell',           level: 2, school: 'necromancy',    classes: ['cleric', 'wizard', 'sorcerer'] },
  { name: 'Gentle Repose',         level: 2, school: 'necromancy',    classes: WSC },
  { name: 'Chill Metal',           level: 2, school: 'necromancy',    classes: D },
  { name: 'Heat Metal',            level: 2, school: 'necromancy',    classes: D },
  // Transmutation
  { name: "Bear's Endurance",      level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'cleric', 'druid', 'ranger'] },
  { name: "Bull's Strength",       level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'cleric', 'druid', 'paladin', 'bard'] },
  { name: "Cat's Grace",           level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'druid', 'ranger', 'bard'] },
  { name: "Eagle's Splendor",      level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'cleric', 'paladin', 'bard'] },
  { name: "Fox's Cunning",         level: 2, school: 'transmutation', classes: WSB },
  { name: "Owl's Wisdom",          level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'cleric', 'druid', 'paladin', 'ranger'] },
  { name: 'Alter Self',            level: 2, school: 'transmutation', classes: WSB },
  { name: 'Darkvision',            level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'ranger'] },
  { name: 'Knock',                 level: 2, school: 'transmutation', classes: WS },
  { name: 'Levitate',              level: 2, school: 'transmutation', classes: WS },
  { name: 'Pyrotechnics',          level: 2, school: 'transmutation', classes: WSB },
  { name: 'Rope Trick',            level: 2, school: 'transmutation', classes: WS },
  { name: 'Spider Climb',          level: 2, school: 'transmutation', classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Whispering Wind',       level: 2, school: 'transmutation', classes: WSB },
  { name: 'Barkskin',              level: 2, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Tree Shape',            level: 2, school: 'transmutation', classes: D },
  { name: 'Wood Shape',            level: 2, school: 'transmutation', classes: D },
  { name: 'Soften Earth and Stone',level: 2, school: 'transmutation', classes: D },
  { name: 'Reduce Animal',         level: 2, school: 'transmutation', classes: D },
  { name: 'Make Whole',            level: 2, school: 'transmutation', classes: WSC },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 3
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Dispel Magic',          level: 3, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'cleric', 'bard', 'paladin'] },
  { name: 'Magic Circle Against Evil', level: 3, school: 'abjuration',classes: ['wizard', 'sorcerer', 'cleric', 'paladin'] },
  { name: 'Nondetection',          level: 3, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'ranger'] },
  { name: 'Protection from Energy',level: 3, school: 'abjuration',    classes: ['cleric', 'druid', 'ranger', 'sorcerer', 'wizard'] },
  { name: 'Remove Curse',          level: 3, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'bard', 'cleric', 'paladin'] },
  { name: 'Glyph of Warding',      level: 3, school: 'abjuration',    classes: C },
  { name: 'Invisibility Purge',    level: 3, school: 'evocation',     classes: C },
  // Conjuration
  { name: 'Stinking Cloud',        level: 3, school: 'conjuration',   classes: WS },
  { name: 'Phantom Steed',         level: 3, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Sleet Storm',           level: 3, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Summon Monster III',    level: 3, school: 'conjuration',   classes: WSCB },
  { name: "Summon Nature's Ally III", level: 3, school: 'conjuration',classes: DR },
  { name: 'Cure Serious Wounds',   level: 3, school: 'conjuration',   classes: ['cleric', 'druid', 'bard'] },
  { name: 'Inflict Serious Wounds',level: 3, school: 'conjuration',   classes: C },
  { name: 'Create Food and Water', level: 3, school: 'conjuration',   classes: C },
  { name: 'Remove Disease',        level: 3, school: 'conjuration',   classes: ['cleric', 'druid', 'paladin', 'ranger'] },
  { name: 'Remove Blindness/Deafness', level: 3, school: 'conjuration',classes: CP },
  // Divination
  { name: 'Arcane Sight',          level: 3, school: 'divination',    classes: WS },
  { name: 'Clairaudience/Clairvoyance', level: 3, school: 'divination', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Tongues',               level: 3, school: 'divination',    classes: ['wizard', 'sorcerer', 'cleric', 'bard'] },
  { name: 'Speak with Dead',       level: 3, school: 'necromancy',    classes: C },
  { name: 'Helping Hand',          level: 3, school: 'evocation',     classes: C },
  // Enchantment
  { name: 'Deep Slumber',          level: 3, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Hold Person',           level: 3, school: 'enchantment',   classes: WS },
  { name: 'Heroism',               level: 3, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Suggestion',            level: 3, school: 'enchantment',   classes: WS },
  { name: 'Prayer',                level: 3, school: 'enchantment',   classes: CP },
  // Evocation
  { name: 'Daylight',              level: 3, school: 'evocation',     classes: ['wizard', 'sorcerer', 'bard', 'cleric', 'druid', 'paladin'] },
  { name: 'Fireball',              level: 3, school: 'evocation',     classes: WS },
  { name: 'Lightning Bolt',        level: 3, school: 'evocation',     classes: WS },
  { name: 'Wind Wall',             level: 3, school: 'evocation',     classes: ['cleric', 'druid', 'ranger', 'wizard', 'sorcerer'] },
  { name: 'Tiny Hut',              level: 3, school: 'evocation',     classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Searing Light',         level: 3, school: 'evocation',     classes: C },
  { name: 'Deeper Darkness',       level: 3, school: 'evocation',     classes: C },
  { name: 'Call Lightning',        level: 3, school: 'evocation',     classes: D },
  // Illusion
  { name: 'Displacement',          level: 3, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Major Image',           level: 3, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Invisibility Sphere',   level: 3, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  // Necromancy
  { name: 'Animate Dead',          level: 3, school: 'necromancy',    classes: C },
  { name: 'Bestow Curse',          level: 3, school: 'necromancy',    classes: ['cleric', 'wizard', 'sorcerer'] },
  { name: 'Halt Undead',           level: 3, school: 'necromancy',    classes: WS },
  { name: 'Ray of Exhaustion',     level: 3, school: 'necromancy',    classes: WS },
  { name: 'Vampiric Touch',        level: 3, school: 'necromancy',    classes: WS },
  // Transmutation
  { name: 'Fly',                   level: 3, school: 'transmutation', classes: WS },
  { name: 'Gaseous Form',          level: 3, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Haste',                 level: 3, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Slow',                  level: 3, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Keen Edge',             level: 3, school: 'transmutation', classes: WS },
  { name: 'Magic Weapon, Greater', level: 3, school: 'transmutation', classes: ['cleric', 'paladin', 'wizard', 'sorcerer'] },
  { name: 'Magic Vestment',        level: 3, school: 'transmutation', classes: CP },
  { name: 'Shrink Item',           level: 3, school: 'transmutation', classes: WS },
  { name: 'Blink',                 level: 3, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Water Breathing',       level: 3, school: 'transmutation', classes: ['wizard', 'sorcerer', 'cleric', 'druid'] },
  { name: 'Water Walk',            level: 3, school: 'transmutation', classes: ['cleric', 'druid', 'ranger'] },
  { name: 'Stone Shape',           level: 3, school: 'transmutation', classes: ['cleric', 'druid'] },
  { name: 'Meld into Stone',       level: 3, school: 'transmutation', classes: ['cleric', 'druid'] },
  { name: 'Plant Growth',          level: 3, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Spike Growth',          level: 3, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Snare',                 level: 3, school: 'transmutation', classes: DR },
  { name: 'Diminish Plants',       level: 3, school: 'transmutation', classes: ['druid', 'ranger'] },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 4
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Dimensional Anchor',    level: 4, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'cleric'] },
  { name: 'Dismissal',             level: 4, school: 'abjuration',    classes: WSC },
  { name: 'Fire Trap',             level: 4, school: 'abjuration',    classes: ['druid', 'wizard', 'sorcerer'] },
  { name: 'Lesser Globe of Invulnerability', level: 4, school: 'abjuration', classes: WS },
  { name: 'Stoneskin',             level: 4, school: 'abjuration',    classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Death Ward',            level: 4, school: 'necromancy',    classes: ['cleric', 'druid', 'paladin'] },
  { name: 'Freedom of Movement',   level: 4, school: 'abjuration',    classes: ['bard', 'cleric', 'druid', 'ranger'] },
  { name: 'Spell Immunity',        level: 4, school: 'abjuration',    classes: C },
  // Conjuration
  { name: 'Black Tentacles',       level: 4, school: 'conjuration',   classes: WS },
  { name: 'Dimension Door',        level: 4, school: 'conjuration',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: "Mordenkainen's Faithful Hound", level: 4, school: 'conjuration', classes: WS },
  { name: 'Solid Fog',             level: 4, school: 'conjuration',   classes: WS },
  { name: 'Summon Monster IV',     level: 4, school: 'conjuration',   classes: WSCB },
  { name: "Summon Nature's Ally IV", level: 4, school: 'conjuration', classes: D },
  { name: 'Cure Critical Wounds',  level: 4, school: 'conjuration',   classes: ['cleric', 'druid', 'bard'] },
  { name: 'Inflict Critical Wounds', level: 4, school: 'conjuration', classes: C },
  { name: 'Neutralize Poison',     level: 4, school: 'conjuration',   classes: ['bard', 'cleric', 'druid', 'paladin', 'ranger'] },
  { name: 'Restoration',           level: 4, school: 'conjuration',   classes: ['cleric', 'paladin'] },
  // Divination
  { name: 'Arcane Eye',            level: 4, school: 'divination',    classes: WS },
  { name: 'Detect Scrying',        level: 4, school: 'divination',    classes: WSB },
  { name: 'Locate Creature',       level: 4, school: 'divination',    classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Scrying',               level: 4, school: 'divination',    classes: ['wizard', 'sorcerer', 'bard', 'cleric', 'druid'] },
  { name: 'Divination',            level: 4, school: 'divination',    classes: C },
  { name: 'Discern Lies',          level: 4, school: 'divination',    classes: ['cleric', 'paladin'] },
  // Enchantment
  { name: 'Charm Monster',         level: 4, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Confusion',             level: 4, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Crushing Despair',      level: 4, school: 'enchantment',   classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Dominate Animal',       level: 4, school: 'enchantment',   classes: ['druid', 'ranger'] },
  { name: 'Hold Monster',          level: 4, school: 'enchantment',   classes: ['bard'] },
  // Evocation
  { name: 'Fire Shield',           level: 4, school: 'evocation',     classes: WS },
  { name: 'Ice Storm',             level: 4, school: 'evocation',     classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Resilient Sphere',      level: 4, school: 'evocation',     classes: WS },
  { name: 'Shout',                 level: 4, school: 'evocation',     classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Wall of Fire',          level: 4, school: 'evocation',     classes: ['wizard', 'sorcerer', 'druid'] },
  { name: 'Wall of Ice',           level: 4, school: 'evocation',     classes: WS },
  { name: 'Air Walk',              level: 4, school: 'transmutation', classes: ['cleric', 'druid', 'ranger'] },
  // Illusion
  { name: 'Greater Invisibility',  level: 4, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Hallucinatory Terrain', level: 4, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Illusory Wall',         level: 4, school: 'illusion',      classes: WS },
  { name: 'Phantasmal Killer',     level: 4, school: 'illusion',      classes: WS },
  { name: 'Rainbow Pattern',       level: 4, school: 'illusion',      classes: ['wizard', 'sorcerer', 'bard'] },
  // Necromancy
  { name: 'Bestow Curse',          level: 4, school: 'necromancy',    classes: ['bard'] },
  { name: 'Contagion',             level: 4, school: 'necromancy',    classes: ['cleric', 'druid', 'wizard', 'sorcerer'] },
  { name: 'Enervation',            level: 4, school: 'necromancy',    classes: WS },
  { name: 'Fear',                  level: 4, school: 'necromancy',    classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Poison',                level: 4, school: 'necromancy',    classes: ['druid', 'cleric'] },
  // Transmutation
  { name: 'Polymorph',             level: 4, school: 'transmutation', classes: ['wizard', 'sorcerer', 'bard'] },
  { name: 'Reduce Person, Mass',   level: 4, school: 'transmutation', classes: WS },
  { name: 'Enlarge Person, Mass',  level: 4, school: 'transmutation', classes: WS },
  { name: 'Repel Vermin',          level: 4, school: 'abjuration',    classes: ['cleric', 'druid', 'ranger'] },
  { name: 'Rusting Grasp',         level: 4, school: 'transmutation', classes: D },
  { name: "Cat's Grace, Mass",     level: 4, school: 'transmutation', classes: WS },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 5 — bard caps at 6, paladin/ranger at 4. Cleric / druid / W / S only.
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Break Enchantment',     level: 5, school: 'abjuration',    classes: ['bard', 'cleric', 'paladin', 'sorcerer', 'wizard'] },
  { name: 'Dispel Evil',           level: 5, school: 'abjuration',    classes: ['cleric', 'paladin'] },
  { name: 'Dispel Good',           level: 5, school: 'abjuration',    classes: C },
  { name: 'Spell Resistance',      level: 5, school: 'abjuration',    classes: C },
  { name: 'Greater Dispel Magic',  level: 5, school: 'abjuration',    classes: ['bard'] },
  // Conjuration
  { name: 'Cloudkill',             level: 5, school: 'conjuration',   classes: WS },
  { name: "Mordenkainen's Faithful Hound", level: 5, school: 'conjuration', classes: ['bard'] },
  { name: 'Summon Monster V',      level: 5, school: 'conjuration',   classes: WSC },
  { name: "Summon Nature's Ally V", level: 5, school: 'conjuration',  classes: D },
  { name: 'Wall of Stone',         level: 5, school: 'conjuration',   classes: ['cleric', 'druid', 'sorcerer', 'wizard'] },
  { name: 'Wall of Thorns',        level: 5, school: 'conjuration',   classes: D },
  { name: 'Cure Light Wounds, Mass', level: 5, school: 'conjuration', classes: ['cleric', 'druid', 'bard'] },
  { name: 'Insect Plague',         level: 5, school: 'conjuration',   classes: ['cleric', 'druid'] },
  { name: 'Plane Shift',           level: 5, school: 'conjuration',   classes: ['cleric'] },
  { name: 'Raise Dead',            level: 5, school: 'conjuration',   classes: C },
  // Divination
  { name: 'Commune',               level: 5, school: 'divination',    classes: C },
  { name: 'Commune with Nature',   level: 5, school: 'divination',    classes: ['druid', 'ranger'] },
  { name: 'True Seeing',           level: 5, school: 'divination',    classes: ['cleric', 'druid', 'sorcerer', 'wizard'] },
  // Enchantment
  { name: 'Dominate Person',       level: 5, school: 'enchantment',   classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Feeblemind',            level: 5, school: 'enchantment',   classes: WS },
  { name: 'Mind Fog',              level: 5, school: 'enchantment',   classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Symbol of Sleep',       level: 5, school: 'enchantment',   classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Suggestion, Mass',      level: 5, school: 'enchantment',   classes: ['bard', 'sorcerer', 'wizard'] },
  // Evocation
  { name: 'Cone of Cold',          level: 5, school: 'evocation',     classes: WS },
  { name: 'Wall of Force',         level: 5, school: 'evocation',     classes: WS },
  { name: 'Fire Shield, Communal', level: 5, school: 'evocation',     classes: ['bard'] },
  { name: 'Flame Strike',          level: 5, school: 'evocation',     classes: ['cleric', 'druid'] },
  { name: 'Call Lightning Storm',  level: 5, school: 'evocation',     classes: D },
  // Illusion
  { name: 'Dream',                 level: 5, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Mirage Arcana',         level: 5, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Nightmare',             level: 5, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Persistent Image',      level: 5, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Seeming',               level: 5, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  // Necromancy
  { name: 'Magic Jar',             level: 5, school: 'necromancy',    classes: WS },
  { name: 'Slay Living',           level: 5, school: 'necromancy',    classes: C },
  { name: 'Symbol of Pain',        level: 5, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Waves of Fatigue',      level: 5, school: 'necromancy',    classes: WS },
  { name: 'Blight',                level: 5, school: 'necromancy',    classes: ['druid', 'sorcerer', 'wizard'] },
  // Transmutation
  { name: 'Animal Growth',         level: 5, school: 'transmutation', classes: ['druid', 'ranger', 'sorcerer', 'wizard'] },
  { name: 'Baleful Polymorph',     level: 5, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Telekinesis',           level: 5, school: 'transmutation', classes: WS },
  { name: 'Transmute Mud to Rock', level: 5, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Transmute Rock to Mud', level: 5, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Tree Stride',           level: 5, school: 'transmutation', classes: ['druid', 'ranger'] },
  { name: 'Awaken',                level: 5, school: 'transmutation', classes: D },
  { name: 'Animal Messenger, Mass',level: 5, school: 'enchantment',   classes: ['bard'] },
  { name: 'Major Creation',        level: 5, school: 'conjuration',   classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Hallow',                level: 5, school: 'evocation',     classes: ['cleric', 'druid'] },
  { name: 'Unhallow',              level: 5, school: 'evocation',     classes: ['cleric', 'druid'] },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 6 — bard caps here.
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Antimagic Field',       level: 6, school: 'abjuration',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Dispel Magic, Greater', level: 6, school: 'abjuration',    classes: ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'] },
  { name: 'Globe of Invulnerability', level: 6, school: 'abjuration', classes: WS },
  { name: 'Repulsion',             level: 6, school: 'abjuration',    classes: ['cleric', 'sorcerer', 'wizard'] },
  // Conjuration
  { name: 'Acid Fog',              level: 6, school: 'conjuration',   classes: WS },
  { name: 'Planar Ally',           level: 6, school: 'conjuration',   classes: C },
  { name: 'Summon Monster VI',     level: 6, school: 'conjuration',   classes: ['bard', 'cleric', 'sorcerer', 'wizard'] },
  { name: "Summon Nature's Ally VI", level: 6, school: 'conjuration', classes: D },
  { name: 'Heal',                  level: 6, school: 'conjuration',   classes: ['cleric', 'druid'] },
  { name: 'Harm',                  level: 6, school: 'conjuration',   classes: C },
  { name: 'Cure Moderate Wounds, Mass', level: 6, school: 'conjuration', classes: ['bard', 'cleric', 'druid'] },
  { name: 'Wall of Iron',          level: 6, school: 'conjuration',   classes: WS },
  { name: 'Create Undead',         level: 6, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  // Divination
  { name: 'Find the Path',         level: 6, school: 'divination',    classes: ['bard', 'cleric', 'druid'] },
  { name: 'Legend Lore',           level: 6, school: 'divination',    classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'True Seeing',           level: 6, school: 'divination',    classes: ['bard'] },
  { name: 'Analyze Dweomer',       level: 6, school: 'divination',    classes: ['bard', 'sorcerer', 'wizard'] },
  // Enchantment
  { name: 'Geas/Quest',            level: 6, school: 'enchantment',   classes: ['bard', 'cleric', 'sorcerer', 'wizard'] },
  { name: 'Heroism, Greater',      level: 6, school: 'enchantment',   classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Suggestion, Mass',      level: 6, school: 'enchantment',   classes: ['bard'] },
  { name: 'Symbol of Persuasion',  level: 6, school: 'enchantment',   classes: ['cleric', 'sorcerer', 'wizard'] },
  // Evocation
  { name: 'Chain Lightning',       level: 6, school: 'evocation',     classes: WS },
  { name: 'Contingency',           level: 6, school: 'evocation',     classes: WS },
  { name: 'Forceful Hand',         level: 6, school: 'evocation',     classes: WS },
  { name: 'Fire Seeds',            level: 6, school: 'evocation',     classes: D },
  { name: 'Word of Recall',        level: 6, school: 'conjuration',   classes: ['cleric', 'druid'] },
  // Illusion
  { name: 'Mislead',               level: 6, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Permanent Image',       level: 6, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Programmed Image',      level: 6, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Shadow Walk',           level: 6, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  { name: 'Veil',                  level: 6, school: 'illusion',      classes: ['bard', 'sorcerer', 'wizard'] },
  // Necromancy
  { name: 'Circle of Death',       level: 6, school: 'necromancy',    classes: WS },
  { name: 'Symbol of Fear',        level: 6, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Undeath to Death',      level: 6, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Eyebite',               level: 6, school: 'necromancy',    classes: ['bard', 'sorcerer', 'wizard'] },
  // Transmutation
  { name: 'Disintegrate',          level: 6, school: 'transmutation', classes: WS },
  { name: 'Flesh to Stone',        level: 6, school: 'transmutation', classes: WS },
  { name: 'Stone to Flesh',        level: 6, school: 'transmutation', classes: WS },
  { name: 'Move Earth',            level: 6, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Transformation',        level: 6, school: 'transmutation', classes: WS },
  { name: 'Liveoak',               level: 6, school: 'transmutation', classes: D },
  { name: 'Animate Objects',       level: 6, school: 'transmutation', classes: ['bard', 'cleric'] },
  { name: 'Stone Tell',            level: 6, school: 'divination',    classes: D },
  { name: 'Transport via Plants',  level: 6, school: 'conjuration',   classes: D },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 7 — cleric / druid / wizard / sorcerer only.
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Banishment',            level: 7, school: 'abjuration',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Spell Turning',         level: 7, school: 'abjuration',    classes: WS },
  { name: 'Sequester',             level: 7, school: 'abjuration',    classes: WS },
  { name: 'Repulsion',             level: 7, school: 'abjuration',    classes: D },
  // Conjuration
  { name: 'Greater Teleport',      level: 7, school: 'conjuration',   classes: WS },
  { name: 'Plane Shift',           level: 7, school: 'conjuration',   classes: WS },
  { name: 'Summon Monster VII',    level: 7, school: 'conjuration',   classes: WSC },
  { name: "Summon Nature's Ally VII", level: 7, school: 'conjuration',classes: D },
  { name: 'Cure Serious Wounds, Mass', level: 7, school: 'conjuration', classes: ['cleric', 'druid'] },
  { name: 'Restoration, Greater',  level: 7, school: 'conjuration',   classes: C },
  { name: 'Resurrection',          level: 7, school: 'conjuration',   classes: C },
  { name: 'Heroes\' Feast',        level: 7, school: 'conjuration',   classes: ['bard', 'cleric'] },
  // Divination
  { name: 'Vision',                level: 7, school: 'divination',    classes: WS },
  { name: 'Scrying, Greater',      level: 7, school: 'divination',    classes: ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'] },
  // Enchantment
  { name: 'Hold Person, Mass',     level: 7, school: 'enchantment',   classes: WS },
  { name: 'Insanity',              level: 7, school: 'enchantment',   classes: WS },
  { name: 'Power Word Blind',      level: 7, school: 'enchantment',   classes: WS },
  { name: 'Symbol of Stunning',    level: 7, school: 'enchantment',   classes: ['cleric', 'sorcerer', 'wizard'] },
  // Evocation
  { name: 'Delayed Blast Fireball',level: 7, school: 'evocation',     classes: WS },
  { name: 'Forcecage',             level: 7, school: 'evocation',     classes: WS },
  { name: 'Prismatic Spray',       level: 7, school: 'evocation',     classes: WS },
  { name: 'Sunbeam',               level: 7, school: 'evocation',     classes: D },
  { name: 'Fire Storm',            level: 7, school: 'evocation',     classes: ['cleric', 'druid'] },
  // Illusion
  { name: 'Invisibility, Mass',    level: 7, school: 'illusion',      classes: WS },
  { name: 'Phase Door',            level: 7, school: 'transmutation', classes: WS },
  { name: 'Project Image',         level: 7, school: 'illusion',      classes: WS },
  { name: 'Simulacrum',            level: 7, school: 'illusion',      classes: WS },
  // Necromancy
  { name: 'Control Undead',        level: 7, school: 'necromancy',    classes: WS },
  { name: 'Finger of Death',       level: 7, school: 'necromancy',    classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Symbol of Weakness',    level: 7, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Waves of Exhaustion',   level: 7, school: 'necromancy',    classes: WS },
  // Transmutation
  { name: 'Control Weather',       level: 7, school: 'transmutation', classes: ['cleric', 'druid', 'sorcerer', 'wizard'] },
  { name: 'Ethereal Jaunt',        level: 7, school: 'transmutation', classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Reverse Gravity',       level: 7, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Statue',                level: 7, school: 'transmutation', classes: WS },
  { name: 'Animate Plants',        level: 7, school: 'transmutation', classes: D },
  { name: 'Transmute Metal to Wood', level: 7, school: 'transmutation', classes: D },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 8
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Dimensional Lock',      level: 8, school: 'abjuration',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Mind Blank',            level: 8, school: 'abjuration',    classes: WS },
  { name: 'Prismatic Wall',        level: 8, school: 'abjuration',    classes: WS },
  { name: 'Protection from Spells',level: 8, school: 'abjuration',    classes: WS },
  // Conjuration
  { name: 'Incendiary Cloud',      level: 8, school: 'conjuration',   classes: WS },
  { name: 'Maze',                  level: 8, school: 'conjuration',   classes: WS },
  { name: 'Planar Ally, Greater',  level: 8, school: 'conjuration',   classes: C },
  { name: 'Summon Monster VIII',   level: 8, school: 'conjuration',   classes: WSC },
  { name: "Summon Nature's Ally VIII", level: 8, school: 'conjuration', classes: D },
  { name: 'Cure Critical Wounds, Mass', level: 8, school: 'conjuration', classes: ['cleric', 'druid'] },
  // Divination
  { name: 'Discern Location',      level: 8, school: 'divination',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Moment of Prescience',  level: 8, school: 'divination',    classes: WS },
  // Enchantment
  { name: 'Antipathy',             level: 8, school: 'enchantment',   classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Charm Monster, Mass',   level: 8, school: 'enchantment',   classes: WS },
  { name: 'Demand',                level: 8, school: 'enchantment',   classes: WS },
  { name: 'Power Word Stun',       level: 8, school: 'enchantment',   classes: WS },
  { name: 'Symbol of Insanity',    level: 8, school: 'enchantment',   classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Sympathy',              level: 8, school: 'enchantment',   classes: ['druid', 'sorcerer', 'wizard'] },
  // Evocation
  { name: 'Sunburst',              level: 8, school: 'evocation',     classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Telekinetic Sphere',    level: 8, school: 'evocation',     classes: WS },
  { name: 'Whirlwind',             level: 8, school: 'evocation',     classes: D },
  { name: 'Earthquake',            level: 8, school: 'evocation',     classes: ['cleric', 'druid'] },
  // Illusion
  { name: 'Scintillating Pattern', level: 8, school: 'illusion',      classes: WS },
  { name: 'Screen',                level: 8, school: 'illusion',      classes: WS },
  // Necromancy
  { name: 'Create Greater Undead', level: 8, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Horrid Wilting',        level: 8, school: 'necromancy',    classes: WS },
  { name: 'Symbol of Death',       level: 8, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  // Transmutation
  { name: 'Iron Body',             level: 8, school: 'transmutation', classes: WS },
  { name: 'Polymorph Any Object',  level: 8, school: 'transmutation', classes: WS },
  { name: 'Animal Shapes',         level: 8, school: 'transmutation', classes: D },
  { name: 'Reverse Gravity',       level: 8, school: 'transmutation', classes: ['cleric'] },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 9
  // ═══════════════════════════════════════════════════════════════════════
  // Abjuration
  { name: 'Freedom',               level: 9, school: 'abjuration',    classes: WS },
  { name: 'Imprisonment',          level: 9, school: 'abjuration',    classes: WS },
  { name: 'Mage\'s Disjunction',   level: 9, school: 'abjuration',    classes: WS },
  // Conjuration
  { name: 'Gate',                  level: 9, school: 'conjuration',   classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Implosion',             level: 9, school: 'evocation',     classes: C },
  { name: 'Storm of Vengeance',    level: 9, school: 'conjuration',   classes: ['cleric', 'druid'] },
  { name: 'Summon Monster IX',     level: 9, school: 'conjuration',   classes: WSC },
  { name: "Summon Nature's Ally IX", level: 9, school: 'conjuration', classes: D },
  { name: 'Mass Heal',             level: 9, school: 'conjuration',   classes: C },
  { name: 'Refuge',                level: 9, school: 'conjuration',   classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'True Resurrection',     level: 9, school: 'conjuration',   classes: C },
  // Divination
  { name: 'Foresight',             level: 9, school: 'divination',    classes: ['druid', 'sorcerer', 'wizard'] },
  // Enchantment
  { name: 'Dominate Monster',      level: 9, school: 'enchantment',   classes: WS },
  { name: 'Power Word Kill',       level: 9, school: 'enchantment',   classes: WS },
  // Evocation
  { name: 'Meteor Swarm',          level: 9, school: 'evocation',     classes: WS },
  { name: 'Prismatic Sphere',      level: 9, school: 'evocation',     classes: WS },
  { name: 'Elemental Swarm',       level: 9, school: 'conjuration',   classes: D },
  // Illusion
  { name: 'Shades',                level: 9, school: 'illusion',      classes: WS },
  { name: 'Weird',                 level: 9, school: 'illusion',      classes: WS },
  // Necromancy
  { name: 'Astral Projection',     level: 9, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Energy Drain',          level: 9, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Soul Bind',             level: 9, school: 'necromancy',    classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Wail of the Banshee',   level: 9, school: 'necromancy',    classes: WS },
  // Transmutation
  { name: 'Etherealness',          level: 9, school: 'transmutation', classes: ['cleric', 'sorcerer', 'wizard'] },
  { name: 'Shapechange',           level: 9, school: 'transmutation', classes: ['druid', 'sorcerer', 'wizard'] },
  { name: 'Time Stop',             level: 9, school: 'transmutation', classes: WS },
  { name: 'Miracle',               level: 9, school: 'evocation',     classes: C },

  // ═══════════════════════════════════════════════════════════════════════
  // PALADIN-only spells (levels 1-4). Most paladin spells overlap with the
  // shared lists above; the entries here are paladin-distinctive picks.
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Holy Sword',            level: 4, school: 'evocation',     classes: ['paladin'] },
  { name: 'Death Knell',           level: 2, school: 'necromancy',    classes: ['paladin'] }, // (paladin variant)

  // ═══════════════════════════════════════════════════════════════════════
  // RANGER-only spells (levels 1-4). Ranger has Cure Light Wounds at level 2,
  // not 1 — but for the popup we use the simplified cleric-aligned level 1.
  // ═══════════════════════════════════════════════════════════════════════
  // (most ranger spells already covered via shared multi-class entries)
  { name: 'Tree Stride, Lesser',   level: 4, school: 'transmutation', classes: ['ranger'] },
];

/**
 * Classic level-1 SRD subset, kept as a separate export so callers that only
 * care about starter spells (legacy or test code) don't have to filter.
 */
export const LEVEL_1_SPELLS: readonly Spell[] = ALL_SPELLS.filter(s => s.level === 1);

/**
 * Index spells by `(class, level)` for fast lookup at character-roll time.
 * Returned arrays are stable references; do not mutate.
 */
export function spellsForClassAndLevel(pcClass: PcClassType, spellLevel: number): readonly Spell[] {
  return ALL_SPELLS.filter(s => s.level === spellLevel && s.classes.includes(pcClass));
}
