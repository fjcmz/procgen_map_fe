import { Timeline } from './Timeline';
import { yearGenerator } from './YearGenerator';
import type { HistoryRoot } from '../HistoryRoot';
import type { World } from '../physical/World';
import type { Cell } from '../../types';
import { DEBUG_HISTORY_TIMING, historyTiming } from './timing';

const NUM_YEARS = 5000;

export class TimelineGenerator {
  generate(rng: () => number, history: HistoryRoot, world: World, cells?: Cell[], usedCityNames?: Set<string>): Timeline {
    if (DEBUG_HISTORY_TIMING) historyTiming.reset();

    const timeline = new Timeline(rng);
    timeline.history = history;
    // Range: [-3000, -1001]
    timeline.startOfTime = Math.floor(rng() * 2000) - 3000;

    for (let i = 0; i < NUM_YEARS; i++) {
      const year = yearGenerator.generate(rng, timeline, world, cells, usedCityNames);
      timeline.years.push(year);
    }

    if (DEBUG_HISTORY_TIMING) console.log(historyTiming.report());

    return timeline;
  }
}

export const timelineGenerator = new TimelineGenerator();
