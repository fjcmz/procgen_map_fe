// D&D 3.5e NPC classes — bulk population layer alongside the PC roster.
//
// NPC classes carry only `class` + `level` + `place` once aggregated. They
// are NOT rolled as full `PcChar` instances; this file exists to keep the
// class enum, fixed weights, and associated metadata next to the PC class
// table for symmetry and future extensibility.

import type { ProbEntry } from './ProbEnum';
import type { Ability } from './Ability';

export type NpcClassType =
  | 'warrior'
  | 'expert'
  | 'aristocrat'
  | 'adept';

export const NPC_CLASS_TYPES: readonly NpcClassType[] = [
  'warrior', 'expert', 'aristocrat', 'adept',
];

export interface NpcClassSpec extends ProbEntry {
  hitDie: number;
  mainAbility: Ability;
}

// Fixed weights — warriors and experts make up the bulk of any settlement
// (militia, guards, artisans, scribes); adepts are uncommon village healers
// and minor casters; aristocrats are scarce nobility / officials. The
// `prob` numbers mirror the PC table convention (small integers; pick is
// weighted-random).
export const NPC_CLASS_SPECS: Record<NpcClassType, NpcClassSpec> = {
  warrior:    { prob: 40, hitDie: 8, mainAbility: 'strength'  },
  expert:     { prob: 40, hitDie: 6, mainAbility: 'intelligence' },
  adept:      { prob: 15, hitDie: 6, mainAbility: 'wisdom'    },
  aristocrat: { prob: 5,  hitDie: 8, mainAbility: 'charisma'  },
};
