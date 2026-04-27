import { IdUtil } from '../IdUtil';
import type { Continent } from './Continent';
import type { Region } from './Region';
import type { CityEntity } from './CityEntity';
import type { CountryEvent } from '../timeline/Country';
import type { Illustrate } from '../timeline/Illustrate';
import type { Wonder } from '../timeline/Wonder';
import type { Religion } from '../timeline/Religion';
import type { War } from '../timeline/War';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class World {
  readonly id: string;
  /**
   * Worker seed string, captured by `WorldGenerator` so simulation generators
   * (e.g. CountryGenerator's race bias, ReligionGenerator's deity binding) can
   * derive isolated PRNG sub-streams via `seededPRNG(`${seed}_<role>_<id>`)`
   * without perturbing the main timeline RNG. Empty string when the harness
   * doesn't supply one (sweep / standalone tests) — sub-stream draws are then
   * still deterministic, just keyed off the empty-string root.
   */
  readonly seed: string;
  continents: Continent[] = [];
  endedOn: number = 0;
  endedBy: string = '';
  // Geography indexes
  mapContinents: Map<string, Continent> = new Map();
  mapRegions: Map<string, Region> = new Map();
  // Civilization indexes (populated during timeline simulation)
  mapCountries: Map<string, CountryEvent> = new Map();
  mapCities: Map<string, CityEntity> = new Map();
  mapUsableCities: Map<string, CityEntity> = new Map();
  mapUncontactedCities: Map<string, CityEntity> = new Map();
  // Cultural/event indexes (populated during timeline simulation)
  mapIllustrates: Map<string, Illustrate> = new Map();
  mapUsableIllustrates: Map<string, Illustrate> = new Map();
  mapWonders: Map<string, Wonder> = new Map();
  mapUsableWonders: Map<string, Wonder> = new Map();
  mapReligions: Map<string, Religion> = new Map();
  mapWars: Map<string, War> = new Map();
  mapAliveWars: Map<string, War> = new Map();
  /** Countries removed from mapCountries by dissolution (all cities ruined). */
  mapDeadCountries: Map<string, CountryEvent> = new Map();
  /** Global dedup set for wonder names — prevents duplicate names within a generation. */
  usedWonderNames: Set<string> = new Set();
  /** Global dedup set for illustrate names — prevents duplicate names within a generation. */
  usedIllustrateNames: Set<string> = new Set();

  constructor(rng: () => number, seed: string = '') {
    this.id = IdUtil.id('world', rngHex(rng)) ?? 'world_unknown';
    this.seed = seed;
  }

  addContinent(continent: Continent): void {
    this.continents.push(continent);
    // worldId and mapContinents are set by ContinentGenerator.
    // mapRegions is set by RegionGenerator. mapCities is set by CityGenerator.
  }
}
