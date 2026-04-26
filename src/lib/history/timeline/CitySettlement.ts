import { IdUtil } from '../IdUtil';
import type { Cell } from '../../types';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CountryEvent } from './Country';
import { cityGenerator } from '../physical/CityGenerator';
import { generateCityName } from '../nameGenerator';
import { scoreCellForCity } from '../history';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface CitySettlement {
  readonly id: string;
  /** ID of the parent city that triggered the settlement. */
  readonly parentCityId: string;
  /** ID of the newly founded child city. */
  readonly childCityId: string;
  readonly countryId: string;
  readonly year: number;
}

/** BFS radius (hops) within which to search for a child city site. */
const SETTLEMENT_SEARCH_RADIUS = 20;

/** Minimum city-placement score to settle. */
const SETTLEMENT_SCORE_THRESHOLD = -2;

export class CitySettlementGenerator {
  /**
   * For each large+ city that has not yet had a settlement, try to found a
   * child city within SETTLEMENT_SEARCH_RADIUS cells in the same country.
   */
  generate(
    rng: () => number,
    year: Year,
    world: World,
    cells: Cell[],
    usedCityNames: Set<string>,
  ): CitySettlement[] {
    const absYear = year.year;
    const results: CitySettlement[] = [];

    // Build set of all existing city cell indices to avoid placing on them
    const cityCellSet = new Set<number>();
    for (const city of world.mapCities.values()) {
      cityCellSet.add(city.cellIndex);
    }

    for (const city of world.mapUsableCities.values()) {
      if (!city.founded || city.isRuin) continue;
      if (city.hasHadSettlement) continue;
      if (city.size !== 'large' && city.size !== 'metropolis' && city.size !== 'megalopolis') continue;

      // Find this city's country
      const region = world.mapRegions.get(city.regionId);
      if (!region?.countryId) continue;
      const countryId = region.countryId;
      const country = world.mapCountries.get(countryId) as CountryEvent | undefined;
      if (!country) continue;

      // Build the set of cell indices owned by this country (core + expansion)
      const countryCells = new Set<number>();
      for (const [, r] of world.mapRegions) {
        if (r.countryId === countryId || r.expansionOwnerId === countryId) {
          for (const ci of r.cellIndices) countryCells.add(ci);
        }
      }

      // BFS from parent city's cell, up to SETTLEMENT_SEARCH_RADIUS hops
      const visited = new Set<number>([city.cellIndex]);
      let frontier = [city.cellIndex];
      const candidates: { cellIndex: number; score: number }[] = [];

      for (let hop = 0; hop < SETTLEMENT_SEARCH_RADIUS && frontier.length > 0; hop++) {
        const next: number[] = [];
        for (const ci of frontier) {
          for (const ni of cells[ci].neighbors) {
            if (visited.has(ni)) continue;
            visited.add(ni);
            next.push(ni);

            // Candidate must be in same country, not water, not already a city
            if (!countryCells.has(ni)) continue;
            if (cells[ni].isWater) continue;
            if (cityCellSet.has(ni)) continue;

            const score = scoreCellForCity(cells[ni], cells);
            if (score < SETTLEMENT_SCORE_THRESHOLD) continue;
            candidates.push({ cellIndex: ni, score });
          }
        }
        frontier = next;
      }

      if (candidates.length === 0) continue;

      // Pick the best-scoring candidate
      candidates.sort((a, b) => b.score - a.score);
      const bestCell = candidates[0].cellIndex;

      // Find the region this cell belongs to
      const targetCell = cells[bestCell];
      const targetRegion = targetCell.regionId ? world.mapRegions.get(targetCell.regionId) : undefined;
      if (!targetRegion) continue;

      // Create the child city
      const childName = generateCityName(rng, usedCityNames);
      const childEntity = cityGenerator.generate(bestCell, childName, rng, targetRegion, world);
      targetRegion.cities.push(childEntity);

      // Found immediately, same initial population as a fresh foundation
      childEntity.founded = true;
      childEntity.foundedOn = absYear;
      childEntity.currentPopulation = 500;
      world.mapUsableCities.set(childEntity.id, childEntity);
      world.mapUncontactedCities.set(childEntity.id, childEntity);
      cityCellSet.add(bestCell);

      // Wire parent ↔ child
      city.hasHadSettlement = true;
      city.childCityId = childEntity.id;
      childEntity.parentCityId = city.id;

      results.push({
        id: IdUtil.id('citysettlement', absYear, rngHex(rng)) ?? 'citysettlement_unknown',
        parentCityId: city.id,
        childCityId: childEntity.id,
        countryId,
        year: absYear,
      });
    }

    return results;
  }
}

export const citySettlementGenerator = new CitySettlementGenerator();
