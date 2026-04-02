import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { TRADE_MIN, TRADE_USE } from '../physical/Resource';
import type { Resource } from '../physical/Resource';
import { cityVisitor } from '../physical/CityVisitor';
import type { CityEntity } from '../physical/CityEntity';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Trade {
  readonly id: string;
  started: number;
  ended: number | null;
  endCause: string;
  readonly city1: string; // city ID
  readonly city2: string; // city ID
  readonly resource1: string; // resource type
  readonly resource2: string; // resource type
  year?: Year;
  tradeCity1?: CityEntity;
  tradeCity2?: CityEntity;
  material1?: Resource;
  material2?: Resource;
}

export class TradeGenerator {
  generate(rng: () => number, year: Year, world: World): Trade | null {
    // Choose source city: usable, canTradeMore, region hasResources
    const sourceCity = cityVisitor.selectRandomUsable(
      world,
      c => {
        if (!c.canTradeMore()) return false;
        const region = world.mapRegions.get(c.regionId);
        return !!region && region.hasResources;
      },
      rng
    );
    if (!sourceCity) return null;

    // Choose target city from source city's contacts in a different region
    const targetCandidates: CityEntity[] = [];
    for (const contactCity of sourceCity.contactCities) {
      if (contactCity.regionId === sourceCity.regionId) continue;
      if (!contactCity.canTradeMore()) continue;
      const targetRegion = world.mapRegions.get(contactCity.regionId);
      if (!targetRegion || !targetRegion.hasResources) continue;
      targetCandidates.push(contactCity);
    }
    if (targetCandidates.length === 0) return null;

    const targetCity = targetCandidates[Math.floor(rng() * targetCandidates.length)];

    // Choose resources
    const sourceRegion = world.mapRegions.get(sourceCity.regionId)!;
    const targetRegion = world.mapRegions.get(targetCity.regionId)!;

    const sourceResources = sourceRegion.resources.filter(r => r.available > TRADE_MIN);
    const targetResources = targetRegion.resources.filter(r => r.available > TRADE_MIN);
    if (sourceResources.length === 0 || targetResources.length === 0) return null;

    const res1 = sourceResources[Math.floor(rng() * sourceResources.length)];
    const res2 = targetResources[Math.floor(rng() * targetResources.length)];

    const absYear = year.year;
    const trade: Trade = {
      id: IdUtil.id('trade', absYear, res1.type, res2.type, rngHex(rng)) ?? 'trade_unknown',
      started: absYear,
      ended: null,
      endCause: '',
      city1: sourceCity.id,
      city2: targetCity.id,
      resource1: res1.type,
      resource2: res2.type,
      year,
      tradeCity1: sourceCity,
      tradeCity2: targetCity,
      material1: res1,
      material2: res2,
    };

    // Decrease resource availability
    res1.available -= TRADE_USE;
    res2.available -= TRADE_USE;

    // Add trade to both cities
    sourceCity.trades.push(trade.id);
    targetCity.trades.push(trade.id);

    return trade;
  }
}

export const tradeGenerator = new TradeGenerator();
