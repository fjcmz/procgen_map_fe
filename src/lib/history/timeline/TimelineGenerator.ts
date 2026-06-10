import { Timeline } from './Timeline';
import { yearGenerator, type YearGenCache } from './YearGenerator';
import type { HistoryRoot } from '../HistoryRoot';
import type { World } from '../physical/World';
import type { Cell } from '../../types';
import { DEBUG_HISTORY_TIMING, historyTiming } from './timing';

const NUM_YEARS = 5000;

export class TimelineGenerator {
  generate(rng: () => number, history: HistoryRoot, world: World, cells?: Cell[], usedCityNames?: Set<string>, numYears: number = NUM_YEARS): Timeline {
    if (DEBUG_HISTORY_TIMING) historyTiming.reset();

    const timeline = new Timeline(rng);
    timeline.history = history;
    // Range: [-3000, -1001]
    timeline.startOfTime = Math.floor(rng() * 2000) - 3000;

    // Pre-compute static region topology once — region cell sets and resource-distance
    // maps never change after buildPhysicalWorld, so building them per-city per-year
    // in expansion-cells is pure waste.  Pass as YearGenCache to every year.
    let cache: YearGenCache | undefined;
    if (cells) {
      const regionCellSets = new Map<string, Set<number>>();
      const regionResourceDists = new Map<string, Map<number, number>>();
      for (const region of world.mapRegions.values()) {
        const cellSet = new Set(region.cellIndices);
        regionCellSets.set(region.id, cellSet);

        const resourceDist = new Map<number, number>();
        const resCells = [...region.cellResources.keys()];
        if (resCells.length > 0) {
          const queue: number[] = [];
          for (const rc of resCells) {
            if (cellSet.has(rc)) { resourceDist.set(rc, 0); queue.push(rc); }
          }
          let qi = 0;
          while (qi < queue.length) {
            const ci = queue[qi++];
            const d = resourceDist.get(ci)!;
            for (const ni of cells[ci].neighbors) {
              if (!cellSet.has(ni) || resourceDist.has(ni)) continue;
              resourceDist.set(ni, d + 1);
              queue.push(ni);
            }
          }
        }
        regionResourceDists.set(region.id, resourceDist);
      }
      cache = { regionCellSets, regionResourceDists };
    }

    // Simulate exactly the requested number of years. The per-year loop is
    // strictly forward (year N+1 only reads state produced by years 0..N), so
    // truncating here yields byte-identical years 0..numYears-1 compared to a
    // full 5000-year run — the sweep baseline (always 5000) is unaffected.
    const yearsToRun = Math.max(1, Math.min(NUM_YEARS, Math.floor(numYears)));
    for (let i = 0; i < yearsToRun; i++) {
      const year = yearGenerator.generate(rng, timeline, world, cells, usedCityNames, cache);
      timeline.years.push(year);
    }

    if (DEBUG_HISTORY_TIMING) console.log(historyTiming.report());

    return timeline;
  }
}

export const timelineGenerator = new TimelineGenerator();
