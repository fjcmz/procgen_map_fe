import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Region, RegionBiome } from '../physical/Region';
import type { Tech, TechField } from './Tech';
import { mergeAllTechs } from './Tech';
import type { Empire } from './Empire';
import { regionVisitor } from '../physical/RegionVisitor';
import type { RaceType } from '../../fantasy/RaceType';
import { RACE_TYPES } from '../../fantasy/RaceType';
import { seededPRNG } from '../../terrain/noise';

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
  /**
   * Cultural race-bias picked at founding from a PRNG sub-stream isolated by
   * country id and the world seed (`seededPRNG(`${world.seed}_racebias_${id}`)`),
   * weighted by the founding region's biome. Decorative-only in v1: it does
   * not feed back into wars / trade / religion-spread; downstream consumers
   * (UI, `lib/citychars.ts` character roller) read it to flavor each country.
   */
  raceBias: { primary: RaceType; secondary?: RaceType };
}

/**
 * Per-`RegionBiome` race-bias weights — each entry is a `RaceType → multiplier`
 * map applied on top of the base `RACE_SPECS[r].prob` weights when picking a
 * country's primary race. Designed so cold/mountainous biomes lean dwarven,
 * forests lean elven, deserts lean orc/half-orc, with humans dominant
 * everywhere as the all-purpose fallback.
 */
const BIOME_RACE_WEIGHTS: Record<RegionBiome, Partial<Record<RaceType, number>>> = {
  temperate: { human: 3, half_elf: 1.5, halfling: 1.2 },
  tropical:  { human: 2, half_elf: 1.5, halfling: 1.5, elf: 1.2 },
  arid:      { human: 2, half_orc: 1.5, dwarf: 1.2 },
  desert:    { human: 1.5, half_orc: 2, orc: 4 },
  swamp:     { human: 1.5, half_orc: 1.5, halfling: 1.5 },
  tundra:    { human: 1.5, dwarf: 3, gnome: 1.5 },
};

/**
 * Forest biomes don't get their own RegionBiome bucket (they fold into
 * 'temperate' / 'tropical' via BIOME_TO_REGION_BIOME), so the elven lean
 * already lives inside the temperate / tropical entries above.
 */

function pickRaceBias(
  worldSeed: string,
  countryId: string,
  biome: RegionBiome,
): { primary: RaceType; secondary?: RaceType } {
  const rng = seededPRNG(worldSeed + '_racebias_' + countryId);
  const biomeMult = BIOME_RACE_WEIGHTS[biome] ?? {};

  let total = 0;
  const weights: number[] = [];
  for (const r of RACE_TYPES) {
    // Fantasy `RACE_SPECS[r].prob` is intentionally re-imported via the
    // fantasy package's type exports so this stays decoupled from the file.
    const base = BASE_RACE_PROB[r];
    const mult = biomeMult[r] ?? 1;
    const w = Math.max(0, base * mult);
    weights.push(w);
    total += w;
  }
  if (total <= 0) return { primary: 'human' };

  // First draw — primary race.
  let r = rng() * total;
  let primary: RaceType = RACE_TYPES[0];
  for (let i = 0; i < RACE_TYPES.length; i++) {
    if (r < weights[i]) { primary = RACE_TYPES[i]; break; }
    r -= weights[i];
  }

  // Second draw — secondary race, excluding the primary. ~60% chance the
  // country has a meaningful secondary culture; otherwise leave it monocultural.
  const wantSecondary = rng() < 0.6;
  if (!wantSecondary) return { primary };

  let total2 = 0;
  const weights2: number[] = new Array(RACE_TYPES.length);
  for (let i = 0; i < RACE_TYPES.length; i++) {
    weights2[i] = RACE_TYPES[i] === primary ? 0 : weights[i];
    total2 += weights2[i];
  }
  if (total2 <= 0) return { primary };
  let r2 = rng() * total2;
  let secondary: RaceType | undefined;
  for (let i = 0; i < RACE_TYPES.length; i++) {
    if (r2 < weights2[i]) { secondary = RACE_TYPES[i]; break; }
    r2 -= weights2[i];
  }
  return secondary ? { primary, secondary } : { primary };
}

/**
 * Snapshot of `RACE_SPECS[r].prob` indexed by race. Frozen here to keep
 * Country.ts free of a fantasy/RaceType.ts deep import cycle and so the
 * race-bias rolls stay independent of any future reordering of `RACE_SPECS`.
 * Must be kept in sync with `RACE_SPECS` whenever weights change.
 */
const BASE_RACE_PROB: Record<RaceType, number> = {
  dwarf: 4, elf: 4, gnome: 1, half_elf: 3, half_orc: 3,
  halfling: 2, human: 5, orc: 0.1,
};

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

    const countryId = IdUtil.id('country', absYear, rngHex(rng)) ?? 'country_unknown';
    // Race bias is decided on an isolated PRNG sub-stream keyed on the world
    // seed + country id, so it does not perturb the main timeline RNG and
    // `npm run sweep` stays byte-identical.
    const raceBias = pickRaceBias(world.seed, countryId, region.biome);
    const country: CountryEvent = {
      id: countryId,
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
      raceBias,
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
