import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { War } from './War';
import type { CountryEvent } from './Country';
import type { Empire } from './Empire';
import { mergeAllTechs, getNewTechs, getCountryTechLevel, type TechField } from './Tech';
import { getCountryStandingWonderTierSum, getEmpireStandingWonderCount } from './Wonder';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Conquer {
  readonly id: string;
  readonly war: string; // war ID
  readonly conqueror: string; // country ID
  readonly conquered: string; // country ID
  acquired: Record<string, string[]>; // e.g. acquired["techs"] = list of tech IDs
  /**
   * Phase 3: resolved snapshot of techs the conqueror gained from this conquest.
   * Populated alongside acquired["techs"]; consumed by HistoryGenerator to
   * surface the delta in the event log without re-resolving Tech objects.
   */
  acquiredTechList?: Array<{ field: TechField; level: number }>;
  /** Set when this conquest triggered a government-tech empire dissolution. */
  dissolvedEmpireId?: string;
  year?: Year;
  inWar?: War;
  conquerorCountry?: CountryEvent;
  conqueredCountry?: CountryEvent;
}

export class ConquerGenerator {
  generate(rng: () => number, year: Year, world: World): Conquer | null {
    const absYear = year.year;

    // Find one finishing war where started + lasts == currentYear
    let finishingWar: War | null = null;
    for (const war of world.mapAliveWars.values() as Iterable<War>) {
      if (war.started + war.lasts === absYear) {
        finishingWar = war;
        break;
      }
    }
    if (!finishingWar) return null;

    // Select winner between aggressor and defender, biased by military tech
    // (Phase 1: +0.05 P(win) per level of advantage, capped at ±0.4 so the
    // roll stays in [0.1, 0.9]).
    const aggressorCountry = world.mapCountries.get(finishingWar.aggressor) as CountryEvent | undefined;
    const defenderCountry = world.mapCountries.get(finishingWar.defender) as CountryEvent | undefined;
    if (!aggressorCountry || !defenderCountry) return null;

    const aggMil = getCountryTechLevel(world, aggressorCountry, 'military');
    const defMil = getCountryTechLevel(world, defenderCountry, 'military');
    // Wonder defense bonus (Wonders_bonuses.md §5): defender's standing wonders
    // reduce the aggressor's win probability by 0.02 per tier level.
    const defWonderTiers = getCountryStandingWonderTierSum(world, defenderCountry.id);
    const wonderDefenseBonus = 0.02 * defWonderTiers;
    const militaryBias = Math.max(-0.4, Math.min(0.4, (aggMil - defMil) * 0.05 - wonderDefenseBonus));
    const winnerIsAggressor = rng() < 0.5 + militaryBias;
    const conquerorCountry = winnerIsAggressor ? aggressorCountry : defenderCountry;
    const conqueredCountry = winnerIsAggressor ? defenderCountry : aggressorCountry;

    const conquer: Conquer = {
      id: IdUtil.id('conquer', absYear, rngHex(rng)) ?? 'conquer_unknown',
      war: finishingWar.id,
      conqueror: conquerorCountry.id,
      conquered: conqueredCountry.id,
      acquired: {},
      year,
      inWar: finishingWar,
      conquerorCountry,
      conqueredCountry,
    };

    // Remove finished war from alive wars
    world.mapAliveWars.delete(finishingWar.id);

    // Only clear atWar if the country has no other alive wars remaining.
    // The finished war was already deleted from mapAliveWars above, so
    // this check only considers other concurrent wars.
    const stillAtWar = (country: CountryEvent): boolean => {
      for (const w of world.mapAliveWars.values() as Iterable<War>) {
        if (w.aggressor === country.id || w.defender === country.id) return true;
      }
      return false;
    };
    if (!stillAtWar(conquerorCountry)) conquerorCountry.atWar = false;
    if (!stillAtWar(conqueredCountry)) conqueredCountry.atWar = false;

    // Capture government tech levels BEFORE the tech merge — after merge the
    // conqueror always has max(conqueror, conquered) so the dissolution check
    // would be dead code if we read post-merge values.
    const preConquerorGov = getCountryTechLevel(world, conquerorCountry, 'government');
    const preConqueredGov = getCountryTechLevel(world, conqueredCountry, 'government');

    // Tech assimilation: merge techs, keep max-level per field
    const originalTechs = new Map(conquerorCountry.knownTechs);
    const merged = mergeAllTechs([conquerorCountry.knownTechs, conqueredCountry.knownTechs]);
    conquerorCountry.knownTechs = merged;

    // Compute acquired delta
    const delta = getNewTechs(originalTechs, merged);
    const acquiredTechIds: string[] = [];
    const acquiredTechList: Array<{ field: TechField; level: number }> = [];
    for (const tech of delta.values()) {
      acquiredTechIds.push(tech.id);
      acquiredTechList.push({ field: tech.field, level: tech.level });
    }
    if (acquiredTechIds.length > 0) {
      conquer.acquired['techs'] = acquiredTechIds;
      conquer.acquiredTechList = acquiredTechList;
    }

    // Empire implications
    this._handleEmpireEffects(conqueredCountry, conquerorCountry, world);

    // Phase 1 `government` tech: if the winner's empire integration is weaker
    // than the loser's, the conqueror's empire may dissolve entirely.
    // Base 15% chance, reduced by 2% per standing wonder across the empire
    // (prestigious monuments hold empires together). Gated on (a) the
    // conqueror is currently in an empire and (b) conquerorGov < conqueredGov.
    if (conquerorCountry.memberOf) {
      const wonderCount = getEmpireStandingWonderCount(world, conquerorCountry.memberOf);
      const dissolutionProb = Math.max(0, 0.15 - 0.02 * wonderCount);
      if (preConquerorGov < preConqueredGov && dissolutionProb > 0 && rng() < dissolutionProb) {
        conquer.dissolvedEmpireId = conquerorCountry.memberOf.id;
        this._dissolveEmpire(conquerorCountry.memberOf, absYear);
      }
    }

    // Transfer expansion regions from conquered to conqueror
    for (const region of world.mapRegions.values()) {
      if (region.expansionOwnerId === conqueredCountry.id) {
        region.expansionOwnerId = conquerorCountry.id;
      }
    }

    return conquer;
  }

