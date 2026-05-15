import type { GenerateRequest, WorkerMessage, RegionData, ContinentData, TerrainProfile } from '../lib/types';
import { createNoiseSamplers3D, seededPRNG, buildCellGraph, assignElevation, computeOceanCurrents, assignMoisture, assignTemperature, assignBiomes, generateRivers, hydraulicErosion, fillDepressions, PROFILES, DEFAULT_PROFILE, SHAPE_PROFILES, remapBiomesForSubtype, applyVolcanism } from '../lib/terrain';
import { assignGasBands } from '../lib/terrain/gasBands';
import { buildPhysicalWorld } from '../lib/history';
import { historyGenerator } from '../lib/history/HistoryGenerator';
import { generateUnderground, DEFAULT_UNDERGROUND_CHANCE } from '../lib/underground';
import type { UndergroundMap } from '../lib/underground';
import { RARITY_WEIGHTS_BY_MODE } from '../lib/history/physical/ResourceCatalog';
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
  if (e.data.type === 'GENERATE_HISTORY') {
    handleGenerateHistory(e.data);
    return;
  }
  handleGenerate(e.data);
};

function handleGenerate(req: Extract<GenerateRequest, { type: 'GENERATE' }>): void {
  const { seed, numCells, width, height, waterRatio, generateHistory: doHistory, numSimYears } = req;

  // Resolve terrain profile from request. Shapes stack between the biome profile
  // and any user overrides so the user override always wins and the biome layer
  // shines through for every field the shape doesn't explicitly set.
  const profileBase = PROFILES[req.profileName ?? 'default'] ?? DEFAULT_PROFILE;
  const shapeOverlay = SHAPE_PROFILES[req.shapeName ?? 'default'] ?? {};
  const profile: TerrainProfile = {
    ...profileBase,
    ...shapeOverlay,
    ...(req.profileOverrides ?? {}),
  };

  // Resolve resource rarity weights from mode (default: 'natural')
  const rarityMode = req.resourceRarityMode ?? 'natural';
  const rarityWeights = RARITY_WEIGHTS_BY_MODE[rarityMode];

  try {
    post({ type: 'PROGRESS', step: 'Building Voronoi diagram…', pct: 5 });
    const { cells } = buildCellGraph(seed, numCells, width, height);

    // Gas-giant branch: skip the entire terrain pipeline and assign cloud
    // bands directly from latitude + an isolated noise stream. History is
    // impossible on a gas giant, so we also short-circuit the post-pipeline
    // branches and emit empty regions.
    if (profile.gasGiantMode) {
      post({ type: 'PROGRESS', step: 'Forming cloud bands…', pct: 30 });
      assignGasBands(cells, width, height, seed, profile);
      post({ type: 'TERRAIN_READY', data: { cells, rivers: [], width, height } });
      post({ type: 'PROGRESS', step: 'Finishing…', pct: 95 });
      post({
        type: 'DONE',
        data: {
          cells, rivers: [], cities: [], roads: [], width, height,
          regions: [], continents: [],
          bodyKind: req.bodyKind,
          paletteOverride: req.paletteOverride,
          coastlinesSuppressed: profile.suppressCoastlineRender,
          hillshadeSuppressed: profile.suppressHillshade,
        },
      });
      return;
    }

    post({ type: 'PROGRESS', step: 'Shaping terrain…', pct: 20 });
    const noise = createNoiseSamplers3D(seed);
    assignElevation(cells, width, height, noise, waterRatio, seed, profile);

    // Ocean currents are skipped on bodies with no real oceans (lava /
    // volcanic / cratered / ice rocks). Substitute a zero-anomaly array so
    // assignMoisture / assignTemperature signatures stay stable.
    let sstAnomaly: Float32Array;
    if (profile.suppressOceanCurrents) {
      sstAnomaly = new Float32Array(cells.length);
    } else {
      post({ type: 'PROGRESS', step: 'Computing ocean currents…', pct: 25 });
      sstAnomaly = computeOceanCurrents(cells, width, height, profile).sstAnomaly;
    }

    post({ type: 'PROGRESS', step: 'Calculating moisture…', pct: 32 });
    const distFromOcean = assignMoisture(cells, width, height, noise, sstAnomaly, profile);

    post({ type: 'PROGRESS', step: 'Computing temperature…', pct: 42 });
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly, profile);

    post({ type: 'PROGRESS', step: 'Classifying biomes…', pct: 48 });
    assignBiomes(cells, width, height, noise, profile);
    if (profile.biomeRemap) remapBiomesForSubtype(cells, profile);

    let rivers: ReturnType<typeof generateRivers> = [];
    if (!profile.suppressRivers) {
      // Priority-flood pass 1: materialize small closed basins as lakes
      // and produce a virtual drainage surface so the initial river pass
      // always has a path to water.
      post({ type: 'PROGRESS', step: 'Filling depressions…', pct: 50 });
      const { drainageElevation: drainageElev1 } = fillDepressions(cells, profile);

      post({ type: 'PROGRESS', step: 'Carving rivers…', pct: 52 });
      generateRivers(cells, profile, drainageElev1); // initial pass — computes riverFlow for erosion

      if (!profile.suppressErosion) {
        post({ type: 'PROGRESS', step: 'Eroding river valleys…', pct: 55 });
        hydraulicErosion(cells, profile); // deliberately uses raw cell.elevation — deposition breaks monotonicity
      }

      // Priority-flood pass 2: erosion's deposition step can create new
      // sinks and shift existing ones, so re-run fillDepressions on the
      // eroded terrain before the final river trace.
      post({ type: 'PROGRESS', step: 'Filling depressions…', pct: 57 });
      const { drainageElevation: drainageElev2 } = fillDepressions(cells, profile);

      post({ type: 'PROGRESS', step: 'Retracing rivers…', pct: 58 });
      rivers = generateRivers(cells, profile, drainageElev2); // final pass — follows carved terrain
    }

    // Refresh elevation-dependent properties after erosion (or for profile-based overrides)
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly, profile);
    assignBiomes(cells, width, height, noise, profile);
    if (profile.biomeRemap) remapBiomesForSubtype(cells, profile);
    // Volcanic-event overlay runs last so its LAVA stamps survive the
    // biome refresh. No-op for any rule other than volcanic / lava.
    applyVolcanism(cells, seed, profile);

    // Terrain pipeline done — let the UI paint the map immediately while
    // buildPhysicalWorld / HistoryGenerator continue running in this worker.
    post({ type: 'TERRAIN_READY', data: { cells, rivers, width, height } });

    let cities: ReturnType<typeof historyGenerator.generate>['cities'] = [];
    let roads: ReturnType<typeof historyGenerator.generate>['roads'] = [];
    let history: ReturnType<typeof historyGenerator.generate>['historyData'] | undefined;
    let historyStats: ReturnType<typeof historyGenerator.generate>['stats'] | undefined;
    let regions: RegionData[] = [];
    let continents: ContinentData[] = [];

    // Defense-in-depth: even if the UI passes generateHistory: true, the
    // worker refuses to run history when disableHistory is set. The flag
    // is set whenever the request originated from a non-life body.
    // Underground map: eligibility roll on an isolated sub-stream, then
    // (if eligible) generate the cavern/tunnel graph. Generated BEFORE
    // `buildPhysicalWorld` / `historyGenerator.generate` so cavern
    // resources can be attached to surface regions before the year-0
    // discovery bootstrap and yearly tech-discovery ticks. Gas-giant
    // worlds never reach here — they return from the `profile.gasGiantMode`
    // branch above. Sub-streams used by `maybeBuildUnderground` +
    // `generateUnderground` are all independent of the surface / history
    // RNG roots, so seeds without an underground stay byte-identical to
    // the pre-feature sweep.
    const { hasUnderground, underground } = maybeBuildUnderground(seed, width, height, cells, req.undergroundChance);

    if (doHistory && !req.disableHistory) {
      post({ type: 'PROGRESS', step: 'Building physical world…', pct: 65 });
      const rng = seededPRNG(seed + '_history');

      post({ type: 'PROGRESS', step: 'Simulating history…', pct: 72 });
      const result = historyGenerator.generate(cells, width, rng, numSimYears ?? 5000, rarityWeights, seed, req.bodyKind, underground);
      cities = result.cities;
      roads = result.roads;
      history = result.historyData;
      historyStats = result.stats;
      regions = result.regions;
      continents = result.continents;
    } else {
      post({ type: 'PROGRESS', step: 'Building world…', pct: 65 });
      const rng = seededPRNG(seed + '_world');
      const result = buildPhysicalWorld(cells, width, rng, rarityWeights, seed, req.bodyKind, underground);
      regions = result.regionData;
      continents = result.continentData;
    }

    post({ type: 'PROGRESS', step: 'Finishing…', pct: 95 });

    post({
      type: 'DONE',
      data: {
        cells, rivers, cities, roads, width, height, history, regions, continents, historyStats,
        bodyKind: req.bodyKind,
        paletteOverride: req.paletteOverride,
        coastlinesSuppressed: profile.suppressCoastlineRender,
        hillshadeSuppressed: profile.suppressHillshade,
        hasUnderground,
        underground,
      },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
}

function maybeBuildUnderground(
  seed: string,
  width: number,
  height: number,
  cells: Parameters<typeof generateUnderground>[3],
  chanceRaw: number | undefined,
): { hasUnderground: boolean; underground: UndergroundMap | undefined } {
  const chance = Math.max(0, Math.min(1, chanceRaw ?? DEFAULT_UNDERGROUND_CHANCE));
  if (chance <= 0) return { hasUnderground: false, underground: undefined };
  const presentRng = seededPRNG(`${seed}_underground_present`);
  if (presentRng() >= chance) return { hasUnderground: false, underground: undefined };
  const underground = generateUnderground(seed, width, height, cells);
  return { hasUnderground: true, underground };
}

function handleGenerateHistory(req: Extract<GenerateRequest, { type: 'GENERATE_HISTORY' }>): void {
  const { seed, cells, width, height, rivers, numSimYears } = req;
  const rarityMode = req.resourceRarityMode ?? 'natural';
  const rarityWeights = RARITY_WEIGHTS_BY_MODE[rarityMode];

  try {
    post({ type: 'PROGRESS', step: 'Building physical world…', pct: 20 });
    // Same rng prefix as the combined path so byte-identical results
    // are produced regardless of which path was taken.
    const rng = seededPRNG(seed + '_history');

    post({ type: 'PROGRESS', step: 'Simulating history…', pct: 40 });
    const result = historyGenerator.generate(cells, width, rng, numSimYears, rarityWeights, seed, undefined, req.previousUnderground);

    post({ type: 'PROGRESS', step: 'Finishing…', pct: 95 });
    post({
      type: 'DONE',
      data: {
        cells,
        rivers,
        cities: result.cities,
        roads: result.roads,
        width,
        height,
        history: result.historyData,
        regions: result.regions,
        continents: result.continents,
        historyStats: result.stats,
      },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
}
