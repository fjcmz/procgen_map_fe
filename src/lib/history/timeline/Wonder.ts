import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import type { CityEntity } from '../physical/CityEntity';
import type { Region } from '../physical/Region';
import type { Resource } from '../physical/Resource';
import type { ResourceType } from '../physical/ResourceCatalog';
import { getCityTechLevel, type TechField } from './Tech';
import type { Empire } from './Empire';
import {
  WONDER_TIER_RESOURCES,
  pickWonderName,
} from './wonderNames';

const ALL_TECH_FIELDS: readonly TechField[] = [
  'science', 'military', 'industry', 'energy', 'growth',
  'exploration', 'biology', 'art', 'government',
];

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Wonder {
  readonly id: string;
  readonly city: string; // city ID
  builtOn: number;
  destroyedOn: number | null;
  destroyCause: string;
  year?: Year;
  // Tier system fields
  readonly tier: number;          // 1-10
  readonly name: string;          // from wonderNames.ts
  readonly resourcesConsumed: ReadonlyArray<{ type: ResourceType; amount: number }>;
}

/**
 * Sum of tiers of all standing (not destroyed) wonders belonging to a city.
 * Used by YearGenerator step 4 (growth-rate and carrying-capacity bonuses)
 * and step 6 (religion adherence drift bonus).
 */
export function getStandingWonderTierSum(world: World, city: CityEntity): number {
  let sum = 0;
  for (const wonderId of city.wonders) {
    const wonder = world.mapUsableWonders.get(wonderId);
    if (wonder) sum += wonder.tier;
  }
  return sum;
}

/**
 * Count of standing (not destroyed) wonders belonging to a city.
 * Used by Cataclysm resilience (Point 7): infrastructure saves lives.
 */
export function getStandingWonderCount(world: World, city: CityEntity): number {
  let count = 0;
  for (const wonderId of city.wonders) {
    if (world.mapUsableWonders.has(wonderId)) count++;
  }
  return count;
}

/**
 * Sum of tiers of all standing wonders across every city belonging to a country.
 * Used by TechGenerator to boost tech discovery chance (+0.05 per tier level).
 */
export function getCountryStandingWonderTierSum(world: World, countryId: string): number {
  let sum = 0;
  for (const city of world.mapUsableCities.values()) {
    const region = world.mapRegions.get(city.regionId);
    if (region?.countryId === countryId) {
      sum += getStandingWonderTierSum(world, city);
    }
  }
  return sum;
}

/**
 * Count of standing wonders across all cities belonging to an empire's member
 * countries (including expansion regions). Used by ConquerGenerator to reduce
 * the government-tech dissolution probability — prestigious monuments hold
 * empires together.
 */
export function getEmpireStandingWonderCount(world: World, empire: Empire): number {
  const memberIds = empire.countries;
  let count = 0;
  for (const city of world.mapUsableCities.values()) {
    const region = world.mapRegions.get(city.regionId);
    if (!region) continue;
    if ((region.countryId && memberIds.has(region.countryId)) ||
        (region.expansionOwnerId && memberIds.has(region.expansionOwnerId))) {
      for (const wonderId of city.wonders) {
        if (world.mapUsableWonders.has(wonderId)) count++;
      }
    }
  }
  return count;
}

/**
 * Collect all available resources across the entity hierarchy
 * (region → country → empire) for a given city, respecting discovery gates.
 *
 * Returns a map from resource type to { total available, source resources }.
 */
function collectPooledResources(
  world: World,
  city: CityEntity,
): Map<ResourceType, { total: number; sources: Array<{ resource: Resource; region: Region }> }> {
  const pool = new Map<ResourceType, { total: number; sources: Array<{ resource: Resource; region: Region }> }>();

  // Resolve all regions belonging to this city's country and its empire
  const regions: Region[] = [];
  const cityRegion = world.mapRegions.get(city.regionId);
  if (!cityRegion) return pool;

  const countryId = cityRegion.countryId;
  if (!countryId) {
    // No country — only city's own region
    regions.push(cityRegion);
  } else {
    const country = world.mapCountries.get(countryId);
    if (!country) {
      regions.push(cityRegion);
    } else {
      // Collect all country IDs to pool from (country + empire members)
      const countryIds = new Set<string>([countryId]);
      if (country.memberOf) {
        for (const memberId of country.memberOf.countries) {
          countryIds.add(memberId);
        }
      }
      // Collect all regions belonging to these countries
      for (const r of world.mapRegions.values()) {
        if ((r.countryId && countryIds.has(r.countryId)) ||
            (r.expansionOwnerId && countryIds.has(r.expansionOwnerId))) {
          regions.push(r);
        }
      }
    }
  }

  // Build resource pool across all collected regions
  for (const region of regions) {
    for (const resource of region.resources) {
      // Must be discovered (unlocked) in this region
      if (!region.discoveredResources.has(resource.type)) continue;
      // Must have some available stock
      if (resource.available < 1) continue;

      let entry = pool.get(resource.type);
      if (!entry) {
        entry = { total: 0, sources: [] };
        pool.set(resource.type, entry);
      }
      entry.total += resource.available;
      entry.sources.push({ resource, region });
    }
  }

  return pool;
}

/**
 * Check if the pooled resources can afford a wonder at the given tier.
 * Returns true if all required resource types have sufficient total available.
 */
