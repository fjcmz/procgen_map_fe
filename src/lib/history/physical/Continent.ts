import { IdUtil } from '../IdUtil';
import type { Region } from './Region';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Continent {
  readonly id: string;
  regions: Region[] = [];
  // Transient
  worldId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('continent', rngHex(rng)) ?? 'continent_unknown';
  }
}
