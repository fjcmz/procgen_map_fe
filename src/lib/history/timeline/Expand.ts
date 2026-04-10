import { IdUtil } from '../IdUtil';
import type { Cell } from '../../types';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { Region } from '../physical/Region';
import type { CountryEvent } from './Country';
import { getCountryTechLevel } from './Tech';
import { cityGenerator } from '../physical/CityGenerator';
import { generateCityName } from '../nameGenerator';
import { scoreCellForCity } from '../history';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Expand {
  readonly id: string;
  readonly countryId: string;
  readonly regionId: string;
  readonly cellIndices: number[];
  readonly year: number;
}

export interface Settle {
  readonly id: string;
  readonly countryId: string;
  readonly cityId: string;
  readonly regionIds: string[];
  readonly cellIndices: number[];
  readonly year: number;
}

/** Minimum exploration tech level needed to expand into each biome. */
const BIOME_EXPANSION_DIFFICULTY: Record<string, number> = {
  temperate: 0,
  tropical: 0,
  arid: 1,
  swamp: 1,
  desert: 2,
  tundra: 2,
};

/** Minimum country population to attempt expansion. */
const EXPANSION_POP_GATE = 5_000;

/** Minimum city-placement score to settle in expansion territory. */
const SETTLE_SCORE_THRESHOLD = -2;

export class ExpandGenerator {
  /**
   * Attempt territorial expansion for all existing countries.
   * Returns arrays of Expand and Settle events produced this year.
   */
  generate(
    rng: () => number,
    year: Year,
    world: World,
    cells: Cell[],
    usedCityNames: Set<string>,
  ): { expansions: Expand[]; settlements: Settle[] } {
    const absYear = year.year;
    const expansions: Expand[] = [];
    const settlements: Settle[] = [];

    // Collect all live countries (shuffled for fairness)
    const countries = Array.from(world.mapCountries.values()) as CountryEvent[];
    for (let i = countries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [countries[i], countries[j]] = [countries[j], countries[i]];
    }

    for (const country of countries) {
      if (country.foundedOn > absYear) continue;

      // Population gate: sum city populations in country's regions
      let totalPop = 0;
      for (const city of world.mapUsableCities.values()) {
        if (!city.founded || city.isRuin) continue;
        const region = world.mapRegions.get(city.regionId);
        if (!region) continue;
        if (region.countryId === country.id || region.expansionOwnerId === country.id) {
          totalPop += city.currentPopulation;
        }
      }
      if (totalPop < EXPANSION_POP_GATE) continue;

      // Tech levels via scope ladder
      const exploration = getCountryTechLevel(world, country, 'exploration');
      const government = getCountryTechLevel(world, country, 'government');
      const growth = getCountryTechLevel(world, country, 'growth');

      // Probability of expanding this year
      const prob = Math.min(0.6, 0.2 + exploration * 0.05 + government * 0.03 + growth * 0.01);
      if (rng() > prob) continue;

      // Number of regions to attempt
      const capacity = Math.min(3, 1 + Math.floor(exploration * 0.3 + government * 0.2));

      // Find all regions owned by this country (core + expansion)
      const ownedRegionIds = new Set<string>();
      for (const [regionId, region] of world.mapRegions) {
        if (region.countryId === country.id || region.expansionOwnerId === country.id) {
          ownedRegionIds.add(regionId);
        }
      }

      // Find candidate unclaimed neighboring regions
      const candidateRegions: Region[] = [];
      for (const regionId of ownedRegionIds) {
        const region = world.mapRegions.get(regionId);
        if (!region) continue;
        for (const neighbourId of region.neighbours) {
          const neighbour = world.mapRegions.get(neighbourId);
          if (!neighbour) continue;
          if (neighbour.countryId !== null || neighbour.expansionOwnerId !== null) continue;
          // Check biome difficulty
          const difficulty = BIOME_EXPANSION_DIFFICULTY[neighbour.biome] ?? 0;
          if (exploration < difficulty) continue;
          // Avoid duplicates
          if (!candidateRegions.some(r => r.id === neighbour.id)) {
            candidateRegions.push(neighbour);
          }
        }
      }

      if (candidateRegions.length === 0) continue;

      // Shuffle candidates for randomness
      for (let i = candidateRegions.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [candidateRegions[i], candidateRegions[j]] = [candidateRegions[j], candidateRegions[i]];
      }

      // Claim up to capacity regions
      const claimed = Math.min(capacity, candidateRegions.length);
      for (let i = 0; i < claimed; i++) {
        const target = candidateRegions[i];
        target.isExpansion = true;
        target.expansionOwnerId = country.id;

        expansions.push({
          id: IdUtil.id('expand', absYear, rngHex(rng)) ?? 'expand_unknown',
          countryId: country.id,
          regionId: target.id,
          cellIndices: [...target.cellIndices],
          year: absYear,
        });
      }
    }

    // After all expansions, try settlements for each country
    this._trySettlements(rng, year, world, cells, usedCityNames, settlements);

    return { expansions, settlements };
  }

