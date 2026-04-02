import { IdUtil } from '../IdUtil';
import type { HistoryRoot } from '../HistoryRoot';
import type { Year } from './Year';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Timeline {
  readonly id: string;
  startOfTime: number = 0;
  years: Year[] = [];
  // Transient
  history!: HistoryRoot;

  constructor(rng: () => number) {
    this.id = IdUtil.id('timeline', rngHex(rng)) ?? 'timeline_unknown';
  }
}
