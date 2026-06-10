import { IdUtil } from '../IdUtil';
import type { Cell } from '../../types';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CountryEvent } from './Country';
import { cityGenerator } from '../physical/CityGenerator';
import { generateCityName } from '../nameGenerator';
import { scoreCellForCity, scoreCellForSeaCity } from '../history';
import { getCityTechLevel } from './Tech';
import { claimCell, registerUsableCityClaims } from '../physical/claims';
import { seededPRNG } from '../../terrain/noise';

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

/** Annual probability that an eligible large+ city attempts a settlement. */
const SETTLEMENT_CHANCE = 0.01;

/**
 * Returns true if `candidateCi` is within 3 hops of any cell owned by a city
 * other than `parentCityId`. Prevents child cities from spawning too close to
 * a neighbour's territory.
 */
function isTooCloseToOtherCity(
  candidateCi: number,
  parentCityId: string,
  cells: import('../../types').Cell[],
  claimedCells: Map<number, string>,
): boolean {
  const checked = new Set([candidateCi]);
  for (const n1 of cells[candidateCi].neighbors) {
    const o1 = claimedCells.get(n1);
    if (o1 && o1 !== parentCityId) return true;
    checked.add(n1);
    for (const n2 of cells[n1].neighbors) {
      if (checked.has(n2)) continue;
      checked.add(n2);
      const o2 = claimedCells.get(n2);
      if (o2 && o2 !== parentCityId) return true;
      for (const n3 of cells[n2].neighbors) {
        if (checked.has(n3)) continue;
        checked.add(n3);
        const o3 = claimedCells.get(n3);
        if (o3 && o3 !== parentCityId) return true;
      }
    }
  }
  return false;
}

/** BFS radius (hops) within which to search for a child city site. */
const SETTLEMENT_SEARCH_RADIUS = 20;

/** Minimum city-placement score to settle. */
const SETTLEMENT_SCORE_THRESHOLD = -2;

/**
 * Sea colonisation tech gates. A parent city's effective country must hold
 * at least this much `maritime` tech to attempt the sea-settlement branch.
 * Tier 1 unlocks coastal water (water cells already attached to a region via
 * the 2-hop COAST band in `buildPhysicalWorld` Step 2b). Tier 4 unlocks
 * deep-ocean cells (no `regionId`); when claimed, those cells are absorbed
 * into the parent city's region so `computeOwnership` keeps working without
 * a new entity type.
 */
const SEA_SETTLEMENT_MARITIME_GATE = 1;
const SEA_SETTLEMENT_DEEP_OCEAN_GATE = 4;

/**
 * Per-year probability that a sea-eligible parent city attempts a sea
 * settlement. Drawn from an isolated `seaRng` sub-stream so the timeline
 * RNG is never consumed pre-tech (sweep stays byte-identical until the
 * first country reaches `maritime >= 1`).
 */
const SEA_SETTLEMENT_CHANCE = 0.005;

/** Minimum sea-cell score (per `scoreCellForSeaCity`) required to settle. */
const SEA_SETTLEMENT_SCORE_THRESHOLD = -2;

