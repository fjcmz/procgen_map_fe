import type { Cell } from '../types';
import type { NoiseSampler } from './noise';
import { fbm } from './noise';

export function assignMoisture(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler
): void {
  for (const cell of cells) {
    const nx = (cell.x / width) * 2 - 1;
    const ny = (cell.y / height) * 2 - 1;

    let m = fbm(noise.moisture, nx * 1.2 + 10, ny * 1.2 + 10, 3);

    // Coastal cells are wetter
    if (cell.isCoast) {
      m = Math.min(1, m + 0.2);
    }

    cell.moisture = m;
  }
}
