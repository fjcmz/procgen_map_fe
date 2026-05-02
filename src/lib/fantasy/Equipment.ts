// D&D 3.5e equipment system: slot definitions, non-magical starter catalog,
// and class-aware starting-gear assignment for level-1 characters.
//
// assignEquipment() is purely deterministic given (pcClass, wealth, abilities)
// — no RNG consumed. The caller in citychars.ts runs this after the main
// character roll so it never perturbs the seed-stable roster generator.
//
// applyEquipmentBonuses() folds typed bonus components from the assigned gear
// into the character's already-computed CombatStats so the CharacterPopup
// AC/saves breakdown reflects worn armor and shields.

import type { PcClassType } from './PcClassType';
import type { Ability } from './Ability';
import { abilityMod } from './Ability';
import type { BonusType } from './Combat';
import { STACKING_BONUS_TYPES } from './Combat';

// ─── Slot types ──────────────────────────────────────────────────────────────

export type EquipmentSlot =
  | 'armor' | 'helmet' | 'braces' | 'gloves' | 'boots'
  | 'necklace' | 'ring1' | 'ring2' | 'belt' | 'cloak'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'ammo'
  | 'utility1' | 'utility2' | 'utility3';

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  armor:    'Armor',      helmet:   'Helmet',
  braces:   'Bracers',   gloves:   'Gloves',    boots:  'Boots',
  necklace: 'Necklace',  ring1:    'Ring I',    ring2:  'Ring II',
  belt:     'Belt',      cloak:    'Cloak',
  weapon1:  'Weapon I',  weapon2:  'Weapon II', weapon3: 'Weapon III',
  ammo:     'Ammo',
  utility1: 'Utility I', utility2: 'Utility II', utility3: 'Utility III',
};

/** Visual groups for the equipment popup. */
export const SLOT_GROUPS: { label: string; slots: EquipmentSlot[] }[] = [
  { label: 'Worn',         slots: ['armor', 'helmet', 'braces', 'gloves', 'boots', 'necklace', 'ring1', 'ring2', 'belt', 'cloak'] },
  { label: 'Weapons',      slots: ['weapon1', 'weapon2', 'weapon3', 'ammo'] },
  { label: 'Utility Belt', slots: ['utility1', 'utility2', 'utility3'] },
];

// ─── Bonus types ─────────────────────────────────────────────────────────────

export type BonusTarget =
  | 'ac' | 'bab' | 'fort' | 'ref' | 'will'
  | 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | 'hp'
  | 'spell_slots' | 'caster_level';

export interface EquipBonus {
  target: BonusTarget;
  value:  number;
  /** Bonus type tag matching Combat.BonusType — determines stacking rules. */
  type?:  BonusType;
  /** For target='spell_slots': which spell level (0–9) gains the bonus slots. */
  spellLevel?: number;
}

// ─── Item definition ─────────────────────────────────────────────────────────

export interface Equipment {
  id:          string;
  name:        string;
  slot:        EquipmentSlot;
  /** Price in gold pieces (gp). */
  price:       number;
  bonuses:     EquipBonus[];
  /** Damage dice expression — present only on attack weapons (not shields). */
  damage?:     string;
  /** Minimum die roll for a threat; default 20. */
  critRange?:  number;
  /** Damage multiplier on a confirmed crit; default 2. */
  critMult?:   number;
  isMartial?:  boolean;
  isExotic?:   boolean;
  isRanged?:   boolean;
  isTwoHanded?: boolean;
  isShield?:   boolean;
  /** Human-readable description of special abilities not captured by bonuses. */
  description?: string;
}

export type EquipmentSet = Partial<Record<EquipmentSlot, Equipment>>;

// ─── Equipment catalog ────────────────────────────────────────────────────────
// Non-magical, level-1-appropriate items covering all classes and races.

export const EQUIPMENT_CATALOG: Record<string, Equipment> = {

  // ── Armor ─────────────────────────────────────────────────────────────────
  robes:           { id: 'robes',           name: 'Robes',            slot: 'armor', price: 1,    bonuses: [] },
  padded:          { id: 'padded',          name: 'Padded Armor',     slot: 'armor', price: 5,    bonuses: [{ target: 'ac', value: 1, type: 'armor' }] },
  leather:         { id: 'leather',         name: 'Leather Armor',    slot: 'armor', price: 10,   bonuses: [{ target: 'ac', value: 2, type: 'armor' }] },
  hide:            { id: 'hide',            name: 'Hide Armor',       slot: 'armor', price: 15,   bonuses: [{ target: 'ac', value: 3, type: 'armor' }] },
  studded_leather: { id: 'studded_leather', name: 'Studded Leather',  slot: 'armor', price: 25,   bonuses: [{ target: 'ac', value: 3, type: 'armor' }] },
  chain_shirt:     { id: 'chain_shirt',     name: 'Chain Shirt',      slot: 'armor', price: 100,  bonuses: [{ target: 'ac', value: 4, type: 'armor' }] },
  scale_mail:      { id: 'scale_mail',      name: 'Scale Mail',       slot: 'armor', price: 50,   bonuses: [{ target: 'ac', value: 4, type: 'armor' }] },
  breastplate:     { id: 'breastplate',     name: 'Breastplate',      slot: 'armor', price: 200,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }] },
  chainmail:       { id: 'chainmail',       name: 'Chainmail',        slot: 'armor', price: 150,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }] },
  splint_mail:     { id: 'splint_mail',     name: 'Splint Mail',      slot: 'armor', price: 200,  bonuses: [{ target: 'ac', value: 6, type: 'armor' }] },
  banded_mail:     { id: 'banded_mail',     name: 'Banded Mail',      slot: 'armor', price: 250,  bonuses: [{ target: 'ac', value: 6, type: 'armor' }] },
  half_plate:      { id: 'half_plate',      name: 'Half-Plate',       slot: 'armor', price: 600,  bonuses: [{ target: 'ac', value: 7, type: 'armor' }] },
  full_plate:      { id: 'full_plate',      name: 'Full Plate',       slot: 'armor', price: 1500, bonuses: [{ target: 'ac', value: 8, type: 'armor' }] },

  // ── Helmets ───────────────────────────────────────────────────────────────
  open_helm:  { id: 'open_helm',  name: 'Open-Face Helm', slot: 'helmet', price: 6,  bonuses: [] },
  half_helm:  { id: 'half_helm',  name: 'Half-Helm',      slot: 'helmet', price: 12, bonuses: [] },
  great_helm: { id: 'great_helm', name: 'Great Helm',     slot: 'helmet', price: 30, bonuses: [] },

  // ── Gloves ────────────────────────────────────────────────────────────────
  gauntlets:    { id: 'gauntlets',    name: 'Gauntlets',    slot: 'gloves', price: 2,  bonuses: [] },
  light_gloves: { id: 'light_gloves', name: 'Light Gloves', slot: 'gloves', price: 1,  bonuses: [] },

  // ── Boots ─────────────────────────────────────────────────────────────────
  boots:         { id: 'boots',         name: 'Boots',          slot: 'boots', price: 1, bonuses: [] },
  riding_boots:  { id: 'riding_boots',  name: 'Riding Boots',   slot: 'boots', price: 3, bonuses: [] },

  // ── Belt ──────────────────────────────────────────────────────────────────
  belt:       { id: 'belt',       name: 'Belt',       slot: 'belt', price: 1, bonuses: [] },
  swordbelt:  { id: 'swordbelt',  name: 'Sword Belt', slot: 'belt', price: 3, bonuses: [] },

  // ── Cloak ─────────────────────────────────────────────────────────────────
  travelers_cloak: { id: 'travelers_cloak', name: "Traveler's Cloak", slot: 'cloak', price: 1, bonuses: [] },

  // ── Shields (weapon2 slot) ────────────────────────────────────────────────
  buckler:             { id: 'buckler',             name: 'Buckler',             slot: 'weapon2', price: 15, bonuses: [{ target: 'ac', value: 1, type: 'shield' }], isShield: true },
  light_wooden_shield: { id: 'light_wooden_shield', name: 'Light Wooden Shield', slot: 'weapon2', price: 3,  bonuses: [{ target: 'ac', value: 1, type: 'shield' }], isShield: true },
  heavy_wooden_shield: { id: 'heavy_wooden_shield', name: 'Heavy Wooden Shield', slot: 'weapon2', price: 7,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true },
  light_steel_shield:  { id: 'light_steel_shield',  name: 'Light Steel Shield',  slot: 'weapon2', price: 9,  bonuses: [{ target: 'ac', value: 1, type: 'shield' }], isShield: true },
  heavy_steel_shield:  { id: 'heavy_steel_shield',  name: 'Heavy Steel Shield',  slot: 'weapon2', price: 20, bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true },

  // ── Simple melee weapons ─────────────────────────────────────────────────
  club:         { id: 'club',         name: 'Club',         slot: 'weapon1', price: 0,  bonuses: [], damage: '1d6',  critMult: 2 },
  dagger:       { id: 'dagger',       name: 'Dagger',       slot: 'weapon1', price: 2,  bonuses: [], damage: '1d4',  critRange: 19, critMult: 2 },
  light_mace:   { id: 'light_mace',   name: 'Light Mace',   slot: 'weapon1', price: 5,  bonuses: [], damage: '1d6',  critMult: 2 },
  heavy_mace:   { id: 'heavy_mace',   name: 'Heavy Mace',   slot: 'weapon1', price: 12, bonuses: [], damage: '1d8',  critMult: 2 },
  morningstar:  { id: 'morningstar',  name: 'Morningstar',  slot: 'weapon1', price: 8,  bonuses: [], damage: '1d8',  critMult: 2 },
  quarterstaff: { id: 'quarterstaff', name: 'Quarterstaff', slot: 'weapon1', price: 0,  bonuses: [], damage: '1d6',  critMult: 2, isTwoHanded: true },
  shortspear:   { id: 'shortspear',   name: 'Short Spear',  slot: 'weapon1', price: 1,  bonuses: [], damage: '1d6',  critMult: 2 },
  spear:        { id: 'spear',        name: 'Spear',        slot: 'weapon1', price: 2,  bonuses: [], damage: '1d8',  critMult: 3, isTwoHanded: true },
  longspear:    { id: 'longspear',    name: 'Longspear',    slot: 'weapon1', price: 5,  bonuses: [], damage: '1d8',  critMult: 3, isTwoHanded: true },
  light_hammer: { id: 'light_hammer', name: 'Light Hammer', slot: 'weapon1', price: 1,  bonuses: [], damage: '1d4',  critMult: 2 },
  sickle:       { id: 'sickle',       name: 'Sickle',       slot: 'weapon1', price: 6,  bonuses: [], damage: '1d6',  critMult: 2 },
  greatclub:    { id: 'greatclub',    name: 'Greatclub',    slot: 'weapon1', price: 5,  bonuses: [], damage: '1d10', critMult: 2, isTwoHanded: true },

  // ── Martial melee weapons (extra) ─────────────────────────────────────────
  longspear_pike:{ id:'longspear_pike',name: 'Pike',         slot: 'weapon1', price: 5, bonuses: [], damage: '1d8', critMult: 3, isMartial: true, isTwoHanded: true },
  halberd:      { id: 'halberd',      name: 'Halberd',      slot: 'weapon1', price: 10, bonuses: [], damage: '1d10', critMult: 3, isMartial: true, isTwoHanded: true },
  glaive:       { id: 'glaive',       name: 'Glaive',       slot: 'weapon1', price: 8,  bonuses: [], damage: '1d10', critMult: 3, isMartial: true, isTwoHanded: true },
  guisarme:     { id: 'guisarme',     name: 'Guisarme',     slot: 'weapon1', price: 9,  bonuses: [], damage: '2d4',  critMult: 3, isMartial: true, isTwoHanded: true },
  ranseur:      { id: 'ranseur',      name: 'Ranseur',      slot: 'weapon1', price: 10, bonuses: [], damage: '2d4',  critMult: 3, isMartial: true, isTwoHanded: true },
  scythe:       { id: 'scythe',       name: 'Scythe',       slot: 'weapon1', price: 18, bonuses: [], damage: '2d4',  critMult: 4, isMartial: true, isTwoHanded: true },
  lance:        { id: 'lance',        name: 'Lance',        slot: 'weapon1', price: 10, bonuses: [], damage: '1d8',  critMult: 3, isMartial: true, isTwoHanded: true },
  trident:      { id: 'trident',      name: 'Trident',      slot: 'weapon1', price: 15, bonuses: [], damage: '1d8',  critMult: 2, isMartial: true },
  kukri:        { id: 'kukri',        name: 'Kukri',        slot: 'weapon1', price: 8,  bonuses: [], damage: '1d4',  critRange: 18, critMult: 2, isMartial: true },
  throwing_axe: { id: 'throwing_axe', name: 'Throwing Axe', slot: 'weapon1', price: 8,  bonuses: [], damage: '1d6',  critMult: 2, isMartial: true },
  warpick:      { id: 'warpick',      name: 'Heavy Pick',   slot: 'weapon1', price: 8,  bonuses: [], damage: '1d6',  critMult: 4, isMartial: true },

  // ── Exotic melee ──────────────────────────────────────────────────────────
  bastard_sword:    { id: 'bastard_sword',    name: 'Bastard Sword',     slot: 'weapon1', price: 35, bonuses: [], damage: '1d10', critRange: 19, critMult: 2, isExotic: true },
  dwarven_waraxe:   { id: 'dwarven_waraxe',   name: 'Dwarven Waraxe',    slot: 'weapon1', price: 30, bonuses: [], damage: '1d10', critMult: 3, isExotic: true },
  spiked_chain:     { id: 'spiked_chain',     name: 'Spiked Chain',      slot: 'weapon1', price: 25, bonuses: [], damage: '2d4',  critMult: 2, isExotic: true, isTwoHanded: true },
  whip:             { id: 'whip',             name: 'Whip',              slot: 'weapon1', price: 1,  bonuses: [], damage: '1d3',  critMult: 2, isExotic: true },
  nunchaku:         { id: 'nunchaku',         name: 'Nunchaku',          slot: 'weapon1', price: 2,  bonuses: [], damage: '1d6',  critMult: 2, isExotic: true },
  shuriken:         { id: 'shuriken',         name: 'Shuriken (5)',      slot: 'weapon1', price: 1,  bonuses: [], damage: '1d2',  critMult: 2, isExotic: true, isRanged: true },

  // ── Martial melee weapons ─────────────────────────────────────────────────
  longsword:  { id: 'longsword',  name: 'Longsword',  slot: 'weapon1', price: 15, bonuses: [], damage: '1d8',  critRange: 19, critMult: 2, isMartial: true },
  shortsword: { id: 'shortsword', name: 'Short Sword', slot: 'weapon1', price: 10, bonuses: [], damage: '1d6',  critRange: 19, critMult: 2, isMartial: true },
  rapier:     { id: 'rapier',     name: 'Rapier',     slot: 'weapon1', price: 20, bonuses: [], damage: '1d6',  critRange: 18, critMult: 2, isMartial: true },
  scimitar:   { id: 'scimitar',   name: 'Scimitar',   slot: 'weapon1', price: 15, bonuses: [], damage: '1d6',  critRange: 18, critMult: 2, isMartial: true },
  handaxe:    { id: 'handaxe',    name: 'Handaxe',    slot: 'weapon1', price: 6,  bonuses: [], damage: '1d6',  critMult: 3, isMartial: true },
  battleaxe:  { id: 'battleaxe',  name: 'Battleaxe',  slot: 'weapon1', price: 10, bonuses: [], damage: '1d8',  critMult: 3, isMartial: true },
  warhammer:  { id: 'warhammer',  name: 'Warhammer',  slot: 'weapon1', price: 12, bonuses: [], damage: '1d8',  critMult: 3, isMartial: true },
  flail:      { id: 'flail',      name: 'Flail',      slot: 'weapon1', price: 8,  bonuses: [], damage: '1d8',  critMult: 2, isMartial: true },
  greataxe:   { id: 'greataxe',   name: 'Greataxe',   slot: 'weapon1', price: 20, bonuses: [], damage: '1d12', critMult: 3, isMartial: true, isTwoHanded: true },
  greatsword: { id: 'greatsword', name: 'Greatsword', slot: 'weapon1', price: 50, bonuses: [], damage: '2d6',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  falchion:   { id: 'falchion',   name: 'Falchion',   slot: 'weapon1', price: 75, bonuses: [], damage: '2d4',  critRange: 18, critMult: 2, isMartial: true, isTwoHanded: true },

  // ── Monk / exotic melee ───────────────────────────────────────────────────
  kama:      { id: 'kama',      name: 'Kama',      slot: 'weapon1', price: 2,  bonuses: [], damage: '1d6', critMult: 2, isExotic: true },
  siangham:  { id: 'siangham',  name: 'Siangham',  slot: 'weapon1', price: 3,  bonuses: [], damage: '1d6', critMult: 2, isExotic: true },

  // ── Simple ranged ─────────────────────────────────────────────────────────
  sling:          { id: 'sling',          name: 'Sling',          slot: 'weapon3', price: 0,  bonuses: [], damage: '1d4',  critMult: 2, isRanged: true },
  light_crossbow: { id: 'light_crossbow', name: 'Light Crossbow', slot: 'weapon3', price: 35, bonuses: [], damage: '1d8',  critRange: 19, critMult: 2, isRanged: true },
  heavy_crossbow: { id: 'heavy_crossbow', name: 'Heavy Crossbow', slot: 'weapon3', price: 50, bonuses: [], damage: '1d10', critRange: 19, critMult: 2, isRanged: true },
  javelin:        { id: 'javelin',        name: 'Javelin',        slot: 'weapon3', price: 1,  bonuses: [], damage: '1d6',  critMult: 2, isRanged: true },
  dart:           { id: 'dart',           name: 'Dart',           slot: 'weapon3', price: 1,  bonuses: [], damage: '1d4',  critMult: 2, isRanged: true },

  // ── Martial ranged ────────────────────────────────────────────────────────
  shortbow:           { id: 'shortbow',           name: 'Shortbow',            slot: 'weapon3', price: 30,  bonuses: [], damage: '1d6', critMult: 3, isRanged: true, isMartial: true },
  longbow:            { id: 'longbow',            name: 'Longbow',             slot: 'weapon3', price: 75,  bonuses: [], damage: '1d8', critMult: 3, isRanged: true, isMartial: true },
  composite_shortbow: { id: 'composite_shortbow', name: 'Composite Shortbow',  slot: 'weapon3', price: 75,  bonuses: [], damage: '1d6', critMult: 3, isRanged: true, isMartial: true, description: 'Adds wielder STR bonus to damage (up to +2).' },
  composite_longbow:  { id: 'composite_longbow',  name: 'Composite Longbow',   slot: 'weapon3', price: 100, bonuses: [], damage: '1d8', critMult: 3, isRanged: true, isMartial: true, description: 'Adds wielder STR bonus to damage (up to +2).' },

  // ── Exotic ranged ─────────────────────────────────────────────────────────
  repeating_crossbow: { id: 'repeating_crossbow', name: 'Repeating Crossbow', slot: 'weapon3', price: 250, bonuses: [], damage: '1d8',  critRange: 19, critMult: 2, isRanged: true, isExotic: true, description: 'Holds 5 bolts in a magazine; reload as a free action.' },
  hand_crossbow:      { id: 'hand_crossbow',      name: 'Hand Crossbow',      slot: 'weapon3', price: 100, bonuses: [], damage: '1d4',  critRange: 19, critMult: 2, isRanged: true, isExotic: true },
  bolas:              { id: 'bolas',              name: 'Bolas',              slot: 'weapon3', price: 5,   bonuses: [], damage: '1d4',  critMult: 2, isRanged: true, isExotic: true, description: 'On hit, target may be tripped (ranged trip attempt).' },

  // ── Ammo ──────────────────────────────────────────────────────────────────
  arrows:       { id: 'arrows',       name: 'Arrows (20)',      slot: 'ammo', price: 1, bonuses: [] },
  bolts:        { id: 'bolts',        name: 'Bolts (10)',       slot: 'ammo', price: 1, bonuses: [] },
  sling_bullets:{ id: 'sling_bullets',name: 'Sling Bullets (10)',slot:'ammo', price: 0, bonuses: [] },
  javelins_3:   { id: 'javelins_3',   name: 'Javelins (3)',     slot: 'ammo', price: 3, bonuses: [] },

  // ── Utility belt ─────────────────────────────────────────────────────────
  potion_clw:        { id: 'potion_clw',        name: 'Potion of Cure Light Wounds', slot: 'utility1', price: 50, bonuses: [{ target: 'hp', value: 5 }] },
  antitoxin:         { id: 'antitoxin',         name: 'Antitoxin',                  slot: 'utility1', price: 50, bonuses: [{ target: 'fort', value: 5 }] },
  scroll_mage_armor: { id: 'scroll_mage_armor', name: 'Scroll: Mage Armor',         slot: 'utility1', price: 25, bonuses: [{ target: 'ac', value: 4, type: 'armor' }] },
  scroll_clw:        { id: 'scroll_clw',        name: 'Scroll: Cure Light Wounds',  slot: 'utility1', price: 25, bonuses: [{ target: 'hp', value: 5 }] },
  holy_water:        { id: 'holy_water',         name: 'Holy Water (flask)',         slot: 'utility1', price: 25, bonuses: [] },
  alchemists_fire:   { id: 'alchemists_fire',   name: "Alchemist's Fire",            slot: 'utility1', price: 20, bonuses: [] },
};

// ─── Magical equipment catalog ────────────────────────────────────────────────
// Items scaled from character levels 1–20, organized by slot.
// Weapons:  base damage includes enhancement (+N baked into die expression).
// Armor:    total AC bonus (base armor + enhancement) stored as one 'armor' entry.
// Saves:    Cloak of Resistance stores three components (fort/ref/will).
// Ability:  enhancement bonus applied via applyEquipmentToCombat in citychars.ts
//           which cascades to combat stats (DEX→AC+Ref, CON→HP+Fort, etc.).
// Spells:   spell_slots bonus targets slotsPerLevel[spellLevel]; caster_level
//           targets CharacterSpellcasting.casterLevelBonus.

