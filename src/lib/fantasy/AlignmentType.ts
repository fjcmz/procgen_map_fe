// Port of es.fjcmz.lib.procgen.fantasy.AlignmentType from procgen-sample.
// Settlement-modifier field/method elided — character generation never reads it.

import type { ProbEntry } from './ProbEnum';

export type AlignmentType =
  | 'lawful_good'
  | 'neutral_good'
  | 'chaotic_good'
  | 'lawful_neutral'
  | 'neutral_neutral'
  | 'chaotic_neutral'
  | 'lawful_evil'
  | 'neutral_evil'
  | 'chaotic_evil';

export const ALIGNMENT_TYPES: readonly AlignmentType[] = [
  'lawful_good',
  'neutral_good',
  'chaotic_good',
  'lawful_neutral',
  'neutral_neutral',
  'chaotic_neutral',
  'lawful_evil',
  'neutral_evil',
  'chaotic_evil',
];

export interface AlignmentSpec extends ProbEntry {
  good: boolean;
  evil: boolean;
  lawful: boolean;
  chaotic: boolean;
  // Bias weights for picking a child alignment given this parent alignment.
  // Indexed in ALIGNMENT_TYPES declaration order.
  adjustAlignment: readonly number[];
}

export const ALIGNMENT_SPECS: Record<AlignmentType, AlignmentSpec> = {
  lawful_good:     { prob: 1, good: true,  evil: false, lawful: true,  chaotic: false, adjustAlignment: [ 1,    0.8,  0.5,  0.7,  0.1, -0.2, -0.8, -0.6, -0.9 ] },
  neutral_good:    { prob: 1, good: true,  evil: false, lawful: false, chaotic: false, adjustAlignment: [ 0.7,  1,    0.7,  0.3,  0.5, -0.1, -0.6, -0.4, -0.7 ] },
  chaotic_good:    { prob: 1, good: true,  evil: false, lawful: false, chaotic: true,  adjustAlignment: [ 0.5,  0.8,  1,    0.3,  0.2,  0.5, -0.8, -0.7, -0.6 ] },
  lawful_neutral:  { prob: 1, good: false, evil: false, lawful: true,  chaotic: false, adjustAlignment: [ 0.5,  0.3, -0.1,  1,    0.4, -0.3,  0.1, -0.3, -0.6 ] },
  neutral_neutral: { prob: 1, good: false, evil: false, lawful: false, chaotic: false, adjustAlignment: [-0.2,  0.4,  0.1,  0.3,  0.5,  0.2,  0.1,  0.2,  0.1 ] },
  chaotic_neutral: { prob: 1, good: false, evil: false, lawful: false, chaotic: true,  adjustAlignment: [-0.4, -0.2,  0.2,  0.1,  0.2,  0.8,  0.2,  0.3,  0.4 ] },
  lawful_evil:     { prob: 1, good: false, evil: true,  lawful: true,  chaotic: false, adjustAlignment: [-0.6, -0.5, -0.4,  0.3,  0.1, -0.2,  0.8,  0.6,  0.2 ] },
  neutral_evil:    { prob: 1, good: false, evil: true,  lawful: false, chaotic: false, adjustAlignment: [-0.7, -0.8, -0.7,  0.2,  0.2,  0.2,  0.6,  0.9,  0.5 ] },
  chaotic_evil:    { prob: 1, good: false, evil: true,  lawful: false, chaotic: true,  adjustAlignment: [-0.8, -0.7, -0.7, -0.1,  0.1,  0.3,  0.4,  0.7,  0.8 ] },
};

export function isLawNeutral(a: AlignmentType): boolean {
  const s = ALIGNMENT_SPECS[a];
  return !s.lawful && !s.chaotic;
}

export function isGoodNeutral(a: AlignmentType): boolean {
  const s = ALIGNMENT_SPECS[a];
  return !s.good && !s.evil;
}

export function isTrueNeutral(a: AlignmentType): boolean {
  return isLawNeutral(a) && isGoodNeutral(a);
}

// Java's static `compatible` map: which alignments coexist with this one.
export const ALIGNMENT_COMPATIBLE: Record<AlignmentType, ReadonlySet<AlignmentType>> = {
  lawful_good:     new Set(['lawful_good', 'neutral_good', 'lawful_neutral']),
  neutral_good:    new Set(['lawful_good', 'neutral_good', 'chaotic_good', 'neutral_neutral']),
  chaotic_good:    new Set(['neutral_good', 'chaotic_good', 'chaotic_neutral']),
  lawful_neutral:  new Set(['lawful_good', 'lawful_neutral', 'lawful_evil', 'neutral_neutral']),
  neutral_neutral: new Set(['neutral_good', 'lawful_neutral', 'neutral_neutral', 'chaotic_neutral', 'neutral_evil']),
  chaotic_neutral: new Set(['chaotic_good', 'neutral_neutral', 'chaotic_neutral', 'chaotic_evil']),
  lawful_evil:     new Set(['lawful_neutral', 'lawful_evil', 'neutral_evil']),
  neutral_evil:    new Set(['neutral_neutral', 'lawful_evil', 'neutral_evil', 'chaotic_evil']),
  chaotic_evil:    new Set(['chaotic_neutral', 'neutral_evil', 'chaotic_evil']),
};
