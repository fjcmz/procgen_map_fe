// Port of es.fjcmz.lib.procgen.fantasy.PcClassType from procgen-sample.

import type { ProbEntry } from './ProbEnum';
import type { Ability } from './Ability';
import type { AlignmentType } from './AlignmentType';
import { ALIGNMENT_SPECS, isLawNeutral, isGoodNeutral } from './AlignmentType';
import type { JobMaturityType } from './JobMaturityType';

export type PcClassType =
  | 'barbarian'
  | 'bard'
  | 'cleric'
  | 'druid'
  | 'fighter'
  | 'monk'
  | 'paladin'
  | 'ranger'
  | 'rogue'
  | 'sorcerer'
  | 'wizard';

export const PC_CLASS_TYPES: readonly PcClassType[] = [
  'barbarian', 'bard', 'cleric', 'druid', 'fighter',
  'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'wizard',
];

export interface PcClassSpec extends ProbEntry {
  jobMaturityType: JobMaturityType;
  hitDie: number;
  allowedAlignment: (a: AlignmentType) => boolean;
  mainAbility: Ability;
  mainAbilities: ReadonlySet<Ability>;
  needsDeity: boolean;
}

export const PC_CLASS_SPECS: Record<PcClassType, PcClassSpec> = {
  barbarian: {
    prob: 3, jobMaturityType: 'intuitive', hitDie: 12,
    allowedAlignment: a => ALIGNMENT_SPECS[a].chaotic,
    mainAbility: 'strength',
    mainAbilities: new Set(['strength', 'constitution']),
    needsDeity: false,
  },
  bard: {
    prob: 3, jobMaturityType: 'self_taught', hitDie: 8,
    allowedAlignment: () => true,
    mainAbility: 'charisma',
    mainAbilities: new Set(['charisma']),
    needsDeity: false,
  },
  cleric: {
    prob: 4, jobMaturityType: 'trained', hitDie: 8,
    allowedAlignment: () => true,
    mainAbility: 'wisdom',
    mainAbilities: new Set(['wisdom']),
    needsDeity: true,
  },
  druid: {
    prob: 2, jobMaturityType: 'trained', hitDie: 8,
    allowedAlignment: a => isGoodNeutral(a) || isLawNeutral(a),
    mainAbility: 'wisdom',
    mainAbilities: new Set(['wisdom']),
    needsDeity: true,
  },
  fighter: {
    prob: 5, jobMaturityType: 'self_taught', hitDie: 10,
    allowedAlignment: () => true,
    mainAbility: 'strength',
    mainAbilities: new Set(['strength', 'constitution']),
    needsDeity: false,
  },
  monk: {
    prob: 4, jobMaturityType: 'trained', hitDie: 8,
    allowedAlignment: a => ALIGNMENT_SPECS[a].lawful,
    mainAbility: 'wisdom',
    mainAbilities: new Set(['wisdom', 'constitution', 'dexterity', 'strength']),
    needsDeity: false,
  },
  paladin: {
    prob: 2, jobMaturityType: 'self_taught', hitDie: 10,
    allowedAlignment: a => ALIGNMENT_SPECS[a].good && ALIGNMENT_SPECS[a].lawful,
    mainAbility: 'charisma',
    mainAbilities: new Set(['charisma', 'constitution', 'strength']),
    needsDeity: true,
  },
  ranger: {
    prob: 3, jobMaturityType: 'self_taught', hitDie: 10,
    allowedAlignment: () => true,
    mainAbility: 'dexterity',
    mainAbilities: new Set(['dexterity', 'constitution', 'wisdom']),
    needsDeity: true,
  },
  rogue: {
    prob: 4, jobMaturityType: 'intuitive', hitDie: 8,
    allowedAlignment: () => true,
    mainAbility: 'dexterity',
    mainAbilities: new Set(['dexterity']),
    needsDeity: false,
  },
  sorcerer: {
    prob: 3, jobMaturityType: 'intuitive', hitDie: 6,
    allowedAlignment: () => true,
    mainAbility: 'charisma',
    mainAbilities: new Set(['charisma']),
    needsDeity: false,
  },
  wizard: {
    prob: 3, jobMaturityType: 'trained', hitDie: 6,
    allowedAlignment: () => true,
    mainAbility: 'intelligence',
    mainAbilities: new Set(['intelligence']),
    needsDeity: false,
  },
};

// Java's static `abilityToClass` map: lazily computed by reverse-indexing
// PC_CLASS_SPECS by mainAbility, mirroring the Java static initializer.
const ABILITY_TO_CLASS: Map<Ability, PcClassType[]> = (() => {
  const map = new Map<Ability, PcClassType[]>();
  for (const c of PC_CLASS_TYPES) {
    const ab = PC_CLASS_SPECS[c].mainAbility;
    let list = map.get(ab);
    if (!list) {
      list = [];
      map.set(ab, list);
    }
    list.push(c);
  }
  return map;
})();

export function getClassesForMainAbility(ability: Ability): PcClassType[] | undefined {
  return ABILITY_TO_CLASS.get(ability);
}