export const MAGICAL_EQUIPMENT_CATALOG: Record<string, Equipment> = {

  // ── Magical weapons — weapon1 (melee) ────────────────────────────────────────

  // +1 tier (~2,300 gp)
  dagger_plus1:        { id: 'dagger_plus1',        name: 'Dagger +1',              slot: 'weapon1', price: 2302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2 },
  shortsword_plus1:    { id: 'shortsword_plus1',    name: 'Short Sword +1',         slot: 'weapon1', price: 2310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 19, critMult: 2, isMartial: true },
  longsword_plus1:     { id: 'longsword_plus1',     name: 'Longsword +1',           slot: 'weapon1', price: 2315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true },
  rapier_plus1:        { id: 'rapier_plus1',        name: 'Rapier +1',              slot: 'weapon1', price: 2320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true },
  scimitar_plus1:      { id: 'scimitar_plus1',      name: 'Scimitar +1',            slot: 'weapon1', price: 2315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true },
  battleaxe_plus1:     { id: 'battleaxe_plus1',     name: 'Battleaxe +1',           slot: 'weapon1', price: 2310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true },
  warhammer_plus1:     { id: 'warhammer_plus1',     name: 'Warhammer +1',           slot: 'weapon1', price: 2312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true },
  quarterstaff_plus1:  { id: 'quarterstaff_plus1',  name: 'Quarterstaff +1',        slot: 'weapon1', price: 2300,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2, isTwoHanded: true },
  greatsword_plus1:    { id: 'greatsword_plus1',    name: 'Greatsword +1',          slot: 'weapon1', price: 2350,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  greataxe_plus1:      { id: 'greataxe_plus1',      name: 'Greataxe +1',            slot: 'weapon1', price: 2320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d12+1', critMult: 3, isMartial: true, isTwoHanded: true },
  handaxe_plus1:       { id: 'handaxe_plus1',       name: 'Handaxe +1',             slot: 'weapon1', price: 2306,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isMartial: true },
  flail_plus1:         { id: 'flail_plus1',         name: 'Flail +1',               slot: 'weapon1', price: 2308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, isMartial: true },
  falchion_plus1:      { id: 'falchion_plus1',      name: 'Falchion +1',            slot: 'weapon1', price: 2375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d4+1',  critRange: 18, critMult: 2, isMartial: true, isTwoHanded: true },
  morningstar_plus1:   { id: 'morningstar_plus1',   name: 'Morningstar +1',         slot: 'weapon1', price: 2308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2 },
  light_mace_plus1:    { id: 'light_mace_plus1',    name: 'Light Mace +1',          slot: 'weapon1', price: 2305,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2 },
  heavy_mace_plus1:    { id: 'heavy_mace_plus1',    name: 'Heavy Mace +1',          slot: 'weapon1', price: 2312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2 },
  spear_plus1:         { id: 'spear_plus1',         name: 'Spear +1',               slot: 'weapon1', price: 2302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isTwoHanded: true },
  halberd_plus1:       { id: 'halberd_plus1',       name: 'Halberd +1',             slot: 'weapon1', price: 2310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d10+1', critMult: 3, isMartial: true, isTwoHanded: true },
  glaive_plus1:        { id: 'glaive_plus1',        name: 'Glaive +1',              slot: 'weapon1', price: 2308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d10+1', critMult: 3, isMartial: true, isTwoHanded: true },
  scythe_plus1:        { id: 'scythe_plus1',        name: 'Scythe +1',              slot: 'weapon1', price: 2318,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d4+1',  critMult: 4, isMartial: true, isTwoHanded: true },
  lance_plus1:         { id: 'lance_plus1',         name: 'Lance +1',               slot: 'weapon1', price: 2310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, isTwoHanded: true },
  trident_plus1:       { id: 'trident_plus1',       name: 'Trident +1',             slot: 'weapon1', price: 2315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, isMartial: true },
  kukri_plus1:         { id: 'kukri_plus1',         name: 'Kukri +1',               slot: 'weapon1', price: 2308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 18, critMult: 2, isMartial: true },
  warpick_plus1:       { id: 'warpick_plus1',       name: 'Heavy Pick +1',          slot: 'weapon1', price: 2308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 4, isMartial: true },
  bastard_sword_plus1: { id: 'bastard_sword_plus1', name: 'Bastard Sword +1',       slot: 'weapon1', price: 2335,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d10+1', critRange: 19, critMult: 2, isExotic: true },
  dwarven_waraxe_plus1:{ id: 'dwarven_waraxe_plus1',name: 'Dwarven Waraxe +1',      slot: 'weapon1', price: 2330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d10+1', critMult: 3, isExotic: true },
  spiked_chain_plus1:  { id: 'spiked_chain_plus1',  name: 'Spiked Chain +1',        slot: 'weapon1', price: 2325,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d4+1',  critMult: 2, isExotic: true, isTwoHanded: true },
  kama_plus1:          { id: 'kama_plus1',          name: 'Kama +1',                slot: 'weapon1', price: 2302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2, isExotic: true },
  siangham_plus1:      { id: 'siangham_plus1',      name: 'Siangham +1',            slot: 'weapon1', price: 2303,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2, isExotic: true },
  nunchaku_plus1:      { id: 'nunchaku_plus1',      name: 'Nunchaku +1',            slot: 'weapon1', price: 2302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2, isExotic: true },

  // +1 special-property weapons (~8,300 gp; property ≈ +1 equivalent)
  flaming_longsword:   { id: 'flaming_longsword',   name: 'Flaming Longsword +1',   slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  flaming_battleaxe:   { id: 'flaming_battleaxe',   name: 'Flaming Battleaxe +1',   slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  flaming_warhammer:   { id: 'flaming_warhammer',   name: 'Flaming Warhammer +1',   slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  flaming_rapier:      { id: 'flaming_rapier',      name: 'Flaming Rapier +1',      slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  flaming_scimitar:    { id: 'flaming_scimitar',    name: 'Flaming Scimitar +1',    slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  flaming_dagger:      { id: 'flaming_dagger',      name: 'Flaming Dagger +1',      slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2, description: '+1d6 fire damage on a successful attack.' },
  flaming_greataxe:    { id: 'flaming_greataxe',    name: 'Flaming Greataxe +1',    slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d12+1', critMult: 3, isMartial: true, isTwoHanded: true, description: '+1d6 fire damage on a successful attack.' },
  frost_greatsword:    { id: 'frost_greatsword',    name: 'Frost Greatsword +1',    slot: 'weapon1', price: 8350,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: '+1d6 cold damage on a successful attack.' },
  frost_longsword:     { id: 'frost_longsword',     name: 'Frost Longsword +1',     slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 cold damage on a successful attack.' },
  frost_battleaxe:     { id: 'frost_battleaxe',     name: 'Frost Battleaxe +1',     slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 cold damage on a successful attack.' },
  frost_warhammer:     { id: 'frost_warhammer',     name: 'Frost Warhammer +1',     slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 cold damage on a successful attack.' },
  frost_rapier:        { id: 'frost_rapier',        name: 'Frost Rapier +1',        slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: '+1d6 cold damage on a successful attack.' },
  frost_dagger:        { id: 'frost_dagger',        name: 'Frost Dagger +1',        slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2, description: '+1d6 cold damage on a successful attack.' },
  shock_battleaxe:     { id: 'shock_battleaxe',     name: 'Shock Battleaxe +1',     slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 electricity damage on a successful attack.' },
  shock_longsword:     { id: 'shock_longsword',     name: 'Shock Longsword +1',     slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 electricity damage on a successful attack.' },
  shock_greatsword:    { id: 'shock_greatsword',    name: 'Shock Greatsword +1',    slot: 'weapon1', price: 8350,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: '+1d6 electricity damage on a successful attack.' },
  shock_warhammer:     { id: 'shock_warhammer',     name: 'Shock Warhammer +1',     slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 electricity damage on a successful attack.' },
  shock_rapier:        { id: 'shock_rapier',        name: 'Shock Rapier +1',        slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: '+1d6 electricity damage on a successful attack.' },
  corrosive_longsword: { id: 'corrosive_longsword', name: 'Corrosive Longsword +1', slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 acid damage on a successful attack.' },
  corrosive_battleaxe: { id: 'corrosive_battleaxe', name: 'Corrosive Battleaxe +1', slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 acid damage on a successful attack.' },
  corrosive_dagger:    { id: 'corrosive_dagger',    name: 'Corrosive Dagger +1',    slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2, description: '+1d6 acid damage on a successful attack.' },
  corrosive_scimitar:  { id: 'corrosive_scimitar',  name: 'Corrosive Scimitar +1',  slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: '+1d6 acid damage on a successful attack.' },
  thundering_warhammer:{ id: 'thundering_warhammer',name: 'Thundering Warhammer +1',slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 sonic damage; on a confirmed crit, target deafened (Fort DC 14 negates).' },
  thundering_greatsword:{id:'thundering_greatsword',name: 'Thundering Greatsword +1',slot:'weapon1',price: 8350, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1', critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: '+1d6 sonic damage; on a confirmed crit, target deafened (Fort DC 14 negates).' },
  keen_longsword:      { id: 'keen_longsword',      name: 'Keen Longsword +1',      slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 17, critMult: 2, isMartial: true, description: 'Threat range doubled (already reflected as 17–20).' },
  keen_rapier:         { id: 'keen_rapier',         name: 'Keen Rapier +1',         slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 15, critMult: 2, isMartial: true, description: 'Threat range doubled (already reflected as 15–20).' },
  keen_scimitar:       { id: 'keen_scimitar',       name: 'Keen Scimitar +1',       slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 15, critMult: 2, isMartial: true, description: 'Threat range doubled (already reflected as 15–20).' },
  keen_falchion:       { id: 'keen_falchion',       name: 'Keen Falchion +1',       slot: 'weapon1', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d4+1',  critRange: 15, critMult: 2, isMartial: true, isTwoHanded: true, description: 'Threat range doubled (already reflected as 15–20).' },
  keen_kukri:          { id: 'keen_kukri',          name: 'Keen Kukri +1',          slot: 'weapon1', price: 8308,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 15, critMult: 2, isMartial: true, description: 'Threat range doubled (already reflected as 15–20).' },
  defending_longsword: { id: 'defending_longsword', name: 'Defending Longsword +1', slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }, { target: 'ac', value: 1, type: 'shield' }], damage: '1d8+1', critRange: 19, critMult: 2, isMartial: true, description: 'Wielder may transfer some/all of the +1 enhancement bonus from attack rolls to AC each round (currently allocated as +1 AC).' },
  defending_rapier:    { id: 'defending_rapier',    name: 'Defending Rapier +1',    slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }, { target: 'ac', value: 1, type: 'shield' }], damage: '1d6+1', critRange: 18, critMult: 2, isMartial: true, description: 'Wielder may transfer the +1 enhancement bonus from attack rolls to AC each round.' },
  throwing_dagger:     { id: 'throwing_dagger',     name: 'Throwing Dagger +1',     slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2, description: 'May be hurled at the wielder\'s normal attack bonus; treated as a thrown weapon (10 ft. range increment).' },
  ghost_touch_longsword:{id:'ghost_touch_longsword',name: 'Ghost Touch Longsword +1',slot:'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critRange: 19, critMult: 2, isMartial: true, description: 'Strikes incorporeal creatures normally; may be wielded by ethereal creatures.' },
  ghost_touch_warhammer:{id:'ghost_touch_warhammer',name: 'Ghost Touch Warhammer +1',slot:'weapon1', price: 8312, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critMult: 3, isMartial: true, description: 'Strikes incorporeal creatures normally; may be wielded by ethereal creatures.' },
  merciful_mace:       { id: 'merciful_mace',       name: 'Merciful Heavy Mace +1', slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, description: '+1d6 nonlethal damage; can switch to lethal as a free action.' },
  bane_undead_mace:    { id: 'bane_undead_mace',    name: 'Bane (Undead) Mace +1',  slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, description: 'Against undead: enhancement bonus jumps to +3, +2d6 bonus damage.' },
  bane_dragon_longsword:{id:'bane_dragon_longsword',name: 'Bane (Dragons) Longsword +1', slot:'weapon1', price: 8315, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critRange: 19, critMult: 2, isMartial: true, description: 'Against dragons: enhancement bonus jumps to +3, +2d6 bonus damage.' },
  bane_giant_warhammer:{ id: 'bane_giant_warhammer',name: 'Bane (Giants) Warhammer +1',slot:'weapon1', price: 8312, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critMult: 3, isMartial: true, description: 'Against giants: enhancement bonus jumps to +3, +2d6 bonus damage.' },
  bane_outsider_sword: { id: 'bane_outsider_sword', name: 'Bane (Outsiders) Greatsword +1', slot: 'weapon1', price: 8350, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1', critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: 'Against outsiders: enhancement bonus jumps to +3, +2d6 bonus damage.' },
  disruption_mace:     { id: 'disruption_mace',     name: 'Mace of Disruption +1',  slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, description: 'Undead struck must succeed on a DC 14 Will save or be destroyed. Emits light as a torch.' },

  // +2 tier (~8,300 gp base)
  dagger_plus2:        { id: 'dagger_plus2',        name: 'Dagger +2',              slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d4+2',  critRange: 19, critMult: 2 },
  shortsword_plus2:    { id: 'shortsword_plus2',    name: 'Short Sword +2',         slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critRange: 19, critMult: 2, isMartial: true },
  longsword_plus2:     { id: 'longsword_plus2',     name: 'Longsword +2',           slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true },
  rapier_plus2:        { id: 'rapier_plus2',        name: 'Rapier +2',              slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critRange: 18, critMult: 2, isMartial: true },
  scimitar_plus2:      { id: 'scimitar_plus2',      name: 'Scimitar +2',            slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critRange: 18, critMult: 2, isMartial: true },
  warhammer_plus2:     { id: 'warhammer_plus2',     name: 'Warhammer +2',           slot: 'weapon1', price: 8312,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true },
  greatsword_plus2:    { id: 'greatsword_plus2',    name: 'Greatsword +2',          slot: 'weapon1', price: 8350,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d6+2',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  greataxe_plus2:      { id: 'greataxe_plus2',      name: 'Greataxe +2',            slot: 'weapon1', price: 8320,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d12+2', critMult: 3, isMartial: true, isTwoHanded: true },
  battleaxe_plus2:     { id: 'battleaxe_plus2',     name: 'Battleaxe +2',           slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true },
  falchion_plus2:      { id: 'falchion_plus2',      name: 'Falchion +2',            slot: 'weapon1', price: 8375,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d4+2',  critRange: 18, critMult: 2, isMartial: true, isTwoHanded: true },
  flail_plus2:         { id: 'flail_plus2',         name: 'Flail +2',               slot: 'weapon1', price: 8308,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 2, isMartial: true },
  halberd_plus2:       { id: 'halberd_plus2',       name: 'Halberd +2',             slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d10+2', critMult: 3, isMartial: true, isTwoHanded: true },
  scythe_plus2:        { id: 'scythe_plus2',        name: 'Scythe +2',              slot: 'weapon1', price: 8318,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d4+2',  critMult: 4, isMartial: true, isTwoHanded: true },
  bastard_sword_plus2: { id: 'bastard_sword_plus2', name: 'Bastard Sword +2',       slot: 'weapon1', price: 8335,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d10+2', critRange: 19, critMult: 2, isExotic: true },
  dwarven_waraxe_plus2:{ id: 'dwarven_waraxe_plus2',name: 'Dwarven Waraxe +2',      slot: 'weapon1', price: 8330,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d10+2', critMult: 3, isExotic: true },
  spiked_chain_plus2:  { id: 'spiked_chain_plus2',  name: 'Spiked Chain +2',        slot: 'weapon1', price: 8325,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d4+2',  critMult: 2, isExotic: true, isTwoHanded: true },
  kama_plus2:          { id: 'kama_plus2',          name: 'Kama +2',                slot: 'weapon1', price: 8302,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critMult: 2, isExotic: true },
  holy_longsword:      { id: 'holy_longsword',      name: 'Holy Longsword +2',      slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+2d6 bonus holy damage against evil creatures. Good-aligned.' },
  flaming_burst_sword: { id: 'flaming_burst_sword', name: 'Flaming Burst Sword +2', slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 fire on every hit; +1d10 bonus fire on a confirmed critical.' },
  speed_longsword:     { id: 'speed_longsword',     name: 'Speed Longsword +1',     slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: 'Grants one additional attack at the highest BAB when used in a full-attack action.' },

  // +3 tier (~18,300 gp)
  shortsword_plus3:    { id: 'shortsword_plus3',    name: 'Short Sword +3',         slot: 'weapon1', price: 18310, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d6+3',  critRange: 19, critMult: 2, isMartial: true },
  longsword_plus3:     { id: 'longsword_plus3',     name: 'Longsword +3',           slot: 'weapon1', price: 18315, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critRange: 19, critMult: 2, isMartial: true },
  rapier_plus3:        { id: 'rapier_plus3',        name: 'Rapier +3',              slot: 'weapon1', price: 18320, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d6+3',  critRange: 18, critMult: 2, isMartial: true },
  scimitar_plus3:      { id: 'scimitar_plus3',      name: 'Scimitar +3',            slot: 'weapon1', price: 18315, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d6+3',  critRange: 18, critMult: 2, isMartial: true },
  battleaxe_plus3:     { id: 'battleaxe_plus3',     name: 'Battleaxe +3',           slot: 'weapon1', price: 18310, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isMartial: true },
  greatsword_plus3:    { id: 'greatsword_plus3',    name: 'Greatsword +3',          slot: 'weapon1', price: 18350, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '2d6+3',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  greataxe_plus3:      { id: 'greataxe_plus3',      name: 'Greataxe +3',            slot: 'weapon1', price: 18320, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d12+3', critMult: 3, isMartial: true, isTwoHanded: true },
  falchion_plus3:      { id: 'falchion_plus3',      name: 'Falchion +3',            slot: 'weapon1', price: 18375, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '2d4+3',  critRange: 18, critMult: 2, isMartial: true, isTwoHanded: true },
  warhammer_plus3:     { id: 'warhammer_plus3',     name: 'Warhammer +3',           slot: 'weapon1', price: 18312, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isMartial: true },
  halberd_plus3:       { id: 'halberd_plus3',       name: 'Halberd +3',             slot: 'weapon1', price: 18310, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d10+3', critMult: 3, isMartial: true, isTwoHanded: true },
  bastard_sword_plus3: { id: 'bastard_sword_plus3', name: 'Bastard Sword +3',       slot: 'weapon1', price: 18335, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d10+3', critRange: 19, critMult: 2, isExotic: true },
  dwarven_waraxe_plus3:{ id: 'dwarven_waraxe_plus3',name: 'Dwarven Waraxe +3',      slot: 'weapon1', price: 18330, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d10+3', critMult: 3, isExotic: true },
  dagger_plus3:        { id: 'dagger_plus3',        name: 'Dagger +3',              slot: 'weapon1', price: 18302, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d4+3',  critRange: 19, critMult: 2 },

  // +4 / +5 tier (~32–50k gp)
  longsword_plus4:     { id: 'longsword_plus4',     name: 'Longsword +4',           slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus4:    { id: 'greatsword_plus4',    name: 'Greatsword +4',          slot: 'weapon1', price: 32350, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '2d6+4',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  battleaxe_plus4:     { id: 'battleaxe_plus4',     name: 'Battleaxe +4',           slot: 'weapon1', price: 32310, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critMult: 3, isMartial: true },
  warhammer_plus4:     { id: 'warhammer_plus4',     name: 'Warhammer +4',           slot: 'weapon1', price: 32312, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critMult: 3, isMartial: true },
  greataxe_plus4:      { id: 'greataxe_plus4',      name: 'Greataxe +4',            slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d12+4', critMult: 3, isMartial: true, isTwoHanded: true },
  rapier_plus4:        { id: 'rapier_plus4',        name: 'Rapier +4',              slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d6+4',  critRange: 18, critMult: 2, isMartial: true },
  scimitar_plus4:      { id: 'scimitar_plus4',      name: 'Scimitar +4',            slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d6+4',  critRange: 18, critMult: 2, isMartial: true },
  bastard_sword_plus4: { id: 'bastard_sword_plus4', name: 'Bastard Sword +4',       slot: 'weapon1', price: 32335, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d10+4', critRange: 19, critMult: 2, isExotic: true },
  longsword_plus5:     { id: 'longsword_plus5',     name: 'Longsword +5',           slot: 'weapon1', price: 50315, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus5:    { id: 'greatsword_plus5',    name: 'Greatsword +5',          slot: 'weapon1', price: 50350, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '2d6+5',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  battleaxe_plus5:     { id: 'battleaxe_plus5',     name: 'Battleaxe +5',           slot: 'weapon1', price: 50310, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critMult: 3, isMartial: true },
  warhammer_plus5:     { id: 'warhammer_plus5',     name: 'Warhammer +5',           slot: 'weapon1', price: 50312, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critMult: 3, isMartial: true },
  greataxe_plus5:      { id: 'greataxe_plus5',      name: 'Greataxe +5',            slot: 'weapon1', price: 50320, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d12+5', critMult: 3, isMartial: true, isTwoHanded: true },
  rapier_plus5:        { id: 'rapier_plus5',        name: 'Rapier +5',              slot: 'weapon1', price: 50320, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d6+5',  critRange: 18, critMult: 2, isMartial: true },
  scimitar_plus5:      { id: 'scimitar_plus5',      name: 'Scimitar +5',            slot: 'weapon1', price: 50315, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d6+5',  critRange: 18, critMult: 2, isMartial: true },
  dagger_plus5:        { id: 'dagger_plus5',        name: 'Dagger +5',              slot: 'weapon1', price: 50302, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d4+5',  critRange: 19, critMult: 2 },
  shortsword_plus5:    { id: 'shortsword_plus5',    name: 'Short Sword +5',         slot: 'weapon1', price: 50310, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d6+5',  critRange: 19, critMult: 2, isMartial: true },
  bastard_sword_plus5: { id: 'bastard_sword_plus5', name: 'Bastard Sword +5',       slot: 'weapon1', price: 50335, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d10+5', critRange: 19, critMult: 2, isExotic: true },

  // +2 special-property weapons (~32k gp; total enhancement ≈ +3 equivalent)
  unholy_longsword:    { id: 'unholy_longsword',    name: 'Unholy Longsword +2',    slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+2d6 bonus unholy damage against good creatures. Evil-aligned.' },
  unholy_scythe:       { id: 'unholy_scythe',       name: 'Unholy Scythe +2',       slot: 'weapon1', price: 32318, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d4+2',  critMult: 4, isMartial: true, isTwoHanded: true, description: '+2d6 bonus unholy damage against good creatures. Evil-aligned.' },
  anarchic_scimitar:   { id: 'anarchic_scimitar',   name: 'Anarchic Scimitar +2',   slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critRange: 18, critMult: 2, isMartial: true, description: '+2d6 chaotic-aligned damage against lawful creatures. Chaotic-aligned.' },
  anarchic_greataxe:   { id: 'anarchic_greataxe',   name: 'Anarchic Greataxe +2',   slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d12+2', critMult: 3, isMartial: true, isTwoHanded: true, description: '+2d6 chaotic-aligned damage against lawful creatures. Chaotic-aligned.' },
  axiomatic_longsword: { id: 'axiomatic_longsword', name: 'Axiomatic Longsword +2', slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+2d6 lawful-aligned damage against chaotic creatures. Lawful-aligned.' },
  axiomatic_warhammer: { id: 'axiomatic_warhammer', name: 'Axiomatic Warhammer +2', slot: 'weapon1', price: 32312, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true, description: '+2d6 lawful-aligned damage against chaotic creatures. Lawful-aligned.' },
  holy_warhammer:      { id: 'holy_warhammer',      name: 'Holy Warhammer +2',      slot: 'weapon1', price: 32312, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true, description: '+2d6 bonus holy damage against evil creatures. Good-aligned.' },
  holy_battleaxe:      { id: 'holy_battleaxe',      name: 'Holy Battleaxe +2',      slot: 'weapon1', price: 32310, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true, description: '+2d6 bonus holy damage against evil creatures. Good-aligned.' },
  holy_mace:           { id: 'holy_mace',           name: 'Holy Heavy Mace +2',     slot: 'weapon1', price: 32312, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 2, description: '+2d6 bonus holy damage against evil creatures. Good-aligned.' },
  flaming_burst_greatsword:{id:'flaming_burst_greatsword',name:'Flaming Burst Greatsword +2',slot:'weapon1',price:32350,bonuses:[{target:'bab',value:2,type:'enhancement'}],damage:'2d6+2',critRange:19,critMult:2,isMartial:true,isTwoHanded:true,description:'+1d6 fire on every hit; +2d10 bonus fire on a confirmed critical.'},
  icy_burst_battleaxe: { id: 'icy_burst_battleaxe', name: 'Icy Burst Battleaxe +2', slot: 'weapon1', price: 32310, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true, description: '+1d6 cold on every hit; +2d10 bonus cold on a confirmed critical.' },
  icy_burst_longsword: { id: 'icy_burst_longsword', name: 'Icy Burst Longsword +2', slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 cold on every hit; +1d10 bonus cold on a confirmed critical.' },
  shocking_burst_warhammer:{id:'shocking_burst_warhammer',name:'Shocking Burst Warhammer +2',slot:'weapon1',price:32312,bonuses:[{target:'bab',value:2,type:'enhancement'}],damage:'1d8+2',critMult:3,isMartial:true,description:'+1d6 electricity on every hit; +2d10 bonus electricity on a confirmed critical.'},
  corrosive_burst_dagger:{id:'corrosive_burst_dagger',name:'Corrosive Burst Dagger +2',slot:'weapon1',price:32302,bonuses:[{target:'bab',value:2,type:'enhancement'}],damage:'1d4+2',critRange:19,critMult:2,description:'+1d6 acid on every hit; +1d10 bonus acid on a confirmed critical.'},
  speed_rapier:        { id: 'speed_rapier',        name: 'Speed Rapier +1',        slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critRange: 18, critMult: 2, isMartial: true, description: 'Grants one additional attack at the highest BAB when used in a full-attack action.' },
  wounding_longsword:  { id: 'wounding_longsword',  name: 'Wounding Longsword +2',  slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: 'A successful hit deals 1 point of CON damage from blood loss (Fortitude DC 17 negates).' },
  wounding_rapier:     { id: 'wounding_rapier',     name: 'Wounding Rapier +2',     slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critRange: 18, critMult: 2, isMartial: true, description: 'A successful hit deals 1 point of CON damage from blood loss (Fortitude DC 17 negates).' },
  vicious_greataxe:    { id: 'vicious_greataxe',    name: 'Vicious Greataxe +2',    slot: 'weapon1', price: 32320, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d12+2', critMult: 3, isMartial: true, isTwoHanded: true, description: '+2d6 damage to target on a successful hit; wielder takes 1d6 backlash damage each strike.' },
  vicious_greatsword:  { id: 'vicious_greatsword',  name: 'Vicious Greatsword +2',  slot: 'weapon1', price: 32350, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d6+2',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: '+2d6 damage to target on a successful hit; wielder takes 1d6 backlash damage each strike.' },
  spell_storing_sword: { id: 'spell_storing_sword', name: 'Spell-Storing Longsword +1',slot: 'weapon1', price: 8315, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critRange: 19, critMult: 2, isMartial: true, description: 'Stores a single spell of 3rd level or lower; releases it on a successful hit.' },
  brilliant_longsword: { id: 'brilliant_longsword', name: 'Brilliant Energy Longsword +4', slot: 'weapon1', price: 50315, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4', critRange: 19, critMult: 2, isMartial: true, description: 'Bypasses non-living matter; ignores armor, shields, and natural armor of living foes. Useless against constructs and undead.' },
  brilliant_rapier:    { id: 'brilliant_rapier',    name: 'Brilliant Energy Rapier +4', slot: 'weapon1', price: 50320, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d6+4',  critRange: 18, critMult: 2, isMartial: true, description: 'Bypasses non-living matter; ignores armor, shields, and natural armor of living foes. Useless against constructs and undead.' },

  // Legendary named weapons
  vorpal_sword:        { id: 'vorpal_sword',        name: 'Vorpal Sword +5',        slot: 'weapon1', price: 120000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5', critRange: 19, critMult: 2, isMartial: true, description: "On a natural 20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },
  vorpal_scimitar:     { id: 'vorpal_scimitar',     name: 'Vorpal Scimitar +5',     slot: 'weapon1', price: 120000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d6+5', critRange: 18, critMult: 2, isMartial: true, description: "On a natural 20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },
  vorpal_greataxe:     { id: 'vorpal_greataxe',     name: 'Vorpal Greataxe +5',     slot: 'weapon1', price: 120000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d12+5',critMult: 3, isMartial: true, isTwoHanded: true, description: "On a natural 20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },
  vorpal_falchion:     { id: 'vorpal_falchion',     name: 'Vorpal Falchion +5',     slot: 'weapon1', price: 120000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '2d4+5', critRange: 18, critMult: 2, isMartial: true, isTwoHanded: true, description: "On a natural 18-20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },
  holy_avenger:        { id: 'holy_avenger',        name: 'Holy Avenger',           slot: 'weapon1', price: 120630, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }, { target: 'will', value: 2, type: 'resistance' }], damage: '1d8+5', critRange: 19, critMult: 2, isMartial: true, description: '+2d6 holy damage vs evil. In the hands of a paladin, continuously emanates magic circle against evil and dispel evil 1/day.' },
  sword_of_dancing:    { id: 'sword_of_dancing',    name: 'Sword of Dancing +4',    slot: 'weapon1', price: 75000, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critRange: 19, critMult: 2, isMartial: true, description: 'Can be released as a free action to fight independently for up to 4 rounds at the owner\'s full BAB, then returns.' },
  mace_of_disruption:  { id: 'mace_of_disruption',  name: 'Mace of Disruption +2', slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 2, description: 'Undead struck must make DC 17 Will save or be destroyed. Emits daylight as a continuous spell effect.' },
  nine_lives_stealer:  { id: 'nine_lives_stealer',  name: 'Nine Lives Stealer +2',  slot: 'weapon1', price: 23315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: 'On a successful hit, target with 8 HD or fewer must make DC 20 Fortitude save or die. Nine charges; consumed on activation.' },
  frost_brand:         { id: 'frost_brand',         name: 'Frost Brand +3',         slot: 'weapon1', price: 53350, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '2d6+3',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: 'Frost greatsword that emits cold light, +1d6 cold damage on hits, fire resistance 10 to wielder, dispels fire effects on contact.' },
  flame_tongue:        { id: 'flame_tongue',        name: 'Flame Tongue +1',        slot: 'weapon1', price: 20715, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+2d6 fire vs regenerating creatures, +2d6 vs cold-using/cold-subtype, +1d6 against everything else. Burns with bright flame.' },
  dragonslayer_sword:  { id: 'dragonslayer_sword',  name: "Dragonslayer Greatsword +3",slot: 'weapon1', price: 38350, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '2d6+3',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: 'Bane (dragons): +2 enhancement and +2d6 damage vs dragons.' },
  giantslayer_warhammer:{id:'giantslayer_warhammer',name: 'Giantslayer Warhammer +3',slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isMartial: true, description: 'Bane (giants): +2 enhancement and +2d6 damage vs giants.' },
  demonbane_mace:      { id: 'demonbane_mace',      name: 'Demonbane Heavy Mace +3',slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 2, description: 'Bane (evil outsiders) and Holy: +2 enhancement and +4d6 damage vs evil outsiders.' },
  sun_blade:           { id: 'sun_blade',           name: 'Sun Blade +2',           slot: 'weapon1', price: 50335, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isExotic: true, description: 'Functions as a bastard sword sized for one-handed use. Acts as a +4 weapon vs negative-energy creatures (undead). Creates sunlight on command.' },

  // ── Magical shields — weapon2 ────────────────────────────────────────────────
  buckler_plus1:        { id: 'buckler_plus1',        name: 'Buckler +1',              slot: 'weapon2', price: 1165,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true },
  buckler_plus2:        { id: 'buckler_plus2',        name: 'Buckler +2',              slot: 'weapon2', price: 4165,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true },
  buckler_plus3:        { id: 'buckler_plus3',        name: 'Buckler +3',              slot: 'weapon2', price: 9165,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true },
  light_wooden_plus1:   { id: 'light_wooden_plus1',   name: 'Light Wooden Shield +1',  slot: 'weapon2', price: 1153,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true, description: 'Druid-friendly: contains no metal.' },
  heavy_wooden_plus1:   { id: 'heavy_wooden_plus1',   name: 'Heavy Wooden Shield +1',  slot: 'weapon2', price: 1157,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true, description: 'Druid-friendly: contains no metal.' },
  heavy_wooden_plus2:   { id: 'heavy_wooden_plus2',   name: 'Heavy Wooden Shield +2',  slot: 'weapon2', price: 4157,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: 'Druid-friendly: contains no metal.' },
  heavy_steel_plus1:    { id: 'heavy_steel_plus1',    name: 'Heavy Steel Shield +1',   slot: 'weapon2', price: 1170,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true },
  heavy_steel_plus2:    { id: 'heavy_steel_plus2',    name: 'Heavy Steel Shield +2',   slot: 'weapon2', price: 4170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true },
  heavy_steel_plus3:    { id: 'heavy_steel_plus3',    name: 'Heavy Steel Shield +3',   slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 5, type: 'shield' }], isShield: true },
  heavy_steel_plus4:    { id: 'heavy_steel_plus4',    name: 'Heavy Steel Shield +4',   slot: 'weapon2', price: 16170, bonuses: [{ target: 'ac', value: 6, type: 'shield' }], isShield: true },
  heavy_steel_plus5:    { id: 'heavy_steel_plus5',    name: 'Heavy Steel Shield +5',   slot: 'weapon2', price: 25170, bonuses: [{ target: 'ac', value: 7, type: 'shield' }], isShield: true },
  light_steel_plus1:    { id: 'light_steel_plus1',    name: 'Light Steel Shield +1',   slot: 'weapon2', price: 1159,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true },
  light_steel_plus2:    { id: 'light_steel_plus2',    name: 'Light Steel Shield +2',   slot: 'weapon2', price: 4159,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true },
  mithral_heavy_shield: { id: 'mithral_heavy_shield', name: 'Mithral Heavy Shield +1', slot: 'weapon2', price: 1620,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true, description: 'Light arcane spell failure (only 5%). Half weight.' },
  animated_shield:      { id: 'animated_shield',      name: 'Animated Shield +2',      slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: 'Can be released as a free action to fight independently for up to 4 rounds.' },
  arrow_catching_shield:{ id: 'arrow_catching_shield',name: 'Arrow-Catching Shield +2',slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: '+5 deflection bonus to AC against ranged attacks targeting adjacent allies.' },
  blinding_shield:      { id: 'blinding_shield',      name: 'Blinding Heavy Shield +1',slot: 'weapon2', price: 6170,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true, description: 'Once per day, flashes a blinding burst (Reflex DC 14 negates).' },
  spined_shield:        { id: 'spined_shield',        name: 'Spined Shield +2',        slot: 'weapon2', price: 6170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: 'Holds and fires four spike-bolts/day (1d10+2 damage, range 60 ft.).' },
  bashing_shield:       { id: 'bashing_shield',       name: 'Bashing Heavy Shield +1', slot: 'weapon2', price: 4170,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true, description: 'Counts as +1 shield bash damage (deals 1d8 instead of 1d4 on a shield bash).' },
  reflecting_shield:    { id: 'reflecting_shield',    name: 'Reflecting Shield +3',    slot: 'weapon2', price: 35170, bonuses: [{ target: 'ac', value: 5, type: 'shield' }], isShield: true, description: 'Once per day, reflects a single targeted spell back at its caster (as the spell turning effect).' },
  fortification_shield: { id: 'fortification_shield', name: 'Light Fortification Shield +2', slot: 'weapon2', price: 14170, bonuses: [{ target: 'ac', value: 4, type: 'shield' }, { target: 'hp', value: 5 }], isShield: true, description: '25% chance to negate critical hits and sneak attacks.' },

  // ── Magical ranged weapons — weapon3 ─────────────────────────────────────────
  shortbow_plus1:       { id: 'shortbow_plus1',       name: 'Shortbow +1',             slot: 'weapon3', price: 2330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isRanged: true, isMartial: true },
  shortbow_plus2:       { id: 'shortbow_plus2',       name: 'Shortbow +2',             slot: 'weapon3', price: 8330,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d6+2',  critMult: 3, isRanged: true, isMartial: true },
  shortbow_plus3:       { id: 'shortbow_plus3',       name: 'Shortbow +3',             slot: 'weapon3', price: 18330, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d6+3',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus1:        { id: 'longbow_plus1',        name: 'Longbow +1',              slot: 'weapon3', price: 2375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus2:        { id: 'longbow_plus2',        name: 'Longbow +2',              slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus3:        { id: 'longbow_plus3',        name: 'Longbow +3',              slot: 'weapon3', price: 18375, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus4:        { id: 'longbow_plus4',        name: 'Longbow +4',              slot: 'weapon3', price: 32375, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus5:        { id: 'longbow_plus5',        name: 'Longbow +5',              slot: 'weapon3', price: 50375, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critMult: 3, isRanged: true, isMartial: true },
  composite_longbow_plus1:{id:'composite_longbow_plus1',name:'Composite Longbow +1', slot: 'weapon3', price: 2400, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1', critMult: 3, isRanged: true, isMartial: true, description: 'Adds wielder STR bonus to damage (up to +2).' },
  composite_longbow_plus2:{id:'composite_longbow_plus2',name:'Composite Longbow +2', slot: 'weapon3', price: 8400, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2', critMult: 3, isRanged: true, isMartial: true, description: 'Adds wielder STR bonus to damage (up to +3).' },
  composite_longbow_plus3:{id:'composite_longbow_plus3',name:'Composite Longbow +3', slot: 'weapon3', price: 18400, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3', critMult: 3, isRanged: true, isMartial: true, description: 'Adds wielder STR bonus to damage (up to +4).' },
  light_crossbow_plus1: { id: 'light_crossbow_plus1', name: 'Light Crossbow +1',       slot: 'weapon3', price: 2335,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isRanged: true },
  light_crossbow_plus2: { id: 'light_crossbow_plus2', name: 'Light Crossbow +2',       slot: 'weapon3', price: 8335,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isRanged: true },
  heavy_crossbow_plus1: { id: 'heavy_crossbow_plus1', name: 'Heavy Crossbow +1',       slot: 'weapon3', price: 2350,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d10+1', critRange: 19, critMult: 2, isRanged: true },
  heavy_crossbow_plus2: { id: 'heavy_crossbow_plus2', name: 'Heavy Crossbow +2',       slot: 'weapon3', price: 8350,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d10+2', critRange: 19, critMult: 2, isRanged: true },
  flaming_longbow:      { id: 'flaming_longbow',      name: 'Flaming Longbow +1',      slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Arrows fired deal +1d6 fire damage on a successful hit.' },
  frost_shortbow:       { id: 'frost_shortbow',       name: 'Frost Shortbow +1',       slot: 'weapon3', price: 8330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Arrows fired deal +1d6 cold damage on a successful hit.' },
  shock_longbow:        { id: 'shock_longbow',        name: 'Shock Longbow +1',        slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Arrows fired deal +1d6 electricity damage on a successful hit.' },
  holy_longbow:         { id: 'holy_longbow',         name: 'Holy Longbow +2',         slot: 'weapon3', price: 32375, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isRanged: true, isMartial: true, description: '+2d6 holy damage vs evil creatures. Good-aligned.' },
  distance_longbow:     { id: 'distance_longbow',     name: 'Longbow of Distance +1',  slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Range increment doubled.' },
  distance_shortbow:    { id: 'distance_shortbow',    name: 'Shortbow of Distance +1', slot: 'weapon3', price: 8330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Range increment doubled.' },
  seeking_longbow:      { id: 'seeking_longbow',      name: 'Seeking Longbow +1',      slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Negates the miss chance granted by concealment (though not total concealment).' },
  seeking_shortbow:     { id: 'seeking_shortbow',     name: 'Seeking Shortbow +1',     slot: 'weapon3', price: 8330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Negates the miss chance granted by concealment (though not total concealment).' },
  oathbow:              { id: 'oathbow',              name: 'Oathbow',                 slot: 'weapon3', price: 25600, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isRanged: true, isMartial: true, description: 'Once per day, designate a sworn enemy. +5 attack and +2d6 damage against that enemy until killed.' },
  hand_crossbow_plus1:  { id: 'hand_crossbow_plus1',  name: 'Hand Crossbow +1',        slot: 'weapon3', price: 2400,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d4+1',  critRange: 19, critMult: 2, isRanged: true, isExotic: true },
  repeating_crossbow_plus1:{id:'repeating_crossbow_plus1',name:'Repeating Crossbow +1',slot:'weapon3',price:2550,bonuses:[{target:'bab',value:1,type:'enhancement'}],damage:'1d8+1',critRange:19,critMult:2,isRanged:true,isExotic:true,description:'Holds 5 bolts in a magazine; reload as a free action.'},
  returning_javelin:    { id: 'returning_javelin',    name: 'Returning Javelin +1',    slot: 'weapon3', price: 8301,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 2, isRanged: true, description: 'Returns to the wielder\'s hand at the end of the round after being thrown.' },
  vorpal_longbow:       { id: 'vorpal_longbow',       name: 'Vorpal Longbow +5',       slot: 'weapon3', price: 120375,bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critMult: 3, isRanged: true, isMartial: true, description: "On a natural 20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },

  // ── Magical ammo ──────────────────────────────────────────────────────────────
  arrows_plus1:         { id: 'arrows_plus1',         name: 'Arrows +1 (20)',          slot: 'ammo', price: 41,   bonuses: [] },
  arrows_plus2:         { id: 'arrows_plus2',         name: 'Arrows +2 (20)',          slot: 'ammo', price: 161,  bonuses: [] },
  arrows_plus3:         { id: 'arrows_plus3',         name: 'Arrows +3 (20)',          slot: 'ammo', price: 361,  bonuses: [] },
  arrows_plus4:         { id: 'arrows_plus4',         name: 'Arrows +4 (20)',          slot: 'ammo', price: 641,  bonuses: [] },
  arrows_plus5:         { id: 'arrows_plus5',         name: 'Arrows +5 (20)',          slot: 'ammo', price: 1001, bonuses: [] },
  flaming_arrows:       { id: 'flaming_arrows',       name: 'Flaming Arrows (20)',     slot: 'ammo', price: 161,  bonuses: [], description: '+1d6 fire damage on a successful hit.' },
  frost_arrows:         { id: 'frost_arrows',         name: 'Frost Arrows (20)',       slot: 'ammo', price: 161,  bonuses: [], description: '+1d6 cold damage on a successful hit.' },
  shock_arrows:         { id: 'shock_arrows',         name: 'Shock Arrows (20)',       slot: 'ammo', price: 161,  bonuses: [], description: '+1d6 electricity damage on a successful hit.' },
  corrosive_arrows:     { id: 'corrosive_arrows',     name: 'Corrosive Arrows (20)',   slot: 'ammo', price: 161,  bonuses: [], description: '+1d6 acid damage on a successful hit.' },
  bane_dragon_arrows:   { id: 'bane_dragon_arrows',   name: 'Bane (Dragons) Arrows (10)', slot: 'ammo', price: 460, bonuses: [], description: '+2 enhancement and +2d6 damage vs dragons.' },
  bane_undead_arrows:   { id: 'bane_undead_arrows',   name: 'Bane (Undead) Arrows (10)',  slot: 'ammo', price: 460, bonuses: [], description: '+2 enhancement and +2d6 damage vs undead.' },
  bolts_plus1:          { id: 'bolts_plus1',          name: 'Bolts +1 (10)',           slot: 'ammo', price: 91,   bonuses: [] },
  bolts_plus2:          { id: 'bolts_plus2',          name: 'Bolts +2 (10)',           slot: 'ammo', price: 331,  bonuses: [] },
  bolts_plus3:          { id: 'bolts_plus3',          name: 'Bolts +3 (10)',           slot: 'ammo', price: 681,  bonuses: [] },
  bullets_plus1:        { id: 'bullets_plus1',        name: 'Sling Bullets +1 (10)',   slot: 'ammo', price: 41,   bonuses: [] },
  bullets_plus2:        { id: 'bullets_plus2',        name: 'Sling Bullets +2 (10)',   slot: 'ammo', price: 161,  bonuses: [] },
  slaying_arrow:        { id: 'slaying_arrow',        name: 'Slaying Arrow (undead)',  slot: 'ammo', price: 2282, bonuses: [], description: 'Target must make DC 20 Fortitude save or die instantly.' },
  slaying_arrow_dragon: { id: 'slaying_arrow_dragon', name: 'Slaying Arrow (dragons)', slot: 'ammo', price: 2282, bonuses: [], description: 'Target dragon must make DC 20 Fortitude save or die instantly.' },
  slaying_arrow_giant:  { id: 'slaying_arrow_giant',  name: 'Slaying Arrow (giants)',  slot: 'ammo', price: 2282, bonuses: [], description: 'Target giant must make DC 20 Fortitude save or die instantly.' },
  screaming_bolt:       { id: 'screaming_bolt',       name: 'Screaming Bolt +2 (10)',  slot: 'ammo', price: 267,  bonuses: [], description: 'Target must make DC 14 Will save or be shaken for 1 round.' },
  brilliant_arrows:     { id: 'brilliant_arrows',     name: 'Brilliant Energy Arrows (10)', slot: 'ammo', price: 1610, bonuses: [], description: 'Bypasses non-living matter; ignores armor, shields, and natural armor of living foes.' },

  // ── Magical armor ─────────────────────────────────────────────────────────────
  // Base +N enchantment tiers
  padded_plus1:         { id: 'padded_plus1',         name: 'Padded Armor +1',         slot: 'armor', price: 1155,  bonuses: [{ target: 'ac', value: 2,  type: 'armor' }] },
  leather_plus1:        { id: 'leather_plus1',        name: 'Leather Armor +1',        slot: 'armor', price: 1160,  bonuses: [{ target: 'ac', value: 3,  type: 'armor' }] },
  leather_plus2:        { id: 'leather_plus2',        name: 'Leather Armor +2',        slot: 'armor', price: 4160,  bonuses: [{ target: 'ac', value: 4,  type: 'armor' }] },
  studded_leather_plus1:{ id: 'studded_leather_plus1',name: 'Studded Leather +1',      slot: 'armor', price: 1175,  bonuses: [{ target: 'ac', value: 4,  type: 'armor' }] },
  studded_leather_plus2:{ id: 'studded_leather_plus2',name: 'Studded Leather +2',      slot: 'armor', price: 4175,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }] },
  studded_leather_plus3:{ id: 'studded_leather_plus3',name: 'Studded Leather +3',      slot: 'armor', price: 9175,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  hide_plus1:           { id: 'hide_plus1',           name: 'Hide Armor +1',           slot: 'armor', price: 1165,  bonuses: [{ target: 'ac', value: 4,  type: 'armor' }], description: 'Druid-friendly: contains no metal.' },
  hide_plus2:           { id: 'hide_plus2',           name: 'Hide Armor +2',           slot: 'armor', price: 4165,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }], description: 'Druid-friendly: contains no metal.' },
  hide_plus3:           { id: 'hide_plus3',           name: 'Hide Armor +3',           slot: 'armor', price: 9165,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }], description: 'Druid-friendly: contains no metal.' },
  chain_shirt_plus1:    { id: 'chain_shirt_plus1',    name: 'Chain Shirt +1',          slot: 'armor', price: 1250,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }] },
  chain_shirt_plus2:    { id: 'chain_shirt_plus2',    name: 'Chain Shirt +2',          slot: 'armor', price: 4250,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  chain_shirt_plus3:    { id: 'chain_shirt_plus3',    name: 'Chain Shirt +3',          slot: 'armor', price: 9250,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  scale_mail_plus1:     { id: 'scale_mail_plus1',     name: 'Scale Mail +1',           slot: 'armor', price: 1200,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }] },
  scale_mail_plus2:     { id: 'scale_mail_plus2',     name: 'Scale Mail +2',           slot: 'armor', price: 4200,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  breastplate_plus1:    { id: 'breastplate_plus1',    name: 'Breastplate +1',          slot: 'armor', price: 1350,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  breastplate_plus2:    { id: 'breastplate_plus2',    name: 'Breastplate +2',          slot: 'armor', price: 4350,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  breastplate_plus3:    { id: 'breastplate_plus3',    name: 'Breastplate +3',          slot: 'armor', price: 9350,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  breastplate_plus4:    { id: 'breastplate_plus4',    name: 'Breastplate +4',          slot: 'armor', price: 16350, bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  mithral_shirt:        { id: 'mithral_shirt',        name: 'Mithral Shirt',           slot: 'armor', price: 1100,  bonuses: [{ target: 'ac', value: 4,  type: 'armor' }], description: 'Counts as light armor. No arcane spell failure chance.' },
  mithral_shirt_plus1:  { id: 'mithral_shirt_plus1',  name: 'Mithral Shirt +1',        slot: 'armor', price: 2100,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }], description: 'Counts as light armor. No arcane spell failure chance.' },
  mithral_shirt_plus3:  { id: 'mithral_shirt_plus3',  name: 'Mithral Shirt +3',        slot: 'armor', price: 10100, bonuses: [{ target: 'ac', value: 7,  type: 'armor' }], description: 'Counts as light armor. No arcane spell failure chance.' },
  elven_chain:          { id: 'elven_chain',          name: 'Elven Chain',             slot: 'armor', price: 4150,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }], description: 'Treated as light armor for proficiency. Allows arcane spellcasting without failure.' },
  chainmail_plus1:      { id: 'chainmail_plus1',      name: 'Chainmail +1',            slot: 'armor', price: 1300,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  chainmail_plus2:      { id: 'chainmail_plus2',      name: 'Chainmail +2',            slot: 'armor', price: 4300,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  chainmail_plus3:      { id: 'chainmail_plus3',      name: 'Chainmail +3',            slot: 'armor', price: 9300,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  splint_mail_plus1:    { id: 'splint_mail_plus1',    name: 'Splint Mail +1',          slot: 'armor', price: 1350,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  splint_mail_plus2:    { id: 'splint_mail_plus2',    name: 'Splint Mail +2',          slot: 'armor', price: 4350,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  banded_mail_plus1:    { id: 'banded_mail_plus1',    name: 'Banded Mail +1',          slot: 'armor', price: 1400,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  banded_mail_plus2:    { id: 'banded_mail_plus2',    name: 'Banded Mail +2',          slot: 'armor', price: 4400,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  banded_mail_plus3:    { id: 'banded_mail_plus3',    name: 'Banded Mail +3',          slot: 'armor', price: 9400,  bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  half_plate_plus1:     { id: 'half_plate_plus1',     name: 'Half-Plate +1',           slot: 'armor', price: 1750,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  half_plate_plus2:     { id: 'half_plate_plus2',     name: 'Half-Plate +2',           slot: 'armor', price: 4750,  bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  half_plate_plus3:     { id: 'half_plate_plus3',     name: 'Half-Plate +3',           slot: 'armor', price: 9750,  bonuses: [{ target: 'ac', value: 10, type: 'armor' }] },
  half_plate_plus4:     { id: 'half_plate_plus4',     name: 'Half-Plate +4',           slot: 'armor', price: 16750, bonuses: [{ target: 'ac', value: 11, type: 'armor' }] },
  full_plate_plus1:     { id: 'full_plate_plus1',     name: 'Full Plate +1',           slot: 'armor', price: 2650,  bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  full_plate_plus2:     { id: 'full_plate_plus2',     name: 'Full Plate +2',           slot: 'armor', price: 5650,  bonuses: [{ target: 'ac', value: 10, type: 'armor' }] },
  full_plate_plus3:     { id: 'full_plate_plus3',     name: 'Full Plate +3',           slot: 'armor', price: 18650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }] },
  full_plate_plus4:     { id: 'full_plate_plus4',     name: 'Full Plate +4',           slot: 'armor', price: 32650, bonuses: [{ target: 'ac', value: 12, type: 'armor' }] },
  full_plate_plus5:     { id: 'full_plate_plus5',     name: 'Full Plate +5',           slot: 'armor', price: 50650, bonuses: [{ target: 'ac', value: 13, type: 'armor' }] },
  mithral_full_plate:   { id: 'mithral_full_plate',   name: 'Mithral Full Plate +1',   slot: 'armor', price: 10500, bonuses: [{ target: 'ac', value: 9,  type: 'armor' }], description: 'Treated as medium armor (not heavy). Arcane spell failure reduced by 15%.' },
  dragonhide_breastplate:{ id: 'dragonhide_breastplate', name: 'Dragonhide Breastplate +2', slot: 'armor', price: 4350, bonuses: [{ target: 'ac', value: 7, type: 'armor' }], description: 'Made from dragon scales: druid-friendly (no metal). Energy resistance 5 vs the parent dragon\'s breath.' },
  adamantine_breastplate:{ id: 'adamantine_breastplate', name: 'Adamantine Breastplate', slot: 'armor', price: 10200, bonuses: [{ target: 'ac', value: 6, type: 'armor' }], description: 'DR 2/— while worn. Adamantine bypasses hardness ≤ 20.' },
  adamantine_full_plate:{ id: 'adamantine_full_plate', name: 'Adamantine Full Plate', slot: 'armor', price: 16500, bonuses: [{ target: 'ac', value: 8, type: 'armor' }], description: 'DR 3/— while worn. Adamantine bypasses hardness ≤ 20.' },
  celestial_armor:      { id: 'celestial_armor',      name: 'Celestial Armor',         slot: 'armor', price: 22400, bonuses: [{ target: 'ac', value: 9,  type: 'armor' }], description: 'Fly 1 min/day (good maneuverability, CL 5th). No arcane spell failure.' },
  ghostward_chain:      { id: 'ghostward_chain',      name: 'Ghost Ward Chainmail +3', slot: 'armor', price: 18300, bonuses: [{ target: 'ac', value: 8,  type: 'armor' }], description: 'Armor bonus applies against incorporeal touch attacks.' },

  // Fortification armors — affect HP via resisted critical/sneak hits
  light_fort_breastplate:    { id: 'light_fort_breastplate',    name: 'Light Fortification Breastplate +1',     slot: 'armor', price: 5350,  bonuses: [{ target: 'ac', value: 6, type: 'armor' }, { target: 'hp', value: 5 }], description: '25% chance to negate critical hits and sneak attacks (averaged into the +5 HP bonus).' },
  light_fort_full_plate:     { id: 'light_fort_full_plate',     name: 'Light Fortification Full Plate +2',      slot: 'armor', price: 11650, bonuses: [{ target: 'ac', value: 10, type: 'armor' }, { target: 'hp', value: 8 }], description: '25% chance to negate critical hits and sneak attacks (averaged into the +8 HP bonus).' },
  moderate_fort_full_plate:  { id: 'moderate_fort_full_plate',  name: 'Moderate Fortification Full Plate +3',   slot: 'armor', price: 31650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'hp', value: 18 }], description: '75% chance to negate critical hits and sneak attacks.' },
  heavy_fort_full_plate:     { id: 'heavy_fort_full_plate',     name: 'Heavy Fortification Full Plate +3',      slot: 'armor', price: 56650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'hp', value: 30 }], description: '100% chance to negate critical hits and sneak attacks.' },
  light_fort_chain_shirt:    { id: 'light_fort_chain_shirt',    name: 'Light Fortification Chain Shirt +1',     slot: 'armor', price: 5250,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }, { target: 'hp', value: 5 }], description: '25% chance to negate critical hits and sneak attacks.' },

  // Energy resistance armors — fold into the relevant save bonus to encourage them in scoring
  fire_resist_breastplate:   { id: 'fire_resist_breastplate',   name: 'Fire Resistance Breastplate +1',         slot: 'armor', price: 19350, bonuses: [{ target: 'ac', value: 6, type: 'armor' }, { target: 'fort', value: 2, type: 'resistance' }], description: 'Energy resistance (fire) 10. Folded into +2 Fortitude resistance for game-mechanics shorthand.' },
  cold_resist_full_plate:    { id: 'cold_resist_full_plate',    name: 'Cold Resistance Full Plate +2',          slot: 'armor', price: 23650, bonuses: [{ target: 'ac', value: 10, type: 'armor' }, { target: 'fort', value: 2, type: 'resistance' }], description: 'Energy resistance (cold) 10. Folded into +2 Fortitude resistance for game-mechanics shorthand.' },
  shock_resist_chain_shirt:  { id: 'shock_resist_chain_shirt',  name: 'Electricity Resistance Chain Shirt +1',  slot: 'armor', price: 19250, bonuses: [{ target: 'ac', value: 5, type: 'armor' }, { target: 'ref', value: 2, type: 'resistance' }], description: 'Energy resistance (electricity) 10. Folded into +2 Reflex resistance for game-mechanics shorthand.' },
  acid_resist_studded:       { id: 'acid_resist_studded',       name: 'Acid Resistance Studded Leather +1',     slot: 'armor', price: 19175, bonuses: [{ target: 'ac', value: 4, type: 'armor' }, { target: 'fort', value: 2, type: 'resistance' }], description: 'Energy resistance (acid) 10. Folded into +2 Fortitude resistance for game-mechanics shorthand.' },
  sonic_resist_breastplate:  { id: 'sonic_resist_breastplate',  name: 'Sonic Resistance Breastplate +1',        slot: 'armor', price: 19350, bonuses: [{ target: 'ac', value: 6, type: 'armor' }, { target: 'fort', value: 2, type: 'resistance' }], description: 'Energy resistance (sonic) 10. Folded into +2 Fortitude resistance for game-mechanics shorthand.' },
  greater_fire_resist_full:  { id: 'greater_fire_resist_full',  name: 'Greater Fire Resistance Full Plate +3',  slot: 'armor', price: 60650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'fort', value: 4, type: 'resistance' }], description: 'Energy resistance (fire) 30. Folded into +4 Fortitude resistance for game-mechanics shorthand.' },
  prismatic_armor:           { id: 'prismatic_armor',           name: 'Prismatic Full Plate +3',                slot: 'armor', price: 80650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'fort', value: 3, type: 'resistance' }, { target: 'ref', value: 3, type: 'resistance' }, { target: 'will', value: 3, type: 'resistance' }], description: 'Energy resistance (acid/cold/electricity/fire/sonic) 10 each.' },

  // Spell resistance armors
  sr13_chainmail:            { id: 'sr13_chainmail',            name: 'Spell Resistance (13) Chainmail +1',     slot: 'armor', price: 12300, bonuses: [{ target: 'ac', value: 6, type: 'armor' }, { target: 'will', value: 2, type: 'resistance' }], description: 'Spell resistance 13.' },
  sr15_full_plate:           { id: 'sr15_full_plate',           name: 'Spell Resistance (15) Full Plate +2',    slot: 'armor', price: 30650, bonuses: [{ target: 'ac', value: 10, type: 'armor' }, { target: 'will', value: 3, type: 'resistance' }], description: 'Spell resistance 15.' },
  sr17_full_plate:           { id: 'sr17_full_plate',           name: 'Spell Resistance (17) Full Plate +3',    slot: 'armor', price: 50650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'will', value: 4, type: 'resistance' }], description: 'Spell resistance 17.' },
  sr19_full_plate:           { id: 'sr19_full_plate',           name: 'Spell Resistance (19) Full Plate +4',    slot: 'armor', price: 96650, bonuses: [{ target: 'ac', value: 12, type: 'armor' }, { target: 'will', value: 5, type: 'resistance' }], description: 'Spell resistance 19.' },

  // Ghost touch armor
  ghost_touch_chain_shirt:   { id: 'ghost_touch_chain_shirt',   name: 'Ghost Touch Chain Shirt +1',             slot: 'armor', price: 9250,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }], description: 'Armor bonus applies against incorporeal touch attacks; can be worn by ethereal creatures.' },
  ghost_touch_full_plate:    { id: 'ghost_touch_full_plate',    name: 'Ghost Touch Full Plate +2',              slot: 'armor', price: 23650, bonuses: [{ target: 'ac', value: 10, type: 'armor' }], description: 'Armor bonus applies against incorporeal touch attacks; can be worn by ethereal creatures.' },

  // Specialty armor
  glamered_chainmail:        { id: 'glamered_chainmail',        name: 'Glamered Chainmail +1',                  slot: 'armor', price: 4300,  bonuses: [{ target: 'ac', value: 6, type: 'armor' }], description: 'Appears as ordinary clothing of the wearer\'s choice on command.' },
  silent_moves_studded:      { id: 'silent_moves_studded',      name: 'Silent Moves Studded Leather +2',        slot: 'armor', price: 9175,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }], description: '+10 competence bonus on Move Silently checks.' },
  shadow_studded:            { id: 'shadow_studded',            name: 'Shadow Studded Leather +2',              slot: 'armor', price: 7175,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }], description: '+10 competence bonus on Hide checks.' },
  slick_leather:             { id: 'slick_leather',             name: 'Slick Leather +1',                       slot: 'armor', price: 4160,  bonuses: [{ target: 'ac', value: 3, type: 'armor' }], description: '+10 competence bonus on Escape Artist checks.' },
  dwarven_plate:             { id: 'dwarven_plate',             name: 'Dwarven Plate +3',                       slot: 'armor', price: 16650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'fort', value: 1, type: 'resistance' }], description: 'Reduces armor check penalty by 1; bonus stability vs trip / bull rush.' },
  determination_breastplate: { id: 'determination_breastplate', name: 'Determination Breastplate +2',           slot: 'armor', price: 25350, bonuses: [{ target: 'ac', value: 7, type: 'armor' }, { target: 'fort', value: 1, type: 'resistance' }, { target: 'ref', value: 1, type: 'resistance' }, { target: 'will', value: 1, type: 'resistance' }], description: 'Once per day, the wearer can reroll a single failed saving throw.' },
  invulnerability_full_plate:{ id: 'invulnerability_full_plate',name: 'Full Plate of Invulnerability +3',       slot: 'armor', price: 38650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'hp', value: 10 }], description: 'Damage reduction 5/magic. Approximated as +10 HP bonus.' },
  righteousness_armor:       { id: 'righteousness_armor',       name: 'Armor of Righteousness +3',              slot: 'armor', price: 30650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }, { target: 'will', value: 2, type: 'sacred' }], description: 'Wearer immune to fear; +2 sacred bonus on Will saves vs evil. Good-aligned.' },
  rhino_hide:                { id: 'rhino_hide',                name: 'Rhino Hide +2',                          slot: 'armor', price: 5165,  bonuses: [{ target: 'ac', value: 5, type: 'armor' }], description: 'On a successful charge, +2d6 damage. Druid-friendly (no metal).' },

  // ── Helmets (magical) ─────────────────────────────────────────────────────────
  headband_intellect2:  { id: 'headband_intellect2',  name: 'Headband of Intellect +2',slot: 'helmet', price: 4000,  bonuses: [{ target: 'int', value: 2, type: 'enhancement' }] },
  headband_intellect4:  { id: 'headband_intellect4',  name: 'Headband of Intellect +4',slot: 'helmet', price: 16000, bonuses: [{ target: 'int', value: 4, type: 'enhancement' }] },
  headband_intellect6:  { id: 'headband_intellect6',  name: 'Headband of Intellect +6',slot: 'helmet', price: 36000, bonuses: [{ target: 'int', value: 6, type: 'enhancement' }] },
  headband_wisdom2:     { id: 'headband_wisdom2',     name: 'Headband of Inspired Wisdom +2', slot: 'helmet', price: 4000, bonuses: [{ target: 'wis', value: 2, type: 'enhancement' }] },
  headband_wisdom4:     { id: 'headband_wisdom4',     name: 'Headband of Inspired Wisdom +4', slot: 'helmet', price: 16000, bonuses: [{ target: 'wis', value: 4, type: 'enhancement' }] },
  headband_charisma2:   { id: 'headband_charisma2',   name: 'Headband of Alluring Charisma +2', slot: 'helmet', price: 4000, bonuses: [{ target: 'cha', value: 2, type: 'enhancement' }] },
  headband_charisma4:   { id: 'headband_charisma4',   name: 'Headband of Alluring Charisma +4', slot: 'helmet', price: 16000, bonuses: [{ target: 'cha', value: 4, type: 'enhancement' }] },
  hat_of_disguise:      { id: 'hat_of_disguise',      name: 'Hat of Disguise',         slot: 'helmet', price: 1800,  bonuses: [], description: 'Disguise self at will (CL 1st).' },
  circlet_persuasion:   { id: 'circlet_persuasion',   name: 'Circlet of Persuasion',   slot: 'helmet', price: 4500,  bonuses: [{ target: 'cha', value: 3, type: 'competence' }], description: '+3 competence bonus on CHA-based skill checks.' },
  circlet_blasting:     { id: 'circlet_blasting',     name: 'Circlet of Blasting (minor)',slot: 'helmet', price: 6480, bonuses: [], description: 'Searing light 1/day (CL 3rd, 3d8 damage; +3d8 vs undead).' },
  helm_comprehend:      { id: 'helm_comprehend',      name: 'Helm of Comprehend Languages', slot: 'helmet', price: 5200, bonuses: [], description: 'Comprehend languages and read magic at will (CL 1st).' },
  helm_underwater:      { id: 'helm_underwater',      name: 'Helm of Underwater Action', slot: 'helmet', price: 4000, bonuses: [], description: 'See underwater normally; water breathing 1/day (CL 5th).' },
  helm_glorious:        { id: 'helm_glorious',        name: 'Helm of Glorious Recovery', slot: 'helmet', price: 12000, bonuses: [], description: 'Once per day, removes one negative effect (disease, poison, fear, paralysis, fatigue) from the wearer.' },
  helm_protection:      { id: 'helm_protection',      name: 'Helm of Protection +2',     slot: 'helmet', price: 8000, bonuses: [{ target: 'fort', value: 1, type: 'resistance' }, { target: 'ref', value: 1, type: 'resistance' }, { target: 'will', value: 2, type: 'resistance' }], description: '+2 Will save resistance, +1 Fort/Ref. Bonus stacks with Cloak of Resistance.' },
  helm_battle:          { id: 'helm_battle',          name: 'Helm of Battle',           slot: 'helmet', price: 10000, bonuses: [{ target: 'bab', value: 1, type: 'sacred' }, { target: 'will', value: 1, type: 'morale' }], description: '+1 sacred bonus on attack rolls and +1 morale bonus on saves vs fear.' },
  helm_telepathy:       { id: 'helm_telepathy',       name: 'Helm of Telepathy',        slot: 'helmet', price: 27000, bonuses: [], description: 'Detect thoughts at will (CL 5th). Once detected, can plant a suggestion (Will DC 14, 1/day).' },
  helm_teleportation:   { id: 'helm_teleportation',   name: 'Helm of Teleportation',    slot: 'helmet', price: 73500, bonuses: [], description: 'Teleport (self only) 3/day (CL 9th).' },
  helm_brilliance:      { id: 'helm_brilliance',      name: 'Helm of Brilliance',       slot: 'helmet', price: 125000, bonuses: [{ target: 'bab', value: 1, type: 'sacred' }], description: 'Fire resistance 30. Commands flaming, fire ball, fire storm, and sunburst effects. Flaming weapons deal +1d6 extra fire.' },
  crown_might:          { id: 'crown_might',          name: 'Crown of Might',           slot: 'helmet', price: 36000, bonuses: [{ target: 'str', value: 4, type: 'enhancement' }, { target: 'will', value: 1, type: 'morale' }], description: '+4 STR (enhancement) and grants the wearer commanding presence.' },
  diadem_intellect:     { id: 'diadem_intellect',     name: 'Diadem of Intellect +6',   slot: 'helmet', price: 36000, bonuses: [{ target: 'int', value: 6, type: 'enhancement' }, { target: 'will', value: 1, type: 'insight' }], description: 'Equivalent to a +6 headband; also grants +1 insight to Will saves.' },
  spectacles_truth:     { id: 'spectacles_truth',     name: 'Spectacles of Truth',      slot: 'helmet', price: 27000, bonuses: [], description: 'True seeing 1 minute/day (CL 5th).' },
  mask_skull:           { id: 'mask_skull',           name: 'Mask of the Skull',        slot: 'helmet', price: 22000, bonuses: [], description: 'Once per day, fly toward target up to 50 ft. and force them to make DC 16 Fortitude save or die (necromancy effect).' },
  phylactery_faithfulness:{id:'phylactery_faithfulness',name:'Phylactery of Faithfulness',slot:'helmet',price:1000, bonuses: [], description: 'Wearer always knows when an action would violate their alignment (continuous detect).' },
  phylactery_undead_turn:{id:'phylactery_undead_turn',name:'Phylactery of Undead Turning',slot:'helmet',price:11000, bonuses: [], description: 'Wearer turns undead as if they were 4 levels higher.' },

  // ── Bracers (magical) ─────────────────────────────────────────────────────────
  bracers_armor1:       { id: 'bracers_armor1',       name: 'Bracers of Armor +1',     slot: 'braces', price: 1000,  bonuses: [{ target: 'ac', value: 1, type: 'armor' }] },
  bracers_armor2:       { id: 'bracers_armor2',       name: 'Bracers of Armor +2',     slot: 'braces', price: 4000,  bonuses: [{ target: 'ac', value: 2, type: 'armor' }] },
  bracers_armor3:       { id: 'bracers_armor3',       name: 'Bracers of Armor +3',     slot: 'braces', price: 9000,  bonuses: [{ target: 'ac', value: 3, type: 'armor' }] },
  bracers_armor4:       { id: 'bracers_armor4',       name: 'Bracers of Armor +4',     slot: 'braces', price: 16000, bonuses: [{ target: 'ac', value: 4, type: 'armor' }] },
  bracers_armor5:       { id: 'bracers_armor5',       name: 'Bracers of Armor +5',     slot: 'braces', price: 25000, bonuses: [{ target: 'ac', value: 5, type: 'armor' }] },
  bracers_armor6:       { id: 'bracers_armor6',       name: 'Bracers of Armor +6',     slot: 'braces', price: 36000, bonuses: [{ target: 'ac', value: 6, type: 'armor' }] },
  bracers_armor7:       { id: 'bracers_armor7',       name: 'Bracers of Armor +7',     slot: 'braces', price: 49000, bonuses: [{ target: 'ac', value: 7, type: 'armor' }] },
  bracers_armor8:       { id: 'bracers_armor8',       name: 'Bracers of Armor +8',     slot: 'braces', price: 64000, bonuses: [{ target: 'ac', value: 8, type: 'armor' }] },
  bracers_archery:      { id: 'bracers_archery',      name: 'Bracers of Archery',      slot: 'braces', price: 5000,  bonuses: [{ target: 'bab', value: 2, type: 'competence' }], description: '+2 competence bonus on attack rolls with bows.' },
  bracers_archery_greater:{id:'bracers_archery_greater',name:'Bracers of Archery, Greater',slot:'braces',price:25000,bonuses:[{target:'bab',value:1,type:'enhancement'},{target:'bab',value:2,type:'competence'}],description:'+1 enhancement and +2 competence on attack rolls with bows.'},
  bracers_falcon_aim:   { id: 'bracers_falcon_aim',   name: "Bracers of Falcon's Aim", slot: 'braces', price: 4000,  bonuses: [{ target: 'bab', value: 1, type: 'competence' }], description: '+1 competence to attack rolls with ranged weapons; +3 to Spot/Perception checks.' },
  bracers_blinding_strike:{id:'bracers_blinding_strike',name:'Bracers of the Blinding Strike',slot:'braces',price:18000,bonuses:[{target:'bab',value:1,type:'competence'}],description:'+1 competence to attack rolls; once per day, blinding strike (Fort DC 14) on a successful hit.'},
  bracers_mighty_striking:{id:'bracers_mighty_striking',name:'Bracers of Mighty Striking',slot:'braces',price:1500,bonuses:[],description:'+1 enhancement to unarmed strike damage; usable by anyone, not just monks.'},
  bracers_dawn:         { id: 'bracers_dawn',         name: 'Bracers of Dawn',         slot: 'braces', price: 4000,  bonuses: [{ target: 'will', value: 1, type: 'sacred' }], description: 'Wearer\'s weapons gain ghost touch and +1d6 sacred damage vs undead. Sheds light as a torch.' },
  bracers_quickstrike:  { id: 'bracers_quickstrike',  name: 'Bracers of Quickstrike',  slot: 'braces', price: 5000,  bonuses: [{ target: 'ref', value: 2, type: 'competence' }], description: '+2 competence bonus on initiative and Reflex saves.' },
  bracers_swordsmith:   { id: 'bracers_swordsmith',   name: 'Bracers of the Swordsmith', slot: 'braces', price: 7500, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], description: 'Held weapon gains +1 enhancement bonus on attack rolls (does not stack with weapon\'s own enhancement).' },
  bracers_relentless:   { id: 'bracers_relentless',   name: 'Bracers of the Relentless Hunt', slot: 'braces', price: 9000, bonuses: [{ target: 'fort', value: 2, type: 'competence' }, { target: 'hp', value: 5 }], description: 'Wearer never tires; ignores fatigue/exhaustion; +2 competence on Fortitude saves.' },

  // ── Gloves (magical) ──────────────────────────────────────────────────────────
  gauntlets_ogre:       { id: 'gauntlets_ogre',       name: 'Gauntlets of Ogre Power', slot: 'gloves', price: 4000,  bonuses: [{ target: 'str', value: 2, type: 'enhancement' }] },
  gloves_dex2:          { id: 'gloves_dex2',          name: 'Gloves of Dexterity +2',  slot: 'gloves', price: 4000,  bonuses: [{ target: 'dex', value: 2, type: 'enhancement' }] },
  gloves_dex4:          { id: 'gloves_dex4',          name: 'Gloves of Dexterity +4',  slot: 'gloves', price: 16000, bonuses: [{ target: 'dex', value: 4, type: 'enhancement' }] },
  gloves_dex6:          { id: 'gloves_dex6',          name: 'Gloves of Dexterity +6',  slot: 'gloves', price: 36000, bonuses: [{ target: 'dex', value: 6, type: 'enhancement' }] },
  gloves_storing:       { id: 'gloves_storing',       name: 'Gloves of Storing',       slot: 'gloves', price: 10000, bonuses: [], description: 'Store one item ≤ 10 lb; retrieve as a free action.' },
  gloves_arrow_snaring: { id: 'gloves_arrow_snaring', name: 'Gloves of Arrow Snaring', slot: 'gloves', price: 4000,  bonuses: [{ target: 'ac', value: 1, type: 'deflection' }], description: 'Once per round, may catch an incoming arrow as a free action (Reflex save).' },
  gloves_swimming_climbing:{id:'gloves_swimming_climbing',name:'Gloves of Swimming and Climbing',slot:'gloves',price:6250,bonuses:[],description:'+5 competence bonus on Swim and Climb checks.'},
  gauntlets_iron:       { id: 'gauntlets_iron',       name: 'Gauntlets of the Ironbound', slot: 'gloves', price: 4500, bonuses: [], description: 'Unarmed strikes deal lethal damage as if armed; +1d4 damage on a successful hit.' },
  gauntlets_rust:       { id: 'gauntlets_rust',       name: 'Gauntlets of Rust',       slot: 'gloves', price: 11500, bonuses: [], description: 'Touch attack: rust metal objects (rusting grasp 3/day, CL 6th).' },
  gloves_titans_grip:   { id: 'gloves_titans_grip',   name: "Gloves of the Titan's Grip", slot: 'gloves', price: 36000, bonuses: [{ target: 'str', value: 6, type: 'enhancement' }], description: 'Massive strength enhancement. Wearer can wield oversized weapons one-handed.' },
  gauntlets_destruction:{ id: 'gauntlets_destruction',name: 'Gauntlets of Destruction', slot: 'gloves', price: 18000, bonuses: [{ target: 'str', value: 2, type: 'enhancement' }], description: 'Wielded weapons deal +1d6 damage; sunder attempts gain +4.' },
  gloves_minstrel:      { id: 'gloves_minstrel',      name: "Gloves of the Minstrel",  slot: 'gloves', price: 4500,  bonuses: [{ target: 'cha', value: 2, type: 'competence' }], description: '+2 competence on Perform checks; once per day extend bardic music duration.' },
  gloves_glamered:      { id: 'gloves_glamered',      name: 'Glamered Gloves',         slot: 'gloves', price: 1500,  bonuses: [], description: 'Conceal up to 4 small items (rings, scrolls, daggers) as ordinary gloves.' },

  // ── Boots (magical) ───────────────────────────────────────────────────────────
  boots_elvenkind:      { id: 'boots_elvenkind',      name: 'Boots of Elvenkind',           slot: 'boots', price: 2500,  bonuses: [], description: '+5 competence bonus on Move Silently checks.' },
  boots_striding:       { id: 'boots_striding',       name: 'Boots of Striding and Springing', slot: 'boots', price: 5500, bonuses: [], description: '+10 ft. land speed. +5 competence bonus on Jump checks.' },
  boots_speed:          { id: 'boots_speed',          name: 'Boots of Speed',               slot: 'boots', price: 12000, bonuses: [{ target: 'ac', value: 1, type: 'dodge' }], description: 'Haste (CL 10th) for up to 10 rounds per day; +1 dodge to AC already reflected.' },
  boots_levitation:     { id: 'boots_levitation',     name: 'Boots of Levitation',          slot: 'boots', price: 7500,  bonuses: [], description: 'Levitate at will (CL 3rd).' },
  boots_flying:         { id: 'boots_flying',         name: 'Winged Boots',                 slot: 'boots', price: 16000, bonuses: [], description: 'Fly 60 ft. (good, CL 5th) for up to 5 min/day in 1-minute increments.' },
  boots_teleport:       { id: 'boots_teleport',       name: 'Boots of Teleportation',       slot: 'boots', price: 49000, bonuses: [], description: 'Teleport 3/day (self only, CL 9th).' },
  boots_winterlands:    { id: 'boots_winterlands',    name: 'Boots of the Winterlands',     slot: 'boots', price: 2500,  bonuses: [{ target: 'fort', value: 2, type: 'resistance' }], description: 'Endure cold environments; leave no tracks in snow; +2 Fortitude vs cold.' },
  boots_earth:          { id: 'boots_earth',          name: 'Boots of the Earth',           slot: 'boots', price: 2500,  bonuses: [{ target: 'hp', value: 5 }], description: 'Heal 1 HP / round (max 10/day) while in contact with natural earth or stone.' },
  boots_swiftness:      { id: 'boots_swiftness',      name: 'Boots of Swiftness',           slot: 'boots', price: 13500, bonuses: [{ target: 'ref', value: 2, type: 'competence' }], description: '+10 ft. land speed; +2 competence to Reflex saves and Initiative.' },
  boots_cat:            { id: 'boots_cat',            name: 'Boots of the Cat',             slot: 'boots', price: 1000,  bonuses: [], description: 'Always land on feet when falling; treat falls as 10 ft. shorter and never lose footing.' },
  boots_balance:        { id: 'boots_balance',        name: 'Boots of Balance',             slot: 'boots', price: 2500,  bonuses: [{ target: 'ref', value: 1, type: 'competence' }], description: '+5 competence on Balance checks; +1 Reflex.' },
  boots_silent:         { id: 'boots_silent',         name: 'Boots of Silent Step',         slot: 'boots', price: 4500,  bonuses: [], description: '+10 competence bonus on Move Silently checks; cannot be heard at any distance.' },
  boots_dimensional:    { id: 'boots_dimensional',    name: 'Boots of the Dimensional Stride',slot: 'boots', price: 36000, bonuses: [], description: 'Dimension door 3/day (CL 7th, 80 ft. range).' },
  boots_road:           { id: 'boots_road',           name: 'Boots of the Long Road',       slot: 'boots', price: 2500,  bonuses: [], description: 'Wearer can hustle for up to 10 hours / day with no fatigue; +5 competence on overland march.' },
  boots_spider_climbing:{ id: 'boots_spider_climbing',name: 'Boots of Spider Climbing',     slot: 'boots', price: 3500,  bonuses: [], description: 'Spider climb at will (CL 6th); 20 ft. climb speed on any surface.' },
  boots_water_walking:  { id: 'boots_water_walking',  name: 'Boots of Water Walking',       slot: 'boots', price: 6000,  bonuses: [], description: 'Water walk continuously (CL 7th); walk on water, oil, mud, etc.' },
  boots_battle_charger: { id: 'boots_battle_charger', name: "Boots of the Battle Charger",  slot: 'boots', price: 6000,  bonuses: [{ target: 'bab', value: 1, type: 'competence' }], description: '+10 ft. land speed when charging; +1 competence on attack rolls during a charge.' },

  // ── Necklace / Amulet (magical) ───────────────────────────────────────────────
  amulet_natural1:      { id: 'amulet_natural1',      name: 'Amulet of Natural Armor +1',  slot: 'necklace', price: 2000,  bonuses: [{ target: 'ac', value: 1, type: 'natural' }] },
  amulet_natural2:      { id: 'amulet_natural2',      name: 'Amulet of Natural Armor +2',  slot: 'necklace', price: 8000,  bonuses: [{ target: 'ac', value: 2, type: 'natural' }] },
  amulet_natural3:      { id: 'amulet_natural3',      name: 'Amulet of Natural Armor +3',  slot: 'necklace', price: 18000, bonuses: [{ target: 'ac', value: 3, type: 'natural' }] },
  amulet_natural4:      { id: 'amulet_natural4',      name: 'Amulet of Natural Armor +4',  slot: 'necklace', price: 32000, bonuses: [{ target: 'ac', value: 4, type: 'natural' }] },
  amulet_natural5:      { id: 'amulet_natural5',      name: 'Amulet of Natural Armor +5',  slot: 'necklace', price: 50000, bonuses: [{ target: 'ac', value: 5, type: 'natural' }] },
  amulet_health2:       { id: 'amulet_health2',       name: 'Amulet of Health +2',         slot: 'necklace', price: 4000,  bonuses: [{ target: 'con', value: 2, type: 'enhancement' }] },
  amulet_health4:       { id: 'amulet_health4',       name: 'Amulet of Health +4',         slot: 'necklace', price: 16000, bonuses: [{ target: 'con', value: 4, type: 'enhancement' }] },
  amulet_health6:       { id: 'amulet_health6',       name: 'Amulet of Health +6',         slot: 'necklace', price: 36000, bonuses: [{ target: 'con', value: 6, type: 'enhancement' }] },
  amulet_fists1:        { id: 'amulet_fists1',        name: 'Amulet of Mighty Fists +1',   slot: 'necklace', price: 6000,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], description: '+1 enhancement to unarmed strike and natural weapon attack and damage.' },
  amulet_fists2:        { id: 'amulet_fists2',        name: 'Amulet of Mighty Fists +2',   slot: 'necklace', price: 24000, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], description: '+2 enhancement to unarmed strike and natural weapon attack and damage.' },
  amulet_fists3:        { id: 'amulet_fists3',        name: 'Amulet of Mighty Fists +3',   slot: 'necklace', price: 54000, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], description: '+3 enhancement to unarmed strike and natural weapon attack and damage.' },
  periapt_wisdom2:      { id: 'periapt_wisdom2',      name: 'Periapt of Wisdom +2',        slot: 'necklace', price: 4000,  bonuses: [{ target: 'wis', value: 2, type: 'enhancement' }] },
  periapt_wisdom4:      { id: 'periapt_wisdom4',      name: 'Periapt of Wisdom +4',        slot: 'necklace', price: 16000, bonuses: [{ target: 'wis', value: 4, type: 'enhancement' }] },
  periapt_wisdom6:      { id: 'periapt_wisdom6',      name: 'Periapt of Wisdom +6',        slot: 'necklace', price: 36000, bonuses: [{ target: 'wis', value: 6, type: 'enhancement' }] },
  necklace_fireballs:   { id: 'necklace_fireballs',   name: 'Necklace of Fireballs (I)',   slot: 'necklace', price: 1650,  bonuses: [], description: '2 beads, each thrown for 5d6 fire (Reflex DC 14 half, range 70 ft.).' },
  necklace_fireballs2:  { id: 'necklace_fireballs2',  name: 'Necklace of Fireballs (IV)',  slot: 'necklace', price: 5400,  bonuses: [], description: '4 beads (5d6/3d6 fire); range 70 ft.' },
  medallion_thoughts:   { id: 'medallion_thoughts',   name: 'Medallion of Thoughts',       slot: 'necklace', price: 12000, bonuses: [], description: 'Detect thoughts at will (CL 5th).' },
  amulet_health8:       { id: 'amulet_health8',       name: 'Amulet of Health +8',         slot: 'necklace', price: 64000, bonuses: [{ target: 'con', value: 8, type: 'enhancement' }] },
  amulet_natural6:      { id: 'amulet_natural6',      name: 'Amulet of Natural Armor +6',  slot: 'necklace', price: 72000, bonuses: [{ target: 'ac', value: 6, type: 'natural' }] },
  amulet_fists4:        { id: 'amulet_fists4',        name: 'Amulet of Mighty Fists +4',   slot: 'necklace', price: 96000, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], description: '+4 enhancement to unarmed strike and natural weapon attack and damage.' },
  amulet_fists5:        { id: 'amulet_fists5',        name: 'Amulet of Mighty Fists +5',   slot: 'necklace', price: 150000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], description: '+5 enhancement to unarmed strike and natural weapon attack and damage.' },
  brooch_shielding:     { id: 'brooch_shielding',     name: 'Brooch of Shielding',         slot: 'necklace', price: 1500,  bonuses: [], description: 'Absorbs up to 101 points of magic missile damage; consumed when capacity exceeded.' },
  scarab_protection:    { id: 'scarab_protection',    name: 'Scarab of Protection',        slot: 'necklace', price: 38000, bonuses: [{ target: 'fort', value: 2, type: 'resistance' }, { target: 'will', value: 2, type: 'resistance' }], description: 'Spell resistance 20 vs death effects, energy drain, and negative energy. Absorbs up to 12 such effects then crumbles.' },
  amulet_proof_detection:{ id: 'amulet_proof_detection',name: 'Amulet of Proof Against Detection', slot: 'necklace', price: 35000, bonuses: [], description: 'Continuous nondetection (CL 8th). Immune to scrying and detection spells.' },
  amulet_archery:       { id: 'amulet_archery',       name: 'Amulet of the Archer',        slot: 'necklace', price: 5000,  bonuses: [{ target: 'bab', value: 2, type: 'competence' }], description: '+2 competence to attack rolls with bows; +5 to Spot ranges.' },
  amulet_inescapable_focus:{id:'amulet_inescapable_focus',name:'Amulet of Inescapable Focus',slot:'necklace',price:5000,bonuses:[{target:'will',value:2,type:'competence'}],description:'+5 competence on Concentration checks; +2 Will saves vs distraction.'},
  talisman_pure_good:   { id: 'talisman_pure_good',   name: 'Talisman of Pure Good',       slot: 'necklace', price: 27000, bonuses: [{ target: 'fort', value: 1, type: 'sacred' }, { target: 'ref', value: 1, type: 'sacred' }, { target: 'will', value: 2, type: 'sacred' }], description: 'Touch attack: destroys evil clerics of 7+ levels (no save). Usable only by good characters.' },
  talisman_ultimate_evil:{id:'talisman_ultimate_evil',name:'Talisman of Ultimate Evil',    slot:'necklace',price:32500,bonuses:[{target:'fort',value:1,type:'profane'},{target:'ref',value:1,type:'profane'},{target:'will',value:2,type:'profane'}],description:'Touch attack: destroys good clerics of 7+ levels (no save). Usable only by evil characters.'},
  amulet_emerald_eye:   { id: 'amulet_emerald_eye',   name: 'Amulet of the Emerald Eye',   slot: 'necklace', price: 16000, bonuses: [{ target: 'will', value: 1, type: 'insight' }, { target: 'cha', value: 2, type: 'enhancement' }], description: 'Continuous see invisibility (CL 5th).' },
  amulet_planes:        { id: 'amulet_planes',        name: 'Amulet of the Planes',        slot: 'necklace', price: 120000, bonuses: [], description: 'Plane shift to any plane the wearer is familiar with (DC 15 INT check or arrive randomly).' },
  periapt_proof_poison: { id: 'periapt_proof_poison', name: 'Periapt of Proof Against Poison',slot: 'necklace', price: 27000, bonuses: [{ target: 'fort', value: 4, type: 'resistance' }], description: 'Continuous immunity to poison.' },
  periapt_health:       { id: 'periapt_health',       name: 'Periapt of Health',           slot: 'necklace', price: 7400,  bonuses: [{ target: 'fort', value: 2, type: 'resistance' }, { target: 'hp', value: 5 }], description: 'Wearer immune to mundane diseases (e.g., mummy rot still affects).' },
  amulet_undying_loyalty:{id:'amulet_undying_loyalty',name:'Amulet of Undying Loyalty',    slot:'necklace',price:18000,bonuses:[{target:'will',value:2,type:'morale'}],description:'Wearer cannot be magically charmed or forced to attack allies; +2 morale on saves vs compulsion.'},

  // ── Rings ─────────────────────────────────────────────────────────────────────
  ring_protection1:     { id: 'ring_protection1',     name: 'Ring of Protection +1',  slot: 'ring1', price: 2000,  bonuses: [{ target: 'ac', value: 1, type: 'deflection' }] },
  ring_protection2:     { id: 'ring_protection2',     name: 'Ring of Protection +2',  slot: 'ring1', price: 8000,  bonuses: [{ target: 'ac', value: 2, type: 'deflection' }] },
  ring_protection3:     { id: 'ring_protection3',     name: 'Ring of Protection +3',  slot: 'ring1', price: 18000, bonuses: [{ target: 'ac', value: 3, type: 'deflection' }] },
  ring_protection4:     { id: 'ring_protection4',     name: 'Ring of Protection +4',  slot: 'ring1', price: 32000, bonuses: [{ target: 'ac', value: 4, type: 'deflection' }] },
  ring_protection5:     { id: 'ring_protection5',     name: 'Ring of Protection +5',  slot: 'ring1', price: 50000, bonuses: [{ target: 'ac', value: 5, type: 'deflection' }] },
  ring_feather_fall:    { id: 'ring_feather_fall',    name: 'Ring of Feather Falling', slot: 'ring1', price: 2200,  bonuses: [], description: 'Feather fall activates automatically when the wearer falls.' },
  ring_force_shield:    { id: 'ring_force_shield',    name: 'Ring of Force Shield',    slot: 'ring1', price: 8500,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], description: 'Creates a +2 force shield as a free action.' },
  ring_sustenance:      { id: 'ring_sustenance',      name: 'Ring of Sustenance',      slot: 'ring1', price: 2500,  bonuses: [], description: 'Only 2 hours of sleep needed per night; no food or water required.' },
  ring_mind_shielding:  { id: 'ring_mind_shielding',  name: 'Ring of Mind Shielding',  slot: 'ring1', price: 8000,  bonuses: [], description: 'Immune to detect thoughts, discern lies, and magical alignment detection.' },
  ring_evasion:         { id: 'ring_evasion',         name: 'Ring of Evasion',         slot: 'ring1', price: 25000, bonuses: [], description: 'Grants the evasion ability: take no damage on a successful Reflex save.' },
  ring_blinking:        { id: 'ring_blinking',        name: 'Ring of Blinking',        slot: 'ring1', price: 27000, bonuses: [], description: 'Blink at will (CL 7th): 50% miss chance against attacks, phase between Material and Ethereal Plane.' },
  ring_wizardry1:       { id: 'ring_wizardry1',       name: 'Ring of Wizardry I',      slot: 'ring1', price: 20000, bonuses: [{ target: 'spell_slots', value: 2, spellLevel: 1 }], description: 'Doubles the wearer\'s available 1st-level spell slots (approximated as +2 slots).' },
  ring_wizardry2:       { id: 'ring_wizardry2',       name: 'Ring of Wizardry II',     slot: 'ring1', price: 40000, bonuses: [{ target: 'spell_slots', value: 2, spellLevel: 2 }], description: 'Doubles the wearer\'s available 2nd-level spell slots.' },
  ring_wizardry3:       { id: 'ring_wizardry3',       name: 'Ring of Wizardry III',    slot: 'ring1', price: 70000, bonuses: [{ target: 'spell_slots', value: 2, spellLevel: 3 }], description: 'Doubles the wearer\'s available 3rd-level spell slots.' },
  ring_wizardry4:       { id: 'ring_wizardry4',       name: 'Ring of Wizardry IV',     slot: 'ring1', price: 100000, bonuses: [{ target: 'spell_slots', value: 2, spellLevel: 4 }], description: 'Doubles the wearer\'s available 4th-level spell slots.' },
  ring_freedom:         { id: 'ring_freedom',         name: 'Ring of Freedom of Movement', slot: 'ring1', price: 40000, bonuses: [], description: 'Continuous freedom of movement: immune to paralysis, slow, entangle, and grapple.' },
  ring_regeneration:    { id: 'ring_regeneration',    name: 'Ring of Regeneration',    slot: 'ring1', price: 90000, bonuses: [{ target: 'hp', value: 1 }], description: 'Regenerates 1 HP/round. The listed HP bonus is per round, not a flat pool.' },
  ring_spell_storing:   { id: 'ring_spell_storing',   name: 'Ring of Spell Storing',   slot: 'ring1', price: 50000, bonuses: [], description: 'Stores up to 5 spell levels; stored spells can be cast from the ring.' },
  ring_djinni_calling:  { id: 'ring_djinni_calling',  name: 'Ring of Djinni Calling',  slot: 'ring1', price: 125000, bonuses: [], description: 'Calls a djinni once per day to serve for up to 1 hour (CL 17th).' },
  ring_three_wishes:    { id: 'ring_three_wishes',    name: 'Ring of Three Wishes',    slot: 'ring1', price: 120000, bonuses: [], description: 'Grants 3 wishes (wish spell, CL 20th). Destroyed when all wishes are spent.' },
  ring_climbing:        { id: 'ring_climbing',        name: 'Ring of Climbing',        slot: 'ring1', price: 2500,  bonuses: [], description: '+10 competence bonus on Climb checks.' },
  ring_climbing_improved:{id:'ring_climbing_improved',name:'Ring of Climbing, Improved',slot:'ring1',price:10000,bonuses:[],description:'+15 competence bonus on Climb checks; can climb at full base speed.'},
  ring_swimming:        { id: 'ring_swimming',        name: 'Ring of Swimming',        slot: 'ring1', price: 2500,  bonuses: [], description: '+10 competence bonus on Swim checks.' },
  ring_jumping:         { id: 'ring_jumping',         name: 'Ring of Jumping',         slot: 'ring1', price: 2500,  bonuses: [], description: '+5 competence bonus on Jump checks.' },
  ring_animal_friendship:{id:'ring_animal_friendship',name:'Ring of Animal Friendship',slot:'ring1',price:10800,bonuses:[],description:'Animal friendship at will (CL 7th); animals of 6 HD or fewer become loyal companions.'},
  ring_chameleon:       { id: 'ring_chameleon',       name: 'Ring of Chameleon Power', slot: 'ring1', price: 12700, bonuses: [], description: 'Continuous +10 to Hide checks; change self at will (CL 3rd).' },
  ring_telekinesis:     { id: 'ring_telekinesis',     name: 'Ring of Telekinesis',     slot: 'ring1', price: 75000, bonuses: [], description: 'Telekinesis at will (CL 9th, 25 lb. limit on sustained force).' },
  ring_xray_vision:     { id: 'ring_xray_vision',     name: 'Ring of X-Ray Vision',    slot: 'ring1', price: 25000, bonuses: [], description: 'See through 1 ft. of stone, 3 in. of common metal, or up to 3 ft. of wood.' },
  ring_invisibility:    { id: 'ring_invisibility',    name: 'Ring of Invisibility',    slot: 'ring1', price: 20000, bonuses: [], description: 'Invisibility at will (self only, CL 3rd).' },
  ring_water_walking:   { id: 'ring_water_walking',   name: 'Ring of Water Walking',   slot: 'ring1', price: 15000, bonuses: [], description: 'Continuous water walk (CL 7th).' },
  ring_minor_fire_resist:{id:'ring_minor_fire_resist',name:'Ring of Minor Fire Resistance',slot:'ring1',price:12000,bonuses:[{target:'fort',value:1,type:'resistance'}],description:'Energy resistance (fire) 10. Folded into +1 Fort for game-mechanics shorthand.'},
  ring_major_fire_resist:{id:'ring_major_fire_resist',name:'Ring of Major Fire Resistance',slot:'ring1',price:28000,bonuses:[{target:'fort',value:2,type:'resistance'}],description:'Energy resistance (fire) 20. Folded into +2 Fort for game-mechanics shorthand.'},
  ring_greater_fire_resist:{id:'ring_greater_fire_resist',name:'Ring of Greater Fire Resistance',slot:'ring1',price:44000,bonuses:[{target:'fort',value:3,type:'resistance'}],description:'Energy resistance (fire) 30. Folded into +3 Fort for game-mechanics shorthand.'},
  ring_minor_cold_resist:{id:'ring_minor_cold_resist',name:'Ring of Minor Cold Resistance',slot:'ring1',price:12000,bonuses:[{target:'fort',value:1,type:'resistance'}],description:'Energy resistance (cold) 10.'},
  ring_major_cold_resist:{id:'ring_major_cold_resist',name:'Ring of Major Cold Resistance',slot:'ring1',price:28000,bonuses:[{target:'fort',value:2,type:'resistance'}],description:'Energy resistance (cold) 20.'},
  ring_minor_shock_resist:{id:'ring_minor_shock_resist',name:'Ring of Minor Electricity Resistance',slot:'ring1',price:12000,bonuses:[{target:'ref',value:1,type:'resistance'}],description:'Energy resistance (electricity) 10.'},
  ring_minor_acid_resist:{id:'ring_minor_acid_resist',name:'Ring of Minor Acid Resistance',slot:'ring1',price:12000,bonuses:[{target:'fort',value:1,type:'resistance'}],description:'Energy resistance (acid) 10.'},
  ring_minor_sonic_resist:{id:'ring_minor_sonic_resist',name:'Ring of Minor Sonic Resistance',slot:'ring1',price:12000,bonuses:[{target:'fort',value:1,type:'resistance'}],description:'Energy resistance (sonic) 10.'},
  ring_universal_energy:{ id: 'ring_universal_energy',name: 'Ring of Universal Energy Resistance',slot: 'ring1', price: 84000, bonuses: [{ target: 'fort', value: 2, type: 'resistance' }, { target: 'ref', value: 2, type: 'resistance' }], description: 'Energy resistance 10 vs all five energy types.' },
  ring_counterspells:   { id: 'ring_counterspells',   name: 'Ring of Counterspells',   slot: 'ring1', price: 4000,  bonuses: [], description: 'Stores one spell of 6th level or lower; automatically counters that spell when cast at the wearer.' },
  ring_minor_spell_storing:{id:'ring_minor_spell_storing',name:'Ring of Minor Spell Storing',slot:'ring1',price:18000,bonuses:[],description:'Stores up to 3 spell levels; stored spells can be cast from the ring.'},
  ring_protection_minor:{id:'ring_protection_minor',  name: 'Ring of Protection (Minor) +1', slot: 'ring1', price: 1000, bonuses: [{ target: 'ac', value: 1, type: 'deflection' }, { target: 'fort', value: 1, type: 'resistance' }], description: 'Combined deflection and resistance benefit (lesser version).' },
  ring_swarming_stabs:  { id: 'ring_swarming_stabs',  name: 'Ring of the Swarming Stabs',slot: 'ring1', price: 8000, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], description: 'When wielding a light melee weapon, gain +1 attack on a successful sneak attack hit.' },
  ring_arcane_might:    { id: 'ring_arcane_might',    name: 'Ring of Arcane Might',    slot: 'ring1', price: 20000, bonuses: [{ target: 'caster_level', value: 1 }], description: '+1 caster level for arcane spellcasters.' },
  ring_divine_might:    { id: 'ring_divine_might',    name: 'Ring of Divine Might',    slot: 'ring1', price: 20000, bonuses: [{ target: 'caster_level', value: 1 }], description: '+1 caster level for divine spellcasters.' },
  ring_lightning_reflexes:{id:'ring_lightning_reflexes',name:'Ring of Lightning Reflexes',slot:'ring1',price:8000,bonuses:[{target:'ref',value:2,type:'resistance'}],description:'+2 resistance bonus on Reflex saves; +2 on Initiative checks.'},
  ring_iron_will:       { id: 'ring_iron_will',       name: 'Ring of Iron Will',       slot: 'ring1', price: 8000,  bonuses: [{ target: 'will', value: 2, type: 'resistance' }], description: '+2 resistance bonus on Will saves; immune to compulsion below 5th level.' },
  ring_great_fortitude: { id: 'ring_great_fortitude', name: 'Ring of Great Fortitude', slot: 'ring1', price: 8000,  bonuses: [{ target: 'fort', value: 2, type: 'resistance' }], description: '+2 resistance bonus on Fortitude saves; +1 hp/level (rolled into HP).' },
  ring_styptic:         { id: 'ring_styptic',         name: 'Ring of Styptic',         slot: 'ring1', price: 4000,  bonuses: [{ target: 'hp', value: 5 }], description: 'Stops bleeding effects; once per day, stabilizes a dying character.' },
  ring_friend_shield:   { id: 'ring_friend_shield',   name: 'Ring of Friend Shield',   slot: 'ring1', price: 50000, bonuses: [{ target: 'ac', value: 1, type: 'deflection' }], description: 'Used in pairs; once per day, can teleport away from danger to the wearer of the matching ring.' },
  ring_chronos:         { id: 'ring_chronos',         name: 'Ring of Chronos',         slot: 'ring1', price: 80000, bonuses: [{ target: 'ref', value: 2, type: 'insight' }], description: 'Once per day, take an additional standard action (as the time stop spell, but only 1 round).' },
  ring_arcane_mastery:  { id: 'ring_arcane_mastery',  name: 'Ring of Arcane Mastery',  slot: 'ring1', price: 60000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 5 }], description: 'Doubles the wearer\'s available 5th-level spell slots (approximated as +1 slot).' },

  // ── Belt (magical) ────────────────────────────────────────────────────────────
  belt_strength2:       { id: 'belt_strength2',       name: 'Belt of Giant Strength +2', slot: 'belt', price: 4000,  bonuses: [{ target: 'str', value: 2, type: 'enhancement' }] },
  belt_strength4:       { id: 'belt_strength4',       name: 'Belt of Giant Strength +4', slot: 'belt', price: 16000, bonuses: [{ target: 'str', value: 4, type: 'enhancement' }] },
  belt_strength6:       { id: 'belt_strength6',       name: 'Belt of Giant Strength +6', slot: 'belt', price: 36000, bonuses: [{ target: 'str', value: 6, type: 'enhancement' }] },
  belt_strength8:       { id: 'belt_strength8',       name: 'Belt of Giant Strength +8', slot: 'belt', price: 64000, bonuses: [{ target: 'str', value: 8, type: 'enhancement' }] },
  belt_dexterity2:      { id: 'belt_dexterity2',      name: 'Belt of Incredible Dexterity +2', slot: 'belt', price: 4000, bonuses: [{ target: 'dex', value: 2, type: 'enhancement' }] },
  belt_dexterity4:      { id: 'belt_dexterity4',      name: 'Belt of Incredible Dexterity +4', slot: 'belt', price: 16000, bonuses: [{ target: 'dex', value: 4, type: 'enhancement' }] },
  belt_dexterity6:      { id: 'belt_dexterity6',      name: 'Belt of Incredible Dexterity +6', slot: 'belt', price: 36000, bonuses: [{ target: 'dex', value: 6, type: 'enhancement' }] },
  belt_constitution2:   { id: 'belt_constitution2',   name: 'Belt of Mighty Constitution +2', slot: 'belt', price: 4000, bonuses: [{ target: 'con', value: 2, type: 'enhancement' }] },
  belt_constitution4:   { id: 'belt_constitution4',   name: 'Belt of Mighty Constitution +4', slot: 'belt', price: 16000, bonuses: [{ target: 'con', value: 4, type: 'enhancement' }] },
  belt_constitution6:   { id: 'belt_constitution6',   name: 'Belt of Mighty Constitution +6', slot: 'belt', price: 36000, bonuses: [{ target: 'con', value: 6, type: 'enhancement' }] },
  belt_physical_might2: { id: 'belt_physical_might2', name: 'Belt of Physical Might +2 (STR & CON)', slot: 'belt', price: 10000, bonuses: [{ target: 'str', value: 2, type: 'enhancement' }, { target: 'con', value: 2, type: 'enhancement' }] },
  belt_physical_might4: { id: 'belt_physical_might4', name: 'Belt of Physical Might +4 (STR & CON)', slot: 'belt', price: 40000, bonuses: [{ target: 'str', value: 4, type: 'enhancement' }, { target: 'con', value: 4, type: 'enhancement' }] },
  belt_physical_perfection2:{id:'belt_physical_perfection2',name:'Belt of Physical Perfection +2',slot:'belt',price:16000,bonuses:[{target:'str',value:2,type:'enhancement'},{target:'dex',value:2,type:'enhancement'},{target:'con',value:2,type:'enhancement'}]},
  belt_physical_perfection4:{id:'belt_physical_perfection4',name:'Belt of Physical Perfection +4',slot:'belt',price:64000,bonuses:[{target:'str',value:4,type:'enhancement'},{target:'dex',value:4,type:'enhancement'},{target:'con',value:4,type:'enhancement'}]},
  belt_physical_perfection6:{id:'belt_physical_perfection6',name:'Belt of Physical Perfection +6',slot:'belt',price:144000,bonuses:[{target:'str',value:6,type:'enhancement'},{target:'dex',value:6,type:'enhancement'},{target:'con',value:6,type:'enhancement'}]},
  belt_many_pockets:    { id: 'belt_many_pockets',    name: "Belt of Many Pockets",       slot: 'belt', price: 9000,  bonuses: [], description: '14 extradimensional pockets (1 cu. ft./10 lb. each); items retrieved as a swift action.' },
  belt_dwarvenkind:     { id: 'belt_dwarvenkind',     name: 'Belt of Dwarvenkind',       slot: 'belt', price: 14900, bonuses: [{ target: 'con', value: 2, type: 'enhancement' }, { target: 'cha', value: 2, type: 'enhancement' }], description: 'Comprehend dwarven and giant; +2 to interaction with dwarves; darkvision 60 ft.' },
  monks_belt:           { id: 'monks_belt',           name: "Monk's Belt",               slot: 'belt', price: 13000, bonuses: [{ target: 'ac', value: 2, type: 'natural' }], description: 'Wearer treated as 5 monk levels higher for unarmed strike damage and AC bonus.' },
  belt_priestly_might:  { id: 'belt_priestly_might',  name: 'Belt of Priestly Might',    slot: 'belt', price: 11000, bonuses: [{ target: 'wis', value: 2, type: 'enhancement' }], description: '+1 caster level for divine spellcasters; turns/rebukes undead 1 extra time per day.' },
  belt_health_replenish:{id:'belt_health_replenish',  name: 'Belt of Health Replenishment', slot: 'belt', price: 9000, bonuses: [{ target: 'hp', value: 10 }, { target: 'fort', value: 1, type: 'resistance' }], description: 'Once per day, when reduced below 0 HP, automatically heals 1d8+5 HP.' },
  belt_battle:          { id: 'belt_battle',          name: 'Belt of Battle',            slot: 'belt', price: 12000, bonuses: [{ target: 'bab', value: 1, type: 'competence' }], description: 'Stores 3 charges; spend 1 to gain a swift-action attack, 2 for a move, 3 for a standard action.' },
  belt_seven_skills:    { id: 'belt_seven_skills',    name: 'Belt of Seven Skills',      slot: 'belt', price: 5500,  bonuses: [], description: '+5 competence on seven specific skills (Climb, Jump, Swim, Balance, Tumble, Move Silently, Hide).' },
  belt_thunderous_charge:{id:'belt_thunderous_charge',name:'Belt of Thunderous Charge',  slot: 'belt', price: 6000,  bonuses: [{ target: 'bab', value: 1, type: 'competence' }], description: 'When charging, +1 competence on attack rolls and +1d6 damage on the first hit.' },

  // ── Cloak (magical) ───────────────────────────────────────────────────────────
  cloak_resistance1:    { id: 'cloak_resistance1',    name: 'Cloak of Resistance +1',  slot: 'cloak', price: 1000,  bonuses: [{ target: 'fort', value: 1, type: 'resistance' }, { target: 'ref', value: 1, type: 'resistance' }, { target: 'will', value: 1, type: 'resistance' }] },
  cloak_resistance2:    { id: 'cloak_resistance2',    name: 'Cloak of Resistance +2',  slot: 'cloak', price: 4000,  bonuses: [{ target: 'fort', value: 2, type: 'resistance' }, { target: 'ref', value: 2, type: 'resistance' }, { target: 'will', value: 2, type: 'resistance' }] },
  cloak_resistance3:    { id: 'cloak_resistance3',    name: 'Cloak of Resistance +3',  slot: 'cloak', price: 9000,  bonuses: [{ target: 'fort', value: 3, type: 'resistance' }, { target: 'ref', value: 3, type: 'resistance' }, { target: 'will', value: 3, type: 'resistance' }] },
  cloak_resistance4:    { id: 'cloak_resistance4',    name: 'Cloak of Resistance +4',  slot: 'cloak', price: 16000, bonuses: [{ target: 'fort', value: 4, type: 'resistance' }, { target: 'ref', value: 4, type: 'resistance' }, { target: 'will', value: 4, type: 'resistance' }] },
  cloak_resistance5:    { id: 'cloak_resistance5',    name: 'Cloak of Resistance +5',  slot: 'cloak', price: 25000, bonuses: [{ target: 'fort', value: 5, type: 'resistance' }, { target: 'ref', value: 5, type: 'resistance' }, { target: 'will', value: 5, type: 'resistance' }] },
  cloak_charisma2:      { id: 'cloak_charisma2',      name: 'Cloak of Charisma +2',    slot: 'cloak', price: 4000,  bonuses: [{ target: 'cha', value: 2, type: 'enhancement' }] },
  cloak_charisma4:      { id: 'cloak_charisma4',      name: 'Cloak of Charisma +4',    slot: 'cloak', price: 16000, bonuses: [{ target: 'cha', value: 4, type: 'enhancement' }] },
  cloak_charisma6:      { id: 'cloak_charisma6',      name: 'Cloak of Charisma +6',    slot: 'cloak', price: 36000, bonuses: [{ target: 'cha', value: 6, type: 'enhancement' }] },
  cloak_elvenkind:      { id: 'cloak_elvenkind',      name: 'Cloak of Elvenkind',      slot: 'cloak', price: 2500,  bonuses: [], description: '+5 competence bonus on Hide checks.' },
  cloak_displacement:   { id: 'cloak_displacement',   name: 'Cloak of Displacement',   slot: 'cloak', price: 24000, bonuses: [{ target: 'ac', value: 2, type: 'deflection' }], description: 'Continuous blur: 20% miss chance against attacks. Deflection bonus approximates stat impact.' },
  cloak_etherealness:   { id: 'cloak_etherealness',   name: 'Cloak of Etherealness',   slot: 'cloak', price: 55000, bonuses: [], description: 'Etherealness at will (CL 15th). Wearer and carried equipment become ethereal.' },
  cloak_bat:            { id: 'cloak_bat',            name: 'Cloak of the Bat',        slot: 'cloak', price: 26000, bonuses: [], description: 'Fly 40 ft. (good) or assume bat form (CL 7th). +5 competence on Hide checks.' },
  cloak_arachnida:      { id: 'cloak_arachnida',      name: 'Cloak of the Arachnida',  slot: 'cloak', price: 14000, bonuses: [{ target: 'fort', value: 2, type: 'resistance' }], description: 'Climb speed 20 ft. (any surface); +4 to saves vs poison; vermin will not attack the wearer.' },
  cloak_manta_ray:      { id: 'cloak_manta_ray',      name: 'Cloak of the Manta Ray',  slot: 'cloak', price: 7200,  bonuses: [], description: 'Swim speed 60 ft.; gills allow underwater breathing.' },
  cloak_minor_displacement:{id:'cloak_minor_displacement',name:'Cloak of Minor Displacement',slot:'cloak',price:24000,bonuses:[{target:'ac',value:2,type:'deflection'}],description:'Continuous blur: 20% miss chance against attacks.'},
  cloak_shadow:         { id: 'cloak_shadow',         name: 'Cloak of Shadow',         slot: 'cloak', price: 7500,  bonuses: [], description: '+5 competence bonus on Hide and Move Silently checks.' },
  cloak_minor_resistance:{id:'cloak_minor_resistance',name:'Cloak of Minor Resistance',slot:'cloak',price:500,bonuses:[{target:'fort',value:1,type:'resistance'}],description:'Provides only +1 Fortitude resistance, not all three saves.'},
  mantle_spell_resistance:{id:'mantle_spell_resistance',name:'Mantle of Spell Resistance',slot:'cloak',price:90000,bonuses:[{target:'will',value:3,type:'resistance'}],description:'Continuous spell resistance 21.'},
  mantle_faith:         { id: 'mantle_faith',         name: 'Mantle of Faith',         slot: 'cloak', price: 24000, bonuses: [{ target: 'ac', value: 3, type: 'sacred' }, { target: 'will', value: 2, type: 'sacred' }], description: '+3 sacred bonus to AC and +2 sacred bonus on Will saves vs evil. Usable only by good characters.' },
  mantle_unholy:        { id: 'mantle_unholy',        name: 'Mantle of the Unholy',    slot: 'cloak', price: 24000, bonuses: [{ target: 'ac', value: 3, type: 'profane' }, { target: 'will', value: 2, type: 'profane' }], description: '+3 profane bonus to AC and +2 profane bonus on Will saves vs good. Usable only by evil characters.' },
  cloak_winter_wolf:    { id: 'cloak_winter_wolf',    name: 'Cloak of the Winter Wolf',slot: 'cloak', price: 6000,  bonuses: [{ target: 'fort', value: 2, type: 'resistance' }], description: 'Endure cold environments; cold resistance 5; once per day, breath weapon (15-ft. cone, 4d6 cold).' },
  cloak_predatory_vigor:{id:'cloak_predatory_vigor',  name: 'Cloak of Predatory Vigor', slot: 'cloak', price: 8000,  bonuses: [{ target: 'hp', value: 5 }, { target: 'fort', value: 1, type: 'resistance' }], description: 'When wearer drops a foe, gains +5 temporary HP for 1 minute.' },
  cloak_protection2:    { id: 'cloak_protection2',    name: 'Cloak of Protection +2',  slot: 'cloak', price: 12000, bonuses: [{ target: 'ac', value: 2, type: 'deflection' }, { target: 'fort', value: 1, type: 'resistance' }, { target: 'ref', value: 1, type: 'resistance' }, { target: 'will', value: 1, type: 'resistance' }], description: '+2 deflection bonus to AC and +1 resistance to all saves.' },
  robe_archmage:        { id: 'robe_archmage',        name: 'Robe of the Archmage',    slot: 'cloak', price: 75000, bonuses: [{ target: 'ac', value: 4, type: 'armor' }, { target: 'will', value: 2, type: 'resistance' }, { target: 'caster_level', value: 1 }], description: '+4 armor bonus, +2 resistance, SR 18, +1 caster level. Comes in white (good), gray (neutral), and black (evil) versions.' },
  robe_eyes:            { id: 'robe_eyes',            name: 'Robe of Eyes',            slot: 'cloak', price: 120000, bonuses: [{ target: 'will', value: 1, type: 'insight' }], description: '360° vision; continuous see invisibility, true seeing 1/day; +10 to Spot/Search.' },
  robe_stars:           { id: 'robe_stars',           name: 'Robe of Stars',           slot: 'cloak', price: 58000, bonuses: [{ target: 'ac', value: 1, type: 'armor' }, { target: 'fort', value: 1, type: 'resistance' }, { target: 'ref', value: 1, type: 'resistance' }, { target: 'will', value: 1, type: 'resistance' }], description: 'Travel to the Astral Plane at will; pluck stars from the robe to use as +5 shuriken (3/day).' },
  robe_blending:        { id: 'robe_blending',        name: 'Robe of Blending',        slot: 'cloak', price: 8400,  bonuses: [], description: 'Continuous disguise self; +10 competence to Disguise checks; mimics local clothing.' },
  robe_useful_items:    { id: 'robe_useful_items',    name: 'Robe of Useful Items',    slot: 'cloak', price: 7000,  bonuses: [], description: 'Patches detach as useful items: dagger, mirror, mule, knotted rope (50 ft.), bullseye lantern, etc.' },
  cloak_fangs:          { id: 'cloak_fangs',          name: 'Cloak of the Fangs',      slot: 'cloak', price: 16000, bonuses: [{ target: 'bab', value: 1, type: 'competence' }], description: 'Bite attack 1d6; flanking allies gain +2 to attack rolls vs the wearer\'s target.' },

  // ── Utility belt (high-level potions, wands, ioun stones, etc.) ───────────────
  potion_csw:           { id: 'potion_csw',           name: 'Potion of Cure Serious Wounds',  slot: 'utility1', price: 750,   bonuses: [{ target: 'hp', value: 15 }] },
  potion_ccw:           { id: 'potion_ccw',           name: 'Potion of Cure Critical Wounds', slot: 'utility1', price: 2800,  bonuses: [{ target: 'hp', value: 25 }] },
  potion_bulls_strength:{ id: 'potion_bulls_strength', name: "Potion of Bull's Strength",    slot: 'utility1', price: 300,   bonuses: [{ target: 'str', value: 4, type: 'enhancement' }], description: 'Duration: 1 minute.' },
  potion_bears_endurance:{ id: 'potion_bears_endurance', name: "Potion of Bear's Endurance", slot: 'utility1', price: 300,   bonuses: [{ target: 'con', value: 4, type: 'enhancement' }], description: 'Duration: 1 minute.' },
  potion_cats_grace:    { id: 'potion_cats_grace',    name: "Potion of Cat's Grace",           slot: 'utility1', price: 300,   bonuses: [{ target: 'dex', value: 4, type: 'enhancement' }], description: 'Duration: 1 minute.' },
  potion_haste:         { id: 'potion_haste',         name: 'Potion of Haste',                 slot: 'utility1', price: 750,   bonuses: [], description: '3 rounds. +1 AC & Reflex, +30 ft. speed, one extra attack in full-attack.' },
  potion_invisibility:  { id: 'potion_invisibility',  name: 'Potion of Invisibility',          slot: 'utility1', price: 300,   bonuses: [], description: '3 minutes or until an attack is made.' },
  wand_clw:             { id: 'wand_clw',             name: 'Wand of CLW (50 charges)',        slot: 'utility1', price: 750,   bonuses: [], description: '50 charges. Cure Light Wounds (1d8+1 HP) as a standard action, CL 1st.' },
  wand_mm:              { id: 'wand_mm',              name: 'Wand of Magic Missiles (50)',     slot: 'utility1', price: 750,   bonuses: [], description: '50 charges. 1d4+1 force damage, auto-hits any target in range, CL 1st.' },
  wand_fireballs:       { id: 'wand_fireballs',       name: 'Wand of Fireball (50)',           slot: 'utility1', price: 11250, bonuses: [], description: '50 charges. Fireball, 10d6 fire (Reflex DC 14 half), CL 10th.' },
  pearl_power1:         { id: 'pearl_power1',         name: 'Pearl of Power I',                slot: 'utility1', price: 1000,  bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 1 }], description: 'Once per day, recover one expended 1st-level spell.' },
  pearl_power2:         { id: 'pearl_power2',         name: 'Pearl of Power II',               slot: 'utility1', price: 4000,  bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 2 }], description: 'Once per day, recover one expended 2nd-level spell.' },
  pearl_power3:         { id: 'pearl_power3',         name: 'Pearl of Power III',              slot: 'utility1', price: 9000,  bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 3 }], description: 'Once per day, recover one expended 3rd-level spell.' },
  pearl_power4:         { id: 'pearl_power4',         name: 'Pearl of Power IV',               slot: 'utility1', price: 16000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 4 }], description: 'Once per day, recover one expended 4th-level spell.' },
  ioun_dusty_rose:      { id: 'ioun_dusty_rose',      name: 'Ioun Stone (Dusty Rose Prism)',   slot: 'utility1', price: 5000,  bonuses: [{ target: 'ac', value: 1, type: 'insight' }], description: '+1 insight bonus to AC.' },
  ioun_pale_green:      { id: 'ioun_pale_green',      name: 'Ioun Stone (Pale Green Prism)',   slot: 'utility1', price: 30000, bonuses: [{ target: 'bab', value: 1, type: 'competence' }, { target: 'fort', value: 1, type: 'competence' }, { target: 'ref', value: 1, type: 'competence' }, { target: 'will', value: 1, type: 'competence' }], description: '+1 competence bonus on all attack rolls, saves, and skill checks.' },
  ioun_orange:          { id: 'ioun_orange',          name: 'Ioun Stone (Orange Prism)',       slot: 'utility1', price: 30000, bonuses: [{ target: 'caster_level', value: 1 }], description: '+1 caster level for all spellcasting classes.' },
  ioun_incandescent:    { id: 'ioun_incandescent',    name: 'Ioun Stone (Incandescent Blue)',  slot: 'utility1', price: 8000,  bonuses: [{ target: 'wis', value: 2, type: 'enhancement' }], description: '+2 enhancement bonus to WIS.' },
  ioun_vibrant_purple:  { id: 'ioun_vibrant_purple',  name: 'Ioun Stone (Vibrant Purple)',     slot: 'utility1', price: 36000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 4 }], description: 'Stores 3 spell levels; releases one 4th-level spell per day (approximated as +1 L4 slot).' },
  ioun_clear:           { id: 'ioun_clear',           name: 'Ioun Stone (Clear Spindle)',      slot: 'utility1', price: 4000,  bonuses: [], description: 'No need for food or water.' },
  bag_holding1:         { id: 'bag_holding1',         name: 'Bag of Holding I',                slot: 'utility1', price: 2500,  bonuses: [], description: 'Holds 250 lb / 30 cu. ft. in an extradimensional space (weighs only 15 lb).' },
  bag_holding2:         { id: 'bag_holding2',         name: 'Bag of Holding II',               slot: 'utility1', price: 5000,  bonuses: [], description: 'Holds 500 lb / 70 cu. ft.' },
  bag_holding4:         { id: 'bag_holding4',         name: 'Bag of Holding IV',               slot: 'utility1', price: 10000, bonuses: [], description: 'Holds 1,500 lb / 250 cu. ft.' },
  handy_haversack:      { id: 'handy_haversack',      name: 'Handy Haversack',                 slot: 'utility1', price: 2000,  bonuses: [], description: 'Any item can be retrieved as a free action.' },
  portable_hole:        { id: 'portable_hole',        name: 'Portable Hole',                   slot: 'utility1', price: 20000, bonuses: [], description: '10 ft. deep extradimensional space, 6 ft. diameter. Holds a massive amount of material.' },
  rod_absorption:       { id: 'rod_absorption',       name: 'Rod of Absorption',               slot: 'utility1', price: 50000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 5 }], description: 'Absorbs spells targeted at wielder; stored energy can power memorized spells. +1 L5 slot approximates typical stored energy.' },

  // Additional potions
  potion_cmw:           { id: 'potion_cmw',           name: 'Potion of Cure Moderate Wounds',  slot: 'utility1', price: 300,   bonuses: [{ target: 'hp', value: 11 }] },
  potion_blur:          { id: 'potion_blur',          name: 'Potion of Blur',                  slot: 'utility1', price: 300,   bonuses: [{ target: 'ac', value: 1, type: 'deflection' }], description: '20% miss chance against attacks for 1 minute.' },
  potion_mage_armor:    { id: 'potion_mage_armor',    name: 'Potion of Mage Armor',            slot: 'utility1', price: 50,    bonuses: [{ target: 'ac', value: 4, type: 'armor' }], description: 'Duration: 1 hour. Provides +4 armor bonus.' },
  potion_protection_evil:{id:'potion_protection_evil',name:'Potion of Protection from Evil',  slot: 'utility1', price: 50,    bonuses: [{ target: 'ac', value: 2, type: 'deflection' }, { target: 'will', value: 2, type: 'resistance' }], description: 'Duration: 1 minute.' },
  potion_shield_faith:  { id: 'potion_shield_faith',  name: 'Potion of Shield of Faith',       slot: 'utility1', price: 50,    bonuses: [{ target: 'ac', value: 2, type: 'deflection' }], description: 'Duration: 1 minute.' },
  potion_resist_energy: { id: 'potion_resist_energy', name: 'Potion of Resist Energy',         slot: 'utility1', price: 300,   bonuses: [{ target: 'fort', value: 2, type: 'resistance' }], description: 'Resist 10 vs one energy type for 10 minutes.' },
  potion_remove_fear:   { id: 'potion_remove_fear',   name: 'Potion of Remove Fear',           slot: 'utility1', price: 50,    bonuses: [{ target: 'will', value: 4, type: 'morale' }], description: 'Removes fear effects; +4 morale on saves vs fear for 10 minutes.' },
  potion_heroism:       { id: 'potion_heroism',       name: 'Potion of Heroism',               slot: 'utility1', price: 750,   bonuses: [{ target: 'bab', value: 2, type: 'morale' }, { target: 'fort', value: 2, type: 'morale' }, { target: 'ref', value: 2, type: 'morale' }, { target: 'will', value: 2, type: 'morale' }], description: '+2 morale bonus on attack rolls and all saves for 10 minutes.' },
  potion_fly:           { id: 'potion_fly',           name: 'Potion of Fly',                   slot: 'utility1', price: 750,   bonuses: [], description: 'Fly 60 ft. (good maneuverability) for 5 minutes.' },
  potion_water_breathing:{id:'potion_water_breathing',name: 'Potion of Water Breathing',      slot: 'utility1', price: 750,   bonuses: [], description: 'Breathe water normally for 2 hours.' },
  potion_gaseous_form:  { id: 'potion_gaseous_form',  name: 'Potion of Gaseous Form',          slot: 'utility1', price: 750,   bonuses: [], description: 'Become a cloud of vapor; flight 10 ft.; immune to most physical attacks for 30 minutes.' },
  potion_displacement:  { id: 'potion_displacement',  name: 'Potion of Displacement',          slot: 'utility1', price: 750,   bonuses: [{ target: 'ac', value: 2, type: 'deflection' }], description: '50% miss chance against attacks for 3 rounds.' },
  potion_neutralize_poison:{id:'potion_neutralize_poison',name:'Potion of Neutralize Poison',slot:'utility1',price:750,bonuses:[{target:'fort',value:4,type:'resistance'}],description:'Neutralizes ingested/injected poison; +4 Fortitude vs poison for 10 minutes.'},
  potion_remove_disease:{id:'potion_remove_disease',  name: 'Potion of Remove Disease',        slot: 'utility1', price: 750,   bonuses: [{ target: 'fort', value: 4, type: 'resistance' }], description: 'Removes one disease.' },
  potion_stoneskin:     { id: 'potion_stoneskin',     name: 'Potion of Stoneskin',             slot: 'utility1', price: 1500,  bonuses: [{ target: 'hp', value: 30 }], description: 'DR 10/adamantine for 10 minutes (or until 100 HP absorbed).' },

  // Additional wands
  wand_cmw:             { id: 'wand_cmw',             name: 'Wand of Cure Moderate Wounds (50)',slot: 'utility1', price: 4500, bonuses: [], description: '50 charges. Cure Moderate Wounds (2d8+3 HP) per charge, CL 3rd.' },
  wand_csw:             { id: 'wand_csw',             name: 'Wand of Cure Serious Wounds (50)', slot: 'utility1', price: 11250, bonuses: [], description: '50 charges. Cure Serious Wounds (3d8+5 HP) per charge, CL 5th.' },
  wand_lightning:       { id: 'wand_lightning',       name: 'Wand of Lightning Bolt (50)',     slot: 'utility1', price: 11250, bonuses: [], description: '50 charges. 5d6 electricity damage in a 60-ft. line, Reflex DC 14 half, CL 5th.' },
  wand_invisibility:    { id: 'wand_invisibility',    name: 'Wand of Invisibility (50)',       slot: 'utility1', price: 4500,  bonuses: [], description: '50 charges. Invisibility, CL 3rd, 3 minutes per use.' },
  wand_dispel_magic:    { id: 'wand_dispel_magic',    name: 'Wand of Dispel Magic (50)',       slot: 'utility1', price: 11250, bonuses: [], description: '50 charges. Dispel one ongoing spell or all on a target, CL 5th.' },
  wand_haste:           { id: 'wand_haste',           name: 'Wand of Haste (50)',              slot: 'utility1', price: 11250, bonuses: [], description: '50 charges. +1 attack/AC/Reflex, +30 ft. speed, extra full-attack action, CL 5th.' },

  // Additional pearls of power
  pearl_power5:         { id: 'pearl_power5',         name: 'Pearl of Power V',                slot: 'utility1', price: 25000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 5 }], description: 'Once per day, recover one expended 5th-level spell.' },
  pearl_power6:         { id: 'pearl_power6',         name: 'Pearl of Power VI',               slot: 'utility1', price: 36000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 6 }], description: 'Once per day, recover one expended 6th-level spell.' },
  pearl_power7:         { id: 'pearl_power7',         name: 'Pearl of Power VII',              slot: 'utility1', price: 49000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 7 }], description: 'Once per day, recover one expended 7th-level spell.' },
  pearl_power8:         { id: 'pearl_power8',         name: 'Pearl of Power VIII',             slot: 'utility1', price: 64000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 8 }], description: 'Once per day, recover one expended 8th-level spell.' },
  pearl_power9:         { id: 'pearl_power9',         name: 'Pearl of Power IX',               slot: 'utility1', price: 81000, bonuses: [{ target: 'spell_slots', value: 1, spellLevel: 9 }], description: 'Once per day, recover one expended 9th-level spell.' },

  // Additional ioun stones
  ioun_deep_red:        { id: 'ioun_deep_red',        name: 'Ioun Stone (Deep Red Sphere)',    slot: 'utility1', price: 8000,  bonuses: [{ target: 'dex', value: 2, type: 'enhancement' }], description: '+2 enhancement bonus to DEX.' },
  ioun_pale_blue:       { id: 'ioun_pale_blue',       name: 'Ioun Stone (Pale Blue Rhomboid)', slot: 'utility1', price: 8000,  bonuses: [{ target: 'str', value: 2, type: 'enhancement' }], description: '+2 enhancement bonus to STR.' },
  ioun_pink_rhomboid:   { id: 'ioun_pink_rhomboid',   name: 'Ioun Stone (Pink Rhomboid)',      slot: 'utility1', price: 8000,  bonuses: [{ target: 'con', value: 2, type: 'enhancement' }], description: '+2 enhancement bonus to CON.' },
  ioun_scarlet_blue:    { id: 'ioun_scarlet_blue',    name: 'Ioun Stone (Scarlet & Blue Sphere)', slot: 'utility1', price: 8000, bonuses: [{ target: 'int', value: 2, type: 'enhancement' }], description: '+2 enhancement bonus to INT.' },
  ioun_pink:            { id: 'ioun_pink',            name: 'Ioun Stone (Pink Prism)',         slot: 'utility1', price: 4000,  bonuses: [{ target: 'hp', value: 1 }], description: '+1 hit point.' },
  ioun_pearly_white:    { id: 'ioun_pearly_white',    name: 'Ioun Stone (Pearly White Spindle)', slot: 'utility1', price: 20000, bonuses: [{ target: 'hp', value: 6 }], description: 'Regenerates 1 HP per hour.' },
  ioun_lavender:        { id: 'ioun_lavender',        name: 'Ioun Stone (Lavender & Green Ellipsoid)', slot: 'utility1', price: 80000, bonuses: [{ target: 'will', value: 2, type: 'resistance' }], description: 'Absorbs spells of 8th level or lower targeted at the wearer (50 spell levels capacity).' },
  ioun_dark_blue:       { id: 'ioun_dark_blue',       name: 'Ioun Stone (Dark Blue Rhomboid)', slot: 'utility1', price: 10000, bonuses: [{ target: 'will', value: 1, type: 'insight' }], description: '+5 insight bonus on Search/Spot/Perception checks.' },

  // Staves
  staff_healing:        { id: 'staff_healing',        name: 'Staff of Healing (50 charges)',   slot: 'utility1', price: 27750, bonuses: [], description: '50 charges; cure light/serious wounds and lesser restoration on demand.' },
  staff_fire:           { id: 'staff_fire',           name: 'Staff of Fire (50 charges)',      slot: 'utility1', price: 17750, bonuses: [], description: '50 charges; burning hands, fireball, wall of fire on demand.' },
  staff_frost:          { id: 'staff_frost',          name: 'Staff of Frost (50 charges)',     slot: 'utility1', price: 56250, bonuses: [], description: '50 charges; ice storm, wall of ice, cone of cold on demand.' },
  staff_power:          { id: 'staff_power',          name: 'Staff of Power (50 charges)',     slot: 'utility1', price: 211000, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }, { target: 'ac', value: 2, type: 'deflection' }, { target: 'fort', value: 2, type: 'resistance' }, { target: 'ref', value: 2, type: 'resistance' }, { target: 'will', value: 2, type: 'resistance' }], description: 'Acts as +2 quarterstaff, casts continual flame, lightning bolt, hold monster, levitate, and other powerful spells.' },
  staff_woodlands:      { id: 'staff_woodlands',      name: 'Staff of the Woodlands (50)',     slot: 'utility1', price: 101250, bonuses: [{ target: 'ac', value: 2, type: 'natural' }, { target: 'wis', value: 2, type: 'enhancement' }], description: 'Acts as +2 quarterstaff, casts barkskin, animal trance, summon nature\'s ally, wall of thorns.' },
  staff_charming:       { id: 'staff_charming',       name: 'Staff of Charming (50 charges)',  slot: 'utility1', price: 16500, bonuses: [{ target: 'cha', value: 1, type: 'enhancement' }], description: '50 charges; charm person, charm monster on demand.' },

  // Rods
  rod_lordly_might:     { id: 'rod_lordly_might',     name: 'Rod of Lordly Might',             slot: 'utility1', price: 70000, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], description: 'Acts as +3 light mace, +2 longsword, +4 battleaxe, +3 spear, climbing pole, or detect-direction wand.' },
  rod_metamagic_extend: { id: 'rod_metamagic_extend', name: 'Rod of Extend Spell, Lesser',     slot: 'utility1', price: 3000,  bonuses: [], description: 'Lets the wielder apply Extend Spell (+0 cost) up to three times per day to spells of 3rd level or lower.' },
  rod_metamagic_empower:{ id: 'rod_metamagic_empower',name: 'Rod of Empower Spell, Lesser',    slot: 'utility1', price: 9000,  bonuses: [], description: 'Lets the wielder apply Empower Spell (+0 cost) up to three times per day to spells of 3rd level or lower.' },
  rod_negation:         { id: 'rod_negation',         name: 'Rod of Negation',                 slot: 'utility1', price: 37000, bonuses: [{ target: 'will', value: 2, type: 'resistance' }], description: 'Discharge dispel magic / disjunction effects to negate magical attacks (3/day).' },
  rod_alertness:        { id: 'rod_alertness',        name: 'Rod of Alertness',                slot: 'utility1', price: 85000, bonuses: [{ target: 'will', value: 1, type: 'insight' }], description: '+1 insight on initiative; +1 insight on attack rolls vs invisible foes; standing the rod activates an alertness aura.' },

  // Figurines of wondrous power
  figurine_silver_raven:{ id: 'figurine_silver_raven',name: 'Silver Raven Figurine',           slot: 'utility1', price: 3800,  bonuses: [], description: 'Animates into a silver raven (CL 4th) once per day for 24 hours; can deliver messages.' },
  figurine_onyx_dog:    { id: 'figurine_onyx_dog',    name: 'Onyx Dog Figurine',               slot: 'utility1', price: 15500, bonuses: [], description: 'Animates into a riding dog (CL 6th) for 6 hours/week.' },
  figurine_bronze_griffon:{id:'figurine_bronze_griffon',name:'Bronze Griffon Figurine',       slot:'utility1',price:10000,bonuses:[],description:'Animates into a griffon (CL 8th) once per week for 6 hours.'},
  figurine_marble_elephant:{id:'figurine_marble_elephant',name:'Marble Elephant Figurine',    slot:'utility1',price:17000,bonuses:[],description:'Animates into an elephant (CL 8th) once per week for 24 hours.'},

  // Horns / instruments
  horn_valhalla:        { id: 'horn_valhalla',        name: 'Horn of Valhalla',                slot: 'utility1', price: 50000, bonuses: [], description: 'Summons 2d4+2 berserker warriors (4th-7th level) to fight for the user once per week.' },
  horn_blasting:        { id: 'horn_blasting',        name: 'Horn of Blasting',                slot: 'utility1', price: 5000,  bonuses: [], description: 'Once per day, blast a 40-ft. cone for 5d6 sonic damage; targets stunned 1 round (Fort DC 16 negates stun).' },
  drums_panic:          { id: 'drums_panic',          name: 'Drums of Panic',                  slot: 'utility1', price: 30000, bonuses: [], description: 'Used in pairs; drums cause panic in a 120-ft. radius (Will DC 16 negates) once per day.' },

  // Stones / charms
  stone_good_luck:      { id: 'stone_good_luck',      name: 'Stone of Good Luck (Luckstone)',  slot: 'utility1', price: 20000, bonuses: [{ target: 'fort', value: 1, type: 'luck' }, { target: 'ref', value: 1, type: 'luck' }, { target: 'will', value: 1, type: 'luck' }], description: '+1 luck bonus on saves, ability checks, and skill checks.' },
  stone_alarm:          { id: 'stone_alarm',          name: 'Stone of Alarm',                  slot: 'utility1', price: 2700,  bonuses: [], description: 'Wails when a creature crosses an established perimeter.' },

  // Misc wondrous items
  decanter_water:       { id: 'decanter_water',       name: 'Decanter of Endless Water',       slot: 'utility1', price: 9000,  bonuses: [], description: 'Produces fresh water (stream/fountain/geyser) on command.' },
  cube_force:           { id: 'cube_force',           name: 'Cube of Force',                   slot: 'utility1', price: 62000, bonuses: [{ target: 'ac', value: 1, type: 'deflection' }], description: 'Creates a 10-ft. cubic force barrier with 6 charges/day; can selectively block matter, undead, magic.' },
  crystal_ball:         { id: 'crystal_ball',         name: 'Crystal Ball',                    slot: 'utility1', price: 42000, bonuses: [], description: 'Scry on a known creature/location once per day (CL 10th).' },
  well_many_worlds:     { id: 'well_many_worlds',     name: 'Well of Many Worlds',             slot: 'utility1', price: 82000, bonuses: [], description: 'Opens a portal to a random plane / world; bidirectional.' },
  horseshoes_speed:     { id: 'horseshoes_speed',     name: 'Horseshoes of Speed (set of 4)',  slot: 'utility1', price: 3000,  bonuses: [], description: 'Mount\'s base land speed +30 ft. while wearing all four.' },
  scroll_csw:           { id: 'scroll_csw',           name: 'Scroll: Cure Serious Wounds',     slot: 'utility1', price: 375,   bonuses: [{ target: 'hp', value: 18 }] },
  scroll_fireball:      { id: 'scroll_fireball',      name: 'Scroll: Fireball',                slot: 'utility1', price: 375,   bonuses: [], description: '5d6 fire (Reflex DC 14 half), 20-ft. radius, range 800 ft.' },
  scroll_invisibility:  { id: 'scroll_invisibility',  name: 'Scroll: Invisibility',            slot: 'utility1', price: 150,   bonuses: [], description: 'Invisibility for 3 minutes or until an attack is made.' },
  scroll_resurrection:  { id: 'scroll_resurrection',  name: 'Scroll: Raise Dead',              slot: 'utility1', price: 1125,  bonuses: [], description: 'Restores life to a creature dead no more than 1 day per CL.' },
};

// ─── Assignment helpers ───────────────────────────────────────────────────────

/** Parse a dice expression like '2d6+3' or '1d8' and return the average roll. */
function parseDiceAvg(expr: string): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * (parseInt(m[2], 10) + 1) / 2 + (m[3] ? parseInt(m[3], 10) : 0);
}

// Metal armor IDs — druids are forbidden from wearing these.
const METAL_ARMOR_IDS = new Set([
  'chain_shirt', 'scale_mail', 'breastplate', 'chainmail', 'splint_mail', 'banded_mail', 'half_plate', 'full_plate',
  'chain_shirt_plus1', 'chain_shirt_plus2', 'chain_shirt_plus3',
  'scale_mail_plus1', 'scale_mail_plus2',
  'breastplate_plus1', 'breastplate_plus2', 'breastplate_plus3', 'breastplate_plus4',
  'mithral_shirt', 'mithral_shirt_plus1', 'mithral_shirt_plus3', 'elven_chain',
  'chainmail_plus1', 'chainmail_plus2', 'chainmail_plus3',
  'splint_mail_plus1', 'splint_mail_plus2',
  'banded_mail_plus1', 'banded_mail_plus2', 'banded_mail_plus3',
  'half_plate_plus1', 'half_plate_plus2', 'half_plate_plus3', 'half_plate_plus4',
  'full_plate_plus1', 'full_plate_plus2', 'full_plate_plus3', 'full_plate_plus4', 'full_plate_plus5',
  'mithral_full_plate', 'adamantine_breastplate', 'adamantine_full_plate', 'ghostward_chain', 'celestial_armor',
  // Fortification / energy / SR / specialty (metal substrates)
  'light_fort_breastplate', 'light_fort_full_plate', 'moderate_fort_full_plate', 'heavy_fort_full_plate',
  'light_fort_chain_shirt',
  'fire_resist_breastplate', 'cold_resist_full_plate', 'shock_resist_chain_shirt',
  'sonic_resist_breastplate', 'greater_fire_resist_full', 'prismatic_armor',
  'sr13_chainmail', 'sr15_full_plate', 'sr17_full_plate', 'sr19_full_plate',
  'ghost_touch_chain_shirt', 'ghost_touch_full_plate', 'glamered_chainmail',
  'dwarven_plate', 'determination_breastplate', 'invulnerability_full_plate', 'righteousness_armor',
]);

// Medium and heavy armor — rogues/bards can't wear these; rangers can't wear heavy.
const MEDIUM_ARMOR_IDS = new Set([
  'hide', 'scale_mail', 'breastplate', 'chainmail',
  'hide_plus1', 'hide_plus2', 'hide_plus3',
  'scale_mail_plus1', 'scale_mail_plus2',
  'breastplate_plus1', 'breastplate_plus2', 'breastplate_plus3', 'breastplate_plus4',
  'chainmail_plus1', 'chainmail_plus2', 'chainmail_plus3',
  'ghostward_chain', 'adamantine_breastplate', 'dragonhide_breastplate',
  'light_fort_breastplate', 'fire_resist_breastplate', 'sonic_resist_breastplate',
  'sr13_chainmail',
  'determination_breastplate', 'rhino_hide',
]);
const HEAVY_ARMOR_IDS = new Set([
  'splint_mail', 'banded_mail', 'half_plate', 'full_plate',
  'half_plate_plus1', 'half_plate_plus2', 'half_plate_plus3', 'half_plate_plus4',
  'full_plate_plus1', 'full_plate_plus2', 'full_plate_plus3', 'full_plate_plus4', 'full_plate_plus5',
  'splint_mail_plus1', 'splint_mail_plus2',
  'banded_mail_plus1', 'banded_mail_plus2', 'banded_mail_plus3',
  'mithral_full_plate', 'adamantine_full_plate',
  'light_fort_full_plate', 'moderate_fort_full_plate', 'heavy_fort_full_plate',
  'cold_resist_full_plate', 'greater_fire_resist_full', 'prismatic_armor',
  'sr15_full_plate', 'sr17_full_plate', 'sr19_full_plate',
  'ghost_touch_full_plate', 'dwarven_plate',
  'invulnerability_full_plate', 'righteousness_armor',
]);

// Combined catalog searched for every assignment phase.
const ALL_ITEMS: Record<string, Equipment> = { ...EQUIPMENT_CATALOG, ...MAGICAL_EQUIPMENT_CATALOG };

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * Assign equipment to a character of the given class, level, and wealth.
 * Searches both the mundane and magical catalogs; picks the best-scoring
 * affordable item per slot using class-role weights.
 *
 * Phase order (highest budget priority first):
 * armor → bracers → cloak → necklace → ring1 → weapon1 → belt → gloves
 * → shield/off-hand → ranged+ammo → helmet → ring2 → boots
 * → utility (×3) → cosmetic fallbacks.
 *
 * The optional `rng` parameter unlocks per-slot variety — when present, each
 * phase weight-samples one item from a top-K shortlist of high-scoring
 * affordable candidates instead of taking the single best. Same character
 * stats now produce different (but still class-appropriate) loadouts across
 * different rng seeds, which is what gives a city's roster its visible
 * weapon / armor / item variety. When `rng` is omitted the behavior collapses
 * to the original deterministic best-score pick (every existing call site
 * stays byte-identical).
 *
 * Callers should derive `rng` from an isolated PRNG sub-stream (e.g.
 * `seededPRNG(`${worldSeed}_chareq_${cellIndex}_${i}`)`) so equipment
 * variety never leaks into the main character roll RNG.
 */
export function assignEquipment(
  pcClass: PcClassType,
  _level: number,
  wealth: number,
  abilities: Record<Ability, number>,
  rng?: () => number,
): EquipmentSet {
  let budget = wealth;
  const result: EquipmentSet = {};

  const strMod = abilityMod(abilities.strength  ?? 10);
  const dexMod = abilityMod(abilities.dexterity ?? 10);

  // ── Role flags ────────────────────────────────────────────────────────────
  const isPureArcane = pcClass === 'wizard' || pcClass === 'sorcerer';
  const isBard       = pcClass === 'bard';
  const isArcane     = isPureArcane || isBard;
  const isMonk       = pcClass === 'monk';
  const isDivine     = ['cleric', 'druid', 'paladin', 'ranger'].includes(pcClass);
  const isRanger     = pcClass === 'ranger';
  const isRogue      = pcClass === 'rogue';
  const isPowerMelee = !isArcane && !isMonk && !isRogue && strMod >= dexMod;
  const isFinesse    = isRogue || isMonk || (!isArcane && dexMod > strMod);

  const castingStat: BonusTarget | null =
    pcClass === 'wizard'               ? 'int'
    : pcClass === 'sorcerer' || isBard ? 'cha'
    : isDivine                         ? 'wis'
    : null;

  // ── Inner helpers ─────────────────────────────────────────────────────────
  function bonusSum(item: Equipment, target: BonusTarget): number {
    return item.bonuses.reduce((s, b) => b.target === target ? s + b.value : s, 0);
  }

  /**
   * AC contribution of `item` over and above what is already equipped, under
   * SRD stacking rules. Same-type AC bonuses (armor / shield / natural /
   * deflection / etc) only contribute the delta above the highest existing
   * value of that type; types in `STACKING_BONUS_TYPES` (only `dodge` is
   * relevant for AC) always contribute their full value.
   *
   * Used in place of raw `bonusSum(item, 'ac')` for every AC-scoring phase
   * so the equipment picker doesn't waste budget on items whose AC bonus
   * would be entirely suppressed by something already in the slot map (e.g.
   * a Fighter in Full Plate has no use for Bracers of Armor).
   */
  function marginalAcGain(item: Equipment): number {
    let gain = 0;
    for (const b of item.bonuses) {
      if (b.target !== 'ac') continue;
      const type = (b.type ?? 'misc') as BonusType;
      if (STACKING_BONUS_TYPES.has(type)) { gain += b.value; continue; }
      let existing = 0;
      for (const eq of Object.values(result)) {
        if (!eq || eq.id === item.id) continue;
        for (const eb of eq.bonuses) {
          if (eb.target !== 'ac') continue;
          if (((eb.type ?? 'misc') as BonusType) !== type) continue;
          if (eb.value > existing) existing = eb.value;
        }
      }
      gain += Math.max(0, b.value - existing);
    }
    return gain;
  }

  /**
   * Score every affordable+filtered candidate and return one. When `rng` is
   * not provided, returns the single highest-scoring item (legacy behavior).
   *
   * When `rng` IS provided, builds a shortlist of the top candidates whose
   * score is within a small tolerance band of the best score, then samples
   * one weighted by `(score - cutoff + epsilon)`. This adds visible variety
   * (across seeds) without ever picking a clearly-inferior item — only items
   * that are competitive with the best are considered.
   *
   * Tolerance band: scores within `max(1.0, |bestScore| * 0.20)` of the best
   * are considered competitive. Tighter than 20% would collapse most slots
   * back to single-pick; looser would let bad items through.
   */
  function bestBuy(
    candidates: Equipment[],
    score: (i: Equipment) => number,
    filter?: (i: Equipment) => boolean,
  ): Equipment | undefined {
    type Scored = { item: Equipment; score: number };
    const scored: Scored[] = [];
    let bestScore = -Infinity;
    for (const item of candidates) {
      if (item.price > budget) continue;
      if (filter && !filter(item)) continue;
      const s = score(item);
      if (s > bestScore) bestScore = s;
      scored.push({ item, score: s });
    }
    if (scored.length === 0) return undefined;

    let chosen: Equipment | undefined;
    if (!rng) {
      let best: Equipment | undefined;
      let bestS = -Infinity;
      for (const sc of scored) {
        if (sc.score > bestS) { bestS = sc.score; best = sc.item; }
      }
      chosen = best;
    } else {
      const tol = Math.max(1.0, Math.abs(bestScore) * 0.20);
      const cutoff = bestScore - tol;
      const shortlist = scored.filter(sc => sc.score >= cutoff);
      // Cap shortlist size so a slot with hundreds of similarly-scored
      // entries (e.g. magical longswords +1 across many sub-types) doesn't
      // produce a long uniform tail.
      shortlist.sort((a, b) => b.score - a.score);
      const topK = shortlist.slice(0, 12);
      let total = 0;
      for (const sc of topK) total += (sc.score - cutoff) + 0.0001;
      let roll = rng() * total;
      chosen = topK[topK.length - 1].item;
      for (const sc of topK) {
        const w = (sc.score - cutoff) + 0.0001;
        roll -= w;
        if (roll <= 0) { chosen = sc.item; break; }
      }
    }

    if (chosen) budget -= chosen.price;
    return chosen;
  }

  function bySlot(s: EquipmentSlot): Equipment[] {
    return Object.values(ALL_ITEMS).filter(i => i.slot === s);
  }

  // ── Proficiency filters ───────────────────────────────────────────────────
  function canWearArmor(item: Equipment): boolean {
    const id = item.id;
    if (isPureArcane || isMonk) return id === 'robes';
    if (isBard || isRogue)      return !HEAVY_ARMOR_IDS.has(id) && !MEDIUM_ARMOR_IDS.has(id);
    if (isRanger)               return !HEAVY_ARMOR_IDS.has(id);
    if (pcClass === 'druid')    return !METAL_ARMOR_IDS.has(id);
    return true;
  }

  function canWieldMelee(item: Equipment): boolean {
    if (item.isRanged || item.isShield) return false;
    if (item.isExotic)  return isMonk;
    if (item.isMartial) return !isPureArcane;
    return true;
  }

  function canWieldRanged(item: Equipment): boolean {
    if (!item.isRanged || item.isExotic) return false;
    if (item.isMartial && (isPureArcane || isMonk)) {
      return item.id.includes('crossbow') || item.id.startsWith('sling') || item.id === 'javelin';
    }
    return true;
  }

  // ── Weapon scoring ────────────────────────────────────────────────────────
  function weaponScore(item: Equipment): number {
    if (!item.damage) return -999;
    const dmg = parseDiceAvg(item.damage);
    const atk = bonusSum(item, 'bab');
    const twoH = item.isTwoHanded;
    if (isPowerMelee) return dmg + atk * 3 + (twoH ? 4 : 0);
    if (isFinesse)    return dmg + atk * 3 - (twoH ? 8 : 0);
    if (isArcane)     return dmg * 0.3 + atk - item.price / 5000;
    return dmg + atk * 2 - (twoH ? 1 : 0);
  }

  function rangedScore(item: Equipment): number {
    if (!item.damage) return -999;
    const dmg = parseDiceAvg(item.damage);
    const atk = bonusSum(item, 'bab');
    return isRanger ? dmg + atk * 3 : dmg + atk * 2;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 – Armor
  // ─────────────────────────────────────────────────────────────────────────
  const armorItem = bestBuy(bySlot('armor'), i => bonusSum(i, 'ac'), canWearArmor);
  if (armorItem) result.armor = armorItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 – Bracers
  // Arcane casters and monks rely on bracers of armor for AC; rangers prefer
  // bracers of archery; anyone else may still buy bracers of armor.
  // ─────────────────────────────────────────────────────────────────────────
  const bracerItem = bestBuy(
    bySlot('braces'),
    item => {
      const ac  = marginalAcGain(item);
      const bab = bonusSum(item, 'bab');
      if (isPureArcane || isMonk) return ac * 3;
      if (isRanger)               return bab * 4 + ac;
      return ac * 2;
    },
    item => {
      if (isPureArcane || isMonk) return item.id.startsWith('bracers_armor');
      if (isRanger)               return true;
      // Other classes only buy bracers of armor when they actually exceed
      // the worn armor's AC bonus (same-type bonuses don't stack).
      if (item.id.startsWith('bracers_armor')) return marginalAcGain(item) > 0;
      return false;
    },
  );
  if (bracerItem) result.braces = bracerItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3 – Cloak (saving throw resistance)
  // ─────────────────────────────────────────────────────────────────────────
  const cloakItem = bestBuy(
    bySlot('cloak'),
    item => {
      const saves = bonusSum(item, 'fort') + bonusSum(item, 'ref') + bonusSum(item, 'will');
      return saves * 5 + marginalAcGain(item) * 3;
    },
  );
  if (cloakItem) result.cloak = cloakItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4 – Necklace / amulet
  // Divine casters prefer WIS; arcane prefer CON or natural armor; melee prefers AC.
  // ─────────────────────────────────────────────────────────────────────────
  const necklaceItem = bestBuy(
    bySlot('necklace'),
    item => {
      const ac  = marginalAcGain(item);
      const wis = bonusSum(item, 'wis');
      const con = bonusSum(item, 'con');
      if (castingStat === 'wis')                      return wis * 8 + ac * 2 + con * 2;
      if (castingStat === 'int' || castingStat === 'cha') return con * 4 + ac * 3;
      return ac * 5 + con * 3;
    },
  );
  if (necklaceItem) result.necklace = necklaceItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5 – Ring 1
  // ─────────────────────────────────────────────────────────────────────────
  const ringPool = bySlot('ring1');
  const ring1Item = bestBuy(
    ringPool,
    item => {
      const ac       = marginalAcGain(item);
      const slotPts  = item.bonuses.reduce((s, b) => b.target === 'spell_slots' ? s + b.value * 3 : s, 0);
      return isArcane ? slotPts * 4 + ac * 2 : ac * 5;
    },
  );
  if (ring1Item) result.ring1 = ring1Item;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6 – Primary melee weapon
  // ─────────────────────────────────────────────────────────────────────────
  const weapon1Item = bestBuy(bySlot('weapon1'), weaponScore, canWieldMelee);
  if (weapon1Item) result.weapon1 = weapon1Item;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7 – Belt (STR for power melee; DEX for finesse/monk; skip for casters)
  // ─────────────────────────────────────────────────────────────────────────
  const beltItem = bestBuy(
    bySlot('belt'),
    item => {
      const str = bonusSum(item, 'str');
      const dex = bonusSum(item, 'dex');
      if (isPowerMelee)        return str * 8 + dex * 2;
      if (isFinesse || isMonk) return dex * 8 + str * 2;
      return 0;
    },
    item => (isPowerMelee || isFinesse || isMonk) ? true : item.price <= 10,
  );
  if (beltItem) result.belt = beltItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8 – Gloves
  // ─────────────────────────────────────────────────────────────────────────
  const glovesItem = bestBuy(
    bySlot('gloves'),
    item => {
      const str = bonusSum(item, 'str');
      const dex = bonusSum(item, 'dex');
      if (isPowerMelee)               return str * 6 + dex;
      if (isFinesse || isMonk)        return dex * 6 + str;
      if (isRanger)                   return dex * 5 + str * 2;
      if (isPureArcane)               return dex * 2;
      return 0;
    },
    item => {
      if (isPowerMelee || isFinesse || isMonk || isRanger) return true;
      if (isPureArcane) return item.price <= 10000;
      return item.price <= 5;
    },
  );
  if (glovesItem) result.gloves = glovesItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 9 – Shield (weapon2) or off-hand weapon
  // ─────────────────────────────────────────────────────────────────────────
  if (!result.weapon1?.isTwoHanded) {
    const w2All    = bySlot('weapon2');
    const shields  = w2All.filter(i => i.isShield);
    const offhands = w2All.filter(i => !i.isShield && !i.isRanged);

    let w2Item: Equipment | undefined;
    if (['fighter', 'paladin', 'cleric', 'barbarian'].includes(pcClass)) {
      w2Item = bestBuy(
        shields,
        item => marginalAcGain(item) * 4,
        // Skip shields whose bonus is already covered by something equipped
        // (e.g. a Ring of Force Shield bought in Phase 5 makes a +1 buckler
        // a wasted slot).
        item => marginalAcGain(item) > 0,
      );
    } else if (pcClass === 'druid') {
      w2Item = bestBuy(
        shields.filter(i => !METAL_ARMOR_IDS.has(i.id)),
        item => marginalAcGain(item) * 3,
        item => marginalAcGain(item) > 0,
      );
    } else if (isRanger || isRogue || isBard) {
      w2Item = bestBuy(
        offhands,
        item => item.damage ? parseDiceAvg(item.damage) + bonusSum(item, 'bab') * 2 : 0,
        item => !item.isTwoHanded,
      );
    }
    if (w2Item) result.weapon2 = w2Item;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 10 – Ranged weapon (weapon3) + matching ammo
  // ─────────────────────────────────────────────────────────────────────────
  const wantRanged = isRanger || ['fighter', 'rogue', 'bard', 'barbarian', 'paladin'].includes(pcClass);
  const rangedItem = bestBuy(
    bySlot('weapon3').filter(i => i.isRanged),
    rangedScore,
    item => canWieldRanged(item) && (wantRanged || item.price <= 200),
  );
  if (rangedItem) {
    result.weapon3 = rangedItem;
    const useArrows  = rangedItem.id.includes('bow');
    const useBolts   = rangedItem.id.includes('crossbow');
    const useBullets = rangedItem.id.includes('sling');
    const useJavelin = rangedItem.id === 'javelin';
    const ammoItem = bestBuy(
      bySlot('ammo'),
      item => bonusSum(item, 'bab') * 3,
      item => {
        if (useArrows)  return item.id.startsWith('arrow');
        if (useBolts)   return item.id.startsWith('bolt') || item.id === 'screaming_bolt';
        if (useBullets) return item.id.startsWith('sling_bullet');
        if (useJavelin) return item.id === 'javelins_3';
        return false;
      },
    );
    if (ammoItem) result.ammo = ammoItem;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 11 – Helmet / headband / circlet
  // ─────────────────────────────────────────────────────────────────────────
  const helmetItem = bestBuy(
    bySlot('helmet'),
    item => {
      const int = bonusSum(item, 'int');
      const wis = bonusSum(item, 'wis');
      const cha = bonusSum(item, 'cha');
      const bab = bonusSum(item, 'bab');
      if (castingStat === 'int') return int * 10 + bab * 2;
      if (castingStat === 'wis') return wis * 8  + bab * 2 + cha;
      if (castingStat === 'cha') return cha * 8  + bab * 2 + wis;
      return bab * 3;
    },
    item => {
      if (isPureArcane) {
        return item.id.startsWith('headband') || item.id.startsWith('circlet') ||
               item.id.startsWith('hat')      || item.id.startsWith('helm');
      }
      if (isDivine && castingStat === 'wis') return !item.id.startsWith('headband_intellect');
      return true;
    },
  );
  if (helmetItem) result.helmet = helmetItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 12 – Ring 2 (same pool, skip the ring1 choice)
  // ─────────────────────────────────────────────────────────────────────────
  const ring2Item = bestBuy(
    ringPool.filter(r => r.id !== ring1Item?.id),
    item => {
      const ac      = marginalAcGain(item);
      const slotPts = item.bonuses.reduce((s, b) => b.target === 'spell_slots' ? s + b.value * 3 : s, 0);
      return isArcane ? slotPts * 3 + ac * 2 : ac * 4;
    },
  );
  if (ring2Item) result.ring2 = ring2Item;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 13 – Boots
  // ─────────────────────────────────────────────────────────────────────────
  const bootsItem = bestBuy(
    bySlot('boots'),
    item => {
      const ac    = marginalAcGain(item);
      const speed = (item.id.includes('speed') || item.id.includes('striding')) ? 4 : 0;
      const dex   = bonusSum(item, 'dex');
      if (isFinesse || isMonk) return dex * 3 + speed * 2 + ac;
      return speed * 2 + ac * 2 + dex;
    },
  );
  if (bootsItem) result.boots = bootsItem;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 14 – Utility slots (up to 3 distinct items)
  // ─────────────────────────────────────────────────────────────────────────
  const utilPool = [
    ...bySlot('utility1'), ...bySlot('utility2'), ...bySlot('utility3'),
  ];

  function utilScore(item: Equipment): number {
    const spellPts = item.bonuses.reduce((s, b) => b.target === 'spell_slots' ? s + b.value * 5 : s, 0);
    const cl    = bonusSum(item, 'caster_level') * 4;
    const stat  = castingStat ? bonusSum(item, castingStat) * 6 : 0;
    const saves = bonusSum(item, 'fort') + bonusSum(item, 'ref') + bonusSum(item, 'will');
    const hp    = bonusSum(item, 'hp');
    if (isArcane) return spellPts * 3 + cl * 2 + stat + saves;
    if (isDivine) return spellPts * 2 + cl + stat + saves + marginalAcGain(item);
    return hp * 2 + saves * 2 + bonusSum(item, 'str') + bonusSum(item, 'con');
  }

  const usedUtil = new Set<string>();
  for (const slot of (['utility1', 'utility2', 'utility3'] as EquipmentSlot[])) {
    const item = bestBuy(utilPool.filter(u => !usedUtil.has(u.id)), utilScore);
    if (item) { result[slot] = item; usedUtil.add(item.id); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 15 – Cosmetic fallbacks for empty wearable slots
  // ─────────────────────────────────────────────────────────────────────────
  for (const [s, id] of [
    ['cloak',  'travelers_cloak'] as const,
    ['boots',  'boots']          as const,
    ['belt',   'belt']           as const,
    ['gloves', 'light_gloves']   as const,
  ]) {
    if (!result[s]) {
      const item = ALL_ITEMS[id];
      if (item && item.price <= budget) { budget -= item.price; result[s] = item; }
    }
  }

  return result;
}

// ─── Bonus summary helpers ────────────────────────────────────────────────────

/** One-line summary of all bonuses an item provides, e.g. "+5 AC, +2 Fort". */
export function equipBonusSummary(item: Equipment): string {
  if (item.bonuses.length === 0 && !item.damage) return item.description ? '(special)' : '—';
  const parts: string[] = [];
  if (item.damage) {
    const crit = formatCrit(item.critRange, item.critMult);
    parts.push(`${item.damage}${crit}`);
  }
  for (const b of item.bonuses) {
    const sign = b.value >= 0 ? '+' : '';
    if (b.target === 'spell_slots') {
      parts.push(`${sign}${b.value} L${b.spellLevel ?? 1} slot${b.value !== 1 ? 's' : ''}`);
    } else if (b.target === 'caster_level') {
      parts.push(`${sign}${b.value} CL`);
    } else {
      const label = BONUS_TARGET_LABELS[b.target] ?? b.target;
      parts.push(`${sign}${b.value} ${label}`);
    }
  }
  return parts.join(', ');
}

/** Format crit range/mult: "(×3)" or "(19-20/×2)" etc. */
export function formatCrit(critRange?: number, critMult?: number): string {
  const r = critRange ?? 20;
  const m = critMult  ?? 2;
  const rangeStr = r < 20 ? `${r}-20/` : '';
  return ` (${rangeStr}×${m})`;
}

const BONUS_TARGET_LABELS: Record<BonusTarget, string> = {
  ac: 'AC', bab: 'Attack',
  fort: 'Fort', ref: 'Ref', will: 'Will',
  str: 'STR', dex: 'DEX', con: 'CON',
  int: 'INT', wis: 'WIS', cha: 'CHA',
  hp: 'HP', spell_slots: 'Slots', caster_level: 'CL',
};
