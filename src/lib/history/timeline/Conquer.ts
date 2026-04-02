import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { War } from './War';
import type { CountryEvent } from './Country';
import { mergeAllTechs, getNewTechs } from './Tech';

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

    // Randomly select winner between aggressor and defender
    const aggressorCountry = world.mapCountries.get(finishingWar.aggressor) as CountryEvent | undefined;
    const defenderCountry = world.mapCountries.get(finishingWar.defender) as CountryEvent | undefined;
    if (!aggressorCountry || !defenderCountry) return null;

    const winnerIsAggressor = rng() < 0.5;
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

    // Set both countries atWar = false
    conquerorCountry.atWar = false;
    conqueredCountry.atWar = false;

    // Tech assimilation: merge techs, keep max-level per field
    const originalTechs = new Map(conquerorCountry.knownTechs);
    const merged = mergeAllTechs([conquerorCountry.knownTechs, conqueredCountry.knownTechs]);
    conquerorCountry.knownTechs = merged;

    // Compute acquired delta
    const delta = getNewTechs(originalTechs, merged);
    const acquiredTechIds: string[] = [];
    for (const tech of delta.values()) {
      acquiredTechIds.push(tech.id);
    }
    if (acquiredTechIds.length > 0) {
      conquer.acquired['techs'] = acquiredTechIds;
    }

    // Empire implications
    this._handleEmpireEffects(conqueredCountry, conquerorCountry, world);

    return conquer;
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

      // If empire drops to one member: dissolve
      if (empire.countries.size <= 1) {
        empire.destroyedOn = conquered.year?.year ?? 0;
        empire.conqueredBy = conqueror.id;
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
