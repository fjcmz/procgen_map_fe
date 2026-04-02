import { IdUtil } from '../IdUtil';
import type { Year } from './Year';
import type { CountryEvent } from './Country';
import type { Conquer } from './Conquer';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Empire {
  readonly id: string;
  foundedOn: number;
  readonly foundedBy: string; // founder country ID
  destroyedOn: number | null;
  conqueredBy: string; // country ID that destroyed this empire
  countries: Set<string>; // member country IDs
  reach: Set<string>; // region/territory IDs controlled
  year?: Year;
  founder?: CountryEvent;
  members?: Set<CountryEvent>;
}

export class EmpireGenerator {
  /**
   * Triggered by a conquer event where the conqueror is not already in an empire.
   */
  generate(rng: () => number, year: Year, conquer: Conquer): Empire | null {
    if (!conquer.conquerorCountry || !conquer.conqueredCountry) return null;

    // Only create empire if conqueror is not already in one
    if (conquer.conquerorCountry.memberOf) return null;

    const absYear = year.year;

    const empire: Empire = {
      id: IdUtil.id('empire', absYear, rngHex(rng)) ?? 'empire_unknown',
      foundedOn: absYear,
      foundedBy: conquer.conquerorCountry.id,
      destroyedOn: null,
      conqueredBy: '',
      countries: new Set([conquer.conquerorCountry.id, conquer.conqueredCountry.id]),
      reach: new Set([conquer.conquerorCountry.governingRegion, conquer.conqueredCountry.governingRegion]),
      year,
      founder: conquer.conquerorCountry,
      members: new Set([conquer.conquerorCountry, conquer.conqueredCountry]),
    };

    // Set both countries' membership
    conquer.conquerorCountry.empires.push(empire.id);
    conquer.conqueredCountry.empires.push(empire.id);
    conquer.conquerorCountry.memberOf = empire;
    conquer.conqueredCountry.memberOf = empire;

    return empire;
  }
}

export const empireGenerator = new EmpireGenerator();
