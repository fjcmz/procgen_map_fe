import type { Cell, TerrainProfile } from '../types';

const MIN_BASIN_SIZE = 50;            // basins smaller than this get no currents

export interface OceanCurrentData {
  sstAnomaly: Float32Array;           // per-cell SST deviation from latitude baseline
}

/**
 * BFS flood-fill to identify connected ocean basins.
 * Returns an Int32Array of basin IDs per cell (-1 for land).
 */
function detectBasins(cells: Cell[]): { basinIds: Int32Array; basinSizes: Map<number, number> } {
  const n = cells.length;
  const basinIds = new Int32Array(n).fill(-1);
  const basinSizes = new Map<number, number>();
  let nextBasinId = 0;

  for (let i = 0; i < n; i++) {
    if (!cells[i].isWater || basinIds[i] >= 0) continue;

    const bid = nextBasinId++;
    let size = 0;
    const queue = [i];
    basinIds[i] = bid;

    let qi = 0;
    while (qi < queue.length) {
      const ci = queue[qi++];
      size++;
      for (const ni of cells[ci].neighbors) {
        if (cells[ni].isWater && basinIds[ni] < 0) {
          basinIds[ni] = bid;
          queue.push(ni);
        }
      }
    }
    basinSizes.set(bid, size);
  }

  return { basinIds, basinSizes };
}

/**
 * Compute bounding box for a basin, handling cylindrical east-west wrapping.
 * Returns minX and basinWidth in pixel space.
 *
 * Uses a single pass over cells to compute both raw and shifted min/max,
 * avoiding intermediate arrays and Math.min/max(...spread) which overflow
 * the call stack on large basins (85k+ cells).
 */
function computeBasinBounds(
  cells: Cell[],
  basinIds: Int32Array,
  bid: number,
  width: number
): { minX: number; basinWidth: number } {
  const halfWidth = width / 2;
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let shiftedMin = Infinity;
  let shiftedMax = -Infinity;
  let hasNearZero = false;
  let hasNearWidth = false;

  for (let i = 0; i < cells.length; i++) {
    if (basinIds[i] !== bid) continue;
    const x = cells[i].x;

    if (x < rawMin) rawMin = x;
    if (x > rawMax) rawMax = x;

    const sx = (x + halfWidth) % width;
    if (sx < shiftedMin) shiftedMin = sx;
    if (sx > shiftedMax) shiftedMax = sx;

    if (x < width * 0.1) hasNearZero = true;
    if (x > width * 0.9) hasNearWidth = true;
  }

  if (hasNearZero && hasNearWidth) {
    const realMin = ((shiftedMin - halfWidth) % width + width) % width;
    return { minX: realMin, basinWidth: shiftedMax - shiftedMin };
  }

  return { minX: rawMin, basinWidth: rawMax - rawMin };
}

/**
 * Latitude envelope for gyre strength.
 * Gyres are strongest at mid-latitudes (absLat 0.2–0.7), weak near equator and poles.
 */
function gyreEnvelope(absLat: number): number {
  if (absLat < 0.10) return absLat / 0.10;           // ramp up from equator
  if (absLat < 0.20) return 0.7 + 0.3 * ((absLat - 0.10) / 0.10); // strengthen
  if (absLat <= 0.65) return 1.0;                     // full strength mid-latitudes
  if (absLat < 0.80) return 1.0 - ((absLat - 0.65) / 0.15); // taper off toward poles
  return 0;                                            // no gyres in polar regions
}

/**
 * Computes per-cell SST anomaly from simplified ocean gyre circulation.
 *
 * Model: In each ocean basin, warm currents flow poleward along the western margin
 * (like the Gulf Stream or Kuroshio) and cold currents flow equatorward along the
 * eastern margin (like the California or Benguela currents). The anomaly is strongest
 * at mid-latitudes and tapers toward the equator and poles.
 */
export function computeOceanCurrents(
  cells: Cell[],
  width: number,
  height: number,
  profile: TerrainProfile
): OceanCurrentData {
  const n = cells.length;
  const sstAnomaly = new Float32Array(n); // defaults to 0

  const { basinIds, basinSizes } = detectBasins(cells);

  // Precompute basin bounds for valid basins
  const basinBounds = new Map<number, { minX: number; basinWidth: number }>();
  for (const [bid, size] of basinSizes) {
    if (size >= MIN_BASIN_SIZE) {
      basinBounds.set(bid, computeBasinBounds(cells, basinIds, bid, width));
    }
  }

  const halfWidth = width / 2;

  for (let i = 0; i < n; i++) {
    const bid = basinIds[i];
    if (bid < 0) continue; // land cell

    const bounds = basinBounds.get(bid);
    if (!bounds) continue; // basin too small

    const cell = cells[i];
    const { minX, basinWidth } = bounds;

    // Skip if basin is too narrow (nearly 1D strip)
    if (basinWidth < width * 0.02) continue;

    // Compute relative x within basin [0, 1], handling wrapping
    let dx = cell.x - minX;
    if (dx > halfWidth) dx -= width;
    else if (dx < -halfWidth) dx += width;
    if (dx < 0) dx += width;
    const relX = Math.max(0, Math.min(1, dx / basinWidth));

    // Latitude factors
    const ny = (cell.y / height) * 2 - 1;
    const absLat = Math.abs(ny);
    const envelope = gyreEnvelope(absLat);

    // Compute anomaly based on position within basin
    let anomaly = 0;

    if (relX < 0.3) {
      // Western margin: warm poleward current
      // Strength peaks at basin edge (relX=0) and fades inward
      const edgeFactor = 1.0 - relX / 0.3;
      anomaly = profile.warmCurrentStrength * edgeFactor * envelope;
    } else if (relX > 0.7) {
      // Eastern margin: cold equatorward current
      // Strongest in subtropics (absLat 0.15–0.50)
      const edgeFactor = (relX - 0.7) / 0.3;
      const subtropicalBoost = absLat > 0.15 && absLat < 0.50
        ? 1.0 + 0.3 * (1.0 - Math.abs(absLat - 0.325) / 0.175)
        : 1.0;
      anomaly = -profile.coldCurrentStrength * edgeFactor * envelope * Math.min(subtropicalBoost, 1.3);
    } else {
      // Interior: weak linear interpolation between margins
      const t = (relX - 0.3) / 0.4; // 0 at relX=0.3, 1 at relX=0.7
      const warmSide = profile.warmCurrentStrength * 0.1 * envelope; // small residual warmth
      const coldSide = -profile.coldCurrentStrength * 0.1 * envelope; // small residual cold
      anomaly = warmSide * (1 - t) + coldSide * t;
    }

    // Depth scaling: surface currents weaker in deep ocean
    const depth = Math.max(0, 1 - cell.elevation / 0.4);
    const depthScale = 1.0 - depth * 0.15; // slight reduction in deep water
    anomaly *= depthScale;

    sstAnomaly[i] = anomaly;
  }

  return { sstAnomaly };
}
