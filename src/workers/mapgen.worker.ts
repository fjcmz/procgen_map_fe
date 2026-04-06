import type { GenerateRequest, WorkerMessage, RegionData, ContinentData } from '../lib/types';
import { createNoiseSamplers3D, seededPRNG, buildCellGraph, assignElevation, computeOceanCurrents, assignMoisture, assignTemperature, assignBiomes, generateRivers, hydraulicErosion } from '../lib/terrain';
import { buildPhysicalWorld } from '../lib/history';
import { historyGenerator } from '../lib/history/HistoryGenerator';

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { seed, numCells, width, height, waterRatio, generateHistory: doHistory, numSimYears } = e.data;

  try {
    post({ type: 'PROGRESS', step: 'Building Voronoi diagram\u2026', pct: 5 });
    const { cells } = buildCellGraph(seed, numCells, width, height);

    post({ type: 'PROGRESS', step: 'Shaping terrain\u2026', pct: 20 });
    const noise = createNoiseSamplers3D(seed);
    assignElevation(cells, width, height, noise, waterRatio, seed);

    post({ type: 'PROGRESS', step: 'Computing ocean currents\u2026', pct: 25 });
    const { sstAnomaly } = computeOceanCurrents(cells, width, height);

    post({ type: 'PROGRESS', step: 'Calculating moisture\u2026', pct: 32 });
    const distFromOcean = assignMoisture(cells, width, height, noise, sstAnomaly);

    post({ type: 'PROGRESS', step: 'Computing temperature\u2026', pct: 42 });
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly);

    post({ type: 'PROGRESS', step: 'Classifying biomes\u2026', pct: 48 });
    assignBiomes(cells, width, height, noise);

    post({ type: 'PROGRESS', step: 'Carving rivers\u2026', pct: 50 });
    generateRivers(cells); // initial pass — computes riverFlow for erosion

    post({ type: 'PROGRESS', step: 'Eroding river valleys\u2026', pct: 55 });
    hydraulicErosion(cells);

    post({ type: 'PROGRESS', step: 'Retracing rivers\u2026', pct: 58 });
    const rivers = generateRivers(cells); // final pass — follows carved terrain

    // Refresh elevation-dependent properties after erosion
    assignTemperature(cells, width, height, distFromOcean, noise, sstAnomaly);
    assignBiomes(cells, width, height, noise);

    let cities: ReturnType<typeof historyGenerator.generate>['cities'] = [];
    let roads: ReturnType<typeof historyGenerator.generate>['roads'] = [];
    let history: ReturnType<typeof historyGenerator.generate>['historyData'] | undefined;
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
      data: { cells, rivers, cities, roads, width, height, history, regions, continents },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
};
