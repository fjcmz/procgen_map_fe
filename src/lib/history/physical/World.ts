import { IdUtil } from '../IdUtil';
import type { Continent } from './Continent';
import type { Region } from './Region';
import type { CityEntity } from './CityEntity';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class World {
  readonly id: string;
  continents: Continent[] = [];
  endedOn: number = 0;
  endedBy: string = '';
  // Geography indexes
  mapContinents: Map<string, Continent> = new Map();
  mapRegions: Map<string, Region> = new Map();
  // Civilization indexes (populated during history simulation)
  mapCountries: Map<string, unknown> = new Map();
  mapCities: Map<string, CityEntity> = new Map();
  mapUsableCities: Map<string, CityEntity> = new Map();
  mapUncontactedCities: Map<string, CityEntity> = new Map();
  // Cultural/event indexes (populated during timeline simulation)
  mapIllustrates: Map<string, unknown> = new Map();
  mapUsableIllustrates: Map<string, unknown> = new Map();
  mapWonders: Map<string, unknown> = new Map();
  mapUsableWonders: Map<string, unknown> = new Map();
  mapReligions: Map<string, unknown> = new Map();
  mapWars: Map<string, unknown> = new Map();
  mapAliveWars: Map<string, unknown> = new Map();

  constructor(rng: () => number) {
    this.id = IdUtil.id('world', rngHex(rng)) ?? 'world_unknown';
  }

  addContinent(continent: Continent): void {
    continent.worldId = this.id;
    this.continents.push(continent);
    this.mapContinents.set(continent.id, continent);
    for (const region of continent.regions) {
      this.mapRegions.set(region.id, region);
      for (const city of region.cities) {
        this.mapCities.set(city.id, city);
      }
    }
  }
}
