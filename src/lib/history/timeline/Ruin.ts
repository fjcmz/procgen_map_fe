import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';
import type { Trade } from './Trade';
import type { Illustrate } from './Illustrate';
import type { CountryEvent } from './Country';
import type { Wonder } from './Wonder';
import { TRADE_USE } from '../physical/Resource';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Ruin {
  readonly id: string;
  readonly city: string;          // city ID
  readonly cause: string;         // 'cataclysm' | 'depopulation'
  year?: Year;
  originCity?: CityEntity;
  dissolvedCountry?: string;      // country ID if this ruin caused dissolution
  relocatedIllustrates?: string[];  // illustrate IDs that were moved
  destroyedWonders?: string[];     // wonder IDs destroyed when the city was ruined
}

/**
 * Turn a city into a ruin, applying all cascading side effects:
 * 1. Mark ruin state on the city
 * 2. Remove from active simulation maps
 * 3. Sever all contacts
 * 4. End all active trades
 * 5. Destroy all standing wonders in this city
 * 6. Relocate living illustrates to other cities
 * 7. Reassign capital if this was the capital
 * 8. Dissolve the country if no non-ruin cities remain
 */
export function ruinifyCity(
  city: CityEntity,
  world: World,
  year: Year,
  cause: string,
  rng: () => number,
): Ruin {
  // Guard: already a ruin (e.g., both cataclysm and pop<100 triggers fire same year)
  if (city.isRuin) {
    return {
      id: 'ruin_noop',
      city: city.id,
      cause,
    };
  }

  const absYear = year.year;

  const ruin: Ruin = {
    id: IdUtil.id('ruin', absYear, city.name, rngHex(rng)) ?? 'ruin_unknown',
    city: city.id,
    cause,
    year,
    originCity: city,
  };

  // 1. Mark ruin state
  city.isRuin = true;
  city.ruinYear = absYear;
  city.ruinCause = cause;
  city.currentPopulation = 0;

  // 2. Remove from active simulation maps
  world.mapUsableCities.delete(city.id);
  world.mapUncontactedCities.delete(city.id);

  // 3. Sever all contacts (bidirectional)
  for (const other of city.contactCities) {
    other.contactCities.delete(city);
  }
  city.contactCities.clear();

  // 4. End all active trades involving this city
  _endCityTrades(city, ruin, absYear, year);

  // 5. Destroy all standing wonders in this city
  const destroyedWonders = _destroyCityWonders(city, world, absYear, ruin.id);
  if (destroyedWonders.length > 0) {
    (ruin as { destroyedWonders?: string[] }).destroyedWonders = destroyedWonders;
  }

  // 6. Relocate living illustrates
  const relocated = _relocateIllustrates(city, world, rng);
  if (relocated.length > 0) {
    (ruin as { relocatedIllustrates?: string[] }).relocatedIllustrates = relocated;
  }

  // 7–8. Capital reassignment / country dissolution
  const region = world.mapRegions.get(city.regionId);
  if (region?.isCountry && region.countryId) {
    const country = world.mapCountries.get(region.countryId) as CountryEvent | undefined;

    // Find non-ruin cities in this region
    const aliveCities = region.cities.filter(c => !c.isRuin);

    if (aliveCities.length === 0) {
      // All cities are ruins → dissolve the country
      const dissolved = _dissolveCountry(region, country, world, absYear);
      if (dissolved) {
        (ruin as { dissolvedCountry?: string }).dissolvedCountry = dissolved;
      }
    } else if (region.cities[0] === city) {
      // Capital became a ruin → swap first alive city to index 0
      const firstAlive = region.cities.findIndex(c => !c.isRuin);
      if (firstAlive > 0) {
        const tmp = region.cities[0];
        region.cities[0] = region.cities[firstAlive];
        region.cities[firstAlive] = tmp;
      }
    }
  }

  return ruin;
}

/**
 * End all active trades involving the given city.
 * Walks previous years (in timeline.years) plus the current year's trades.
 */
