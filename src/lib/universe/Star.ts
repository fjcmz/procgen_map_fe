import { IdUtil } from '../history/IdUtil';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type StarComposition = 'MATTER' | 'ANTIMATTER';

export class Star {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  radius: number = 0;
  brightness: number = 0;
  composition: StarComposition = 'MATTER';
  // Transient
  solarSystemId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('star', rngHex(rng)) ?? 'star_unknown';
  }
}