export class CitySettlementGenerator {
  /**
   * For each large+ city that has not yet had a settlement, roll a 1% chance
   * per year. On success, found a child city within SETTLEMENT_SEARCH_RADIUS
   * cells in the same country on a cell not owned by any existing city.
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

    // Founding cells of every city ever created — maintained persistently by
    // CityGenerator.generate (same key set the per-year rebuild over
    // mapCities used to produce). New children created below are added by
    // cityGenerator.generate at the same program point the local-set adds
    // used to happen, so within-year visibility is unchanged.
    const cityCellSet = world.allCityCells;

    // Build a map of cell index → owning city id to exclude cells claimed by others.
    // Always include each city's founding cell (city.cellIndex) regardless of ownedCells,
    // because Expand.ts-founded and settlement-founded cities don't add their founding
    // cell to ownedCells the way Foundation.ts does.
    const claimedCells = new Map<number, string>();
    for (const city of world.mapUsableCities.values()) {
      claimedCells.set(city.cellIndex, city.id); // founding cell — always present
      for (const ci of city.ownedCells.keys()) {
        claimedCells.set(ci, city.id);
      }
    }

    for (const city of world.mapUsableCities.values()) {
      if (!city.founded || city.isRuin) continue;
      if (city.hasHadSettlement) continue;
      if (city.size !== 'large' && city.size !== 'metropolis' && city.size !== 'megalopolis' && city.size !== 'ecumenopolis') continue;

      // --- Sea-colonisation branch -----------------------------------------
      // Gated by the parent country's effective `maritime` tech level. Reads
      // are pure (no rng draws): pre-first-maritime-tech years skip this
      // entirely, leaving the timeline RNG byte-identical to the legacy run.
      // All randomness inside this branch comes from an isolated `seaRng`
      // sub-stream so even post-tech years don't perturb the timeline RNG
      // for cities/years that don't actually settle a sea city.
      const maritimeLevel = getCityTechLevel(world, city, 'maritime');
      if (maritimeLevel >= SEA_SETTLEMENT_MARITIME_GATE) {
        const parentCell = cells[city.cellIndex];
        const parentCoastal = parentCell.isCoast
          || parentCell.neighbors.some(n => cells[n].isWater);
        if (parentCoastal) {
          const seaResult = this._tryFoundSeaCity(
            city, cells, world, year,
            cityCellSet, claimedCells, usedCityNames,
            maritimeLevel,
          );
          if (seaResult) {
            results.push(seaResult);
            continue; // sea attempt succeeded — skip the land roll for this city
          }
        }
      }

      // 1% annual chance to attempt a settlement
      if (rng() >= SETTLEMENT_CHANCE) continue;

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

            // Candidate must be in same country, not water, not already a city site,
            // not owned by any existing city, and not within 2 hops of another city's cells.
            if (!countryCells.has(ni)) continue;
            if (cells[ni].isWater) continue;
            if (cityCellSet.has(ni)) continue;
            if (claimedCells.has(ni)) continue;
            if (isTooCloseToOtherCity(ni, city.id, cells, claimedCells)) continue;

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

      // Found immediately, same initial population as a fresh foundation.
      // Claim the founding cell in ownedCells (mirrors Foundation.ts) so future
      // proximity checks in the same year see it via claimedCells.
      childEntity.founded = true;
      childEntity.foundedOn = absYear;
      childEntity.currentPopulation = 500;
      claimCell(world, childEntity, bestCell, absYear, cells[bestCell], false);
      world.mapUsableCities.set(childEntity.id, childEntity);
      world.mapUncontactedCities.set(childEntity.id, childEntity);
      registerUsableCityClaims(world, childEntity);
      claimedCells.set(bestCell, childEntity.id);

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

  /**
   * Sea-colonisation path. Attempts to found a child city on a water cell
   * within `SETTLEMENT_SEARCH_RADIUS` hops of the parent city. Returns a
   * `CitySettlement` record on success, or `null` if no candidate is found.
   *
   * **All randomness inside this method routes through `seaRng`** — an
   * isolated sub-stream keyed on world seed + parent city id + absolute
   * year. The timeline RNG is never consumed, so:
   *   - Years where no city has `maritime >= 1` are byte-identical to a run
   *     without this feature (the caller never invokes this method).
   *   - Years where this method runs but fails do not perturb the timeline
   *     RNG either; the caller falls through to the existing land path.
   *
   * Coastal water cells (those carrying a `regionId` from the
   * `buildPhysicalWorld` Step 2b coastal band) settle via the parent
   * country's existing region claim. Deep-ocean cells (`regionId` undefined)
   * are absorbed into the parent city's region by appending to
   * `region.cellIndices` and stamping `cells[ci].regionId`. Appending after
   * the existing land cells preserves the "land cells first" invariant
   * relied on by other consumers.
   */
  private _tryFoundSeaCity(
    parentCity: import('../physical/CityEntity').CityEntity,
    cells: Cell[],
    world: World,
    year: Year,
    cityCellSet: Set<number>,
    claimedCells: Map<number, string>,
    usedCityNames: Set<string>,
    maritimeLevel: number,
  ): CitySettlement | null {
    const absYear = year.year;

    // Resolve country & region of the parent city
    const parentRegion = world.mapRegions.get(parentCity.regionId);
    if (!parentRegion?.countryId) return null;
    const countryId = parentRegion.countryId;
    const country = world.mapCountries.get(countryId) as CountryEvent | undefined;
    if (!country) return null;

    // Isolated sub-stream keeps the timeline RNG untouched on this path.
    const seaRng = seededPRNG(`${world.seed}_seasettle_${parentCity.id}_${absYear}`);

    // Roll attempt chance on seaRng (not the timeline rng)
    if (seaRng() >= SEA_SETTLEMENT_CHANCE) return null;

    // Build the country's owned-cell set (core + expansion)
    const countryCells = new Set<number>();
    for (const [, r] of world.mapRegions) {
      if (r.countryId === countryId || r.expansionOwnerId === countryId) {
        for (const ci of r.cellIndices) countryCells.add(ci);
      }
    }

    const canSettleDeep = maritimeLevel >= SEA_SETTLEMENT_DEEP_OCEAN_GATE;

    // BFS from parent city's cell; collect water-cell candidates
    const visited = new Set<number>([parentCity.cellIndex]);
    let frontier = [parentCity.cellIndex];
    const candidates: { cellIndex: number; score: number; isDeep: boolean }[] = [];

    for (let hop = 0; hop < SETTLEMENT_SEARCH_RADIUS && frontier.length > 0; hop++) {
      const next: number[] = [];
      for (const ci of frontier) {
        for (const ni of cells[ci].neighbors) {
          if (visited.has(ni)) continue;
          visited.add(ni);
          next.push(ni);

          const nCell = cells[ni];
          if (!nCell.isWater) continue;
          if (cityCellSet.has(ni)) continue;
          if (claimedCells.has(ni)) continue;

          const isDeep = nCell.regionId === undefined;
          if (isDeep) {
            // Deep-ocean cells are claimable only at the deeper tech tier.
            if (!canSettleDeep) continue;
          } else {
            // Coastal water (regionId set) must already belong to this country.
            if (!countryCells.has(ni)) continue;
          }

          if (isTooCloseToOtherCity(ni, parentCity.id, cells, claimedCells)) continue;

          const score = scoreCellForSeaCity(nCell, cells);
          if (score < SEA_SETTLEMENT_SCORE_THRESHOLD) continue;
          candidates.push({ cellIndex: ni, score, isDeep });
        }
      }
      frontier = next;
    }

    if (candidates.length === 0) return null;

    // Pick the best-scoring candidate; tiebreak on seaRng to keep determinism.
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable on cellIndex as last-resort tiebreak so we don't depend on
      // map iteration order for byte-identical replays.
      return a.cellIndex - b.cellIndex;
    });
    const best = candidates[0];
    const bestCell = best.cellIndex;

    // Resolve the region the new city will live in. Deep-ocean cells get
    // absorbed into the parent's region.
    let targetRegion = cells[bestCell].regionId
      ? world.mapRegions.get(cells[bestCell].regionId!)
      : undefined;
    if (!targetRegion) {
      if (!best.isDeep) return null; // coastal water with no region — defensive
      // Absorb deep-ocean cell into parent region (append, preserving the
      // "land cells first" ordering invariant).
      parentRegion.cellIndices.push(bestCell);
      cells[bestCell].regionId = parentRegion.id;
      targetRegion = parentRegion;
    }

    // Mint the child city. Use seaRng so all draws stay isolated.
    const childName = generateCityName(seaRng, usedCityNames);
    const childEntity = cityGenerator.generate(bestCell, childName, seaRng, targetRegion, world);
    targetRegion.cities.push(childEntity);

    childEntity.founded = true;
    childEntity.foundedOn = absYear;
    childEntity.currentPopulation = 500;
    claimCell(world, childEntity, bestCell, absYear, cells[bestCell], false);
    childEntity.isSeaCity = true;
    childEntity.foundedOnDeepOcean = best.isDeep;
    if (best.isDeep) {
      childEntity.absorbedWaterCells.add(bestCell);
    }

    world.mapUsableCities.set(childEntity.id, childEntity);
    world.mapUncontactedCities.set(childEntity.id, childEntity);
    registerUsableCityClaims(world, childEntity);
    claimedCells.set(bestCell, childEntity.id);

    parentCity.hasHadSettlement = true;
    parentCity.childCityId = childEntity.id;
    childEntity.parentCityId = parentCity.id;

    return {
      id: IdUtil.id('citysettlement', absYear, rngHex(seaRng)) ?? 'citysettlement_unknown',
      parentCityId: parentCity.id,
      childCityId: childEntity.id,
      countryId,
      year: absYear,
    };
  }
}

export const citySettlementGenerator = new CitySettlementGenerator();
