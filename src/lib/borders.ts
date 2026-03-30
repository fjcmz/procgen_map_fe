import type { Cell, City } from './types';

const MOUNTAIN_THRESHOLD = 0.72;

/** BFS flood-fill kingdom borders from capital cities. */
export function assignKingdoms(cells: Cell[], cities: City[]): void {
  const capitals = cities.filter(c => c.isCapital);
  const queue: number[] = [];

  // Initialize from capitals
  for (const cap of capitals) {
    const cell = cells[cap.cellIndex];
    if (!cell.isWater) {
      cell.kingdom = cap.kingdomId;
      queue.push(cap.cellIndex);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cell = cells[idx];
    if (cell.kingdom === null) continue;

    for (const ni of cell.neighbors) {
      const neighbor = cells[ni];
      if (
        neighbor.kingdom === null &&
        !neighbor.isWater &&
        neighbor.elevation < MOUNTAIN_THRESHOLD
      ) {
        neighbor.kingdom = cell.kingdom;
        queue.push(ni);
      }
    }
  }
}
