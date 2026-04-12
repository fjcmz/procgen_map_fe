import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CountryEvent } from './Country';
import { TRADE_USE } from '../physical/Resource';
import type { Trade } from './Trade';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

function roll(rng: () => number, n: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.floor(rng() * sides) + 1;
  return total;
}

export type WarReason = 'expansion' | 'religion' | 'resources' | 'vengance';

const WAR_REASON_WEIGHTS: Record<WarReason, number> = {
  expansion: 20, religion: 10, resources: 20, vengance: 2,
};
const WAR_REASON_TOTAL = (Object.values(WAR_REASON_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

function pickWarReason(rng: () => number): WarReason {
  let r = rng() * WAR_REASON_TOTAL;
  for (const [reason, w] of Object.entries(WAR_REASON_WEIGHTS) as [WarReason, number][]) {
    r -= w;
    if (r <= 0) return reason;
  }
  return 'expansion';
}

export interface War {
  readonly id: string;
  readonly reason: WarReason;
  started: number;
  readonly aggressor: string; // country ID
  readonly defender: string;  // country ID
  lasts: number;
  year?: Year;
}

export class WarGenerator {
  generate(rng: () => number, year: Year, world: World): War | null {
    // Choose aggressor: a country not currently at war
    const countries = Array.from(world.mapCountries.values()) as CountryEvent[];
    // Shuffle
    for (let i = countries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [countries[i], countries[j]] = [countries[j], countries[i]];
    }

    const aggressor = countries.find(c => !c.atWar);
    if (!aggressor || !aggressor.region) return null;

    // Choose defender: neighbouring region that is a country, not in same empire
    const neighbourRegionIds = Array.from(aggressor.region.neighbours);
    // Shuffle
    for (let i = neighbourRegionIds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [neighbourRegionIds[i], neighbourRegionIds[j]] = [neighbourRegionIds[j], neighbourRegionIds[i]];
    }

    let defender: CountryEvent | null = null;
    for (const nId of neighbourRegionIds) {
      const nRegion = world.mapRegions.get(nId);
      if (!nRegion || !nRegion.isCountry || !nRegion.countryId) continue;
      const candidate = world.mapCountries.get(nRegion.countryId) as CountryEvent | undefined;
      if (!candidate) continue;
      // Skip countries already at war
      if (candidate.atWar) continue;
      // Not in the same empire
      if (aggressor.memberOf && candidate.memberOf && aggressor.memberOf === candidate.memberOf) continue;
      defender = candidate;
      break;
    }
    if (!defender) return null;

    const reason = pickWarReason(rng);
    const lasts = roll(rng, 2, 5);
    const absYear = year.year;

    const war: War = {
      id: IdUtil.id('war', absYear, reason, lasts, rngHex(rng)) ?? 'war_unknown',
      reason,
      started: absYear,
      aggressor: aggressor.id,
      defender: defender.id,
      lasts,
      year,
    };

    // Mark both countries at war
    aggressor.atWar = true;
    defender.atWar = true;
    aggressor.wars.push(war.id);
    defender.wars.push(war.id);

    // Add to world maps
    world.mapWars.set(war.id, war);
    world.mapAliveWars.set(war.id, war);

    // Trade disruption: terminate cross-region trades between belligerents
    this._disruptTrades(rng, war, aggressor, defender, world);

    return war;
  }

  private _disruptTrades(
    rng: () => number,
    war: War,
    aggressor: CountryEvent,
    defender: CountryEvent,
    _world: World,
  ): void {
    if (!aggressor.region || !defender.region) return;

    const defenderCityIds = new Set(defender.region.cities.map(c => c.id));

    // For each aggressor city, check trades that connect to defender cities
    for (const city of aggressor.region.cities) {
      for (const contactCity of city.contactCities) {
        if (!defenderCityIds.has(contactCity.id)) continue;
        // Random probability threshold: [8, 17] percent
        const threshold = (8 + rng() * 9) / 100;
        if (rng() >= threshold) continue;

        // Find matching active trades between these two cities
        for (const tradeId of city.trades) {
          // Search the year's trade list for the trade object
          const yearObj = war.year;
          if (!yearObj) continue;
          for (const trade of yearObj.trades as Trade[]) {
            if (trade.id !== tradeId) continue;
            if (trade.ended !== null) continue;
            trade.ended = war.started;
            trade.endCause = war.id;
            if (trade.material1) trade.material1.available += TRADE_USE;
            if (trade.material2) trade.material2.available += TRADE_USE;
          }
        }
      }
    }
  }
}

export const warGenerator = new WarGenerator();
