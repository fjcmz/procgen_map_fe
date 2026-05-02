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

  // ── Martial ranged ────────────────────────────────────────────────────────
  shortbow: { id: 'shortbow', name: 'Shortbow', slot: 'weapon3', price: 30, bonuses: [], damage: '1d6', critMult: 3, isRanged: true, isMartial: true },
  longbow:  { id: 'longbow',  name: 'Longbow',  slot: 'weapon3', price: 75, bonuses: [], damage: '1d8', critMult: 3, isRanged: true, isMartial: true },

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

  // +1 special-property weapons (~8,300 gp; property ≈ +1 equivalent)
  flaming_longsword:   { id: 'flaming_longsword',   name: 'Flaming Longsword +1',   slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 fire damage on a successful attack.' },
  frost_greatsword:    { id: 'frost_greatsword',    name: 'Frost Greatsword +1',    slot: 'weapon1', price: 8350,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '2d6+1',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true, description: '+1d6 cold damage on a successful attack.' },
  shock_battleaxe:     { id: 'shock_battleaxe',     name: 'Shock Battleaxe +1',     slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isMartial: true, description: '+1d6 electricity damage on a successful attack.' },
  keen_longsword:      { id: 'keen_longsword',      name: 'Keen Longsword +1',      slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 17, critMult: 2, isMartial: true, description: 'Threat range doubled (already reflected as 17–20).' },
  disruption_mace:     { id: 'disruption_mace',     name: 'Mace of Disruption +1',  slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 2, description: 'Undead struck must succeed on a DC 14 Will save or be destroyed. Emits light as a torch.' },

  // +2 tier (~8,300 gp base)
  longsword_plus2:     { id: 'longsword_plus2',     name: 'Longsword +2',           slot: 'weapon1', price: 8315,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus2:    { id: 'greatsword_plus2',    name: 'Greatsword +2',          slot: 'weapon1', price: 8350,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '2d6+2',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  battleaxe_plus2:     { id: 'battleaxe_plus2',     name: 'Battleaxe +2',           slot: 'weapon1', price: 8310,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isMartial: true },
  holy_longsword:      { id: 'holy_longsword',      name: 'Holy Longsword +2',      slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+2d6 bonus holy damage against evil creatures. Good-aligned.' },
  flaming_burst_sword: { id: 'flaming_burst_sword', name: 'Flaming Burst Sword +2', slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critRange: 19, critMult: 2, isMartial: true, description: '+1d6 fire on every hit; +1d10 bonus fire on a confirmed critical.' },
  speed_longsword:     { id: 'speed_longsword',     name: 'Speed Longsword +1',     slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critRange: 19, critMult: 2, isMartial: true, description: 'Grants one additional attack at the highest BAB when used in a full-attack action.' },

  // +3 tier (~18,300 gp)
  longsword_plus3:     { id: 'longsword_plus3',     name: 'Longsword +3',           slot: 'weapon1', price: 18315, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus3:    { id: 'greatsword_plus3',    name: 'Greatsword +3',          slot: 'weapon1', price: 18350, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '2d6+3',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  warhammer_plus3:     { id: 'warhammer_plus3',     name: 'Warhammer +3',           slot: 'weapon1', price: 18312, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isMartial: true },

  // +4 / +5 tier (~32–50k gp)
  longsword_plus4:     { id: 'longsword_plus4',     name: 'Longsword +4',           slot: 'weapon1', price: 32315, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus4:    { id: 'greatsword_plus4',    name: 'Greatsword +4',          slot: 'weapon1', price: 32350, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '2d6+4',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },
  longsword_plus5:     { id: 'longsword_plus5',     name: 'Longsword +5',           slot: 'weapon1', price: 50315, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5',  critRange: 19, critMult: 2, isMartial: true },
  greatsword_plus5:    { id: 'greatsword_plus5',    name: 'Greatsword +5',          slot: 'weapon1', price: 50350, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '2d6+5',  critRange: 19, critMult: 2, isMartial: true, isTwoHanded: true },

  // Legendary named weapons
  vorpal_sword:        { id: 'vorpal_sword',        name: 'Vorpal Sword +5',        slot: 'weapon1', price: 120000, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }], damage: '1d8+5', critRange: 19, critMult: 2, isMartial: true, description: "On a natural 20 (confirmed crit), severs the target's head. Creatures immune to crits are unaffected." },
  holy_avenger:        { id: 'holy_avenger',        name: 'Holy Avenger',           slot: 'weapon1', price: 120630, bonuses: [{ target: 'bab', value: 5, type: 'enhancement' }, { target: 'will', value: 2, type: 'resistance' }], damage: '1d8+5', critRange: 19, critMult: 2, isMartial: true, description: '+2d6 holy damage vs evil. In the hands of a paladin, continuously emanates magic circle against evil and dispel evil 1/day.' },
  sword_of_dancing:    { id: 'sword_of_dancing',    name: 'Sword of Dancing +4',    slot: 'weapon1', price: 75000, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critRange: 19, critMult: 2, isMartial: true, description: 'Can be released as a free action to fight independently for up to 4 rounds at the owner\'s full BAB, then returns.' },
  mace_of_disruption:  { id: 'mace_of_disruption',  name: 'Mace of Disruption +2', slot: 'weapon1', price: 38312, bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 2, description: 'Undead struck must make DC 17 Will save or be destroyed. Emits daylight as a continuous spell effect.' },

  // ── Magical shields — weapon2 ────────────────────────────────────────────────
  buckler_plus1:        { id: 'buckler_plus1',        name: 'Buckler +1',              slot: 'weapon2', price: 1165,  bonuses: [{ target: 'ac', value: 2, type: 'shield' }], isShield: true },
  buckler_plus2:        { id: 'buckler_plus2',        name: 'Buckler +2',              slot: 'weapon2', price: 4165,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true },
  heavy_steel_plus1:    { id: 'heavy_steel_plus1',    name: 'Heavy Steel Shield +1',   slot: 'weapon2', price: 1170,  bonuses: [{ target: 'ac', value: 3, type: 'shield' }], isShield: true },
  heavy_steel_plus2:    { id: 'heavy_steel_plus2',    name: 'Heavy Steel Shield +2',   slot: 'weapon2', price: 4170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true },
  heavy_steel_plus3:    { id: 'heavy_steel_plus3',    name: 'Heavy Steel Shield +3',   slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 5, type: 'shield' }], isShield: true },
  animated_shield:      { id: 'animated_shield',      name: 'Animated Shield +2',      slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: 'Can be released as a free action to fight independently for up to 4 rounds.' },
  arrow_catching_shield:{ id: 'arrow_catching_shield',name: 'Arrow-Catching Shield +2',slot: 'weapon2', price: 9170,  bonuses: [{ target: 'ac', value: 4, type: 'shield' }], isShield: true, description: '+5 deflection bonus to AC against ranged attacks targeting adjacent allies.' },

  // ── Magical ranged weapons — weapon3 ─────────────────────────────────────────
  shortbow_plus1:       { id: 'shortbow_plus1',       name: 'Shortbow +1',             slot: 'weapon3', price: 2330,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d6+1',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus1:        { id: 'longbow_plus1',        name: 'Longbow +1',              slot: 'weapon3', price: 2375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus2:        { id: 'longbow_plus2',        name: 'Longbow +2',              slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 2, type: 'enhancement' }], damage: '1d8+2',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus3:        { id: 'longbow_plus3',        name: 'Longbow +3',              slot: 'weapon3', price: 18375, bonuses: [{ target: 'bab', value: 3, type: 'enhancement' }], damage: '1d8+3',  critMult: 3, isRanged: true, isMartial: true },
  longbow_plus4:        { id: 'longbow_plus4',        name: 'Longbow +4',              slot: 'weapon3', price: 32375, bonuses: [{ target: 'bab', value: 4, type: 'enhancement' }], damage: '1d8+4',  critMult: 3, isRanged: true, isMartial: true },
  distance_longbow:     { id: 'distance_longbow',     name: 'Longbow of Distance +1',  slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Range increment doubled.' },
  seeking_longbow:      { id: 'seeking_longbow',      name: 'Seeking Longbow +1',      slot: 'weapon3', price: 8375,  bonuses: [{ target: 'bab', value: 1, type: 'enhancement' }], damage: '1d8+1',  critMult: 3, isRanged: true, isMartial: true, description: 'Negates the miss chance granted by concealment (though not total concealment).' },

  // ── Magical ammo ──────────────────────────────────────────────────────────────
  arrows_plus1:         { id: 'arrows_plus1',         name: 'Arrows +1 (20)',          slot: 'ammo', price: 41,   bonuses: [] },
  arrows_plus2:         { id: 'arrows_plus2',         name: 'Arrows +2 (20)',          slot: 'ammo', price: 161,  bonuses: [] },
  arrows_plus3:         { id: 'arrows_plus3',         name: 'Arrows +3 (20)',          slot: 'ammo', price: 361,  bonuses: [] },
  slaying_arrow:        { id: 'slaying_arrow',        name: 'Slaying Arrow (undead)',  slot: 'ammo', price: 2282, bonuses: [], description: 'Target must make DC 20 Fortitude save or die instantly.' },
  screaming_bolt:       { id: 'screaming_bolt',       name: 'Screaming Bolt +2 (10)',  slot: 'ammo', price: 267,  bonuses: [], description: 'Target must make DC 14 Will save or be shaken for 1 round.' },

  // ── Magical armor ─────────────────────────────────────────────────────────────
  leather_plus1:        { id: 'leather_plus1',        name: 'Leather Armor +1',        slot: 'armor', price: 1160,  bonuses: [{ target: 'ac', value: 3,  type: 'armor' }] },
  chain_shirt_plus1:    { id: 'chain_shirt_plus1',    name: 'Chain Shirt +1',          slot: 'armor', price: 1250,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }] },
  mithral_shirt:        { id: 'mithral_shirt',        name: 'Mithral Shirt',           slot: 'armor', price: 1100,  bonuses: [{ target: 'ac', value: 4,  type: 'armor' }], description: 'Counts as light armor. No arcane spell failure chance.' },
  elven_chain:          { id: 'elven_chain',          name: 'Elven Chain',             slot: 'armor', price: 4150,  bonuses: [{ target: 'ac', value: 5,  type: 'armor' }], description: 'Treated as light armor for proficiency. Allows arcane spellcasting without failure.' },
  chainmail_plus1:      { id: 'chainmail_plus1',      name: 'Chainmail +1',            slot: 'armor', price: 1300,  bonuses: [{ target: 'ac', value: 6,  type: 'armor' }] },
  chainmail_plus2:      { id: 'chainmail_plus2',      name: 'Chainmail +2',            slot: 'armor', price: 4300,  bonuses: [{ target: 'ac', value: 7,  type: 'armor' }] },
  half_plate_plus1:     { id: 'half_plate_plus1',     name: 'Half-Plate +1',           slot: 'armor', price: 1750,  bonuses: [{ target: 'ac', value: 8,  type: 'armor' }] },
  half_plate_plus2:     { id: 'half_plate_plus2',     name: 'Half-Plate +2',           slot: 'armor', price: 4750,  bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  half_plate_plus3:     { id: 'half_plate_plus3',     name: 'Half-Plate +3',           slot: 'armor', price: 9750,  bonuses: [{ target: 'ac', value: 10, type: 'armor' }] },
  full_plate_plus1:     { id: 'full_plate_plus1',     name: 'Full Plate +1',           slot: 'armor', price: 2650,  bonuses: [{ target: 'ac', value: 9,  type: 'armor' }] },
  full_plate_plus2:     { id: 'full_plate_plus2',     name: 'Full Plate +2',           slot: 'armor', price: 5650,  bonuses: [{ target: 'ac', value: 10, type: 'armor' }] },
  full_plate_plus3:     { id: 'full_plate_plus3',     name: 'Full Plate +3',           slot: 'armor', price: 18650, bonuses: [{ target: 'ac', value: 11, type: 'armor' }] },
  full_plate_plus4:     { id: 'full_plate_plus4',     name: 'Full Plate +4',           slot: 'armor', price: 32650, bonuses: [{ target: 'ac', value: 12, type: 'armor' }] },
  full_plate_plus5:     { id: 'full_plate_plus5',     name: 'Full Plate +5',           slot: 'armor', price: 50650, bonuses: [{ target: 'ac', value: 13, type: 'armor' }] },
  mithral_full_plate:   { id: 'mithral_full_plate',   name: 'Mithral Full Plate +1',   slot: 'armor', price: 10500, bonuses: [{ target: 'ac', value: 9,  type: 'armor' }], description: 'Treated as medium armor (not heavy). Arcane spell failure reduced by 15%.' },
  adamantine_breastplate:{ id: 'adamantine_breastplate', name: 'Adamantine Breastplate', slot: 'armor', price: 10200, bonuses: [{ target: 'ac', value: 6, type: 'armor' }], description: 'DR 2/— while worn. Adamantine bypasses hardness ≤ 20.' },
  celestial_armor:      { id: 'celestial_armor',      name: 'Celestial Armor',         slot: 'armor', price: 22400, bonuses: [{ target: 'ac', value: 9,  type: 'armor' }], description: 'Fly 1 min/day (good maneuverability, CL 5th). No arcane spell failure.' },
  ghostward_chain:      { id: 'ghostward_chain',      name: 'Ghost Ward Chainmail +3', slot: 'armor', price: 18300, bonuses: [{ target: 'ac', value: 8,  type: 'armor' }], description: 'Armor bonus applies against incorporeal touch attacks.' },

  // ── Helmets (magical) ─────────────────────────────────────────────────────────
  headband_intellect2:  { id: 'headband_intellect2',  name: 'Headband of Intellect +2',slot: 'helmet', price: 4000,  bonuses: [{ target: 'int', value: 2, type: 'enhancement' }] },
  headband_intellect4:  { id: 'headband_intellect4',  name: 'Headband of Intellect +4',slot: 'helmet', price: 16000, bonuses: [{ target: 'int', value: 4, type: 'enhancement' }] },
  headband_intellect6:  { id: 'headband_intellect6',  name: 'Headband of Intellect +6',slot: 'helmet', price: 36000, bonuses: [{ target: 'int', value: 6, type: 'enhancement' }] },
  hat_of_disguise:      { id: 'hat_of_disguise',      name: 'Hat of Disguise',         slot: 'helmet', price: 1800,  bonuses: [], description: 'Disguise self at will (CL 1st).' },
  circlet_persuasion:   { id: 'circlet_persuasion',   name: 'Circlet of Persuasion',   slot: 'helmet', price: 4500,  bonuses: [{ target: 'cha', value: 3, type: 'competence' }], description: '+3 competence bonus on CHA-based skill checks.' },
  helm_comprehend:      { id: 'helm_comprehend',      name: 'Helm of Comprehend Languages', slot: 'helmet', price: 5200, bonuses: [], description: 'Comprehend languages at will (CL 1st).' },
  helm_telepathy:       { id: 'helm_telepathy',       name: 'Helm of Telepathy',        slot: 'helmet', price: 27000, bonuses: [], description: 'Detect thoughts at will (CL 5th). Once detected, can plant a suggestion (Will DC 14, 1/day).' },
  helm_teleportation:   { id: 'helm_teleportation',   name: 'Helm of Teleportation',    slot: 'helmet', price: 73500, bonuses: [], description: 'Teleport (self only) 3/day (CL 9th).' },
  helm_brilliance:      { id: 'helm_brilliance',      name: 'Helm of Brilliance',       slot: 'helmet', price: 125000, bonuses: [{ target: 'bab', value: 1, type: 'sacred' }], description: 'Fire resistance 30. Commands flaming, fire ball, fire storm, and sunburst effects. Flaming weapons deal +1d6 extra fire.' },

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

  // ── Gloves (magical) ──────────────────────────────────────────────────────────
  gauntlets_ogre:       { id: 'gauntlets_ogre',       name: 'Gauntlets of Ogre Power', slot: 'gloves', price: 4000,  bonuses: [{ target: 'str', value: 2, type: 'enhancement' }] },
  gloves_dex2:          { id: 'gloves_dex2',          name: 'Gloves of Dexterity +2',  slot: 'gloves', price: 4000,  bonuses: [{ target: 'dex', value: 2, type: 'enhancement' }] },
  gloves_dex4:          { id: 'gloves_dex4',          name: 'Gloves of Dexterity +4',  slot: 'gloves', price: 16000, bonuses: [{ target: 'dex', value: 4, type: 'enhancement' }] },
  gloves_dex6:          { id: 'gloves_dex6',          name: 'Gloves of Dexterity +6',  slot: 'gloves', price: 36000, bonuses: [{ target: 'dex', value: 6, type: 'enhancement' }] },
  gloves_storing:       { id: 'gloves_storing',       name: 'Gloves of Storing',       slot: 'gloves', price: 10000, bonuses: [], description: 'Store one item ≤ 10 lb; retrieve as a free action.' },

  // ── Boots (magical) ───────────────────────────────────────────────────────────
  boots_elvenkind:      { id: 'boots_elvenkind',      name: 'Boots of Elvenkind',           slot: 'boots', price: 2500,  bonuses: [], description: '+5 competence bonus on Move Silently checks.' },
  boots_striding:       { id: 'boots_striding',       name: 'Boots of Striding and Springing', slot: 'boots', price: 5500, bonuses: [], description: '+10 ft. land speed. +5 competence bonus on Jump checks.' },
  boots_speed:          { id: 'boots_speed',          name: 'Boots of Speed',               slot: 'boots', price: 12000, bonuses: [{ target: 'ac', value: 1, type: 'dodge' }], description: 'Haste (CL 10th) for up to 10 rounds per day; +1 dodge to AC already reflected.' },
  boots_levitation:     { id: 'boots_levitation',     name: 'Boots of Levitation',          slot: 'boots', price: 7500,  bonuses: [], description: 'Levitate at will (CL 3rd).' },
  boots_flying:         { id: 'boots_flying',         name: 'Winged Boots',                 slot: 'boots', price: 16000, bonuses: [], description: 'Fly 60 ft. (good, CL 5th) for up to 5 min/day in 1-minute increments.' },
  boots_teleport:       { id: 'boots_teleport',       name: 'Boots of Teleportation',       slot: 'boots', price: 49000, bonuses: [], description: 'Teleport 3/day (self only, CL 9th).' },

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
  medallion_thoughts:   { id: 'medallion_thoughts',   name: 'Medallion of Thoughts',       slot: 'necklace', price: 12000, bonuses: [], description: 'Detect thoughts at will (CL 5th).' },

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

  // ── Belt (magical) ────────────────────────────────────────────────────────────
  belt_strength2:       { id: 'belt_strength2',       name: 'Belt of Giant Strength +2', slot: 'belt', price: 4000,  bonuses: [{ target: 'str', value: 2, type: 'enhancement' }] },
  belt_strength4:       { id: 'belt_strength4',       name: 'Belt of Giant Strength +4', slot: 'belt', price: 16000, bonuses: [{ target: 'str', value: 4, type: 'enhancement' }] },
  belt_strength6:       { id: 'belt_strength6',       name: 'Belt of Giant Strength +6', slot: 'belt', price: 36000, bonuses: [{ target: 'str', value: 6, type: 'enhancement' }] },
  belt_many_pockets:    { id: 'belt_many_pockets',    name: "Belt of Many Pockets",       slot: 'belt', price: 9000,  bonuses: [], description: '14 extradimensional pockets (1 cu. ft./10 lb. each); items retrieved as a swift action.' },

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
  'chain_shirt', 'scale_mail', 'chainmail', 'splint_mail', 'banded_mail', 'half_plate', 'full_plate',
  'chain_shirt_plus1', 'mithral_shirt', 'elven_chain',
  'chainmail_plus1', 'chainmail_plus2',
  'half_plate_plus1', 'half_plate_plus2', 'half_plate_plus3',
  'full_plate_plus1', 'full_plate_plus2', 'full_plate_plus3', 'full_plate_plus4', 'full_plate_plus5',
  'mithral_full_plate', 'adamantine_breastplate', 'ghostward_chain', 'celestial_armor',
]);

// Medium and heavy armor — rogues/bards can't wear these; rangers can't wear heavy.
const MEDIUM_ARMOR_IDS = new Set([
  'hide', 'scale_mail', 'chainmail', 'chainmail_plus1', 'chainmail_plus2',
  'ghostward_chain', 'adamantine_breastplate',
]);
const HEAVY_ARMOR_IDS = new Set([
  'splint_mail', 'banded_mail', 'half_plate', 'full_plate',
  'half_plate_plus1', 'half_plate_plus2', 'half_plate_plus3',
  'full_plate_plus1', 'full_plate_plus2', 'full_plate_plus3', 'full_plate_plus4', 'full_plate_plus5',
  'mithral_full_plate',
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
 */
export function assignEquipment(
  pcClass: PcClassType,
  _level: number,
  wealth: number,
  abilities: Record<Ability, number>,
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

  function bestBuy(
    candidates: Equipment[],
    score: (i: Equipment) => number,
    filter?: (i: Equipment) => boolean,
  ): Equipment | undefined {
    let best: Equipment | undefined;
    let bestScore = -Infinity;
    for (const item of candidates) {
      if (item.price > budget) continue;
      if (filter && !filter(item)) continue;
      const s = score(item);
      if (s > bestScore) { bestScore = s; best = item; }
    }
    if (best) budget -= best.price;
    return best;
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
      const ac  = bonusSum(item, 'ac');
      const bab = bonusSum(item, 'bab');
      if (isPureArcane || isMonk) return ac * 3;
      if (isRanger)               return bab * 4 + ac;
      return ac * 2;
    },
    item => {
      if (isPureArcane || isMonk) return item.id.startsWith('bracers_armor');
      if (isRanger)               return true;
      return item.id.startsWith('bracers_armor');
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
      return saves * 5 + bonusSum(item, 'ac') * 3;
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
      const ac  = bonusSum(item, 'ac');
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
      const ac       = bonusSum(item, 'ac');
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
      w2Item = bestBuy(shields, item => bonusSum(item, 'ac') * 4);
    } else if (pcClass === 'druid') {
      w2Item = bestBuy(
        shields.filter(i => !METAL_ARMOR_IDS.has(i.id)),
        item => bonusSum(item, 'ac') * 3,
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
      const ac      = bonusSum(item, 'ac');
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
      const ac    = bonusSum(item, 'ac');
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
    if (isDivine) return spellPts * 2 + cl + stat + saves + bonusSum(item, 'ac');
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
