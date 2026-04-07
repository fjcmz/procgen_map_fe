import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';
import { TRADE_MIN } from '../physical/Resource';
import { getCityTechLevel } from './Tech';

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
    // megalopolis requires >1 high-original resources (known quirk from spec).
    // Phase 1: weight eligible cities by industry tech (1 + 0.1 * level, capped
    // at level 10 for a max 2× weight).
    const candidates: Array<{ city: CityEntity; weight: number }> = [];
    for (const c of world.mapUsableCities.values()) {
      let eligible = false;
      if (c.size === 'large' || c.size === 'metropolis') {
        eligible = true;
      } else if (c.size === 'megalopolis') {
        const region = world.mapRegions.get(c.regionId);
        if (region) {
          const highResources = region.resources.filter(r => r.original > TRADE_MIN).length;
          eligible = highResources > 1;
        }
      }
      if (!eligible) continue;

      const industryLevel = Math.min(getCityTechLevel(world, c, 'industry'), 10);
      candidates.push({ city: c, weight: 1 + 0.1 * industryLevel });
    }
    if (candidates.length === 0) return null;

    let total = 0;
    for (const cand of candidates) total += cand.weight;
    let r = rng() * total;
    let city: CityEntity = candidates[candidates.length - 1].city; // float-error safety
    for (const cand of candidates) {
      r -= cand.weight;
      if (r <= 0) { city = cand.city; break; }
    }

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
