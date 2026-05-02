import { IdUtil } from '../history/IdUtil';
import type { PlanetBiome } from './Planet';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type SatelliteComposition = 'ICE' | 'ROCK';

/**
 * Compositional subtype — finer-grained than `SatelliteComposition` and drives
 * the satellite's visual palette. Each subtype belongs to exactly one
 * `SatelliteComposition`; mismatches are forbidden by `SATELLITE_SUBTYPE_COMPOSITION`.
 */
export type IceSatelliteSubtype =
  | 'water_ice' | 'methane_ice' | 'sulfur_ice' | 'nitrogen_ice' | 'dirty_ice';
export type RockSatelliteSubtype =
  | 'terrestrial' | 'cratered' | 'volcanic' | 'iron_rich' | 'desert_moon';
export type SatelliteSubtype = IceSatelliteSubtype | RockSatelliteSubtype;

export const SATELLITE_SUBTYPE_COMPOSITION: Record<SatelliteSubtype, SatelliteComposition> = {
  water_ice: 'ICE', methane_ice: 'ICE', sulfur_ice: 'ICE', nitrogen_ice: 'ICE', dirty_ice: 'ICE',
  terrestrial: 'ROCK', cratered: 'ROCK', volcanic: 'ROCK', iron_rich: 'ROCK', desert_moon: 'ROCK',
};

export class Satellite {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  radius: number = 0;
  composition: SatelliteComposition = 'ROCK';
  subtype: SatelliteSubtype = 'terrestrial';
  life: boolean = false;
  biome?: PlanetBiome;
  // Transient
  planetId: string = '';

  constructor(rng: () => number) {
    this.id = IdUtil.id('satellite', rngHex(rng)) ?? 'satellite_unknown';
  }
}
