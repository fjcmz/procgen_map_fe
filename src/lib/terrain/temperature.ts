import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';
import { getWindDirection } from './moisture';

// --- Continentality constants ---
const CONT_STRENGTH = 0.15;        // how much continental interiors deviate from maritime norm
const MARITIME_STRENGTH = 0.08;    // how much coasts pull temperature toward moderate (0.5)

// --- Windward ocean proximity ---
const WINDWARD_HOPS = 15;          // how far upwind to march looking for ocean
const WINDWARD_BONUS = 0.5;        // extra maritime effect for windward coasts

// --- Elevation lapse rate ---
const LAPSE_RATE = 0.10;           // temperature reduction per unit elevation

// --- Ocean current land influence ---
const CURRENT_LAND_INFLUENCE = 0.6; // attenuation of SST anomaly effect on nearby land

// --- Noise ---
const NOISE_AMPLITUDE = 0.03;      // small perturbation for organic boundaries

/**
 * Computes a windward ocean proximity factor for a land cell.
 * Marches upwind through the Voronoi neighbor graph. If ocean is found
 * nearby upwind, returns a factor close to 1.0; if not, returns 0.0.
 * Also returns the SST anomaly of the first upwind ocean cell (if available),
 * so ocean currents can influence coastal land temperatures.
 */
function computeWindwardFactor(
  cells: Cell[],
  cellIndex: number,
  width: number,
  height: number,
  sstAnomaly?: Float32Array
): { factor: number; oceanAnomaly: number } {
  const cell = cells[cellIndex];
  const ny = (cell.y / height) * 2 - 1;
  const wind = getWindDirection(ny);
  // Upwind direction is opposite of wind
  const upX = -wind.dx;
  const upY = -wind.dy;
  const halfWidth = width / 2;

  let current = cellIndex;

  for (let hop = 0; hop < WINDWARD_HOPS; hop++) {
    const neighbors = cells[current].neighbors;
    let bestDot = -Infinity;
    let bestNeighbor = -1;

    for (let j = 0; j < neighbors.length; j++) {
      const ni = neighbors[j];
      let dx = cells[ni].x - cells[current].x;
      // Handle cylindrical wrapping
      if (dx > halfWidth) dx -= width;
      else if (dx < -halfWidth) dx += width;
      const dy = cells[ni].y - cells[current].y;

      const dot = dx * upX + dy * upY;
      if (dot > bestDot) {
        bestDot = dot;
        bestNeighbor = ni;
      }
    }

    if (bestNeighbor === -1 || bestDot <= 0) break;

    current = bestNeighbor;

    if (cells[current].isWater) {
      // Ocean found upwind — return factor decayed by distance + SST anomaly
      const factor = 1.0 - (hop / WINDWARD_HOPS) * 0.6;
      const oceanAnomaly = sstAnomaly ? sstAnomaly[current] : 0;
      return { factor, oceanAnomaly };
    }
  }

  return { factor: 0, oceanAnomaly: 0 };
}

/**
 * Assigns a temperature value (0–1) to every cell based on:
 *   1. Base temperature from latitude (equator=1.0, poles=0.0)
 *   2. Continentality modifier (interiors more extreme, coasts milder)
 *   3. Windward ocean proximity (west-coast effect in westerlies belt)
 *   4. Elevation lapse rate (higher = colder)
 *   5. Small noise perturbation for organic edges
 */
export function assignTemperature(
  cells: Cell[],
  width: number,
  height: number,
  distFromOcean: Float32Array,
  noise: NoiseSampler3D,
  sstAnomaly?: Float32Array
): void {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    // 1. Base temperature from latitude
    const ny = (cell.y / height) * 2 - 1; // -1 (top/north) to +1 (bottom/south)
    const polarDist = Math.abs(ny);
    const baseTemp = 1.0 - polarDist;

    // Water cells: latitude-based temperature + ocean current anomaly + noise
    if (cell.isWater) {
      const n = fbmCylindrical(noise.continent, cell.x * 0.8, cell.y * 0.8, width, height, 2, 2.0);
      const currentAnomaly = sstAnomaly ? sstAnomaly[i] : 0;
      cell.temperature = Math.max(0, Math.min(1, baseTemp + currentAnomaly + n * NOISE_AMPLITUDE));
      continue;
    }

    // 2. Continentality modifier
    // Continental interiors: pushed away from 0.5 (more extreme)
    // Maritime cells: pulled toward 0.5 (milder)
    const d = distFromOcean[i];
    const sign = baseTemp > 0.5 ? 1 : -1;
    const contMod = sign * d * CONT_STRENGTH;

    // Maritime modifier: pull toward 0.5 (opposite of continentality)
    const maritimeMod = -sign * (1 - d) * MARITIME_STRENGTH;

    // 3. Windward ocean proximity — strengthens maritime effect on windward coasts
    const { factor: windwardFactor, oceanAnomaly } = computeWindwardFactor(cells, i, width, height, sstAnomaly);
    const windwardMod = -sign * windwardFactor * WINDWARD_BONUS * MARITIME_STRENGTH;

    // 3b. Ocean current influence on land — warm/cold currents modify coastal temps
    const currentMod = windwardFactor * oceanAnomaly * CURRENT_LAND_INFLUENCE;

    // 4. Elevation lapse rate: higher elevation = colder
    const elevCooling = cell.elevation * LAPSE_RATE;

    // 5. Small noise perturbation
    const n = fbmCylindrical(noise.continent, cell.x * 0.8, cell.y * 0.8, width, height, 2, 2.0);
    const noiseMod = n * NOISE_AMPLITUDE;

    cell.temperature = Math.max(0, Math.min(1,
      baseTemp + contMod + maritimeMod + windwardMod + currentMod - elevCooling + noiseMod
    ));
  }
}
