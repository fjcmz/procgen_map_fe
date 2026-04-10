import { IdUtil } from '../IdUtil';
import type { Timeline } from './Timeline';
import type {
  Foundation, Contact, CountryEvent, Illustrate, Wonder, Religion,
  Trade, Cataclysm, War, Tech, Conquer, Empire, Ruin, Expand, Settle,
} from './events';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Year {
  readonly id: string;
  year: number = 0;
  worldPopulation: number = 0;

  // Event collections (populated by Phase 5 generators, in generation order)
  foundations: Foundation[] = [];
  contacts: Contact[] = [];
  countries: CountryEvent[] = [];
  illustrates: Illustrate[] = [];
  wonders: Wonder[] = [];
  religions: Religion[] = [];
  trades: Trade[] = [];
  cataclysms: Cataclysm[] = [];
  wars: War[] = [];
  techs: Tech[] = [];
  conquers: Conquer[] = [];
  empires: Empire[] = [];
  ruins: Ruin[] = [];
  expansions: Expand[] = [];
  settlements: Settle[] = [];

  // Per-city snapshots captured at end of year (after all events applied)
  cityPopulations: Record<number, number> = {};  // cellIndex → population
  citySizeByCell: Record<number, number> = {};   // cellIndex → size index (0-4)

  // Transient
  timeline!: Timeline;

  constructor(rng: () => number) {
    this.id = IdUtil.id('year', rngHex(rng)) ?? 'year_unknown';
  }
}
