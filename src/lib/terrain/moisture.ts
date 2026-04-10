import type { Cell, TerrainProfile } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

const MAX_HOPS = 30;              // how far upwind to march through the neighbor graph

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
  height: number,
  profile: TerrainProfile
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
      if (elev > profile.mountainThreshold) {
        const barrier = (elev - profile.mountainThreshold) / (1.0 - profile.mountainThreshold);
        const distDecay = 1.0 - (hop / MAX_HOPS) * 0.5;
        maxBarrier = Math.max(maxBarrier, barrier * distDecay);
      }
    }

    shadow[i] = Math.min(1, maxBarrier * profile.elevationScale) * profile.shadowStrength;
  }

  return shadow;
}

export function assignMoisture(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D,
  sstAnomaly: Float32Array | undefined,
  profile: TerrainProfile
): Float32Array {
  // Pass 1: Base moisture from noise + latitude + coastal boost
  for (const cell of cells) {
    let m = fbmCylindrical(noise.moisture, cell.x + width * 0.3, cell.y + height * 0.3, width, height, 3);

    // Latitude-based moisture adjustment (smooth Hadley cell model)
    // Damped cosine produces: wet equator (+0.26), dry subtropics (-0.25),
    // moderate midlatitudes (+0.17), dry poles (-0.16) with smooth transitions
    const ny = (cell.y / height) * 2 - 1; // -1 (top) to 1 (bottom)
    const absLat = Math.abs(ny);
    const damping = profile.latAmplitude * (1.0 - profile.latPolarDamping * absLat);
    const latMod = damping * Math.cos(absLat * Math.PI * profile.latFrequency) + profile.latBias;
    m += latMod;

    // Coastal cells are wetter (compensates for stronger subtropical penalty)
    // Cold ocean currents suppress evaporation → reduced coastal moisture (Atacama, Namibia)
    if (cell.isCoast) {
      let coastBoost = 0.25;
      if (sstAnomaly) {
        // Average SST anomaly of neighboring water cells
        let totalAnomaly = 0;
        let waterNeighbors = 0;
        for (const ni of cell.neighbors) {
          if (cells[ni].isWater) {
            totalAnomaly += sstAnomaly[ni];
            waterNeighbors++;
          }
        }
        if (waterNeighbors > 0) {
          const avgAnomaly = totalAnomaly / waterNeighbors;
          // Negative anomaly (cold current) reduces the coastal boost
          const coldFactor = Math.max(0, -avgAnomaly);
          coastBoost *= Math.max(0, 1.0 - coldFactor * profile.coastalMoistureSensitivity);
        }
      }
      m = Math.min(1, m + coastBoost);
    }

    cell.moisture = Math.max(0, Math.min(1, m));
  }

  // Pass 1b: Continentality — reduce moisture based on distance from ocean
  const distFromOcean = computeDistanceFromOcean(cells);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].isWater && distFromOcean[i] > 0) {
      const d = distFromOcean[i];
      const decay = profile.continentalityStrength * (d / (d + profile.continentalityMidpoint));
      cells[i].moisture = Math.max(0, cells[i].moisture - decay);
    }
  }

  // Pass 2: Rain shadow — reduce moisture behind mountain ranges
  const shadow = computeRainShadow(cells, width, height, profile);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].isWater && shadow[i] > 0) {
      cells[i].moisture = Math.max(0, cells[i].moisture - shadow[i]);
    }
  }

  // Global moisture offset — additive shift applied last
  if (profile.globalMoistureOffset !== 0) {
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i].isWater) {
        cells[i].moisture = Math.max(0, Math.min(1, cells[i].moisture + profile.globalMoistureOffset));
      }
    }
  }

  return distFromOcean;
}
