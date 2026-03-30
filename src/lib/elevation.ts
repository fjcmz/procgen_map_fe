import type { Cell } from './types';
import type { NoiseSampler } from './noise';
import { fbm } from './noise';

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler,
  waterRatio: number
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
  }

  // Derive sea level from the desired water ratio using the actual elevation distribution
  const sorted = cells.map(c => c.elevation).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(waterRatio * (sorted.length - 1))];

  for (const cell of cells) {
    cell.isWater = cell.elevation < seaLevel;
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
