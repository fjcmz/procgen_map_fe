import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';
import { generateIllustrateName } from '../nameGenerator';

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

export type IllustrateType = 'religion' | 'science' | 'philosophy' | 'industry' | 'military' | 'art';

const ILLUSTRATE_WEIGHTS: Record<IllustrateType, number> = {
  religion: 2, science: 3, philosophy: 2, industry: 5, military: 5, art: 3,
};
const ILLUSTRATE_TOTAL = (Object.values(ILLUSTRATE_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

/** Wonder Attraction: per-tier-sum weight bonus for illustrate city selection. */
const WONDER_ATTRACTION_FACTOR = 0.25;

const ILLUSTRATE_ACTIVE_ROLLS: Record<IllustrateType, [number, number]> = {
  religion: [5, 10],
  science: [5, 6],
  philosophy: [5, 12],
  industry: [5, 6],
  military: [5, 8],
  art: [5, 10],
};

function pickIllustrateType(rng: () => number): IllustrateType {
  let r = rng() * ILLUSTRATE_TOTAL;
  for (const [type, w] of Object.entries(ILLUSTRATE_WEIGHTS) as [IllustrateType, number][]) {
    r -= w;
    if (r <= 0) return type;
  }
  return 'industry';
}

export interface Illustrate {
  readonly id: string;
  readonly name: string;
  readonly type: IllustrateType;
  readonly city: string; // origin city ID
  yearsActive: number;
  greatDeed: string;
  diedOn: number | null;
  deathCause: string;
  birthYear: number;
  year?: Year;
  originCity?: CityEntity;
}

export class IllustrateGenerator {
  generate(rng: () => number, year: Year, world: World): Illustrate | null {
    // Wonder Attraction: cities with standing wonders get higher selection weight.
    // Weight = 1 + 0.25 × wonderTierSum. Consumes exactly 1 rng call.
    const candidates: Array<{ city: CityEntity; weight: number }> = [];
    let totalWeight = 0;
    for (const c of world.mapUsableCities.values()) {
      if (!c.founded) continue;
      if (c.size !== 'large' && c.size !== 'metropolis' && c.size !== 'megalopolis') continue;
      const w = 1 + WONDER_ATTRACTION_FACTOR * c.wonderTierSum;
      candidates.push({ city: c, weight: w });
      totalWeight += w;
    }
    if (candidates.length === 0) return null;

    // Weighted roulette selection (mirrors Wonder.ts pattern)
    let r = rng() * totalWeight;
    let city: CityEntity = candidates[candidates.length - 1].city;
    for (const cand of candidates) {
      r -= cand.weight;
      if (r <= 0) { city = cand.city; break; }
    }

    const type = pickIllustrateType(rng);
    const name = generateIllustrateName(rng, world.usedIllustrateNames);
    const [n, sides] = ILLUSTRATE_ACTIVE_ROLLS[type];
    const yearsActive = roll(rng, n, sides);
    const absYear = year.year;

    const illustrate: Illustrate = {
      id: IdUtil.id('illustrate', absYear, type, rngHex(rng)) ?? 'illustrate_unknown',
      name,
      type,
      city: city.id,
      yearsActive,
      greatDeed: '',
      diedOn: null,
      deathCause: '',
      birthYear: absYear,
      year,
      originCity: city,
    };

    city.illustrates.push(illustrate.id);
    world.mapIllustrates.set(illustrate.id, illustrate);
    world.mapUsableIllustrates.set(illustrate.id, illustrate);

    return illustrate;
  }
}

export const illustrateGenerator = new IllustrateGenerator();
