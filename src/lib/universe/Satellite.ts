import { IdUtil } from '../history/IdUtil';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type SatelliteComposition = 'ICE' | 'ROCK';

export class Satellite {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  radius: number = 0;
  composition: SatelliteComposition = 'ROCK';
  // Transient
  planetId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('satellite', rngHex(rng)) ?? 'satellite_unknown';
  }
}
