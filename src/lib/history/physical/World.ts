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
  /**
   * Refcounted claim index: cellIndex → number of USABLE cities currently
   * holding that cell in `ownedCells`. Maintained by `claims.ts` at every
   * claim / founding / ruin site; read (`.has`) by YearGenerator steps
   * 4c / 4c-sea instead of rebuilding a claimed-cells map every year.
   */
  usableClaimRefs: Map<number, number> = new Map();
  /**
   * Founding cell index of every city ever created (usable or not).
   * Maintained by `CityGenerator.generate`; read by CitySettlement instead of
   * rebuilding the set from `mapCities` every year.
   */
  allCityCells: Set<number> = new Set();
  /**
   * Per-region claim epoch, bumped whenever a ruin releases owned cells in
   * that region (see `claims.ts::releaseUsableCityClaims`). Cities cache
   * "my land frontier was empty at epoch E" and skip the frontier rebuild in
   * YearGenerator step 4c until the epoch moves — claims are monotonic within
   * an epoch, so an empty frontier can only stay empty.
   */
  regionClaimEpoch: Map<string, number> = new Map();
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
