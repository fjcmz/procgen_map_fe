import type { GenerateRequest, WorkerMessage, RegionData, ContinentData, TerrainProfile } from '../lib/types';
import { createNoiseSamplers3D, seededPRNG, buildCellGraph, assignElevation, computeOceanCurrents, assignMoisture, assignTemperature, assignBiomes, generateRivers, hydraulicErosion, PROFILES, DEFAULT_PROFILE } from '../lib/terrain';
import { buildPhysicalWorld } from '../lib/history';
import { historyGenerator } from '../lib/history/HistoryGenerator';
import { CityEntity, CITY_SIZE_TRADE_CAP, type CitySize } from '../lib/history/physical/CityEntity';

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

// One-shot sanity check: effective trade cap must be monotonic non-decreasing
// as TRADE_TECH levels rise. Catches any regression in the Phase 0
// canTradeMore() multiplier. Cheap (~100 iterations) so it runs at worker
// startup regardless of build mode.
function _assertTradeCapMonotonic(): void {
  const fields = ['exploration', 'growth', 'industry', 'government'] as const;
  const sizes: CitySize[] = ['small', 'medium', 'large', 'metropolis', 'megalopolis'];
  const fakeRng = () => 0.5;
  for (const size of sizes) {
    for (const field of fields) {
      const city = new CityEntity(0, 'SanityCheck', fakeRng);
      city.size = size;
      let prev = CITY_SIZE_TRADE_CAP[size];
      for (let level = 0; level <= 5; level++) {
        if (level > 0) city.knownTechs.set(field, { level });
        const cap = city.effectiveTradeCap();
        if (cap < prev) {
          throw new Error(
            `TRADE_TECHS sanity check failed: size=${size} field=${field} level=${level} cap=${cap} < prev=${prev}`,
          );
        }
        prev = cap;
      }
    }
  }
}
_assertTradeCapMonotonic();

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { seed, numCells, width, height, waterRatio, generateHistory: doHistory, numSimYears } = e.data;

  // Resolve terrain profile from request
  const profileBase = PROFILES[e.data.profileName ?? 'default'] ?? DEFAULT_PROFILE;
  const profile: TerrainProfile = e.data.profileOverrides
    ? { ...profileBase, ...e.data.profileOverrides }
    : profileBase;

  try {
    post({ type: 'PROGRESS', step: 'Building Voronoi diagram\u2026', pct: 5 });
    const { cells } = buildCellGraph(seed, numCells, width, height);

    post({ type: 'PROGRESS', step: 'Shaping terrain\u2026', pct: 20 });
    const noise = createNoiseSamplers3D(seed);
    assignElevation(cells, width, height, noise, waterRatio, seed, profile);

    post({ type: 'PROGRESS', step: 'Computing ocean currents\u2026', pct: 25 });
    const { sstAnomaly } = computeOceanCurrents(cells, width, height, profile);

    post({ type: 'PROGRESS', step: 'Calculating moisture\u2026', pct: 32 });
    const distFromOcean = assignMoisture(cells, width, height, noise, sstAnomaly, profile);

    post({ type: 'PROGRESS', step: 'Computing temperature\u2026', pct: 42 });
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly, profile);

    post({ type: 'PROGRESS', step: 'Classifying biomes\u2026', pct: 48 });
    assignBiomes(cells, width, height, noise, profile);

    let rivers: ReturnType<typeof generateRivers> = [];
    if (!profile.suppressRivers) {
      post({ type: 'PROGRESS', step: 'Carving rivers\u2026', pct: 50 });
      generateRivers(cells); // initial pass — computes riverFlow for erosion

      post({ type: 'PROGRESS', step: 'Eroding river valleys\u2026', pct: 55 });
      hydraulicErosion(cells, profile);

      post({ type: 'PROGRESS', step: 'Retracing rivers\u2026', pct: 58 });
      rivers = generateRivers(cells); // final pass — follows carved terrain
    }

    // Refresh elevation-dependent properties after erosion (or for profile-based overrides)
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly, profile);
    assignBiomes(cells, width, height, noise, profile);

    let cities: ReturnType<typeof historyGenerator.generate>['cities'] = [];
    let roads: ReturnType<typeof historyGenerator.generate>['roads'] = [];
    let history: ReturnType<typeof historyGenerator.generate>['historyData'] | undefined;
    let historyStats: ReturnType<typeof historyGenerator.generate>['stats'] | undefined;
    let regions: RegionData[] = [];
    let continents: ContinentData[] = [];

    if (doHistory) {
      post({ type: 'PROGRESS', step: 'Building physical world\u2026', pct: 65 });
      const rng = seededPRNG(seed + '_history');

      post({ type: 'PROGRESS', step: 'Simulating history\u2026', pct: 72 });
      const result = historyGenerator.generate(cells, width, rng, numSimYears ?? 5000);
      cities = result.cities;
      roads = result.roads;
      history = result.historyData;
      historyStats = result.stats;
      regions = result.regions;
      continents = result.continents;
    } else {
      post({ type: 'PROGRESS', step: 'Building world\u2026', pct: 65 });
      const rng = seededPRNG(seed + '_world');
      const result = buildPhysicalWorld(cells, width, rng);
      regions = result.regionData;
      continents = result.continentData;
    }

    post({ type: 'PROGRESS', step: 'Finishing\u2026', pct: 95 });

    post({
      type: 'DONE',
      data: { cells, rivers, cities, roads, width, height, history, regions, continents, historyStats },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
};
