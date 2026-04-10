import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Region } from '../physical/Region';
import type { Tech, TechField } from './Tech';
import { mergeAllTechs } from './Tech';
import type { Empire } from './Empire';
import { regionVisitor } from '../physical/RegionVisitor';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type Spirit = 'military' | 'religious' | 'industrious' | 'neutral';

const SPIRIT_WEIGHTS: Record<Spirit, number> = {
  military: 3, religious: 3, industrious: 3, neutral: 9,
};
const SPIRIT_TOTAL = (Object.values(SPIRIT_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

function pickSpirit(rng: () => number): Spirit {
  let r = rng() * SPIRIT_TOTAL;
  for (const [spirit, w] of Object.entries(SPIRIT_WEIGHTS) as [Spirit, number][]) {
    r -= w;
    if (r <= 0) return spirit;
  }
  return 'neutral';
}

export interface CountryEvent {
  readonly id: string;
  readonly spirit: Spirit;
  readonly governingRegion: string; // region ID
  foundedOn: number;
  atWar: boolean;
  wars: string[];
  empires: string[];
  year?: Year;
  region?: Region;
  warCountries: CountryEvent[];
  memberOf: Empire | null;
  knownTechs: Map<TechField, Tech>;
}

export class CountryGenerator {
  generate(rng: () => number, year: Year, world: World): CountryEvent | null {
    // Select up to 5 candidate regions where:
    // - isCountry == false
    // - All cities in the region are founded and contacted
    const candidates = regionVisitor.selectUpToN(
      world, 5,
      (r: Region) => {
        if (r.isCountry) return false;
        // Exclude regions already claimed by expansion or another country
        if (r.countryId !== null || r.expansionOwnerId !== null) return false;
        if (r.cities.length === 0) return false;
        return r.cities.every(c => c.founded && c.contacted && !c.isRuin);
      },
      rng
    );

    if (candidates.length === 0) return null;

    // Pick one randomly
    const region = candidates[Math.floor(rng() * candidates.length)];
    const absYear = year.year;

    const country: CountryEvent = {
      id: IdUtil.id('country', absYear, rngHex(rng)) ?? 'country_unknown',
      spirit: pickSpirit(rng),
      governingRegion: region.id,
      foundedOn: absYear,
      atWar: false,
      wars: [],
      empires: [],
      year,
      region,
      warCountries: [],
      memberOf: null,
      knownTechs: new Map(),
    };

    // Bind region
    region.isCountry = true;
    region.countryId = country.id;

    // Merge all city tech maps by max-level-per-field
    const cityTechMaps = region.cities
      .map(c => c.knownTechs)
      .filter((m): m is Map<TechField, Tech> => m !== undefined);
    const unified = mergeAllTechs(cityTechMaps);
    country.knownTechs = unified;

    // Assign unified tech map to each city in the region
    for (const city of region.cities) {
      city.knownTechs = unified;
    }

    // Insert into world
    world.mapCountries.set(country.id, country);

    return country;
  }
}

export const countryGenerator = new CountryGenerator();
