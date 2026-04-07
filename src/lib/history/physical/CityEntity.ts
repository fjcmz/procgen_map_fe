import { IdUtil } from '../IdUtil';

export type CitySize = 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';

export const CITY_SIZE_WEIGHTS: Record<CitySize, number> = {
  small: 100, medium: 40, large: 15, metropolis: 5, megalopolis: 1,
};

const CITY_SIZE_TOTAL = (Object.values(CITY_SIZE_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

export const CITY_SIZE_TRADE_CAP: Record<CitySize, number> = {
  small: 10, medium: 15, large: 20, metropolis: 30, megalopolis: 50,
};

/**
 * Tech fields that multiply trade capacity by (1 + level/10) per known tech.
 * Mirror of `TRADE_TECHS` in `src/lib/history/timeline/Tech.ts`; duplicated
 * here to avoid a physical → timeline circular dependency. Keep in sync.
 */
const TRADE_TECH_FIELDS = ['exploration', 'growth', 'industry', 'government'] as const;

function roll(rng: () => number, n: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.floor(rng() * sides) + 1;
  return total;
}

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export function pickCitySize(rng: () => number): CitySize {
  let r = rng() * CITY_SIZE_TOTAL;
  for (const [size, w] of Object.entries(CITY_SIZE_WEIGHTS) as [CitySize, number][]) {
    r -= w;
    if (r <= 0) return size;
  }
  return 'small';
}

export function rollInitialPopulation(rng: () => number, size: CitySize): number {
  switch (size) {
    case 'small':       return roll(rng, 2, 10) + 90;
    case 'medium':      return roll(rng, 5, 10) + 200;
    case 'large':       return roll(rng, 40, 10) + 400;
    case 'metropolis':  return roll(rng, 100, 10) + 1000;
    case 'megalopolis': return roll(rng, 1000, 10) + 5000;
  }
}

export class CityEntity {
  readonly id: string;
  readonly cellIndex: number;
  readonly name: string;
  founded: boolean = false;
  contacted: boolean = false;
  foundedOn: number = 0;
  destroyedOn: number = 0;
  destroyCause: string = '';
  size: CitySize;
  initialPopulation: number;
  currentPopulation: number;
  contacts: string[] = [];
  trades: string[] = [];
  illustrates: string[] = [];
  wonders: string[] = [];
  religions: Map<string, number> = new Map();
  cataclysms: string[] = [];
  // Transient
  regionId: string = '';
  contactCities: Set<CityEntity> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed as Map<TechField, Tech> in timeline layer; loose here to avoid circular dependency
  knownTechs: Map<string, any> = new Map();

  constructor(cellIndex: number, name: string, rng: () => number) {
    this.id = IdUtil.id('city', rngHex(rng)) ?? 'city_unknown';
    this.cellIndex = cellIndex;
    this.name = name;
    this.size = pickCitySize(rng);
    this.initialPopulation = rollInitialPopulation(rng, this.size);
    this.currentPopulation = this.initialPopulation;
  }

  /**
   * Effective trade capacity, accounting for TRADE_TECHS multipliers.
   * Per spec (`specs/04_City.md` § Trade Capacity), the base cap is
   * multiplied by `(1 + level/10)` for each known tech in a TRADE_TECH field,
   * then rounded. Used by `canTradeMore()`.
   */
  effectiveTradeCap(): number {
    let capacity = CITY_SIZE_TRADE_CAP[this.size];
    for (const field of TRADE_TECH_FIELDS) {
      const tech = this.knownTechs.get(field);
      if (tech) capacity *= 1 + tech.level / 10;
    }
    return Math.round(capacity);
  }

  canTradeMore(): boolean {
    return this.trades.length < this.effectiveTradeCap();
  }
}
