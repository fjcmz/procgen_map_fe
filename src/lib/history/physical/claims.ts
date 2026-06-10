import type { World } from './World';
import type { CityEntity } from './CityEntity';
import type { Cell } from '../../types';
import { CELL_BIOME_CAPACITY } from './Region';

/**
 * Claim-site choke point + derived claim indexes.
 *
 * Three pieces of derived state are maintained incrementally instead of being
 * rebuilt from scratch every simulated year:
 *
 *  - `city.cellCapSum` — running sum of `CELL_BIOME_CAPACITY` over the city's
 *    `ownedCells` (read by the YearGenerator growth step).
 *  - `city.ownedCellRegionIds` — region ids touched by the city's owned cells
 *    (used to invalidate frontier caches when the city ruins).
 *  - `world.usableClaimRefs` — refcounted cell→count index over the owned
 *    cells of all USABLE cities. Replaces the per-year `claimedCells` rebuilds
 *    in YearGenerator steps 4c / 4c-sea, which only ever call `.has()` on it.
 *
 * A refcount (not a plain map) is load-bearing: two usable cities can own the
 * same cell — a neighbour may claim a dormant city's pre-seeded founding cell
 * in step 4c before Foundation founds that city — and when one of them later
 * ruins, the key must survive for the other.
 *
 * INVARIANT: every `city.ownedCells.set` in the codebase must go through
 * `claimCell` (or, for Foundation's overwrite of the pre-seeded founding
 * cell, be a guaranteed key overwrite), and every transition in or out of
 * `world.mapUsableCities` must call `registerUsableCityClaims` /
 * `releaseUsableCityClaims`. A missed site silently desyncs the indexes from
 * the legacy per-year rebuild semantics and shifts the sweep baseline.
 */

/**
 * Record `ci` as owned by `city`, maintaining the derived indexes.
 * `cityIsUsable` must reflect whether the city is in `world.mapUsableCities`
 * at call time — claims by usable cities enter the refcount immediately;
 * claims by dormant cities enter it when the city becomes usable (via
 * `registerUsableCityClaims`).
 */
export function claimCell(
  world: World,
  city: CityEntity,
  ci: number,
  year: number,
  cell: Cell | undefined,
  cityIsUsable: boolean,
): void {
  const isNew = !city.ownedCells.has(ci);
  city.ownedCells.set(ci, year);
  if (!isNew) return;
  if (cell) {
    city.cellCapSum += CELL_BIOME_CAPACITY[cell.biome] ?? 0;
    if (cell.regionId) city.ownedCellRegionIds.add(cell.regionId);
  }
  if (cityIsUsable) {
    world.usableClaimRefs.set(ci, (world.usableClaimRefs.get(ci) ?? 0) + 1);
  }
}

/** A city entered `mapUsableCities`: its owned cells join the claim index. */
export function registerUsableCityClaims(world: World, city: CityEntity): void {
  for (const ci of city.ownedCells.keys()) {
    world.usableClaimRefs.set(ci, (world.usableClaimRefs.get(ci) ?? 0) + 1);
  }
}

/** A city left `mapUsableCities` (ruin): release its claims. */
export function releaseUsableCityClaims(world: World, city: CityEntity): void {
  for (const ci of city.ownedCells.keys()) {
    const n = world.usableClaimRefs.get(ci);
    if (n === undefined) continue;
    if (n <= 1) world.usableClaimRefs.delete(ci);
    else world.usableClaimRefs.set(ci, n - 1);
  }
}
