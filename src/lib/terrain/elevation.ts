import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical, seededPRNG } from './noise';

// ---------------------------------------------------------------------------
// Tectonic plate simulation
// ---------------------------------------------------------------------------

interface TectonicPlate {
  id: number;
  seedCell: number;
  isContinental: boolean;
  /** Drift direction (unit vector in wrapped x/y space) */
  driftX: number;
  driftY: number;
  /** Base elevation for this plate */
  baseElev: number;
}

/**
 * Assign every cell to its nearest plate via multi-source BFS on the cell
 * adjacency graph. This produces irregular plate shapes that follow the
 * Voronoi mesh topology — no circles or ellipses.
 */
function assignPlates(
  cells: Cell[],
  numPlates: number,
  rng: () => number
): { plateOf: Int32Array; plates: TectonicPlate[] } {
  const n = cells.length;
  const plateOf = new Int32Array(n).fill(-1);

  // Pick plate seed cells spread out via farthest-point sampling
  const seedIndices: number[] = [];
  // First seed: random
  seedIndices.push(Math.floor(rng() * n));
  plateOf[seedIndices[0]] = 0;

  // Subsequent seeds: pick the cell farthest (by BFS hops) from all existing seeds
  // Approximate with random candidates + max-min distance
  const hopDist = new Int32Array(n).fill(0x7fffffff);
  for (let s = 0; s < numPlates; s++) {
    if (s > 0) {
      // Pick from candidates the one with max min-distance to existing seeds
      let bestCell = -1;
      let bestDist = -1;
      const numCandidates = Math.min(n, 80);
      for (let c = 0; c < numCandidates; c++) {
        const ci = Math.floor(rng() * n);
        if (hopDist[ci] > bestDist && plateOf[ci] === -1) {
          bestDist = hopDist[ci];
          bestCell = ci;
        }
      }
      if (bestCell === -1) break;
      seedIndices.push(bestCell);
      plateOf[bestCell] = s;
    }

    // BFS from this seed to update hop distances
    const queue: number[] = [seedIndices[s]];
    const visited = new Uint8Array(n);
    visited[seedIndices[s]] = 1;
    const dist = new Int32Array(n).fill(0x7fffffff);
    dist[seedIndices[s]] = 0;
    let qi = 0;
    while (qi < queue.length) {
      const ci = queue[qi++];
      for (const ni of cells[ci].neighbors) {
        if (!visited[ni]) {
          visited[ni] = 1;
          dist[ni] = dist[ci] + 1;
          queue.push(ni);
        }
      }
    }
    // Update global min-distance
    for (let i = 0; i < n; i++) {
      if (dist[i] < hopDist[i]) hopDist[i] = dist[i];
    }
  }

  // Multi-source BFS from all seeds simultaneously to assign plates
  // Randomize expansion order slightly for more organic boundaries
  const queue: number[] = [];
  const order = new Float64Array(n);
  for (const si of seedIndices) {
    queue.push(si);
    order[si] = rng() * 0.5; // small random priority
  }

  // Simple BFS (not priority queue, but shuffle neighbors for irregularity)
  let qi = 0;
  while (qi < queue.length) {
    const ci = queue[qi++];
    const neighbors = cells[ci].neighbors;
    // Shuffle neighbors for organic boundaries
    for (let i = neighbors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = neighbors[i];
      neighbors[i] = neighbors[j];
      neighbors[j] = tmp;
    }
    for (const ni of neighbors) {
      if (plateOf[ni] === -1) {
        plateOf[ni] = plateOf[ci];
        queue.push(ni);
      }
    }
  }

  // Build plate objects
  const continentalRatio = 0.35 + rng() * 0.15; // 35-50% of plates are continental
  const plates: TectonicPlate[] = [];
  for (let i = 0; i < numPlates; i++) {
    const isContinental = rng() < continentalRatio;
    const angle = rng() * Math.PI * 2;
    const speed = 0.3 + rng() * 0.7;
    plates.push({
      id: i,
      seedCell: seedIndices[i],
      isContinental,
      driftX: Math.cos(angle) * speed,
      driftY: Math.sin(angle) * speed,
      baseElev: isContinental ? 0.45 + rng() * 0.15 : 0.05 + rng() * 0.1,
    });
  }

  return { plateOf, plates };
}

