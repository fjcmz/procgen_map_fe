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
    // Layer 1: Low-frequency continent mask — creates large continental blobs
    const continentRaw = fbmCylindrical(
      noise.continent, cell.x, cell.y, width, height, 2, 0.5
    );
    const continentMask = Math.pow(continentRaw, 1.2) * 1.6 - 0.3;

    // Layer 2: High-frequency terrain detail (mountains, valleys, coastlines)
    const detail = fbmCylindrical(noise.elevation, cell.x, cell.y, width, height, 4);

    // Combine: continent mask dominates for clear land/ocean separation
    let elev = continentMask * 0.7 + detail * 0.3;

    // Gentle polar falloff: allows polar land but tends toward ocean at poles
    const ny = (cell.y / height) * 2 - 1;
    const polarDist = Math.abs(ny);
    elev = elev - Math.pow(polarDist, 2.5) * 0.6;

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
