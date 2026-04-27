// Port of es.fjcmz.lib.procgen.fantasy.Ability from procgen-sample.

import type { ProbEntry } from './ProbEnum';

export type Ability =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export const ABILITIES: readonly Ability[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export const MENTAL: ReadonlySet<Ability> = new Set(['intelligence', 'wisdom', 'charisma']);
export const PHYSICAL: ReadonlySet<Ability> = new Set(['strength', 'dexterity', 'constitution']);

// All abilities have equal default probability (Java's ProbEnum default).
export const ABILITY_SPECS: Record<Ability, ProbEntry> = {
  strength: { prob: 1 },
  dexterity: { prob: 1 },
  constitution: { prob: 1 },
  intelligence: { prob: 1 },
  wisdom: { prob: 1 },
  charisma: { prob: 1 },
};

// Java: (value/2) - 5
export function abilityMod(value: number): number {
  return Math.floor(value / 2) - 5;
}
