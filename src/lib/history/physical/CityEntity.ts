import { IdUtil } from '../IdUtil';

export type CitySize = 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';

export const CITY_SIZE_WEIGHTS: Record<CitySize, number> = {
  small: 100, medium: 40, large: 15, metropolis: 5, megalopolis: 1,
};

const CITY_SIZE_TOTAL = (Object.values(CITY_SIZE_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

export const CITY_SIZE_TRADE_CAP: Record<CitySize, number> = {
  small: 10, medium: 15, large: 20, metropolis: 30, megalopolis: 50,
};

/** Population thresholds for dynamic city size. Ordered descending by minPop. */
export const CITY_SIZE_THRESHOLDS: { size: CitySize; minPop: number }[] = [
  { size: 'megalopolis', minPop: 10_000_000 },
  { size: 'metropolis',  minPop: 1_000_000 },
  { size: 'large',       minPop: 100_000 },
  { size: 'medium',      minPop: 10_000 },
];

export const CITY_SIZE_TO_INDEX: Record<CitySize, number> = {
  small: 0, medium: 1, large: 2, metropolis: 3, megalopolis: 4,
};

export const INDEX_TO_CITY_SIZE: CitySize[] = ['small', 'medium', 'large', 'metropolis', 'megalopolis'];

/**
 * Population milestones that each grant +1 cell of territory.
 * City starts with 1 cell (founding cell), so max cells from milestones = 1 + 56 = 57.
 * Government tech adds +4 cells per level (capped at +20) on top of this.
 *
 * 4x granularity: each old milestone interval is subdivided into 4 geometric
 * sub-steps, plus 3 sub-steps before the first old milestone (500).
 */
export const CITY_TERRITORY_MILESTONES: number[] = [
  // 0→500 band
  125, 200, 325, 500,
  // 500→2_000 band
  710, 1_000, 1_410, 2_000,
  // 2_000→5_000 band
  2_660, 3_350, 4_200, 5_000,
  // 5_000→10_000 band
  5_950, 7_070, 8_410, 10_000,
  // 10_000→25_000 band
  12_550, 15_800, 19_900, 25_000,
  // 25_000→50_000 band
  29_700, 35_350, 42_050, 50_000,
  // 50_000→100_000 band
  59_500, 70_700, 84_100, 100_000,
  // 100_000→250_000 band
  125_500, 158_000, 199_000, 250_000,
  // 250_000→500_000 band
  297_000, 354_000, 421_000, 500_000,
  // 500_000→1_000_000 band
  595_000, 707_000, 841_000, 1_000_000,
  // 1M→2.5M band
  1_255_000, 1_580_000, 1_990_000, 2_500_000,
  // 2.5M→5M band
  2_970_000, 3_540_000, 4_210_000, 5_000_000,
  // 5M→10M band
  5_950_000, 7_070_000, 8_410_000, 10_000_000,
  // 10M→25M band
  12_550_000, 15_800_000, 19_900_000, 25_000_000,
];

/** Max cells a city can own based purely on population milestones (excludes tech bonus). */
export function maxCellsForPopulation(pop: number): number {
  let count = 1; // founding cell
  for (const milestone of CITY_TERRITORY_MILESTONES) {
    if (pop >= milestone) count++;
    else break;
  }
  return count;
}

/** Max cells a city can own including government tech bonus (capped at +20, 4 cells per gov level). */
export function maxCellsForCity(pop: number, govLevel: number): number {
  return maxCellsForPopulation(pop) + Math.min(20, govLevel * 4);
}

/**
 * Derive city size from population and tech levels.
 * `government` and `industry` tech reduce thresholds (~4% per combined level),
 * so advanced civilizations reach higher tiers at smaller populations.
 */
export function computeCitySize(population: number, govLevel: number = 0, industryLevel: number = 0): CitySize {
  const techFactor = 1 / (1 + 0.04 * (govLevel + industryLevel));
  for (const { size, minPop } of CITY_SIZE_THRESHOLDS) {
    if (population >= minPop * techFactor) return size;
  }
  return 'small';
}

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

export function rollInitialPopulation(rng: () => number, _size: CitySize): number {
  // All cities start as small settlements (100–1000).
  // 9d100 gives 9–900, + 100 → 109–1000 with a bell-curve center ~550.
  return roll(rng, 9, 100) + 100;
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
  isRuin: boolean = false;
  ruinYear: number = 0;
  ruinCause: string = '';  // 'cataclysm' | 'depopulation'
  size: CitySize;
  initialPopulation: number;
  currentPopulation: number;
  contacts: string[] = [];
  trades: string[] = [];
  illustrates: string[] = [];
  wonders: string[] = [];
  religions: Map<string, number> = new Map();
  cataclysms: string[] = [];
  /** Cells owned by this city. Keys are cell indices, values are the year the cell was claimed. */
  ownedCells: Map<number, number> = new Map();
  // Transient
  regionId: string = '';
  contactCities: Set<CityEntity> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed as Map<TechField, Tech> in timeline layer; loose here to avoid circular dependency
  knownTechs: Map<string, any> = new Map();

  constructor(cellIndex: number, name: string, rng: () => number) {
    this.id = IdUtil.id('city', rngHex(rng)) ?? 'city_unknown';
    this.cellIndex = cellIndex;
    this.name = name;
    // RNG calls preserved for determinism; size is then derived from population
    const randomSize = pickCitySize(rng);
    this.initialPopulation = rollInitialPopulation(rng, randomSize);
    this.currentPopulation = this.initialPopulation;
    this.size = computeCitySize(this.currentPopulation);
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