function canAffordTier(
  pool: Map<ResourceType, { total: number; sources: Array<{ resource: Resource; region: Region }> }>,
  tierIndex: number,
): boolean {
  const req = WONDER_TIER_RESOURCES[tierIndex];
  if (!req) return false;
  for (const type of req.types) {
    const entry = pool.get(type);
    if (!entry || entry.total < req.costPerResource) return false;
  }
  return true;
}

/**
 * Consume resources from the pool for a wonder at the given tier.
 * Greedily deducts from the first source(s) that have stock.
 * Returns the consumed resources for recording on the Wonder.
 */
function consumeResources(
  pool: Map<ResourceType, { total: number; sources: Array<{ resource: Resource; region: Region }> }>,
  tierIndex: number,
): Array<{ type: ResourceType; amount: number }> {
  const req = WONDER_TIER_RESOURCES[tierIndex];
  const consumed: Array<{ type: ResourceType; amount: number }> = [];

  for (const type of req.types) {
    let remaining = req.costPerResource;
    const entry = pool.get(type)!;
    for (const src of entry.sources) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, src.resource.available);
      src.resource.available -= take;
      remaining -= take;
    }
    // Update pool total
    entry.total -= req.costPerResource;
    consumed.push({ type, amount: req.costPerResource });
  }

  return consumed;
}

export class WonderGenerator {
  generate(rng: () => number, year: Year, world: World): Wonder | null {
    // Phase 1: Build candidates with feasible tier and weight
    const candidates: Array<{ city: CityEntity; weight: number; tier: number }> = [];

    const absYear = year.year;

    for (const c of world.mapUsableCities.values()) {
      // City size gate: must be large, metropolis, or megalopolis
      if (c.size !== 'large' && c.size !== 'metropolis' && c.size !== 'megalopolis') continue;

      // Compute total tech level across all 9 fields
      let totalTech = 0;
      for (const field of ALL_TECH_FIELDS) {
        totalTech += getCityTechLevel(world, c, field);
      }

      // Cooldown: 50yr base, reduced by 1 per 2 growth tech levels, min 10
      const growthLevel = getCityTechLevel(world, c, 'growth');
      const cooldown = Math.max(10, 50 - Math.floor(growthLevel / 2));
      if (c.wonders.length > 0) {
        let mostRecentBuilt = -Infinity;
        for (const wid of c.wonders) {
          const w = world.mapWonders.get(wid);
          if (w && w.builtOn > mostRecentBuilt) mostRecentBuilt = w.builtOn;
        }
        if (absYear - mostRecentBuilt < cooldown) continue;
      }

      // Max standing wonders: floor(government / 5), minimum 1
      const govLevel = getCityTechLevel(world, c, 'government');
      const maxStanding = Math.max(1, Math.floor(govLevel / 5));
      if (getStandingWonderCount(world, c) >= maxStanding) continue;

      // Max tier from tech: tier N requires N*10 total tech levels
      let maxTier = Math.min(10, Math.floor(totalTech / 10));
      if (maxTier < 1) continue; // need at least 10 total tech

      // Tier-based size gate: tier 7+ requires metropolis+, tier 9+ requires megalopolis
      if (c.size === 'large' && maxTier > 6) maxTier = 6;
      if (c.size === 'metropolis' && maxTier > 8) maxTier = 8;

      // Collect pooled resources for this city's entity hierarchy
      const pool = collectPooledResources(world, c);

      // Find highest affordable tier
      let feasibleTier = 0;
      for (let t = maxTier; t >= 1; t--) {
        if (canAffordTier(pool, t - 1)) { // tier 1 = index 0
          feasibleTier = t;
          break;
        }
      }
      if (feasibleTier === 0) continue; // can't afford any tier

      // Weight: industry tech bonus × tier bonus
      const industryLevel = Math.min(getCityTechLevel(world, c, 'industry'), 10);
      const weight = (1 + 0.1 * industryLevel) * (1 + 0.1 * feasibleTier);
      candidates.push({ city: c, weight, tier: feasibleTier });
    }

    if (candidates.length === 0) return null;

    // Phase 2: Weighted random selection
    let total = 0;
    for (const cand of candidates) total += cand.weight;
    let r = rng() * total;
    let pick = candidates[candidates.length - 1]; // float-error safety
    for (const cand of candidates) {
      r -= cand.weight;
      if (r <= 0) { pick = cand; break; }
    }

    const city = pick.city;
    const tier = pick.tier;

    // Phase 3: Consume resources from the pooled hierarchy
    const pool = collectPooledResources(world, city);
    const resourcesConsumed = consumeResources(pool, tier - 1);

    // Phase 4: Pick a name
    const name = pickWonderName(rng, tier, world.usedWonderNames);

    // Phase 5: Create the Wonder
    const wonder: Wonder = {
      id: IdUtil.id('wonder', absYear, rngHex(rng)) ?? 'wonder_unknown',
      city: city.id,
      builtOn: absYear,
      destroyedOn: null,
      destroyCause: '',
      year,
      tier,
      name,
      resourcesConsumed,
    };

    city.wonders.push(wonder.id);
    world.mapWonders.set(wonder.id, wonder);
    world.mapUsableWonders.set(wonder.id, wonder);

    return wonder;
  }
}

export const wonderGenerator = new WonderGenerator();
