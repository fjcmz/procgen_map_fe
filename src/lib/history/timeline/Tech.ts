import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Illustrate, IllustrateType } from './Illustrate';
import type { CityEntity } from '../physical/CityEntity';
import type { Spirit } from './Country';
import { getCountryStandingWonderTierSum } from './Wonder';

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

/**
 * Spec stretch §2: sentinel `Tech.discoverer` value for techs acquired via
 * trade-driven diffusion. Distinct from any real illustrate ID so the
 * HistoryGenerator and any future serializers can distinguish "discovered
 * by an illustrate" from "diffused via trade route" without an extra flag.
 */
export const TRADE_DIFFUSION_DISCOVERER = 'trade_diffusion';

/** Mapping from illustrate type to eligible tech fields. */
const ILLUSTRATE_TO_TECH: Record<IllustrateType, TechField[]> = {
  science: ['science', 'biology', 'energy'],
  military: ['military'],
  industry: ['industry', 'energy', 'growth'],
  philosophy: ['government', 'exploration', 'art'],
  religion: ['government', 'art'],
  art: ['art'],
};

/**
 * Phase 2 — Soft adjacency graph for tech leveling. To advance a field from
 * level (N-1) to level N (where N >= 2), at least one neighbour in this graph
 * must already be at level >= N-1 in the same country-scope tech map. The
 * graph is bidirectional and hand-mirrored. NOT exported — implementation
 * detail of `_pickFieldForCountry`. The spec also mentions `art ↔ religion-flag`,
 * which has no corresponding TechField; it collapses to `art ↔ government`.
 */
const TECH_ADJACENCY: Record<TechField, ReadonlyArray<TechField>> = {
  science:     ['biology', 'energy'],
  biology:     ['science'],
  energy:      ['science', 'industry'],
  industry:    ['energy', 'growth', 'military'],
  growth:      ['industry'],
  military:    ['industry', 'government'],
  government:  ['military', 'art', 'exploration'],
  art:         ['government'],
  exploration: ['government'],
};

/**
 * Phase 2 — per-country spirit alignment bonus. Fields listed here get a
 * weight bump in `_pickFieldForCountry` for the matching spirit. Bounded
 * (multiplier is 1.5×) to avoid the snowball pitfall flagged in Phase 1.
 */
const SPIRIT_FIELD_BONUS: Record<Spirit, ReadonlyArray<TechField>> = {
  military:    ['military'],
  religious:   ['art', 'government'],
  industrious: ['industry', 'energy', 'growth'],
  neutral:     [],
};

// One-shot sanity check: TECH_ADJACENCY must be symmetric. Runs once at
// module load (~20 ops, trivially cheap). Mirrors the unconditional Phase 0
// monotonicity check in mapgen.worker.ts.
(function _assertTechAdjacencySymmetric(): void {
  for (const [a, neigh] of Object.entries(TECH_ADJACENCY) as [TechField, ReadonlyArray<TechField>][]) {
    for (const b of neigh) {
      if (!TECH_ADJACENCY[b]?.includes(a)) {
        throw new Error(`TECH_ADJACENCY not symmetric: ${a} → ${b} (missing reverse edge)`);
      }
    }
  }
})();

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

/**
 * Spec stretch §2: write a diffused tech into the receiver country's
 * effective tech map. The caller (`tradeGenerator.generate`) owns
 * eligibility, gap computation, donor/receiver picking, probability, and
 * `newLevel` derivation. This helper only mints the `Tech` object and
 * writes it through `getCountryEffectiveTechs` so empire-member countries
 * mutate the founder's shared map — same scope ladder the Phase 1 tech
 * effects and the spec stretch §1 cataclysm tech-loss path use.
 *
 * The minted tech uses `TRADE_DIFFUSION_DISCOVERER` instead of an
 * illustrate ID, and no illustrate is consumed from `mapUsableIllustrates`
 * — the whole point of the alternative discovery path.
 */
export function recordDiffusedTech(
  rng: () => number,
  year: Year,
  world: World,
  receiver: TechScope,
  field: TechField,
  newLevel: number,
): Tech {
  const absYear = year.year;
  const tech: Tech = {
    id: IdUtil.id('tech', absYear, field, newLevel, rngHex(rng)) ?? 'tech_unknown',
    field,
    level: newLevel,
    discoverer: TRADE_DIFFUSION_DISCOVERER,
    year,
  };
  getCountryEffectiveTechs(world, receiver).set(field, tech);
  return tech;
}

export class TechGenerator {
  /**
   * Phase 2 — own the entire per-year tech-discovery flow.
   *
   * 1. Throughput cap: N = clamp(0..5, floor(log10(worldPop / 10_000))).
   *    Pop 10k→0, 100k→1, 1M→2, 10M→3, 100M→4, 1B→5.
   * 2. Bucket usable illustrates by their resolved country (via
   *    originCity → region → countryId). Stateless (no country yet)
   *    illustrates fall into a separate pool.
   * 3. Iterate countries in shuffled order; each country with illustrates
   *    rolls min(1, count/5). On success, pick a discoverer (uniform random
   *    inside its bucket) and a field via `_pickFieldForCountry` (which
   *    applies unknown-bonus, spirit-alignment, and soft adjacency
   *    prerequisites). Stop when N techs have been generated.
   * 4. If slots remain and stateless illustrates exist, run ONE legacy
   *    science-weighted pick over the stateless bucket.
   *
   * The bucket is built once at the top of the call from a snapshot of
   * `mapUsableIllustrates`; `_createTech` deletes from that map as we go,
   * but our captured arrays are unaffected so there is no concurrent-
   * modification hazard within the year.
   */
  generateForYear(rng: () => number, year: Year, world: World): Tech[] {
    const results: Tech[] = [];

    // Step 1 — throughput cap
    const N = this._throughputCap(year.worldPopulation);
    if (N === 0 || world.mapUsableIllustrates.size === 0) return results;

    // Step 2 — bucket illustrates
    const byCountry = new Map<string, Illustrate[]>();
    const stateless: Illustrate[] = [];
    for (const ill of world.mapUsableIllustrates.values() as Iterable<Illustrate>) {
      const countryId = this._resolveCountryId(world, ill);
      if (countryId && world.mapCountries.has(countryId)) {
        const arr = byCountry.get(countryId);
        if (arr) arr.push(ill);
        else byCountry.set(countryId, [ill]);
      } else {
        stateless.push(ill);
      }
    }

    // Step 3 — per-country rolls in shuffled order (Fisher-Yates)
    const entries = Array.from(byCountry.entries());
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }

    for (const [countryId, illustrates] of entries) {
      if (results.length >= N) break;
      const country = world.mapCountries.get(countryId);
      if (!country) continue;
      // Per-country roll: min(1, illustrateCount / 5 + 0.05 × wonderTierSum)
      const wonderTierSum = getCountryStandingWonderTierSum(world, countryId);
      const chance = Math.min(1, illustrates.length / 5 + 0.05 * wonderTierSum);
      if (rng() >= chance) continue;

      // Pick discoverer uniform random over the bucket
      const illustrate = illustrates[Math.floor(rng() * illustrates.length)];
      if (!illustrate) continue;

      const field = this._pickFieldForCountry(rng, world, country, illustrate);
      if (!field) continue; // soft-prereq filter blocked all eligible fields

      results.push(this._createTech(rng, year, world, illustrate, field));
    }

    // Step 4 — stateless tail (one legacy single-roll)
    if (results.length < N && stateless.length > 0) {
      const t = this._pickStatelessTech(rng, year, world, stateless);
      if (t) results.push(t);
    }

    return results;
  }

  /** Phase 2 throughput cap: floor(log10(worldPop / 10_000)) clamped to [0, 5]. */
  private _throughputCap(worldPopulation: number): number {
    if (worldPopulation < 10_000) return 0;
    const raw = Math.floor(Math.log10(worldPopulation / 10_000));
    return Math.max(0, Math.min(5, raw));
  }

  /** Resolve an illustrate's owning country via originCity → region → countryId. */
  private _resolveCountryId(world: World, ill: Illustrate): string | null {
    const city = ill.originCity;
    if (!city) return null;
    const region = world.mapRegions.get(city.regionId);
    return region?.countryId ?? null;
  }

  /**
   * Phase 2 field selection for a country path. Returns null if no eligible
   * field passes the soft-prereq filter (caller skips the slot).
   */
  private _pickFieldForCountry(
    rng: () => number,
    world: World,
    country: { knownTechs: Map<TechField, Tech>; memberOf: { foundedBy: string } | null; spirit: Spirit },
    illustrate: Illustrate,
  ): TechField | null {
    const eligible = ILLUSTRATE_TO_TECH[illustrate.type];
    if (!eligible || eligible.length === 0) {
      // Defensive fallback — every IllustrateType currently maps to ≥1 field
      return pickTechField(rng);
    }

    const effectiveTechs = getCountryEffectiveTechs(world, country);
    const aligned = SPIRIT_FIELD_BONUS[country.spirit];

    type Candidate = { field: TechField; weight: number };
    const candidates: Candidate[] = [];
    for (const field of eligible) {
      const currentLevel = effectiveTechs.get(field)?.level ?? 0;
      const nextLevel = currentLevel + 1;

      // Soft prerequisite: nextLevel ≥ 2 needs an adjacent field at ≥ nextLevel - 1
      if (nextLevel >= 2) {
        const adjacents = TECH_ADJACENCY[field];
        let satisfied = false;
        for (const adj of adjacents) {
          if ((effectiveTechs.get(adj)?.level ?? 0) >= nextLevel - 1) {
            satisfied = true;
            break;
          }
        }
        if (!satisfied) continue;
      }

      // Weight = base × unknownMult × spiritMult
      const unknownMult = currentLevel === 0 ? 2.0 : 1.0;
      const spiritMult = aligned.includes(field) ? 1.5 : 1.0;
      candidates.push({ field, weight: unknownMult * spiritMult });
    }

    if (candidates.length === 0) return null;

    // Weighted pick
    let total = 0;
    for (const c of candidates) total += c.weight;
    let r = rng() * total;
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) return c.field;
    }
    return candidates[candidates.length - 1].field;
  }

  /**
   * Legacy single-tech path used as the stateless fallback when slots remain
   * after the per-country pass. Preserves the Phase 1 science-weighted
   * illustrate picker (weight = 1 + 0.25 × min(sciLevel, 8)). Operates on
   * the stateless bucket only — does not touch the per-country illustrates.
   */
  private _pickStatelessTech(
    rng: () => number,
    year: Year,
    world: World,
    illustrates: Illustrate[],
  ): Tech | null {
    if (illustrates.length === 0) return null;

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

    const eligibleFields = ILLUSTRATE_TO_TECH[illustrate.type];
    const field = (eligibleFields && eligibleFields.length > 0)
      ? eligibleFields[Math.floor(rng() * eligibleFields.length)]
      : pickTechField(rng);
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