function _endCityTrades(city: CityEntity, ruin: Ruin, absYear: number, year: Year): void {
  if (city.trades.length === 0) return;

  const endTrade = (trade: Trade) => {
    if (trade.ended !== null) return;
    if (trade.city1 !== city.id && trade.city2 !== city.id) return;
    trade.ended = absYear;
    trade.endCause = ruin.id;
    if (trade.material1) trade.material1.available += TRADE_USE;
    if (trade.material2) trade.material2.available += TRADE_USE;
  };

  // Previous years (current year not yet in timeline.years)
  for (const yr of year.timeline.years) {
    for (const trade of yr.trades as Trade[]) {
      endTrade(trade);
    }
  }
  // Current year's trades
  for (const trade of year.trades as Trade[]) {
    endTrade(trade);
  }
}

/**
 * Destroy all standing wonders belonging to a ruined city.
 * Sets destroyedOn / destroyCause on each wonder and removes from mapUsableWonders.
 * Does NOT clear city.wonders — that array is a permanent record for serialization.
 */
function _destroyCityWonders(
  city: CityEntity,
  world: World,
  absYear: number,
  ruinId: string,
): string[] {
  const destroyed: string[] = [];
  for (const wonderId of city.wonders) {
    const wonder = world.mapUsableWonders.get(wonderId) as Wonder | undefined;
    if (!wonder) continue; // already destroyed
    wonder.destroyedOn = absYear;
    wonder.destroyCause = ruinId;
    world.mapUsableWonders.delete(wonderId);
    destroyed.push(wonderId);
  }
  return destroyed;
}

/**
 * Relocate all living illustrates from a ruined city to other usable cities.
 * Prefers cities in the same country; falls back to any usable city.
 */
function _relocateIllustrates(city: CityEntity, world: World, rng: () => number): string[] {
  const relocated: string[] = [];

  for (const illId of city.illustrates) {
    const ill = world.mapUsableIllustrates.get(illId) as Illustrate | undefined;
    if (!ill) continue; // already dead

    // Build candidate list: prefer same country, fall back to any usable city
    const region = world.mapRegions.get(city.regionId);
    const countryId = region?.countryId;
    let candidates: CityEntity[] = [];

    if (countryId) {
      // Same country: cities in regions owned by this country
      for (const c of world.mapUsableCities.values()) {
        if (c.isRuin) continue;
        const cRegion = world.mapRegions.get(c.regionId);
        if (cRegion?.countryId === countryId) candidates.push(c);
      }
    }

    // Fall back to any usable non-ruin city
    if (candidates.length === 0) {
      for (const c of world.mapUsableCities.values()) {
        if (!c.isRuin) candidates.push(c);
      }
    }

    if (candidates.length === 0) continue; // no city to relocate to (apocalypse)

    const target = candidates[Math.floor(rng() * candidates.length)];

    // Move the illustrate
    ill.originCity = target;
    target.illustrates.push(illId);
    relocated.push(illId);
  }

  // Clear the ruined city's illustrate list
  city.illustrates = [];

  return relocated;
}

/**
 * Dissolve a country when all its cities have become ruins.
 * Returns the dissolved country ID, or undefined if no dissolution occurred.
 */
function _dissolveCountry(
  region: { isCountry: boolean; countryId: string | null },
  country: CountryEvent | undefined,
  world: World,
  absYear: number,
): string | undefined {
  const countryId = region.countryId;
  if (!countryId) return undefined;

  // Clear region ownership
  region.isCountry = false;
  region.countryId = null;

  if (country) {
    // Remove from empire if a member
    if (country.memberOf) {
      const empire = country.memberOf;
      empire.countries.delete(country.id);
      empire.reach.delete(country.governingRegion);
      empire.members?.delete(country);

      // If empire drops to ≤1 member: dissolve
      if (empire.countries.size <= 1) {
        empire.destroyedOn = absYear;
        empire.conqueredBy = '';
        if (empire.members) {
          for (const member of empire.members) member.memberOf = null;
          empire.members.clear();
        }
        empire.countries.clear();
        empire.reach.clear();
      } else {
        country.memberOf = null;
      }
    }

    // Move country to dead list (keeps it available for name resolution at serialization)
    world.mapDeadCountries.set(country.id, country);
    world.mapCountries.delete(country.id);
  }

  return countryId;
}
