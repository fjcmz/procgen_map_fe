import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { cityVisitor } from '../physical/CityVisitor';
import { registerUsableCityClaims } from '../physical/claims';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Foundation {
  readonly id: string;
  readonly founded: string; // city ID
  year?: Year;
}

export class FoundationGenerator {
  generate(rng: () => number, year: Year, world: World): Foundation | null {
    // If all cities already founded, produce no foundation
    if (world.mapCities.size === world.mapUsableCities.size) return null;

    // Choose a random unfounded city
    const city = cityVisitor.selectRandom(
      world,
      c => !c.founded,
      rng
    );
    if (!city) return null;

    const absYear = year.year;
    const foundation: Foundation = {
      id: IdUtil.id('foundation', absYear, rngHex(rng)) ?? 'foundation_unknown',
      founded: city.id,
      year,
    };

    // Mark city as founded
    city.founded = true;
    city.foundedOn = absYear;

    // Claim founding cell as city territory. This is always an overwrite of
    // the key pre-seeded at creation time in buildPhysicalWorld (only
    // buildPhysicalWorld cities are ever unfounded), so cellCapSum needs no
    // update here — only the claim-year value changes.
    city.ownedCells.set(city.cellIndex, absYear);

    // Add city to usable and uncontacted maps
    world.mapUsableCities.set(city.id, city);
    world.mapUncontactedCities.set(city.id, city);
    registerUsableCityClaims(world, city);

    return foundation;
  }
}

export const foundationGenerator = new FoundationGenerator();
