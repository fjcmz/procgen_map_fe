import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Illustrate, IllustrateType } from './Illustrate';
import type { CityEntity } from '../physical/CityEntity';

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

/**
 * Minimal structural type for country-like objects with empire + tech state.
 * Kept local here to avoid a circular `import type { CountryEvent } from './Country'`
 * (Country.ts already imports from this file).
 */
interface TechScope {
  knownTechs: Map<TechField, Tech>;
  memberOf: { foundedBy: string } | null;
}

/**
 * Resolve a country's effective tech map: empire-founder country if the
 * country is a member, else the country's own map. Load-bearing only for
 * empire-member countries — plain countries return themselves.
 */
export function getCountryEffectiveTechs(world: World, country: TechScope): Map<TechField, Tech> {
  if (country.memberOf) {
    const founder = world.mapCountries.get(country.memberOf.foundedBy) as TechScope | undefined;
    if (founder) return founder.knownTechs;
  }
  return country.knownTechs;
}

export function getCountryTechLevel(world: World, country: TechScope, field: TechField): number {
  return getCountryEffectiveTechs(world, country).get(field)?.level ?? 0;
}

/**
 * Resolve a city's effective tech map via region → country → empire-founder.
 * Falls back to the city's own map only when the city has no country yet.
 * Mirrors the scope ladder used by TechGenerator._createTech so Phase 1
 * effects read from the same place tech was originally recorded.
 */
export function getCityEffectiveTechs(world: World, city: CityEntity): Map<TechField, Tech> | null {
  const region = world.mapRegions.get(city.regionId);
  if (region?.countryId) {
    const country = world.mapCountries.get(region.countryId) as TechScope | undefined;
    if (country) return getCountryEffectiveTechs(world, country);
  }
  return (city.knownTechs as Map<TechField, Tech>) ?? null;
}

export function getCityTechLevel(world: World, city: CityEntity, field: TechField): number {
  return getCityEffectiveTechs(world, city)?.get(field)?.level ?? 0;
}

export class TechGenerator {
  generate(rng: () => number, year: Year, world: World): Tech | null {
    // Pick a usable illustrate, weighted toward illustrates whose country has
    // higher `science` tech (Phase 1: models scientific institutions attracting
    // talent). Weight = 1 + 0.25 * min(sciLevel, 8); max weight 3.0. The cap is
    // tightened from the spec-suggested 0.5/level because techGenerator.generate
    // runs up to 5 times per year (YearGenerator:227, rndSize(5, 1)) — a larger
    // coefficient would snowball the tech leader.
    if (world.mapUsableIllustrates.size === 0) return null;

    const illustrates = Array.from(world.mapUsableIllustrates.values()) as Illustrate[];
    const weights = illustrates.map(ill => {
      if (!ill.originCity) return 1;
      const sciLevel = getCityTechLevel(world, ill.originCity, 'science');
      return 1 + 0.25 * Math.min(sciLevel, 8);
    });

    let total = 0;
    for (const w of weights) total += w;
    let r = rng() * total;
    let chosenIdx = illustrates.length - 1;
    for (let i = 0; i < illustrates.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosenIdx = i; break; }
    }

    const illustrate = illustrates[chosenIdx];
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
    // Determine known-tech map scope via the shared helper (empire founder → country → city)
    const originCity = illustrate.originCity;
    const techMap: Map<TechField, Tech> | null = originCity
      ? getCityEffectiveTechs(world, originCity)
      : null;

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
