// Port of es.fjcmz.lib.procgen.fantasy.RaceType from procgen-sample.

import type { ProbEntry } from './ProbEnum';
import { probPick } from './ProbEnum';
import type { Ability } from './Ability';
import { ABILITY_SPECS, ABILITIES } from './Ability';
import type { JobMaturityType } from './JobMaturityType';
import type { Rollable } from './Rollable';
import { roll } from './Rollable';

export type RaceType =
  | 'dwarf'
  | 'elf'
  | 'gnome'
  | 'half_elf'
  | 'half_orc'
  | 'halfling'
  | 'human'
  | 'orc';

export const RACE_TYPES: readonly RaceType[] = [
  'dwarf', 'elf', 'gnome', 'half_elf', 'half_orc', 'halfling', 'human', 'orc',
];

export interface RaceSpec extends ProbEntry {
  // Static ability adjustments (humanoid races with no fixed bonuses leave this empty —
  // generator picks a random ability for those at roll time via getAdjustAbilities).
  adjustAbilities: Partial<Record<Ability, number>>;
  baseAge: number;
  middleAge: Rollable;
  oldAge: Rollable;
  venerableAge: Rollable;
  maxAge: Rollable;
  ageAdjustement: Record<JobMaturityType, Rollable>;
  baseHeight: number;
  heightAdjustment: Rollable;
  baseWeight: number;
  weightAdjustment: Rollable;
}

export const RACE_SPECS: Record<RaceType, RaceSpec> = {
  dwarf: {
    prob: 4,
    adjustAbilities: { constitution: 2 },
    baseAge: 40,
    middleAge: roll(6, 4).add(111),
    oldAge: roll(4, 10).add(169),
    venerableAge: roll(4, 10).add(230),
    maxAge: roll(2, 100).add(270),
    ageAdjustement: { intuitive: roll(3, 6), self_taught: roll(5, 6), trained: roll(7, 6) },
    baseHeight: 45,
    heightAdjustment: roll(2, 4),
    baseWeight: 150,
    weightAdjustment: roll(2, 4).mult(7),
  },
  elf: {
    prob: 4,
    adjustAbilities: { dexterity: 2 },
    baseAge: 110,
    middleAge: roll(6, 4).add(164),
    oldAge: roll(4, 10).add(242),
    venerableAge: roll(4, 10).add(330),
    maxAge: roll(4, 100).add(370),
    ageAdjustement: { intuitive: roll(4, 6), self_taught: roll(6, 6), trained: roll(10, 6) },
    baseHeight: 64,
    heightAdjustment: roll(2, 8),
    baseWeight: 110,
    weightAdjustment: roll(2, 8).mult(3),
  },
  gnome: {
    prob: 1,
    adjustAbilities: { constitution: 2 },
    baseAge: 40,
    middleAge: roll(6, 4).add(89),
    oldAge: roll(4, 10).add(129),
    venerableAge: roll(4, 10).add(179),
    maxAge: roll(3, 100).add(220),
    ageAdjustement: { intuitive: roll(4, 6), self_taught: roll(4, 6), trained: roll(4, 6) },
    baseHeight: 36,
    heightAdjustment: roll(2, 4),
    baseWeight: 35,
    weightAdjustment: roll(2, 4),
  },
  half_elf: {
    prob: 3,
    adjustAbilities: {},
    baseAge: 20,
    middleAge: roll(6, 4).add(53),
    oldAge: roll(4, 10).add(72),
    venerableAge: roll(4, 10).add(104),
    maxAge: roll(3, 20).add(144),
    ageAdjustement: { intuitive: roll(1, 6), self_taught: roll(2, 6), trained: roll(3, 6) },
    baseHeight: 62,
    heightAdjustment: roll(2, 8),
    baseWeight: 100,
    weightAdjustment: roll(2, 8).mult(5),
  },
  half_orc: {
    prob: 3,
    adjustAbilities: {},
    baseAge: 12,
    middleAge: roll(3, 4).add(24),
    oldAge: roll(2, 10).add(35),
    venerableAge: roll(2, 10).add(50),
    maxAge: roll(2, 10).add(70),
    ageAdjustement: { intuitive: roll(1, 4), self_taught: roll(1, 6), trained: roll(2, 6) },
    baseHeight: 58,
    heightAdjustment: roll(2, 12),
    baseWeight: 150,
    weightAdjustment: roll(2, 12).mult(7),
  },
  halfling: {
    prob: 2,
    adjustAbilities: { charisma: 2, dexterity: 2, strength: -2 },
    baseAge: 20,
    middleAge: roll(5, 4).add(40),
    oldAge: roll(4, 6).add(60),
    venerableAge: roll(2, 10).add(90),
    maxAge: roll(5, 20).add(120),
    ageAdjustement: { intuitive: roll(2, 4), self_taught: roll(3, 6), trained: roll(4, 6) },
    baseHeight: 32,
    heightAdjustment: roll(2, 4),
    baseWeight: 30,
    weightAdjustment: roll(2, 4),
  },
  human: {
    prob: 5,
    adjustAbilities: {},
    baseAge: 15,
    middleAge: roll(3, 6).add(25),
    oldAge: roll(3, 8).add(35),
    venerableAge: roll(4, 6).add(56),
    maxAge: roll(2, 20).add(80),
    ageAdjustement: { intuitive: roll(1, 4), self_taught: roll(1, 6), trained: roll(2, 6) },
    baseHeight: 58,
    heightAdjustment: roll(2, 10),
    baseWeight: 120,
    weightAdjustment: roll(2, 10).mult(5),
  },
  orc: {
    prob: 0.1,
    adjustAbilities: { strength: 4, intelligence: -2, wisdom: -2, charisma: -2 },
    baseAge: 15,
    middleAge: roll(3, 6).add(25),
    oldAge: roll(3, 8).add(35),
    venerableAge: roll(4, 6).add(56),
    maxAge: roll(2, 20).add(80),
    ageAdjustement: { intuitive: roll(1, 4), self_taught: roll(1, 6), trained: roll(2, 6) },
    baseHeight: 58,
    heightAdjustment: roll(2, 10),
    baseWeight: 120,
    weightAdjustment: roll(2, 10).mult(5),
  },
};

// human / half_elf / half_orc have no fixed adjustment — they roll a random
// ability and award +2 to it. Other races return their static map.
export function getAdjustAbilities(race: RaceType, rng: () => number): Partial<Record<Ability, number>> {
  if (race === 'human' || race === 'half_elf' || race === 'half_orc') {
    const picked = probPick(ABILITY_SPECS, ABILITIES, rng);
    return { [picked]: 2 };
  }
  return RACE_SPECS[race].adjustAbilities;
}
