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
 * the planet's visual palette / texture. The set of subtypes is now data-
 * driven via `lib/extensions` so loaded packs can add new entries; the type
 * is `string` at runtime. The four name aliases below preserve back-compat
 * for code that imported them as type-level documentation.
 */
export type PlanetSubtype = string;
export type RockPlanetSubtype = string;
export type GasPlanetSubtype = string;

/**
 * @deprecated Use `extensionRegistry.getUniverseCatalogue().planet.composition`
 * for runtime lookup. Retained for back-compat with the historical built-in
 * 13-subtype set; loaded extension packs are NOT reflected here.
 */
export const PLANET_SUBTYPE_COMPOSITION: Record<string, PlanetComposition> = {
  terrestrial: 'ROCK', desert: 'ROCK', volcanic: 'ROCK', lava: 'ROCK', iron: 'ROCK',
  carbon: 'ROCK', ocean: 'ROCK', ice_rock: 'ROCK',
  jovian: 'GAS', hot_jupiter: 'GAS', ice_giant: 'GAS', methane_giant: 'GAS', ammonia_giant: 'GAS',
};

/**
 * Terrain profile biome — only assigned to ROCK planets/satellites with life.
 * Now `string` at runtime so packs can add biomes; the historical 7-biome set
 * is still the default.
 */
export type PlanetBiome = string;

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
