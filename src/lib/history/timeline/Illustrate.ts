import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';
import { generateIllustrateName } from '../nameGenerator';
import type { PcClassType } from '../../fantasy/PcClassType';
import { PC_CLASS_TYPES } from '../../fantasy/PcClassType';
import { seededPRNG } from '../../terrain/noise';

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

/**
 * Type → D&D class weight table. Used by `pickPcClass` (isolated sub-stream)
 * to give each illustrate a class consistent with their type at sim time, so
 * the same illustrate always reads as the same character no matter when the
 * city's roster is opened. Mapping mirrors the intuitions in
 * `lib/citychars.ts::CLASS_LANDMARK_AFFINITY` so the affiliation pass naturally
 * lands religion-illustrate clerics at temples, military-illustrate fighters
 * at citadels, etc.
 */
const ILLUSTRATE_TO_CLASS_WEIGHTS: Record<IllustrateType, Partial<Record<PcClassType, number>>> = {
  religion:   { cleric: 6, paladin: 2, monk: 1 },
  science:    { wizard: 6, sorcerer: 1 },
  philosophy: { wizard: 3, bard: 2, druid: 1, sorcerer: 1 },
  industry:   { rogue: 3, fighter: 2, bard: 1 },
  military:   { fighter: 5, barbarian: 3, paladin: 1, ranger: 1 },
  art:        { bard: 6, sorcerer: 1 },
};

/** Inclusive level band for illustrate-derived characters. */
const ILLUSTRATE_LEVEL_MIN = 8;
const ILLUSTRATE_LEVEL_MAX = 15;

function pickPcClass(rng: () => number, type: IllustrateType): PcClassType {
  const weights = ILLUSTRATE_TO_CLASS_WEIGHTS[type];
  let total = 0;
  for (const c of PC_CLASS_TYPES) total += weights[c] ?? 0;
  if (total <= 0) return 'fighter';
  let r = rng() * total;
  for (const c of PC_CLASS_TYPES) {
    const w = weights[c] ?? 0;
    if (w <= 0) continue;
    r -= w;
    if (r <= 0) return c;
  }
  return 'fighter';
}

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
  /**
   * D&D 3.5e class baked at sim time from an isolated PRNG sub-stream
   * (`${world.seed}_illustrate_${id}`) so the city's UI roster can spawn this
   * illustrate as a real character with a class consistent with their type.
   * Sub-stream isolation keeps `npm run sweep` byte-stable — same discipline
   * as `Country.raceBias` and `Religion.deity`.
   */
  readonly pcClass: PcClassType;
  /** Character level rolled in [ILLUSTRATE_LEVEL_MIN, ILLUSTRATE_LEVEL_MAX]. */
  readonly pcLevel: number;
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

    const id = IdUtil.id('illustrate', absYear, type, rngHex(rng)) ?? 'illustrate_unknown';

    // Isolated sub-stream — does NOT consume `rng`, so sweep stays byte-stable.
    // Same discipline as `Country.pickRaceBias` and `Religion.pickDeity`.
    const charRng = seededPRNG(world.seed + '_illustrate_' + id);
    const pcClass = pickPcClass(charRng, type);
    const pcLevel = ILLUSTRATE_LEVEL_MIN + Math.floor(charRng() * (ILLUSTRATE_LEVEL_MAX - ILLUSTRATE_LEVEL_MIN + 1));

    const illustrate: Illustrate = {
      id,
      name,
      type,
      city: city.id,
      yearsActive,
      greatDeed: '',
      diedOn: null,
      deathCause: '',
      birthYear: absYear,
      pcClass,
      pcLevel,
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
