import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D,
  waterRatio: number
): void {
  for (const cell of cells) {
    let elev = fbmCylindrical(noise.elevation, cell.x, cell.y, width, height, 4);

    // North-south falloff: poles become water, equator stays habitable.
    // No east-west falloff since the map wraps cylindrically.
    const ny = (cell.y / height) * 2 - 1; // -1 at top, +1 at bottom
    const falloff = Math.pow(Math.abs(ny), 1.5);
    elev = elev * (1 - falloff) - falloff * 0.3;
    elev = Math.max(0, Math.min(1, elev));

    cell.elevation = elev;
  }

  // Normalize elevations so the highest cell reaches 1.0. Without this, FBM
  // noise rarely exceeds ~0.8 in practice, and after the falloff the
  // elevation range is compressed further — preventing mountain biomes from
  // ever forming.
  let maxElev = 0;
  for (const cell of cells) {
    if (cell.elevation > maxElev) maxElev = cell.elevation;
  }
  if (maxElev > 0) {
    for (const cell of cells) {
      cell.elevation = cell.elevation / maxElev;
    }
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