  /**
   * For each country with expansion territory, check if settlement conditions
   * are met (expansion territory >= smallest country size, good city spot exists).
   */
  private _trySettlements(
    rng: () => number,
    year: Year,
    world: World,
    cells: Cell[],
    usedCityNames: Set<string>,
    settlements: Settle[],
  ): void {
    const absYear = year.year;

    // Compute smallest country size (by cell count of governing region)
    let smallestCountrySize = Infinity;
    for (const country of world.mapCountries.values()) {
      const ce = country as CountryEvent;
      if (ce.foundedOn > absYear) continue;
      const region = world.mapRegions.get(ce.governingRegion);
      if (region) {
        smallestCountrySize = Math.min(smallestCountrySize, region.cellIndices.length);
      }
    }
    if (!isFinite(smallestCountrySize)) return;

    // For each country, gather expansion regions and check size threshold
    const countryExpansionRegions = new Map<string, Region[]>();
    for (const [, region] of world.mapRegions) {
      if (region.isExpansion && region.expansionOwnerId) {
        let arr = countryExpansionRegions.get(region.expansionOwnerId);
        if (!arr) {
          arr = [];
          countryExpansionRegions.set(region.expansionOwnerId, arr);
        }
        arr.push(region);
      }
    }

    for (const [countryId, expRegions] of countryExpansionRegions) {
      const country = world.mapCountries.get(countryId) as CountryEvent | undefined;
      if (!country) continue;

      // Total expansion cell count
      let totalExpCells = 0;
      const allExpCellIndices: number[] = [];
      for (const region of expRegions) {
        totalExpCells += region.cellIndices.length;
        allExpCellIndices.push(...region.cellIndices);
      }

      if (totalExpCells < smallestCountrySize) continue;

      // Find the best city spot in expansion territory
      let bestScore = -Infinity;
      let bestCellIndex = -1;
      for (const ci of allExpCellIndices) {
        const score = scoreCellForCity(cells[ci], cells);
        if (score > bestScore) {
          bestScore = score;
          bestCellIndex = ci;
        }
      }

      if (bestCellIndex < 0 || bestScore < SETTLE_SCORE_THRESHOLD) continue;

      // Settle: create a new city
      const cityRegion = expRegions.find(r => r.cellIndices.includes(bestCellIndex));
      if (!cityRegion) continue;

      const cityName = generateCityName(rng, usedCityNames);
      const cityEntity = cityGenerator.generate(bestCellIndex, cityName, rng, cityRegion, world);
      cityRegion.cities.push(cityEntity);

      // Found the city immediately
      cityEntity.founded = true;
      cityEntity.foundedOn = absYear;
      cityEntity.currentPopulation = 500;
      world.mapUsableCities.set(cityEntity.id, cityEntity);
      world.mapUncontactedCities.set(cityEntity.id, cityEntity);

      // Consolidate: clear expansion flags, set countryId on all expansion regions
      const consolidatedRegionIds: string[] = [];
      const consolidatedCellIndices: number[] = [];
      for (const region of expRegions) {
        region.isExpansion = false;
        region.expansionOwnerId = null;
        region.countryId = country.id;
        consolidatedRegionIds.push(region.id);
        consolidatedCellIndices.push(...region.cellIndices);
      }

      settlements.push({
        id: IdUtil.id('settle', absYear, rngHex(rng)) ?? 'settle_unknown',
        countryId,
        cityId: cityEntity.id,
        regionIds: consolidatedRegionIds,
        cellIndices: consolidatedCellIndices,
        year: absYear,
      });
    }
  }
}

export const expandGenerator = new ExpandGenerator();
