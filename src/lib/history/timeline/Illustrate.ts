import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { cityVisitor } from '../physical/CityVisitor';
import type { CityEntity } from '../physical/CityEntity';

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
    // Eligible city: founded and size in {large, metropolis, megalopolis}
    const city = cityVisitor.selectRandomUsable(
      world,
      c => c.founded && (c.size === 'large' || c.size === 'metropolis' || c.size === 'megalopolis'),
      rng
    );
    if (!city) return null;

    const type = pickIllustrateType(rng);
    const [n, sides] = ILLUSTRATE_ACTIVE_ROLLS[type];
    const yearsActive = roll(rng, n, sides);
    const absYear = year.year;

    const illustrate: Illustrate = {
      id: IdUtil.id('illustrate', absYear, type, rngHex(rng)) ?? 'illustrate_unknown',
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
