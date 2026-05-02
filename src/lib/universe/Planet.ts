import { IdUtil } from '../history/IdUtil';
import type { Satellite } from './Satellite';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type PlanetComposition = 'GAS' | 'ROCK';

/**
 * Compositional subtype — finer-grained than `PlanetComposition` and drives
 * the planet's visual palette / texture. Each subtype belongs to exactly one
 * `PlanetComposition`; mismatches are forbidden by `PLANET_SUBTYPE_COMPOSITION`.
 */
export type RockPlanetSubtype =
  | 'terrestrial' | 'desert' | 'volcanic' | 'lava' | 'iron'
  | 'carbon' | 'ocean' | 'ice_rock';
export type GasPlanetSubtype =
  | 'jovian' | 'hot_jupiter' | 'ice_giant' | 'methane_giant' | 'ammonia_giant';
export type PlanetSubtype = RockPlanetSubtype | GasPlanetSubtype;

export const PLANET_SUBTYPE_COMPOSITION: Record<PlanetSubtype, PlanetComposition> = {
  terrestrial: 'ROCK', desert: 'ROCK', volcanic: 'ROCK', lava: 'ROCK', iron: 'ROCK',
  carbon: 'ROCK', ocean: 'ROCK', ice_rock: 'ROCK',
  jovian: 'GAS', hot_jupiter: 'GAS', ice_giant: 'GAS', methane_giant: 'GAS', ammonia_giant: 'GAS',
};

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
  subtype: PlanetSubtype = 'terrestrial';
  biome?: PlanetBiome;
  satellites: Satellite[] = [];
  // Transient
  solarSystemId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('planet', rngHex(rng)) ?? 'planet_unknown';
  }
}