/**
 * Detect plate boundaries and compute boundary stress for each cell.
 * Returns per-cell values:
 *   boundaryStress: 0 (interior) to 1+ (strong boundary)
 *   isConvergent: true if plates are pushing together at this boundary
 */
function computeBoundaryEffects(
  cells: Cell[],
  plateOf: Int32Array,
  plates: TectonicPlate[],
  width: number
): { stress: Float64Array; convergent: Float64Array } {
  const n = cells.length;
  const stress = new Float64Array(n);
  const convergent = new Float64Array(n); // 1 = convergent, -1 = divergent, 0 = interior

  for (let i = 0; i < n; i++) {
    const myPlate = plateOf[i];
    let maxStress = 0;
    let conv = 0;

    for (const ni of cells[i].neighbors) {
      const otherPlate = plateOf[ni];
      if (otherPlate !== myPlate) {
        // This is a boundary cell
        maxStress = 1.0;

        // Compute relative drift at boundary
        const p1 = plates[myPlate];
        const p2 = plates[otherPlate];

        // Direction from cell to neighbor (wrapped in x)
        let dx = cells[ni].x - cells[i].x;
        if (dx > width / 2) dx -= width;
        if (dx < -width / 2) dx += width;
        const dy = cells[ni].y - cells[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;

        // Relative velocity projected onto boundary normal
        const relVx = p1.driftX - p2.driftX;
        const relVy = p1.driftY - p2.driftY;
        const dot = relVx * nx + relVy * ny;

        // Positive dot = convergent (plates pushing together)
        // Negative dot = divergent (plates pulling apart)
        conv = dot > 0 ? 1 : -1;
      }
    }

    stress[i] = maxStress;
    convergent[i] = conv;
  }

  // Spread boundary stress to nearby cells (2-ring diffusion)
  for (let pass = 0; pass < 3; pass++) {
    const prev = new Float64Array(stress);
    for (let i = 0; i < n; i++) {
      if (prev[i] > 0) continue; // don't overwrite actual boundary cells
      let sum = 0;
      let count = 0;
      for (const ni of cells[i].neighbors) {
        if (prev[ni] > 0) {
          sum += prev[ni];
          count++;
        }
      }
      if (count > 0) {
        stress[i] = (sum / count) * 0.5; // decay with distance
      }
    }
  }

  return { stress, convergent };
}

// ---------------------------------------------------------------------------
// Simple thermal erosion — smooths unrealistically steep slopes
// ---------------------------------------------------------------------------

function thermalErosion(cells: Cell[], iterations: number, talusAngle: number): void {
  for (let iter = 0; iter < iterations; iter++) {
    for (const cell of cells) {
      if (cell.isWater) continue;
      for (const ni of cell.neighbors) {
        const diff = cell.elevation - cells[ni].elevation;
        if (diff > talusAngle) {
          const transfer = diff * 0.3;
          cell.elevation -= transfer;
          cells[ni].elevation += transfer;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main elevation assignment
// ---------------------------------------------------------------------------

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D,
  waterRatio: number,
  seed: string
): void {
  const rng = seededPRNG(seed + '_tectonics');
  const n = cells.length;

  // --- Step 1: Generate tectonic plates ---
  const numPlates = 8 + Math.floor(rng() * 8); // 8–15 plates
  const { plateOf, plates } = assignPlates(cells, numPlates, rng);

  // --- Step 2: Compute plate boundary effects ---
  const { stress, convergent } = computeBoundaryEffects(
    cells, plateOf, plates, width
  );

  // --- Step 3: Assign elevation per cell ---
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const plate = plates[plateOf[i]];

    // Base elevation from plate type
    let elev = plate.baseElev;

    // --- Plate boundary effects ---
    if (stress[i] > 0.01) {
      if (convergent[i] > 0) {
        // Convergent boundary: mountain building
        if (plate.isContinental) {
          // Continental collision → tall mountains (Himalayas)
          elev += stress[i] * 0.4;
        } else {
          // Oceanic subduction → volcanic arc, island chains
          elev += stress[i] * 0.25;
        }
      } else if (convergent[i] < 0) {
        // Divergent boundary: rift valleys on land, mid-ocean ridges at sea
        if (plate.isContinental) {
          elev -= stress[i] * 0.15; // rift valley
        } else {
          elev += stress[i] * 0.08; // mid-ocean ridge (slight rise)
        }
      }
    }

    // --- Noise-based terrain variation within plates ---
    // Domain warp for organic shapes
    const wx = fbmCylindrical(noise.warpX, cell.x, cell.y, width, height, 2, 1.5);
    const wy = fbmCylindrical(noise.warpY, cell.x, cell.y, width, height, 2, 1.5);
    const wX = cell.x + (wx - 0.5) * width * 0.08;
    const wY = cell.y + (wy - 0.5) * height * 0.08;

    // Large-scale variation (continental shelves, basins within plates)
    const largeFeat = fbmCylindrical(noise.continent, wX, wY, width, height, 3, 1.0);
    elev += (largeFeat - 0.5) * 0.2;

    // Fine detail (hills, valleys)
    const detail = fbmCylindrical(noise.elevation, cell.x, cell.y, width, height, 5, 3.0);
    elev += (detail - 0.5) * 0.12;

    // --- Coastal irregularity ---
    // Additional warped noise specifically to break up coastlines
    const coastWarp = fbmCylindrical(
      noise.oceanBasin, wX, wY, width, height, 4, 2.5
    );
    // Strongest effect near the land/ocean boundary (elev ~0.3-0.5)
    const edgeness = 1.0 - Math.abs(elev - 0.4) * 4.0;
    if (edgeness > 0) {
      elev += (coastWarp - 0.5) * 0.25 * edgeness;
    }

    // --- Polar ice caps ---
    const ny = (cell.y / height) * 2 - 1;
    const polarDist = Math.abs(ny);

    if (polarDist > 0.82) {
      const polarOffset = ny > 0 ? 0.0 : width * 0.5;
      const polarNoise = fbmCylindrical(
        noise.continent, cell.x + polarOffset, cell.y, width, height, 3, 1.5
      );
      const polarBlend = Math.min(1, (polarDist - 0.82) / 0.12);
      const polarLand = (polarNoise - 0.25) * 1.2 * polarBlend;
      elev = Math.max(elev, polarLand);
    }

    cell.elevation = Math.max(0, Math.min(1, elev));
  }

  // --- Step 4: Normalize elevation ---
  let maxElev = 0;
  for (const cell of cells) {
    if (cell.elevation > maxElev) maxElev = cell.elevation;
  }
  if (maxElev > 0) {
    for (const cell of cells) {
      cell.elevation /= maxElev;
    }
  }

  // --- Step 5: Mark water cells by elevation rank ---
  const targetWaterCount = Math.round(waterRatio * cells.length);
  const byElevation = [...cells].sort((a, b) => a.elevation - b.elevation);
  byElevation.forEach((cell, i) => {
    cell.isWater = i < targetWaterCount;
  });

  // --- Step 6: Thermal erosion (smooth unrealistic cliffs) ---
  thermalErosion(cells, 3, 0.05);

  // --- Step 7: Mark coast cells ---
  for (const cell of cells) {
    cell.isCoast = false; // reset after erosion may have shifted things
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
