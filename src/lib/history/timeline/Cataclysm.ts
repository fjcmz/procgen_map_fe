import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { cityVisitor } from '../physical/CityVisitor';
import { computeCitySize } from '../physical/CityEntity';
import type { CityEntity } from '../physical/CityEntity';
import type { Illustrate } from './Illustrate';
import type { Wonder } from './Wonder';
import type { CountryEvent } from './Country';
import type { TechField } from './Tech';
import { getCityTechLevel, getCountryTechLevel, getCountryEffectiveTechs } from './Tech';
import { ruinifyCity } from './Ruin';

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

export type CataclysmType = 'earthquake' | 'volcano' | 'tornado' | 'asteroid' | 'tsunami' | 'flood' | 'heat_wave' | 'cold_wave' | 'drought';

interface CataclysmTypeInfo {
  probability: number;
  killRollN: number;
  killRollSides: number;
  canDestroyWonder: boolean;
}

const CATACLYSM_TYPES: Record<CataclysmType, CataclysmTypeInfo> = {
  earthquake:  { probability: 50, killRollN: 10, killRollSides: 3, canDestroyWonder: true },
  volcano:     { probability: 30, killRollN: 7,  killRollSides: 5, canDestroyWonder: true },
  tornado:     { probability: 50, killRollN: 8,  killRollSides: 4, canDestroyWonder: true },
  asteroid:    { probability: 1,  killRollN: 20, killRollSides: 2, canDestroyWonder: true },
  tsunami:     { probability: 5,  killRollN: 15, killRollSides: 2, canDestroyWonder: true },
  flood:       { probability: 70, killRollN: 6,  killRollSides: 3, canDestroyWonder: false },
  heat_wave:   { probability: 80, killRollN: 3,  killRollSides: 4, canDestroyWonder: false },
  cold_wave:   { probability: 80, killRollN: 3,  killRollSides: 4, canDestroyWonder: false },
  drought:     { probability: 70, killRollN: 5,  killRollSides: 4, canDestroyWonder: false },
};
const CATACLYSM_TYPE_TOTAL = (Object.values(CATACLYSM_TYPES) as CataclysmTypeInfo[])
  .reduce((a, b) => a + b.probability, 0);

// Slow-onset, survivable-with-medicine/food-storage disasters. No explicit
// plague type exists today; these are the closest "biology applies" analogues.
// Impact events (earthquake, volcano, asteroid, tsunami, tornado) are NOT
// included — biology tech can't realistically mitigate instantaneous destruction.
const BIOLOGY_MITIGATED: ReadonlySet<CataclysmType> = new Set(['drought', 'heat_wave', 'cold_wave', 'flood']);

// Spec stretch §1: large knowledge-destroying disasters can erase tech.
// `fire/war/plague/dark_age/magical` from the spec are mapped onto the
// closest existing physical disasters — volcano (firestorm), asteroid
// (impact + library loss), tornado (structural). Earthquakes, tsunamis,
// floods, and slow-onset disasters are excluded: they kill people and
// crops, not libraries.
const KNOWLEDGE_DESTROYING: ReadonlySet<CataclysmType> = new Set(['volcano', 'asteroid', 'tornado']);

export type CataclysmStrength = 'local' | 'regional' | 'continental' | 'global';

