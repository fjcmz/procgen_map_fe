import type { GenerateRequest, WorkerMessage } from '../lib/types';
import { createNoiseSamplers, seededPRNG, buildCellGraph, assignElevation, assignMoisture, assignBiomes, generateRivers } from '../lib/terrain';
import { generateHistory } from '../lib/history';

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { seed, numCells, width, height, waterRatio, generateHistory: doHistory, numSimYears } = e.data;

  try {
    post({ type: 'PROGRESS', step: 'Building Voronoi diagram…', pct: 5 });
    const { cells } = buildCellGraph(seed, numCells, width, height);

    post({ type: 'PROGRESS', step: 'Shaping terrain…', pct: 20 });
    const noise = createNoiseSamplers(seed);
    assignElevation(cells, width, height, noise, waterRatio);

    post({ type: 'PROGRESS', step: 'Calculating moisture…', pct: 35 });
    assignMoisture(cells, width, height, noise);

    post({ type: 'PROGRESS', step: 'Classifying biomes…', pct: 45 });
    assignBiomes(cells);

    post({ type: 'PROGRESS', step: 'Carving rivers…', pct: 55 });
    const rivers = generateRivers(cells);

    let cities: ReturnType<typeof generateHistory>['cities'] = [];
    let roads: ReturnType<typeof generateHistory>['roads'] = [];
    let history: ReturnType<typeof generateHistory>['historyData'] | undefined;

    if (doHistory) {
      post({ type: 'PROGRESS', step: 'Simulating history…', pct: 65 });
      const rng = seededPRNG(seed + '_history');
      const result = generateHistory(cells, width, rng, numSimYears ?? 200);
      cities = result.cities;
      roads = result.roads;
      history = result.historyData;
    }

    post({ type: 'PROGRESS', step: 'Finishing…', pct: 95 });

    post({
      type: 'DONE',
      data: { cells, rivers, cities, roads, width, height, history },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
};
