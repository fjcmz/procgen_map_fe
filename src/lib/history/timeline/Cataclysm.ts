import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { cityVisitor } from '../physical/CityVisitor';
import type { CityEntity } from '../physical/CityEntity';
import type { Illustrate } from './Illustrate';
import type { Wonder } from './Wonder';
import { getCityTechLevel } from './Tech';

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

export type CataclysmStrength = 'local' | 'regional' | 'continental' | 'global';

const STRENGTH_WEIGHTS: Record<CataclysmStrength, number> = {
  local: 100, regional: 10, continental: 2, global: 1,
};
const STRENGTH_TOTAL = (Object.values(STRENGTH_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

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

export interface Cataclysm {
  readonly id: string;
  readonly type: CataclysmType;
  readonly strength: CataclysmStrength;
  readonly city: string; // epicenter city ID
  killRatio: number;
  killed: number;
  year?: Year;
}

function applyCasualties(city: CityEntity, killRatio: number, world: World, mitigation = 0): number {
  const effectiveRatio = killRatio * (1 - mitigation);
  const casualties = Math.round(city.currentPopulation * effectiveRatio);
  if (casualties >= city.currentPopulation) {
    const killed = city.currentPopulation;
    city.currentPopulation = 0;
    city.destroyedOn = 1; // will be set properly by caller
    city.destroyCause = 'cataclysm';
    world.mapUsableCities.delete(city.id);
    return killed;
  }
  city.currentPopulation -= casualties;
  return casualties;
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
    for (const city of affectedCities) {
      if (!world.mapUsableCities.has(city.id) && city !== epicenterCity) continue;
      city.destroyedOn = 0; // reset
      let mitigation = 0;
      if (biologyApplies) {
        const bioLevel = getCityTechLevel(world, city, 'biology');
        mitigation = Math.min(0.5, 0.1 * bioLevel);
      }
      const killed = applyCasualties(city, killRatio, world, mitigation);
      if (city.destroyedOn === 1) city.destroyedOn = absYear;
      totalKilled += killed;
      city.cataclysms.push(cataclysm.id);
    }
    cataclysm.killed = totalKilled;

    // Secondary effect: Illustrate death (50% chance)
    if (rng() < 0.5 && world.mapUsableIllustrates.size > 0) {
      const usableIllustrates = Array.from(world.mapUsableIllustrates.values()) as Illustrate[];
      const victim = usableIllustrates[Math.floor(rng() * usableIllustrates.length)];
      if (victim) {
        victim.diedOn = absYear;
        victim.deathCause = `Killed in ${type}`;
        world.mapUsableIllustrates.delete(victim.id);
      }
    }

    // Secondary effect: Wonder destruction
    if (typeInfo.canDestroyWonder && world.mapUsableWonders.size > 0) {
      const usableWonders = Array.from(world.mapUsableWonders.values()) as Wonder[];
      // Find a wonder in an affected city
      const destroyableWonder = usableWonders.find(w =>
        Array.from(affectedCities).some(c => c.wonders.includes(w.id))
      );
      if (destroyableWonder) {
        destroyableWonder.destroyedOn = absYear;
        destroyableWonder.destroyCause = cataclysm.id;
        world.mapUsableWonders.delete(destroyableWonder.id);
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
