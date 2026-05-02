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
  | 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | 'hp';

export interface EquipBonus {
  target: BonusTarget;
  value:  number;
  /** Bonus type tag matching Combat.BonusType — determines stacking rules. */
  type?:  BonusType;
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

// ─── Class preference tables ─────────────────────────────────────────────────
// Lists are ordered from most preferred (try first) to fallback. pickBest()
// walks the list and returns the first item whose price fits the budget.

const ARMOR_PREFS: Record<PcClassType, string[]> = {
  fighter:   ['half_plate', 'banded_mail', 'splint_mail', 'chainmail', 'scale_mail', 'studded_leather'],
  paladin:   ['half_plate', 'banded_mail', 'chainmail', 'scale_mail', 'studded_leather'],
  ranger:    ['chain_shirt', 'scale_mail', 'studded_leather', 'hide', 'leather'],
  cleric:    ['half_plate', 'chainmail', 'scale_mail', 'studded_leather', 'padded'],
  druid:     ['hide', 'leather', 'padded', 'robes'],
  barbarian: ['chain_shirt', 'scale_mail', 'hide', 'studded_leather', 'leather'],
  rogue:     ['studded_leather', 'leather', 'padded'],
  bard:      ['studded_leather', 'leather', 'padded'],
  monk:      ['robes'],
  sorcerer:  ['robes'],
  wizard:    ['robes'],
};

const WEAPON1_PREFS_POWER: Record<PcClassType, string[]> = {
  fighter:   ['greatsword', 'greataxe', 'falchion', 'longsword', 'battleaxe', 'warhammer', 'flail', 'morningstar'],
  paladin:   ['longsword', 'warhammer', 'battleaxe', 'morningstar', 'heavy_mace'],
  ranger:    ['longsword', 'shortsword', 'battleaxe', 'handaxe'],
  cleric:    ['heavy_mace', 'morningstar', 'warhammer', 'flail', 'quarterstaff'],
  druid:     ['scimitar', 'spear', 'quarterstaff', 'club', 'shortspear', 'dagger'],
  barbarian: ['greataxe', 'greatsword', 'falchion', 'battleaxe', 'warhammer', 'heavy_mace'],
  rogue:     ['rapier', 'shortsword', 'dagger'],
  bard:      ['rapier', 'longsword', 'shortsword', 'dagger'],
  monk:      ['quarterstaff', 'kama', 'siangham', 'dagger'],
  sorcerer:  ['quarterstaff', 'dagger'],
  wizard:    ['quarterstaff', 'dagger'],
};

// DEX-favoring characters prefer lighter / finesse weapons
const WEAPON1_PREFS_FINESSE: Record<PcClassType, string[]> = {
  fighter:   ['longsword', 'rapier', 'shortsword', 'battleaxe', 'handaxe', 'flail', 'warhammer', 'morningstar'],
  paladin:   ['longsword', 'warhammer', 'battleaxe', 'morningstar', 'heavy_mace'],
  ranger:    ['shortsword', 'longsword', 'rapier', 'handaxe'],
  cleric:    ['heavy_mace', 'morningstar', 'warhammer', 'quarterstaff'],
  druid:     ['scimitar', 'shortspear', 'dagger', 'quarterstaff', 'club'],
  barbarian: ['battleaxe', 'warhammer', 'greataxe', 'flail', 'heavy_mace'],
  rogue:     ['rapier', 'shortsword', 'dagger'],
  bard:      ['rapier', 'shortsword', 'longsword', 'dagger'],
  monk:      ['kama', 'siangham', 'quarterstaff', 'dagger'],
  sorcerer:  ['dagger', 'quarterstaff'],
  wizard:    ['dagger', 'quarterstaff'],
};

const SHIELD_PREFS: Partial<Record<PcClassType, string[]>> = {
  fighter:   ['heavy_steel_shield', 'light_steel_shield', 'heavy_wooden_shield', 'light_wooden_shield', 'buckler'],
  paladin:   ['heavy_steel_shield', 'light_steel_shield', 'light_wooden_shield'],
  cleric:    ['heavy_steel_shield', 'light_steel_shield', 'heavy_wooden_shield'],
  druid:     ['heavy_wooden_shield', 'light_wooden_shield'],
  ranger:    ['light_steel_shield', 'light_wooden_shield', 'buckler'],
  barbarian: ['heavy_steel_shield', 'light_steel_shield'],
};

const WEAPON2_PREFS: Partial<Record<PcClassType, string[]>> = {
  ranger:    ['shortsword', 'handaxe', 'dagger'],
  rogue:     ['dagger'],
  bard:      ['dagger'],
};

const RANGED_PREFS: Partial<Record<PcClassType, string[]>> = {
  ranger:    ['longbow', 'shortbow', 'light_crossbow', 'javelin'],
  fighter:   ['light_crossbow', 'javelin'],
  rogue:     ['light_crossbow'],
  bard:      ['light_crossbow'],
  cleric:    ['light_crossbow', 'javelin'],
  barbarian: ['javelin'],
  paladin:   ['javelin'],
  wizard:    ['light_crossbow'],
  sorcerer:  ['light_crossbow'],
  druid:     ['sling', 'javelin'],
  monk:      ['sling', 'javelin'],
};

const AMMO_FOR_WEAPON: Record<string, string> = {
  shortbow: 'arrows', longbow: 'arrows',
  light_crossbow: 'bolts', heavy_crossbow: 'bolts',
  sling: 'sling_bullets',
  javelin: 'javelins_3',
};

const UTILITY_PREFS: Partial<Record<PcClassType, string[]>> = {
  fighter:   ['potion_clw'],
  paladin:   ['potion_clw', 'holy_water'],
  ranger:    ['antitoxin', 'potion_clw'],
  cleric:    ['potion_clw', 'scroll_clw', 'holy_water'],
  druid:     ['potion_clw', 'antitoxin'],
  barbarian: ['potion_clw', 'antitoxin'],
  rogue:     ['antitoxin', 'potion_clw', 'alchemists_fire'],
  bard:      ['potion_clw', 'alchemists_fire'],
  monk:      ['potion_clw', 'antitoxin'],
  sorcerer:  ['scroll_mage_armor', 'potion_clw'],
  wizard:    ['scroll_mage_armor', 'scroll_clw', 'potion_clw'],
};

const HELMET_PREFS: Partial<Record<PcClassType, string[]>> = {
  fighter:   ['great_helm', 'half_helm', 'open_helm'],
  paladin:   ['great_helm', 'half_helm', 'open_helm'],
  barbarian: ['half_helm', 'open_helm'],
  cleric:    ['half_helm', 'open_helm'],
  ranger:    ['open_helm'],
};

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * Deterministically assign starting equipment to a level-1 character.
 *
 * Priority order: armor → primary weapon → shield/secondary → ranged → ammo
 * → helmet → utility items → cosmetics (cloak, boots). Each step picks the
 * best (most expensive) item that fits within the remaining budget.
 *
 * Power vs finesse: STR-heavy characters (STR ≥ DEX+2) favour two-handed
 * power weapons; others favour lighter or finesse options.
 */
export function assignEquipment(
  pcClass: PcClassType,
  wealth: number,
  abilities: Record<Ability, number>,
): EquipmentSet {
  let budget = wealth;
  const result: EquipmentSet = {};

  const strMod = abilityMod(abilities.strength     ?? 10);
  const dexMod = abilityMod(abilities.dexterity    ?? 10);
  const favorsStrength = strMod >= dexMod + 2;

  // Pick the most expensive affordable item from a preference list.
  function pick(ids: string[]): Equipment | undefined {
    for (const id of ids) {
      const item = EQUIPMENT_CATALOG[id];
      if (item && item.price <= budget) {
        budget -= item.price;
        return item;
      }
    }
    return undefined;
  }

  // 1 ── Armor
  const armor = pick(ARMOR_PREFS[pcClass] ?? ['robes']);
  if (armor) result.armor = armor;

  // 2 ── Primary weapon — reorder for STR-heavy combatants
  const baseW1 = favorsStrength && ['fighter', 'barbarian', 'ranger'].includes(pcClass)
    ? WEAPON1_PREFS_POWER[pcClass]
    : WEAPON1_PREFS_FINESSE[pcClass] ?? WEAPON1_PREFS_POWER[pcClass] ?? ['dagger'];
  const weapon1 = pick(baseW1 ?? ['dagger']);
  if (weapon1) result.weapon1 = weapon1;

  // 3 ── Shield or secondary weapon (skipped when primary is two-handed)
  if (!result.weapon1?.isTwoHanded) {
    const shieldList = SHIELD_PREFS[pcClass];
    const shield = shieldList ? pick(shieldList) : undefined;
    if (shield) {
      result.weapon2 = shield;
    } else {
      const w2List = WEAPON2_PREFS[pcClass];
      const w2 = w2List ? pick(w2List) : undefined;
      if (w2) result.weapon2 = w2;
    }
  }

  // 4 ── Ranged weapon
  const rangedList = RANGED_PREFS[pcClass];
  const ranged = rangedList ? pick(rangedList) : undefined;
  if (ranged) result.weapon3 = ranged;

  // 5 ── Ammunition (matches the ranged weapon type)
  const rangedWeapon = result.weapon3 ?? (result.weapon1?.isRanged ? result.weapon1 : undefined);
  if (rangedWeapon) {
    const ammoId = AMMO_FOR_WEAPON[rangedWeapon.id];
    if (ammoId) {
      const ammo = pick([ammoId]);
      if (ammo) result.ammo = ammo;
    }
  }

  // 6 ── Helmet
  const helmetList = HELMET_PREFS[pcClass];
  const helmet = helmetList ? pick(helmetList) : undefined;
  if (helmet) result.helmet = helmet;

  // 7 ── Utility belt (up to 3 slots, each a distinct item)
  const utilList = UTILITY_PREFS[pcClass] ?? [];
  const usedUtil = new Set<string>();
  const utilSlots: EquipmentSlot[] = ['utility1', 'utility2', 'utility3'];
  let uSlot = 0;
  for (const uid of utilList) {
    if (uSlot >= utilSlots.length) break;
    if (usedUtil.has(uid)) continue;
    const item = EQUIPMENT_CATALOG[uid];
    if (item && item.price <= budget) {
      result[utilSlots[uSlot]] = item;
      budget -= item.price;
      usedUtil.add(uid);
      uSlot++;
    }
  }

  // 8 ── Cosmetics — buy with whatever budget remains
  if (!result.cloak && budget >= EQUIPMENT_CATALOG['travelers_cloak'].price) {
    result.cloak = EQUIPMENT_CATALOG['travelers_cloak'];
    budget -= result.cloak.price;
  }
  if (!result.boots && budget >= EQUIPMENT_CATALOG['boots'].price) {
    result.boots = EQUIPMENT_CATALOG['boots'];
    budget -= result.boots.price;
  }
  if (!result.belt && budget >= EQUIPMENT_CATALOG['belt'].price) {
    result.belt = EQUIPMENT_CATALOG['belt'];
    budget -= result.belt.price;
  }
  if (!result.gloves && ['fighter', 'paladin', 'cleric'].includes(pcClass)) {
    const glov = pick(['gauntlets']);
    if (glov) result.gloves = glov;
  } else if (!result.gloves && budget >= EQUIPMENT_CATALOG['light_gloves'].price) {
    result.gloves = EQUIPMENT_CATALOG['light_gloves'];
    budget -= result.gloves.price;
  }

  return result;
}

// ─── Bonus summary helpers ────────────────────────────────────────────────────

/** One-line summary of all bonuses an item provides, e.g. "+5 AC, +2 Fort". */
export function equipBonusSummary(item: Equipment): string {
  if (item.bonuses.length === 0 && !item.damage) return '—';
  const parts: string[] = [];
  if (item.damage) {
    const crit = formatCrit(item.critRange, item.critMult);
    parts.push(`${item.damage}${crit}`);
  }
  for (const b of item.bonuses) {
    const sign = b.value >= 0 ? '+' : '';
    const label = BONUS_TARGET_LABELS[b.target] ?? b.target;
    parts.push(`${sign}${b.value} ${label}`);
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
  hp: 'HP',
};
