import { Year } from './Year';
import type { Timeline } from './Timeline';
import type { World } from '../physical/World';
import { REGION_BIOME_GROWTH } from '../physical/Region';

export class YearGenerator {
  generate(rng: () => number, timeline: Timeline, world: World): Year {
    const year = new Year(rng);
    year.timeline = timeline;

    // Step 1: Abort if world has ended
    if (world.endedBy !== '') {
      year.year = timeline.startOfTime + timeline.years.length;
      return year;
    }

    // Step 2: Compute absolute year
    const absYear = timeline.startOfTime + timeline.years.length;
    year.year = absYear;

    // Step 3: Sum world population from usable cities (measured before growth)
    let worldPop = 0;
    for (const city of world.mapUsableCities.values()) {
      worldPop += city.currentPopulation;
    }
    year.worldPopulation = worldPop;

    // Step 4: Increase populations using biome growth multiplier
    for (const city of world.mapUsableCities.values()) {
      const region = world.mapRegions.get(city.regionId);
      if (region) {
        const growthRate = REGION_BIOME_GROWTH[region.biome];
        // growthRate values (0.3–1.5) are percentage-point annual growth rates
        city.currentPopulation = Math.floor(
          city.currentPopulation * (1 + growthRate / 100)
        );
      }
    }

    // Step 5: Kill/retire illustrates
    // Natural death: birthYear + yearsActive <= currentYear
    // War-related death: 15% chance if active war affects origin country
    // No-op until Phase 5 populates world.mapUsableIllustrates
    // (world.mapUsableIllustrates is Map<string, unknown>, iterates zero times)

    // Step 6: Propagate religions
    // - Single-religion cities: adherence drifts +0.05 toward dominance until 0.9
    // - If total adherence < 0.9, random existing religion gains +0.05
    // - Recompute member counts: sum(cityPopulation * adherenceFraction) across usable cities
    // No-op until Phase 5 populates world.mapReligions

    // Step 7: End expired wars — remove alive wars where started + lasts < year
    // Clear atWar flags on involved countries
    // No-op until Phase 5 populates world.mapAliveWars

    // Step 8: Reassert war flags — active wars set atWar = true for involved countries
    // No-op until Phase 5 populates world.mapAliveWars

    // Step 9: Recompute resources — region.hasResources = any resource.available >= TRADE_MIN
    for (const region of world.mapRegions.values()) {
      region.updateHasResources();
    }

    return year;
  }
}

export const yearGenerator = new YearGenerator();