  /**
   * Fully dissolve an empire: mark destroyedOn, clear all member references,
   * and release every country back to independent status. The empire event
   * itself remains in the history log.
   */
  private _dissolveEmpire(empire: Empire, absYear: number): void {
    empire.destroyedOn = absYear;
    empire.conqueredBy = ''; // self-inflicted, no specific destroyer
    if (empire.members) {
      for (const member of empire.members) member.memberOf = null;
      empire.members.clear();
    }
    empire.countries.clear();
    empire.reach.clear();
  }

  private _handleEmpireEffects(
    conquered: CountryEvent,
    conqueror: CountryEvent,
    _world: World,
  ): void {
    // If conquered belonged to an empire, remove it
    if (conquered.memberOf) {
      const empire = conquered.memberOf;
      empire.countries.delete(conquered.id);
      empire.reach.delete(conquered.governingRegion);
      empire.members?.delete(conquered);

      // If empire drops to one member: fully dissolve (release remaining
      // members, clear sets). Matches the cleanup in Ruin.ts _dissolveCountry
      // and _dissolveEmpire above.
      if (empire.countries.size <= 1) {
        empire.destroyedOn = conquered.year?.year ?? 0;
        empire.conqueredBy = conqueror.id;
        if (empire.members) {
          for (const member of empire.members) member.memberOf = null;
          empire.members.clear();
        }
        empire.countries.clear();
        empire.reach.clear();
      }
      conquered.memberOf = null;
    }

    // If conqueror belongs to an empire, add conquered
    if (conqueror.memberOf) {
      const empire = conqueror.memberOf;
      empire.countries.add(conquered.id);
      empire.reach.add(conquered.governingRegion);
      empire.members?.add(conquered);
      conquered.memberOf = empire;
    }
  }
}

export const conquerGenerator = new ConquerGenerator();
