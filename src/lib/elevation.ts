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

  // Mark the lowest-elevation cells as water to hit the desired ratio exactly.
  // A threshold comparison against a percentile value breaks when many cells share
  // the minimum elevation (0), so we rank cells directly instead.
  const targetWaterCount = Math.round(waterRatio * cells.length);
  const byElevation = [...cells].sort((a, b) => a.elevation - b.elevation);
  byElevation.forEach((cell, i) => {
    cell.isWater = i < targetWaterCount;
  });

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
