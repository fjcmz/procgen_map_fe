import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

/**
 * Sample cylindrical FBM at warped coordinates for more irregular continent shapes.
 * Domain warping distorts the input position using a secondary noise field,
 * creating rift-like gaps and peninsulas that break up uniform blobs.
 */
function warpedContinentNoise(
  noise: NoiseSampler3D,
  x: number,
  y: number,
  width: number,
  height: number,
  warpStrength: number,
  octaves: number,
  baseFreq: number
): number {
  // Sample warp displacement from dedicated noise layers
  const wx = fbmCylindrical(noise.warpX, x, y, width, height, 2, 0.5);
  const wy = fbmCylindrical(noise.warpY, x, y, width, height, 2, 0.5);

  // Apply warp: shift coordinates by noise-derived offset
  const warpedX = x + (wx - 0.5) * warpStrength * width;
  const warpedY = y + (wy - 0.5) * warpStrength * height;

  return fbmCylindrical(noise.continent, warpedX, warpedY, width, height, octaves, baseFreq);
}

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D,
  waterRatio: number
): void {
  for (const cell of cells) {
    // --- Layer 1: Warped continent noise at two scales ---
    // Large-scale continents (low frequency, strong warp for irregular shapes)
    const largeCont = warpedContinentNoise(
      noise, cell.x, cell.y, width, height,
      0.25,  // warp strength
      2,     // octaves
      0.5    // base frequency — large blobs
    );

    // Medium-scale landmasses (higher frequency, creates archipelagos and subcontinents)
    const medCont = warpedContinentNoise(
      noise, cell.x + width * 0.5, cell.y + height * 0.5, width, height,
      0.15,  // less warp
      2,     // octaves
      1.0    // higher frequency — smaller features
    );

    // Combine: large continents dominate, medium adds variety
    const continentRaw = largeCont * 0.7 + medCont * 0.3;

    // Shape the continent mask: push toward bimodal (land vs ocean)
    // Power curve creates sharper land/ocean boundaries
    const continentMask = Math.pow(continentRaw, 1.4) * 2.0 - 0.55;

    // --- Layer 2: Ocean basin carving ---
    // Very low-frequency noise that creates wide ocean channels between continents
    const basin = fbmCylindrical(
      noise.oceanBasin, cell.x, cell.y, width, height, 2, 0.4
    );
    // Ocean channels: where basin noise is low, strongly suppress elevation
    // This creates reliable ocean gaps that separate continents
    const basinFactor = Math.pow(Math.max(0, basin), 0.8);
    const oceanCarve = basinFactor * 0.4 + 0.6; // range 0.6..1.0

    // --- Layer 3: Terrain detail (mountains, valleys, coastlines) ---
    const detail = fbmCylindrical(
      noise.elevation, cell.x, cell.y, width, height, 4
    );

    // --- Combine all layers ---
    let elev = (continentMask * oceanCarve) * 0.65 + detail * 0.35;

    // --- Latitude effects ---
    const ny = (cell.y / height) * 2 - 1; // -1 (top) to 1 (bottom)
    const polarDist = Math.abs(ny);

    // Gentle polar suppression for mid-latitudes, but allow polar land
    // Uses a smooth curve that only kicks in strongly near the very edges
    if (polarDist > 0.7) {
      const polarFade = (polarDist - 0.7) / 0.3; // 0..1 in polar zone
      // Moderate suppression — still allows polar continents (like Antarctica)
      elev = elev - Math.pow(polarFade, 2.0) * 0.35;
    }

    // Polar landmass boost: create ice-cap continents at the extreme poles
    // Uses continent noise sampled at different offset to get independent polar shapes
    if (polarDist > 0.8) {
      const polarLand = fbmCylindrical(
        noise.continent, cell.x + width * 0.33, cell.y * 3, width, height, 2, 0.8
      );
      const polarBoost = Math.pow(Math.max(0, polarLand - 0.35), 0.8) * 0.6;
      const polarBlend = Math.min(1, (polarDist - 0.8) / 0.15);
      elev = elev + polarBoost * polarBlend;
    }

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
