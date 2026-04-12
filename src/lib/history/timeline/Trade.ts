import { IdUtil } from '../IdUtil';
import type { World } from '../physical/World';
import type { Year } from './Year';
import { TRADE_MIN, TRADE_USE } from '../physical/Resource';
import type { Resource } from '../physical/Resource';
import { cityVisitor } from '../physical/CityVisitor';
import type { CityEntity } from '../physical/CityEntity';
import type { CountryEvent } from './Country';
import type { TechField } from './Tech';
import {
  getCountryEffectiveTechs,
  getCountryTechLevel,
  recordDiffusedTech,
} from './Tech';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export interface Trade {
  readonly id: string;
  started: number;
  ended: number | null;
  endCause: string;
  readonly city1: string; // city ID
  readonly city2: string; // city ID
  readonly resource1: string; // resource type
  readonly resource2: string; // resource type
  year?: Year;
  tradeCity1?: CityEntity;
  tradeCity2?: CityEntity;
  material1?: Resource;
  material2?: Resource;
  /**
   * Spec stretch §2: tech transferred from donor to receiver country via
   * this trade. Set by `_tryTechDiffusion` after the trade is built; absent
   * when the diffusion check returned early (no eligible field, same
   * empire, no country yet, probability roll failed).
   */
  techDiffusion?: {
    field: TechField;
    donorCountryId: string;
    receiverCountryId: string;
    newLevel: number;
  };
}

export class TradeGenerator {
  generate(rng: () => number, year: Year, world: World): Trade | null {
    // Choose source city: usable, canTradeMore, region hasResources
    const sourceCity = cityVisitor.selectRandomUsable(
      world,
      c => {
        if (!c.canTradeMore()) return false;
        const region = world.mapRegions.get(c.regionId);
        return !!region && region.hasResources;
      },
      rng
    );
    if (!sourceCity) return null;

    // Choose target city from source city's contacts in a different region
    const targetCandidates: CityEntity[] = [];
    for (const contactCity of sourceCity.contactCities) {
      if (contactCity.regionId === sourceCity.regionId) continue;
      if (!contactCity.canTradeMore()) continue;
      const targetRegion = world.mapRegions.get(contactCity.regionId);
      if (!targetRegion || !targetRegion.hasResources) continue;
      targetCandidates.push(contactCity);
    }
    if (targetCandidates.length === 0) return null;

    const targetCity = targetCandidates[Math.floor(rng() * targetCandidates.length)];

    // Choose resources
    const sourceRegion = world.mapRegions.get(sourceCity.regionId)!;
    const targetRegion = world.mapRegions.get(targetCity.regionId)!;

    // Tech-gated: a resource is tradeable only if it has enough stock AND
    // has been discovered by the owning country. Discovery is per-region and
    // monotonic (see `YearGenerator` step 9 and `Region.discoveredResources`).
    const sourceResources = sourceRegion.resources.filter(r =>
      r.available > TRADE_MIN && sourceRegion.discoveredResources.has(r.type)
    );
    const targetResources = targetRegion.resources.filter(r =>
      r.available > TRADE_MIN && targetRegion.discoveredResources.has(r.type)
    );
    if (sourceResources.length === 0 || targetResources.length === 0) return null;

    const res1 = sourceResources[Math.floor(rng() * sourceResources.length)];
    const res2 = targetResources[Math.floor(rng() * targetResources.length)];

    const absYear = year.year;
    // Consume rngHex before the exploitation check to preserve RNG sequence.
    const tradeHex = rngHex(rng);

    // City territory gate: a resource can only be exploited if its cell is
    // owned by a city in the region.
    if (!this._isResourceExploited(world, sourceRegion.id, res1.cellIndex) ||
        !this._isResourceExploited(world, targetRegion.id, res2.cellIndex)) {
      return null;
    }

    const trade: Trade = {
      id: IdUtil.id('trade', absYear, res1.type, res2.type, tradeHex) ?? 'trade_unknown',
      started: absYear,
      ended: null,
      endCause: '',
      city1: sourceCity.id,
      city2: targetCity.id,
      resource1: res1.type,
      resource2: res2.type,
      year,
      tradeCity1: sourceCity,
      tradeCity2: targetCity,
      material1: res1,
      material2: res2,
    };

    // Decrease resource availability
    res1.available -= TRADE_USE;
    res2.available -= TRADE_USE;

    // Add trade to both cities
    sourceCity.trades.push(trade.id);
    targetCity.trades.push(trade.id);

    // Spec stretch §2: trade-driven tech diffusion. Single check per trade,
    // mutates `trade.techDiffusion` on success. The eligibility/probability
    // logic lives here; the country-scope write delegates to
    // `recordDiffusedTech` so empire-member writes go through the founder.
    this._tryTechDiffusion(rng, year, world, sourceCity, targetCity, trade);

    return trade;
  }

