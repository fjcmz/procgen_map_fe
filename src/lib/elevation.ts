import type { Cell } from './types';
import type { NoiseSampler } from './noise';
import { fbm } from './noise';

const SEA_LEVEL = 0.4;

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler
): void {
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (const cell of cells) {
    const nx = (cell.x / width) * 2 - 1;
    const ny = (cell.y / height) * 2 - 1;

    let elev = fbm(noise.elevation, nx * 1.5, ny * 1.5, 4);

    // Island mask: radial falloff from center
    const dx = cell.x - cx;
    const dy = cell.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const falloff = Math.pow(dist / maxDist, 1.5);
    elev = elev * (1 - falloff) - falloff * 0.3;
    elev = Math.max(0, Math.min(1, elev));

    cell.elevation = elev;
    cell.isWater = elev < SEA_LEVEL;
  }

  // Mark coast cells
  for (const cell of cells) {
    if (!cell.isWater) {
      for (const ni of cell.neighbors) {
        if (cells[ni].isWater) {
          cell.isCoast = true;
          break;
        }
      }
    }
  }
}
