import { IdUtil } from '../history/IdUtil';
import type { Satellite } from './Satellite';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type PlanetComposition = 'GAS' | 'ROCK';

/** Terrain profile subtypes — only assigned to ROCK planets/satellites with life. */
export type PlanetBiome = 'default' | 'desert' | 'ice' | 'forest' | 'swamp' | 'mountains' | 'ocean';

export class Planet {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  radius: number = 0;
  orbit: number = 0;
  life: boolean = false;
  composition: PlanetComposition = 'ROCK';
  biome?: PlanetBiome;
  satellites: Satellite[] = [];
  // Transient
  solarSystemId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('planet', rngHex(rng)) ?? 'planet_unknown';
  }
}
