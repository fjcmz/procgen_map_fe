import { IdUtil } from '../history/IdUtil';
import type { Star } from './Star';
import type { Planet } from './Planet';
import type { SystemKind } from './SystemKind';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type SolarSystemComposition = 'ROCK' | 'GAS';

export class SolarSystem {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  composition: SolarSystemComposition = 'ROCK';
  /** Taxonomic kind — drives star count, planet gating, and renderer style. */
  kind: SystemKind = 'main_sequence';
  stars: Star[] = [];
  planets: Planet[] = [];
  sectorId: string = '';
  // Transient
  universeId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('solarSystem', rngHex(rng)) ?? 'solarSystem_unknown';
  }
}
