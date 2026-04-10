import type { Cell, TerrainProfile } from '../types';

// ---------------------------------------------------------------------------
// Stream-power hydraulic erosion — carves river valleys into terrain
// ---------------------------------------------------------------------------
const FLOW_EXPONENT = 0.5;     // sqrt(flow) — big rivers erode more, not linearly
const SLOPE_EXPONENT = 1.0;    // linear with slope
const DEPOSITION_RATE = 0.3;   // fraction deposited on downstream cell (floodplains)
const MIN_ELEVATION = 0.005;   // floor for eroded cells

// Valley widening constants
const VALLEY_FLOW_THRESHOLD = 8;  // only widen valleys for significant rivers
const VALLEY_FRACTION = 0.3;      // fraction of channel erosion applied to neighbors

/** Find the lowest-elevation neighbor for each land cell (drainage direction). */
function buildDrainageMap(cells: Cell[]): (number | null)[] {
  const drainage: (number | null)[] = new Array(cells.length).fill(null);
  for (const cell of cells) {
    if (cell.isWater) continue;
    let lowestElev = cell.elevation;
    let lowestIdx: number | null = null;
    for (const ni of cell.neighbors) {
      if (cells[ni].elevation < lowestElev) {
        lowestElev = cells[ni].elevation;
        lowestIdx = ni;
      }
    }
    drainage[cell.index] = lowestIdx;
  }
  return drainage;
}

/**
 * Hydraulic erosion using the stream power law.
 *
 * Uses the riverFlow values already computed by generateRivers() to determine
 * where and how much to erode. Higher flow = deeper valley. After erosion,
 * a valley-widening pass lowers neighbors of major river cells for visible
 * V-shaped cross-sections in hillshading.
 *
 * Call this AFTER generateRivers() and BEFORE re-running temperature/biomes.
 */
export function hydraulicErosion(cells: Cell[], profile: TerrainProfile): void {
  const n = cells.length;

  // Track cumulative erosion per cell for the valley-widening pass
  const cumulativeErosion = new Float64Array(n);

  for (let iter = 0; iter < profile.erosionIterations; iter++) {
    const drainage = buildDrainageMap(cells);

    // Topological sort: process high cells first so upstream erosion
    // propagates before downstream cells are processed
    const landCells = cells.filter(c => !c.isWater);
    landCells.sort((a, b) => b.elevation - a.elevation);

    for (const cell of landCells) {
      if (cell.riverFlow <= 1) continue; // no upstream contribution

      const downstream = drainage[cell.index];
      if (downstream === null) continue;

      const slope = cell.elevation - cells[downstream].elevation;
      if (slope <= 0) continue; // no downhill gradient

      // Stream power law: erosion ~ K * Q^m * S^n
      const erosion = profile.erosionK
        * Math.pow(cell.riverFlow, FLOW_EXPONENT)
        * Math.pow(slope, SLOPE_EXPONENT);

      // Clamp: don't erode below downstream cell or below minimum
      const maxDrop = cell.elevation - Math.max(cells[downstream].elevation, MIN_ELEVATION);
      const actualErosion = Math.min(erosion, maxDrop);

      if (actualErosion <= 0) continue;

      cell.elevation -= actualErosion;
      cumulativeErosion[cell.index] += actualErosion;

      // Deposit a fraction on the downstream cell (creates floodplains)
      const deposit = actualErosion * DEPOSITION_RATE;
      cells[downstream].elevation += deposit;
    }
  }

  // --- Valley widening pass ---
  // For major river cells, lower immediate non-river neighbors to create
  // visible V-shaped valleys in the hillshading
  const valleyLowering = new Float64Array(n);

  for (const cell of cells) {
    if (cell.isWater) continue;
    if (cell.riverFlow < VALLEY_FLOW_THRESHOLD) continue;
    if (cumulativeErosion[cell.index] <= 0) continue;

    const lowerAmount = cumulativeErosion[cell.index] * VALLEY_FRACTION;

    for (const ni of cell.neighbors) {
      if (cells[ni].isWater) continue;
      // Don't widen into cells that are themselves major river channels
      if (cells[ni].riverFlow >= VALLEY_FLOW_THRESHOLD) continue;
      // Accumulate the max lowering from any adjacent river cell
      valleyLowering[ni] = Math.max(valleyLowering[ni], lowerAmount);
    }
  }

  for (let i = 0; i < n; i++) {
    if (valleyLowering[i] > 0) {
      cells[i].elevation = Math.max(MIN_ELEVATION, cells[i].elevation - valleyLowering[i]);
    }
  }

  // --- Re-normalize elevations to [0, 1] ---
  let maxElev = 0;
  for (const cell of cells) {
    if (cell.elevation > maxElev) maxElev = cell.elevation;
  }
  if (maxElev > 0 && maxElev !== 1) {
    const invMax = 1 / maxElev;
    for (const cell of cells) {
      cell.elevation *= invMax;
    }
  }

  // --- Re-mark coast cells ---
  for (const cell of cells) {
    if (cell.isWater) {
      cell.isCoast = false;
      continue;
    }
    cell.isCoast = false;
    for (const ni of cell.neighbors) {
      if (cells[ni].isWater) {
        cell.isCoast = true;
        break;
      }
    }
  }
}
