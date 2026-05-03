import { IdUtil } from '../history/IdUtil';
import type { PlanetBiome } from './Planet';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type SatelliteComposition = 'ICE' | 'ROCK';

/**
 * Compositional subtype — now data-driven via `lib/extensions`. The type
 * aliases are `string` at runtime; loaded extension packs can add subtypes.
 */
export type SatelliteSubtype = string;
export type IceSatelliteSubtype = string;
export type RockSatelliteSubtype = string;

/**
 * @deprecated Use `extensionRegistry.getUniverseCatalogue().satellite.composition`
 * for runtime lookup. Retained for back-compat with the historical built-in
 * 10-subtype set; loaded extension packs are NOT reflected here.
 */
export const SATELLITE_SUBTYPE_COMPOSITION: Record<string, SatelliteComposition> = {
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
