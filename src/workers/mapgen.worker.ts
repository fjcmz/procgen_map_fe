import type { GenerateRequest, WorkerMessage, RegionData, ContinentData } from '../lib/types';
import { createNoiseSamplers, seededPRNG, buildCellGraph, assignElevation, assignMoisture, assignBiomes, generateRivers } from '../lib/terrain';
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
    const noise = createNoiseSamplers(seed);
    assignElevation(cells, width, height, noise, waterRatio);

    post({ type: 'PROGRESS', step: 'Calculating moisture\u2026', pct: 35 });
    assignMoisture(cells, width, height, noise);

    post({ type: 'PROGRESS', step: 'Classifying biomes\u2026', pct: 45 });
    assignBiomes(cells);

    post({ type: 'PROGRESS', step: 'Carving rivers\u2026', pct: 55 });
    const rivers = generateRivers(cells);

    let cities: ReturnType<typeof historyGenerator.generate>['cities'] = [];
    let roads: ReturnType<typeof historyGenerator.generate>['roads'] = [];
    let history: ReturnType<typeof historyGenerator.generate>['historyData'] | undefined;
    let regions: RegionData[] = [];
    let continents: ContinentData[] = [];

    if (doHistory) {
      post({ type: 'PROGRESS', step: 'Building physical world\u2026', pct: 65 });
      const rng = seededPRNG(seed + '_history');

      post({ type: 'PROGRESS', step: 'Simulating history\u2026', pct: 72 });
      const result = historyGenerator.generate(cells, width, rng, numSimYears ?? 200);
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