const STRENGTH_WEIGHTS: Record<CataclysmStrength, number> = {
  local: 100, regional: 10, continental: 2, global: 1,
};
const STRENGTH_TOTAL = (Object.values(STRENGTH_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

const ALL_TECH_FIELDS: readonly TechField[] = [
  'science', 'military', 'industry', 'energy', 'growth',
  'exploration', 'biology', 'art', 'government',
];

const WONDER_DESTROY_BASE_CHANCE: Record<CataclysmStrength, number> = {
  local: 0.30, regional: 0.55, continental: 0.80, global: 0.95,
};

function pickCataclysmType(rng: () => number): CataclysmType {
  let r = rng() * CATACLYSM_TYPE_TOTAL;
  for (const [type, info] of Object.entries(CATACLYSM_TYPES) as [CataclysmType, CataclysmTypeInfo][]) {
    r -= info.probability;
    if (r <= 0) return type;
  }
  return 'earthquake';
}

function pickStrength(rng: () => number): CataclysmStrength {
  let r = rng() * STRENGTH_TOTAL;
  for (const [str, w] of Object.entries(STRENGTH_WEIGHTS) as [CataclysmStrength, number][]) {
    r -= w;
    if (r <= 0) return str;
  }
  return 'local';
}

/** Spec stretch §1: a single tech-loss applied to a country by a cataclysm. */
export interface TechLossEntry {
  countryId: string;
  field: TechField;
  /** Post-decrement level. 0 means the field was removed from `knownTechs`. */
  newLevel: number;
}

/** Spec stretch §1: a tech-loss roll that `government >= 2` silently absorbed. */
export interface AbsorbedTechLossEntry {
  countryId: string;
  field: TechField;
  /** Untouched current level (no decrement applied). */
  level: number;
}

export interface Cataclysm {
  readonly id: string;
  readonly type: CataclysmType;
  readonly strength: CataclysmStrength;
  readonly city: string; // epicenter city ID
  killRatio: number;
  killed: number;
  /** Spec stretch §1: techs degraded by this cataclysm (empty if none). */
  techLosses: TechLossEntry[];
  /** Spec stretch §1: tech-loss rolls absorbed by `government >= 2` (empty if none). */
  absorbedTechLosses: AbsorbedTechLossEntry[];
  year?: Year;
}

/**
 * Spec stretch §1: degrade country techs after a knowledge-destroying cataclysm.
 *
 * Trigger gates: cataclysm strength must be `continental` or `global`, and
 * the type must be in `KNOWLEDGE_DESTROYING`. For each affected country we
 * roll up to `lossCount` times at `lossChance` each; on success we pick a
 * field weighted by current level (high levels are more "fragile" because
 * they depend on more infrastructure) and decrement it by 1, removing the
 * entry entirely if it hits 0. `government >= 2` silently absorbs each
 * loss but the roll/pick is still recorded so the timeline can show what
 * was saved.
 */
function applyTechLoss(
  cataclysm: Cataclysm,
  affectedCountries: Set<CountryEvent>,
  world: World,
  rng: () => number,
): void {
  if (!KNOWLEDGE_DESTROYING.has(cataclysm.type)) return;
  if (cataclysm.strength !== 'continental' && cataclysm.strength !== 'global') return;

  const lossChance = cataclysm.strength === 'global' ? 0.6 : 0.3;
  const lossCount = cataclysm.strength === 'global' ? 2 : 1;

  for (const country of affectedCountries) {
    const govLevel = getCountryTechLevel(world, country, 'government');
    // Empire-aware: writes through the founder's map for empire members,
    // mirroring the read scope used elsewhere in Phase 1.
    const techs = getCountryEffectiveTechs(world, country);

    for (let i = 0; i < lossCount; i++) {
      if (rng() >= lossChance) continue;

      // Build a level-weighted candidate pool of fields with level >= 1.
      const candidates: { field: TechField; level: number }[] = [];
      let totalWeight = 0;
      for (const [field, tech] of techs.entries()) {
        if (tech.level >= 1) {
          candidates.push({ field, level: tech.level });
          totalWeight += tech.level;
        }
      }
      if (candidates.length === 0) break; // nothing left to lose this country

      let r = rng() * totalWeight;
      let pick = candidates[0];
      for (const c of candidates) {
        r -= c.level;
        if (r <= 0) {
          pick = c;
          break;
        }
      }

      if (govLevel >= 2) {
        cataclysm.absorbedTechLosses.push({
          countryId: country.id,
          field: pick.field,
          level: pick.level,
        });
        continue;
      }

      const tech = techs.get(pick.field)!;
      tech.level -= 1;
      if (tech.level <= 0) techs.delete(pick.field);
      cataclysm.techLosses.push({
        countryId: country.id,
        field: pick.field,
        newLevel: tech.level,
      });
    }
  }
}

interface CasualtyResult {
  killed: number;
  shouldRuin: boolean;
}

function applyCasualties(city: CityEntity, killRatio: number, world: World, mitigation = 0): CasualtyResult {
  const effectiveRatio = killRatio * (1 - mitigation);
  const prePop = city.currentPopulation;
  const casualties = Math.round(prePop * effectiveRatio);

  // ≥90% population loss → city becomes a ruin (handled by caller via ruinifyCity)
  if (prePop > 0 && casualties / prePop >= 0.9) {
    city.currentPopulation = Math.max(0, prePop - casualties);
    return { killed: Math.min(casualties, prePop), shouldRuin: true };
  }

  city.currentPopulation -= casualties;
  // Shrink city tier if population dropped below thresholds
  const govLevel = getCityTechLevel(world, city, 'government');
  const indLevel = getCityTechLevel(world, city, 'industry');
  city.size = computeCitySize(city.currentPopulation, govLevel, indLevel);
  return { killed: casualties, shouldRuin: false };
}

export class CataclysmGenerator {
  generate(rng: () => number, year: Year, world: World): Cataclysm | null {
    // Pick a random usable city as epicenter
    const epicenterCity = cityVisitor.selectRandomUsable(world, () => true, rng);
    if (!epicenterCity) return null;

    const type = pickCataclysmType(rng);
    const strength = pickStrength(rng);
    const typeInfo = CATACLYSM_TYPES[type];
    const killRollResult = roll(rng, typeInfo.killRollN, typeInfo.killRollSides);
    const killRatio = killRollResult / 100;
    const absYear = year.year;

    const cataclysm: Cataclysm = {
      id: IdUtil.id('cataclysm', absYear, type, strength, rngHex(rng)) ?? 'cataclysm_unknown',
      type,
      strength,
      city: epicenterCity.id,
      killRatio,
      killed: 0,
      techLosses: [],
      absorbedTechLosses: [],
      year,
    };

    // Collect affected cities based on strength (cascading/fall-through)
    const affectedCities = new Set<CityEntity>();

    const epicenterRegion = world.mapRegions.get(epicenterCity.regionId);
    const epicenterContinent = epicenterRegion
      ? Array.from(world.mapContinents.values()).find(c =>
          c.regions.some(r => r.id === epicenterRegion.id)
        )
      : null;

    // Fall-through: global → continental → regional → local
    if (strength === 'global') {
      for (const city of world.mapUsableCities.values()) {
        affectedCities.add(city);
      }
    }
    if (strength === 'global' || strength === 'continental') {
      if (epicenterContinent) {
        for (const region of epicenterContinent.regions) {
          for (const city of region.cities) {
            if (world.mapUsableCities.has(city.id)) affectedCities.add(city);
          }
        }
      }
    }
    if (strength === 'global' || strength === 'continental' || strength === 'regional') {
      if (epicenterRegion) {
        for (const city of epicenterRegion.cities) {
          if (world.mapUsableCities.has(city.id)) affectedCities.add(city);
        }
      }
    }
    // Local: always applies to epicenter
    affectedCities.add(epicenterCity);

    // Apply casualties (Phase 1: `biology` tech mitigates slow-onset disasters)
    const biologyApplies = BIOLOGY_MITIGATED.has(type);
    let totalKilled = 0;
    const citiesToRuin: CityEntity[] = [];
    for (const city of affectedCities) {
      if (!world.mapUsableCities.has(city.id) && city !== epicenterCity) continue;
      let mitigation = 0;
      if (biologyApplies) {
        const bioLevel = getCityTechLevel(world, city, 'biology');
        mitigation = Math.min(0.5, 0.1 * bioLevel);
      }
      const result = applyCasualties(city, killRatio, world, mitigation);
      totalKilled += result.killed;
      city.cataclysms.push(cataclysm.id);
      if (result.shouldRuin) citiesToRuin.push(city);
    }
    cataclysm.killed = totalKilled;

    // Turn cities that lost ≥90% of population into ruins
    for (const city of citiesToRuin) {
      const ruin = ruinifyCity(city, world, year, 'cataclysm', rng);
      year.ruins.push(ruin);
    }

    // Spec stretch §1: knowledge-destroying disasters degrade country techs.
    // Resolve affected countries from affected cities (region.countryId), then
    // delegate to applyTechLoss which handles the strength/type gates.
    const affectedCountries = new Set<CountryEvent>();
    for (const city of affectedCities) {
      const region = world.mapRegions.get(city.regionId);
      if (!region?.countryId) continue;
      const country = world.mapCountries.get(region.countryId) as CountryEvent | undefined;
      if (country) affectedCountries.add(country);
    }
    applyTechLoss(cataclysm, affectedCountries, world, rng);

    // Secondary effect: Illustrate death (50% chance, scoped to affected cities)
    if (rng() < 0.5) {
      const affectedIllustrates: Illustrate[] = [];
      for (const city of affectedCities) {
        for (const illId of city.illustrates) {
          const ill = world.mapUsableIllustrates.get(illId) as Illustrate | undefined;
          if (ill) affectedIllustrates.push(ill);
        }
      }
      if (affectedIllustrates.length > 0) {
        const victim = affectedIllustrates[Math.floor(rng() * affectedIllustrates.length)];
        victim.diedOn = absYear;
        victim.deathCause = `Killed in ${type}`;
        world.mapUsableIllustrates.delete(victim.id);
      }
    }

    // Secondary effect: Wonder destruction (probabilistic, strength- and tech-gated)
    if (typeInfo.canDestroyWonder && world.mapUsableWonders.size > 0) {
      // Collect all standing wonders in affected cities
      const wonderPool: Wonder[] = [];
      for (const city of affectedCities) {
        for (const wonderId of city.wonders) {
          const w = world.mapUsableWonders.get(wonderId);
          if (w) wonderPool.push(w);
        }
      }
      if (wonderPool.length > 0) {
        // Pick a random wonder from the scoped pool
        const targetWonder = wonderPool[Math.floor(rng() * wonderPool.length)];
        // Compute tech-reduced destruction chance from the wonder's host city
        const hostCity = world.mapCities.get(targetWonder.city) as CityEntity | undefined;
        let totalTech = 0;
        if (hostCity) {
          for (const field of ALL_TECH_FIELDS) {
            totalTech += getCityTechLevel(world, hostCity, field);
          }
        }
        const baseChance = WONDER_DESTROY_BASE_CHANCE[strength];
        const destroyChance = Math.max(0.05, baseChance - 0.02 * totalTech);
        if (rng() < destroyChance) {
          targetWonder.destroyedOn = absYear;
          targetWonder.destroyCause = cataclysm.id;
          world.mapUsableWonders.delete(targetWonder.id);
        }
      }
    }

    // World end check
    if (world.mapUsableCities.size === 0) {
      world.endedOn = absYear;
      world.endedBy = cataclysm.id;
    }

    return cataclysm;
  }
}

export const cataclysmGenerator = new CataclysmGenerator();
