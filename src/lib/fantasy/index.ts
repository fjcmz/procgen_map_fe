// Barrel re-export for the fantasy character-generation port.
// Mirrors the convention used by src/lib/history/physical/index.ts.
//
// Initial conversion of the `fantasy` package from
// https://github.com/fjcmz/procgen-sample (Java, master @ 7cfaf5f).
// Only the player-character subset is ported; settlements / countries / root /
// the JSON config are intentionally out of scope.

export type { Rollable } from './Rollable';
export { roll } from './Rollable';

export type { ProbEntry } from './ProbEnum';
export { probPick, probPickAdjusted, pickRandom } from './ProbEnum';

export type { Ability } from './Ability';
export { ABILITIES, MENTAL, PHYSICAL, ABILITY_SPECS, abilityMod } from './Ability';

export type { JobMaturityType } from './JobMaturityType';
export { JOB_MATURITY_TYPES } from './JobMaturityType';

export type { AlignmentType, AlignmentSpec } from './AlignmentType';
export {
  ALIGNMENT_TYPES,
  ALIGNMENT_SPECS,
  ALIGNMENT_COMPATIBLE,
  isLawNeutral,
  isGoodNeutral,
  isTrueNeutral,
} from './AlignmentType';

export type { Deity, DeitySpec } from './Deity';
export { DEITIES, DEITY_SPECS, deityAllowsRace, deityAllowsAlignment } from './Deity';

export type { RaceType, RaceSpec } from './RaceType';
export { RACE_TYPES, RACE_SPECS, getAdjustAbilities } from './RaceType';

export type { PcClassType, PcClassSpec } from './PcClassType';
export { PC_CLASS_TYPES, PC_CLASS_SPECS, getClassesForMainAbility } from './PcClassType';

export type { PcCharAge } from './PcChar';
export { PcChar } from './PcChar';

export type { PcCharBiasOptions } from './PcCharGenerator';
export { PcCharGenerator, pcCharGenerator, generatePcChar, generatePcCharBiased } from './PcCharGenerator';

export type {
  ClassLevel,
  BonusType,
  BonusComponent,
  DerivedStat,
  Saves,
  CombatStats,
  BabRate,
  SaveQuality,
  SaveProfile,
} from './Combat';
export {
  BAB_RATE_BY_CLASS,
  SAVE_PROFILE_BY_CLASS,
  babForClass,
  goodSaveBase,
  poorSaveBase,
  computeBAB,
  computeAC,
  computeSaves,
  computeCombatStats,
} from './Combat';

export type {
  EquipmentSlot,
  BonusTarget,
  EquipBonus,
  Equipment,
  EquipmentSet,
} from './Equipment';
export {
  SLOT_LABELS,
  SLOT_GROUPS,
  EQUIPMENT_CATALOG,
  assignEquipment,
  equipBonusSummary,
  formatCrit,
} from './Equipment';

export type { Spell, SpellSchool } from './Spell';
export { SPELL_SCHOOLS, LEVEL_1_SPELLS, ALL_SPELLS, spellsForClassAndLevel } from './Spell';

export type { CharacterSpellcasting, SpellcastingClassInfo } from './Spellcasting';
export {
  SPELLCASTING_CLASSES,
  bonusSpellsForLevel,
  maxSpellLevelForAbility,
  rollCharacterSpellcasting,
} from './Spellcasting';
