import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

export function assignMoisture(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D
): void {
  for (const cell of cells) {
    // Offset cell position to decorrelate moisture from elevation noise
    let m = fbmCylindrical(noise.moisture, cell.x + width * 0.3, cell.y + height * 0.3, width, height, 3);

    // Coastal cells are wetter
    if (cell.isCoast) {
      m = Math.min(1, m + 0.2);
    }

    cell.moisture = m;
  }
}
