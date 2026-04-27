// Port of es.fjcmz.lib.procgen.fantasy.Deity from procgen-sample.

import type { ProbEntry } from './ProbEnum';
import type { AlignmentType } from './AlignmentType';
import { ALIGNMENT_COMPATIBLE } from './AlignmentType';
import type { RaceType } from './RaceType';

export type Deity =
  | 'boccob'
  | 'corellon_larethian'
  | 'garl_glittergold'
  | 'gruumsh'
  | 'lolth'
  | 'moradin'
  | 'nerull'
  | 'pelor'
  | 'yondalla'
  | 'ehlona'
  | 'erythnul'
  | 'fharlangh'
  | 'heironeous'
  | 'hextor'
  | 'kord'
  | 'obad_hai'
  | 'olidammara'
  | 'saint_cuthert'
  | 'wee_jas'
  | 'vecna';

export const DEITIES: readonly Deity[] = [
  'boccob', 'corellon_larethian', 'garl_glittergold', 'gruumsh', 'lolth',
  'moradin', 'nerull', 'pelor', 'yondalla',
  'ehlona', 'erythnul', 'fharlangh', 'heironeous', 'hextor', 'kord',
  'obad_hai', 'olidammara', 'saint_cuthert', 'wee_jas',
  'vecna',
];

export interface DeitySpec extends ProbEntry {
  name: string;
  alignment: AlignmentType;
  race: RaceType | null;
}

export const DEITY_SPECS: Record<Deity, DeitySpec> = {
  boccob:             { prob: 9, name: 'Boccob',             alignment: 'neutral_neutral', race: null },
  corellon_larethian: { prob: 9, name: 'Corellon Larethian', alignment: 'chaotic_good',    race: 'elf' },
  garl_glittergold:   { prob: 9, name: 'Garl Glitttergold',  alignment: 'neutral_good',    race: 'gnome' },
  gruumsh:            { prob: 9, name: 'Gruumsh',            alignment: 'chaotic_evil',    race: 'orc' },
  lolth:              { prob: 9, name: 'Lolth',              alignment: 'chaotic_evil',    race: 'elf' },
  moradin:            { prob: 9, name: 'Moradin',            alignment: 'lawful_good',     race: 'dwarf' },
  nerull:             { prob: 9, name: 'Nerull',             alignment: 'neutral_evil',    race: null },
  pelor:              { prob: 9, name: 'Pelor',              alignment: 'neutral_good',    race: null },
  yondalla:           { prob: 9, name: 'Yondalla',           alignment: 'lawful_good',     race: 'halfling' },
  ehlona:             { prob: 9, name: 'Ehlona',             alignment: 'neutral_good',    race: 'elf' },
  erythnul:           { prob: 9, name: 'Erythnul',           alignment: 'chaotic_evil',    race: null },
  fharlangh:          { prob: 9, name: 'Fharlangh',          alignment: 'neutral_neutral', race: null },
  heironeous:         { prob: 9, name: 'Heironeous',         alignment: 'lawful_good',     race: null },
  hextor:             { prob: 9, name: 'Hextor',             alignment: 'lawful_evil',     race: null },
  kord:               { prob: 9, name: 'Kord',               alignment: 'chaotic_good',    race: null },
  obad_hai:           { prob: 9, name: 'Obad-Hai',           alignment: 'neutral_neutral', race: null },
  olidammara:         { prob: 9, name: 'Olidammara',         alignment: 'chaotic_good',    race: null },
  saint_cuthert:      { prob: 9, name: 'Sain Cuthbert',      alignment: 'lawful_neutral',  race: null },
  wee_jas:            { prob: 9, name: 'Wee Jas',            alignment: 'lawful_neutral',  race: null },
  vecna:              { prob: 3, name: 'Vecna',              alignment: 'neutral_evil',    race: null },
};

export function deityAllowsRace(d: Deity, race: RaceType): boolean {
  const r = DEITY_SPECS[d].race;
  return r === null || r === race;
}

export function deityAllowsAlignment(d: Deity, alignment: AlignmentType): boolean {
  return ALIGNMENT_COMPATIBLE[DEITY_SPECS[d].alignment].has(alignment);
}
