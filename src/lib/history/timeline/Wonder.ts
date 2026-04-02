import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { cityVisitor } from '../physical/CityVisitor';
import { TRADE_MIN } from '../physical/Resource';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Wonder {
  readonly id: string;
  readonly city: string; // city ID
  builtOn: number;
  destroyedOn: number | null;
  destroyCause: string;
  year?: Year;
}

export class WonderGenerator {
  generate(rng: () => number, year: Year, world: World): Wonder | null {
    // Eligible city: large/metropolis always qualify,
    // megalopolis requires >1 high-original resources (known quirk from spec)
    const city = cityVisitor.selectRandomUsable(
      world,
      c => {
        if (c.size === 'large' || c.size === 'metropolis') return true;
        if (c.size === 'megalopolis') {
          const region = world.mapRegions.get(c.regionId);
          if (!region) return false;
          const highResources = region.resources.filter(r => r.original > TRADE_MIN).length;
          return highResources > 1;
        }
        return false;
      },
      rng
    );
    if (!city) return null;

    const absYear = year.year;
    const wonder: Wonder = {
      id: IdUtil.id('wonder', absYear, rngHex(rng)) ?? 'wonder_unknown',
      city: city.id,
      builtOn: absYear,
      destroyedOn: null,
      destroyCause: '',
      year,
    };

    city.wonders.push(wonder.id);
    world.mapWonders.set(wonder.id, wonder);
    world.mapUsableWonders.set(wonder.id, wonder);

    return wonder;
  }
}

export const wonderGenerator = new WonderGenerator();
