// Port of es.fjcmz.lib.procgen.fantasy.PcChar from procgen-sample.
// Inner Java class `Age` is exported as a sibling interface PcCharAge.

import type { Ability } from './Ability';
import type { AlignmentType } from './AlignmentType';
import type { RaceType } from './RaceType';
import type { PcClassType } from './PcClassType';

export interface PcCharAge {
  currentAge: number;
  middleAge: number;
  oldAge: number;
  venerableAge: number;
  maxAge: number;
}

export class PcChar {
  abilities: Map<Ability, number> = new Map();
  alignment!: AlignmentType;
  race!: RaceType;
  pcClass!: PcClassType;
  level = 0;
  hitPoints = 0;
  deity: string = 'none';
  height = 0;
  weight = 0;
  wealth = 0;
  age!: PcCharAge;
}