  /** Check if a resource cell is owned by any founded city in its region. */
  private _isResourceExploited(world: World, regionId: string, cellIndex: number): boolean {
    const region = world.mapRegions.get(regionId);
    if (!region) return false;
    for (const city of region.cities) {
      if (!city.founded) continue;
      if (city.ownedCells.has(cellIndex)) return true;
    }
    return false;
  }

  /**
   * Spec stretch §2: attempt one tech-diffusion roll between the two
   * countries hosting the trade. Returns silently when ineligible. The
   * caller has already minted the trade, so this is a pure side-effect on
   * the receiver's effective tech map plus a stamp on `trade.techDiffusion`
   * for the serializer.
   *
   * Eligibility:
   * - Both source and target cities resolve to a country (region.countryId)
   * - The two countries differ
   * - They are not in the same empire (knowledge already flows via the
   *   empire-founder scope ladder in `getCountryEffectiveTechs`)
   *
   * Selection:
   * - Iterate the union of fields known by either country
   * - Keep fields where the level gap is >= 2
   * - Pick one uniformly at random; donor = higher level, receiver = lower
   *
   * Probability:
   * - `min(0.6, 0.15 + 0.05 * receiverExploration + 0.05 * receiverGovernment)`
   * - The receiver's exploration/government levels gate the boost so a
   *   civilization that has invested in those fields absorbs more from
   *   trade contact, giving both fields a second-order role.
   *
   * Effect:
   * - `newLevel = receiverLvl + 1`, capped at `donorLvl - 1` so a single
   *   trade can never make the receiver match or surpass the donor. The
   *   `gap >= 2` filter guarantees the cap doesn't clamp below
   *   `receiverLvl + 1`, so we always actually advance.
   */
  private _tryTechDiffusion(
    rng: () => number,
    year: Year,
    world: World,
    sourceCity: CityEntity,
    targetCity: CityEntity,
    trade: Trade,
  ): void {
    const sourceRegion = world.mapRegions.get(sourceCity.regionId);
    const targetRegion = world.mapRegions.get(targetCity.regionId);
    if (!sourceRegion?.countryId || !targetRegion?.countryId) return;
    if (sourceRegion.countryId === targetRegion.countryId) return;

    const countryA = world.mapCountries.get(sourceRegion.countryId) as CountryEvent | undefined;
    const countryB = world.mapCountries.get(targetRegion.countryId) as CountryEvent | undefined;
    if (!countryA || !countryB) return;

    // Empire gate — same founder means knowledge already shared via the
    // empire-founder scope in `getCountryEffectiveTechs`.
    if (
      countryA.memberOf &&
      countryB.memberOf &&
      countryA.memberOf.foundedBy === countryB.memberOf.foundedBy
    ) {
      return;
    }

    const techsA = getCountryEffectiveTechs(world, countryA);
    const techsB = getCountryEffectiveTechs(world, countryB);

    // Build candidate list: fields with gap >= 2. Iterate the union of
    // both maps' keys so a field that's level 0 on one side and level 2+
    // on the other is still considered.
    type Candidate = { field: TechField; donor: CountryEvent; receiver: CountryEvent; donorLvl: number; receiverLvl: number };
    const candidates: Candidate[] = [];
    const seen = new Set<TechField>();
    const consider = (field: TechField) => {
      if (seen.has(field)) return;
      seen.add(field);
      const lvlA = techsA.get(field)?.level ?? 0;
      const lvlB = techsB.get(field)?.level ?? 0;
      const gap = Math.abs(lvlA - lvlB);
      if (gap < 2) return;
      if (lvlA > lvlB) {
        candidates.push({ field, donor: countryA, receiver: countryB, donorLvl: lvlA, receiverLvl: lvlB });
      } else {
        candidates.push({ field, donor: countryB, receiver: countryA, donorLvl: lvlB, receiverLvl: lvlA });
      }
    };
    for (const field of techsA.keys()) consider(field);
    for (const field of techsB.keys()) consider(field);

    if (candidates.length === 0) return;

    const pick = candidates[Math.floor(rng() * candidates.length)];

    // Probability gated by the receiver's exploration + government levels.
    const receiverExploration = getCountryTechLevel(world, pick.receiver, 'exploration');
    const receiverGovernment = getCountryTechLevel(world, pick.receiver, 'government');
    const prob = Math.min(0.6, 0.15 + 0.05 * receiverExploration + 0.05 * receiverGovernment);
    if (rng() >= prob) return;

    // Cap: never reach donor's level in a single hop. `gap >= 2` ensures
    // `receiverLvl + 1 <= donorLvl - 1`, so the cap is a no-op today but
    // guards future loosening of the gap floor.
    const newLevel = Math.min(pick.receiverLvl + 1, pick.donorLvl - 1);

    recordDiffusedTech(rng, year, world, pick.receiver, pick.field, newLevel);

    trade.techDiffusion = {
      field: pick.field,
      donorCountryId: pick.donor.id,
      receiverCountryId: pick.receiver.id,
      newLevel,
    };
  }
}

export const tradeGenerator = new TradeGenerator();
