import type { GenerateRequest, WorkerMessage } from '../lib/types';
import { createNoiseSamplers } from '../lib/noise';
import { buildCellGraph } from '../lib/voronoi';
import { assignElevation } from '../lib/elevation';
import { assignMoisture } from '../lib/moisture';
import { assignBiomes } from '../lib/biomes';
import { generateRivers } from '../lib/rivers';
import { placeCities } from '../lib/cities';
import { generateRoads } from '../lib/roads';
import { assignKingdoms } from '../lib/borders';

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { seed, numCells, width, height } = e.data;

  try {
    post({ type: 'PROGRESS', step: 'Building Voronoi diagram…', pct: 5 });
    const { cells } = buildCellGraph(seed, numCells, width, height);

    post({ type: 'PROGRESS', step: 'Shaping terrain…', pct: 20 });
    const noise = createNoiseSamplers(seed);
    assignElevation(cells, width, height, noise);

    post({ type: 'PROGRESS', step: 'Calculating moisture…', pct: 35 });
    assignMoisture(cells, width, height, noise);

    post({ type: 'PROGRESS', step: 'Classifying biomes…', pct: 45 });
    assignBiomes(cells);

    post({ type: 'PROGRESS', step: 'Carving rivers…', pct: 55 });
    const rivers = generateRivers(cells);

    post({ type: 'PROGRESS', step: 'Placing cities…', pct: 65 });
    const cities = placeCities(cells, width);

    post({ type: 'PROGRESS', step: 'Building roads…', pct: 75 });
    const roads = generateRoads(cells, cities);

    post({ type: 'PROGRESS', step: 'Drawing kingdom borders…', pct: 85 });
    assignKingdoms(cells, cities);

    post({ type: 'PROGRESS', step: 'Finishing…', pct: 95 });

    post({
      type: 'DONE',
      data: { cells, rivers, cities, roads, width, height },
    });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
};
