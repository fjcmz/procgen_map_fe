import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Illustrate, IllustrateType } from './Illustrate';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export type TechField = 'science' | 'military' | 'industry' | 'energy' | 'growth' | 'exploration' | 'biology' | 'art' | 'government';

const TECH_FIELD_WEIGHTS: Record<TechField, number> = {
  science: 3, military: 3, industry: 3, energy: 2, growth: 2,
  exploration: 1, biology: 1, art: 1, government: 1,
};
const TECH_FIELD_TOTAL = (Object.values(TECH_FIELD_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

/** Fields that affect trade capacity: each known tech multiplies capacity by (1 + level/10). */
export const TRADE_TECHS = new Set<TechField>(['exploration', 'growth', 'industry', 'government']);

/** Mapping from illustrate type to eligible tech fields. */
const ILLUSTRATE_TO_TECH: Record<IllustrateType, TechField[]> = {
  science: ['science', 'biology', 'energy'],
  military: ['military'],
  industry: ['industry', 'energy', 'growth'],
  philosophy: ['government', 'exploration', 'art'],
  religion: ['government', 'art'],
  art: ['art'],
};

export interface Tech {
  readonly id: string;
  readonly field: TechField;
  level: number;
  readonly discoverer: string; // illustrate ID
  year?: Year;
}

function pickTechField(rng: () => number): TechField {
  let r = rng() * TECH_FIELD_TOTAL;
  for (const [field, w] of Object.entries(TECH_FIELD_WEIGHTS) as [TechField, number][]) {
    r -= w;
    if (r <= 0) return field;
  }
  return 'science';
}

/**
 * Merge tech maps by keeping max-level per field.
 * Used when forming countries (merging all city techs).
 */
export function mergeAllTechs(techMaps: Iterable<Map<TechField, Tech>>): Map<TechField, Tech> {
  const merged = new Map<TechField, Tech>();
  for (const techMap of techMaps) {
    for (const [field, tech] of techMap) {
      const existing = merged.get(field);
      if (!existing || tech.level > existing.level) {
        merged.set(field, tech);
      }
    }
  }
  return merged;
}

/**
 * Returns delta map: fields where the tech is absent in original or level increased in new.
 * Used by Conquer to determine acquired technologies.
 */
export function getNewTechs(
  originalTechs: Map<TechField, Tech>,
  newTechs: Map<TechField, Tech>
): Map<TechField, Tech> {
  const delta = new Map<TechField, Tech>();
  for (const [field, tech] of newTechs) {
    const original = originalTechs.get(field);
    if (!original || tech.level > original.level) {
      delta.set(field, tech);
    }
  }
  return delta;
}

export class TechGenerator {
  generate(rng: () => number, year: Year, world: World): Tech | null {
    // Pick a random usable illustrate
    if (world.mapUsableIllustrates.size === 0) return null;

    const illustrates = Array.from(world.mapUsableIllustrates.values()) as Illustrate[];
    // Shuffle
    for (let i = illustrates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [illustrates[i], illustrates[j]] = [illustrates[j], illustrates[i]];
    }

    const illustrate = illustrates[0];
    if (!illustrate) return null;

    // Determine eligible tech fields from illustrate type
    const eligibleFields = ILLUSTRATE_TO_TECH[illustrate.type];
    if (!eligibleFields || eligibleFields.length === 0) {
      // Fallback: pick random field
      const field = pickTechField(rng);
      return this._createTech(rng, year, world, illustrate, field);
    }

    // Pick one of the eligible fields
    const field = eligibleFields[Math.floor(rng() * eligibleFields.length)];
    return this._createTech(rng, year, world, illustrate, field);
  }

  private _createTech(
    rng: () => number,
    year: Year,
    world: World,
    illustrate: Illustrate,
    field: TechField,
  ): Tech {
    // Determine known-tech map scope
    const originCity = illustrate.originCity;
    let techMap: Map<TechField, Tech> | undefined;

    if (originCity) {
      const region = world.mapRegions.get(originCity.regionId);
      if (region && region.countryId) {
        const country = world.mapCountries.get(region.countryId);
        if (country && country.memberOf) {
          // Empire scope: use empire founder country's techs
          const founderCountry = world.mapCountries.get(country.memberOf.foundedBy);
          if (founderCountry) techMap = founderCountry.knownTechs;
        }
        if (!techMap && country) techMap = country.knownTechs;
      }
      if (!techMap) techMap = originCity.knownTechs as Map<TechField, Tech>;
    }

    const existingLevel = techMap?.get(field)?.level ?? 0;
    const level = existingLevel + 1;
    const absYear = year.year;

    const tech: Tech = {
      id: IdUtil.id('tech', absYear, field, level, rngHex(rng)) ?? 'tech_unknown',
      field,
      level,
      discoverer: illustrate.id,
      year,
    };

    // Insert/replace in the known-tech map
    if (techMap) {
      techMap.set(field, tech);
    }

    // Consume illustrate
    illustrate.greatDeed = `Discovered ${field} level ${level}`;
    world.mapUsableIllustrates.delete(illustrate.id);

    return tech;
  }
}

export const techGenerator = new TechGenerator();
