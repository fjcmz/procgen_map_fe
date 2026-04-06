import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

// --- Rain shadow constants ---
const MAX_HOPS = 30;              // how far upwind to march through the neighbor graph
const MOUNTAIN_THRESHOLD = 0.55;  // elevation above which terrain blocks moisture
const SHADOW_STRENGTH = 0.40;     // maximum moisture reduction from rain shadow
const ELEVATION_SCALE = 1.8;      // amplifies barrier effect (sharper from tall mountains)

// --- Continentality constants ---
const CONTINENTALITY_STRENGTH = 0.40;  // max moisture reduction for most inland cells
const CONTINENTALITY_MIDPOINT = 0.40;  // normalized distance at which decay reaches 50%

// --- Latitude / Hadley cell constants ---
const LAT_AMPLITUDE = 0.28;       // base amplitude of latitude moisture curve
const LAT_POLAR_DAMPING = 0.5;    // how much amplitude decreases toward poles
const LAT_FREQUENCY = 3.0;        // cosine cycles across latitude range (3 Hadley cells)
const LAT_BIAS = -0.02;           // slight global drying bias

/**
 * Returns the prevailing wind direction vector at a given normalized latitude.
 * Models Earth-like atmospheric circulation:
 *   Polar easterlies → westerlies → trade winds → equatorial doldrums
 * ny: -1 = north pole, 0 = equator, +1 = south pole
 */
export function getWindDirection(ny: number): { dx: number; dy: number } {
  const absLat = Math.abs(ny);
  let dx: number;
  let dy: number;

  if (absLat < 0.15) {
    // Polar easterlies: wind blows from east to west
    dx = 1;
    dy = 0;
  } else if (absLat < 0.25) {
    // Transition from polar easterlies to westerlies
    const t = (absLat - 0.15) / 0.10;
    dx = 1 - 2 * t; // +1 → -1
    dy = 0;
  } else if (absLat < 0.50) {
    // Westerlies: wind blows from west to east
    dx = -1;
    dy = 0;
  } else if (absLat < 0.60) {
    // Transition from westerlies to trade winds
    const t = (absLat - 0.50) / 0.10;
    dx = -1 + 2 * t; // -1 → +1
    dy = (ny > 0 ? -0.3 : 0.3) * t; // trades deflect equatorward
  } else if (absLat < 0.85) {
    // Trade winds: blow from east, deflected toward equator
    dx = 1;
    dy = ny > 0 ? -0.3 : 0.3;
  } else {
    // Near equator (ITCZ): weak easterlies
    dx = 0.5;
    dy = 0;
  }

  // Normalize to unit vector
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

/**
 * Multi-source BFS from all water cells to compute normalized distance-from-ocean
 * for every cell. Returns a Float32Array where 0 = water/coast, 1 = most inland.
 */
function computeDistanceFromOcean(cells: Cell[]): Float32Array {
  const n = cells.length;
  const dist = new Float32Array(n).fill(-1);
  const queue: number[] = [];

  // Seed BFS from all water cells (distance = 0)
  for (let i = 0; i < n; i++) {
    if (cells[i].isWater) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  // BFS expansion through neighbor graph
  let qi = 0;
  let maxDist = 0;
  while (qi < queue.length) {
    const ci = queue[qi++];
    for (const ni of cells[ci].neighbors) {
      if (dist[ni] < 0) {
        dist[ni] = dist[ci] + 1;
        if (dist[ni] > maxDist) maxDist = dist[ni];
        queue.push(ni);
      }
    }
  }

  // Normalize to 0–1 range
  if (maxDist > 0) {
    for (let i = 0; i < n; i++) {
      if (dist[i] > 0) {
        dist[i] = dist[i] / maxDist;
      }
    }
  }

  return dist;
}

/**
 * Computes rain shadow intensity per cell by marching upwind through the
 * Voronoi neighbor graph and tracking elevation barriers.
 */
function computeRainShadow(
  cells: Cell[],
  width: number,
  height: number
): Float32Array {
  const n = cells.length;
  const shadow = new Float32Array(n);
  const halfWidth = width / 2;

  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (cell.isWater) continue;

    const ny = (cell.y / height) * 2 - 1;
    const wind = getWindDirection(ny);
    // Upwind direction is opposite of wind
    const upX = -wind.dx;
    const upY = -wind.dy;

    let current = i;
    let maxBarrier = 0;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      // Pick neighbor most aligned with the upwind direction
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

      // No neighbor in the upwind direction
      if (bestNeighbor === -1 || bestDot <= 0) break;

      current = bestNeighbor;

      // If we hit water, moisture is replenished — no shadow
      if (cells[current].isWater) {
        maxBarrier = 0;
        break;
      }

      // Track the maximum elevation barrier, decayed by distance
      const elev = cells[current].elevation;
      if (elev > MOUNTAIN_THRESHOLD) {
        const barrier = (elev - MOUNTAIN_THRESHOLD) / (1.0 - MOUNTAIN_THRESHOLD);
        const distDecay = 1.0 - (hop / MAX_HOPS) * 0.5;
        maxBarrier = Math.max(maxBarrier, barrier * distDecay);
      }
    }

    shadow[i] = Math.min(1, maxBarrier * ELEVATION_SCALE) * SHADOW_STRENGTH;
  }

  return shadow;
}

export function assignMoisture(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D
): Float32Array {
  // Pass 1: Base moisture from noise + latitude + coastal boost (unchanged)
  for (const cell of cells) {
    let m = fbmCylindrical(noise.moisture, cell.x + width * 0.3, cell.y + height * 0.3, width, height, 3);

    // Latitude-based moisture adjustment (smooth Hadley cell model)
    // Damped cosine produces: wet equator (+0.26), dry subtropics (-0.25),
    // moderate midlatitudes (+0.17), dry poles (-0.16) with smooth transitions
    const ny = (cell.y / height) * 2 - 1; // -1 (top) to 1 (bottom)
    const absLat = Math.abs(ny);
    const damping = LAT_AMPLITUDE * (1.0 - LAT_POLAR_DAMPING * absLat);
    const latMod = damping * Math.cos(absLat * Math.PI * LAT_FREQUENCY) + LAT_BIAS;
    m += latMod;

    // Coastal cells are wetter (compensates for stronger subtropical penalty)
    if (cell.isCoast) {
      m = Math.min(1, m + 0.25);
    }

    cell.moisture = Math.max(0, Math.min(1, m));
  }

  // Pass 1b: Continentality — reduce moisture based on distance from ocean
  const distFromOcean = computeDistanceFromOcean(cells);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].isWater && distFromOcean[i] > 0) {
      const d = distFromOcean[i];
      const decay = CONTINENTALITY_STRENGTH * (d / (d + CONTINENTALITY_MIDPOINT));
      cells[i].moisture = Math.max(0, cells[i].moisture - decay);
    }
  }

  // Pass 2: Rain shadow — reduce moisture behind mountain ranges
  const shadow = computeRainShadow(cells, width, height);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].isWater && shadow[i] > 0) {
      cells[i].moisture = Math.max(0, cells[i].moisture - shadow[i]);
    }
  }

  return distFromOcean;
}
