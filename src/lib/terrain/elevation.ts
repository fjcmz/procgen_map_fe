import type { Cell, TerrainProfile } from '../types';
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

// ---------------------------------------------------------------------------
// Plate generation tuning constants
// ---------------------------------------------------------------------------

const OCEANIC_GROWTH_MIN = 0.6;
const OCEANIC_GROWTH_MAX = 1.0;

const BASE_STEP_SIZE = 4;
const CONTINENTAL_SEED_MIN_SEP_FACTOR = 0.15; // multiplied by sqrt(n)

/**
 * BFS from a single cell, returns hop distances to all cells.
 */
function bfsDistances(cells: Cell[], startCell: number): Int32Array {
  const n = cells.length;
  const dist = new Int32Array(n).fill(0x7fffffff);
  dist[startCell] = 0;
  const queue: number[] = [startCell];
  let qi = 0;
  while (qi < queue.length) {
    const ci = queue[qi++];
    for (const ni of cells[ci].neighbors) {
      if (dist[ni] === 0x7fffffff) {
        dist[ni] = dist[ci] + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

/**
 * Assign every cell to its nearest plate via multi-source BFS on the cell
 * adjacency graph. Uses a controlled continental/oceanic split with
 * continental seed clustering and size-biased growth weights.
 *
 * Continental plates (3–5) are seeded near each other to form large
 * landmasses, while oceanic plates (8–12) are spread evenly via
 * farthest-point sampling. Round-robin weighted BFS gives continental
 * plates ~3× more cells than oceanic plates.
 */
function assignPlates(
  cells: Cell[],
  rng: () => number,
  profile: TerrainProfile
): { plateOf: Int32Array; plates: TectonicPlate[] } {
  const n = cells.length;
  const plateOf = new Int32Array(n).fill(-1);

  const numContinental = profile.numContinentalMin + Math.floor(rng() * (profile.numContinentalMax - profile.numContinentalMin + 1));
  const numOceanic = profile.numOceanicMin + Math.floor(rng() * (profile.numOceanicMax - profile.numOceanicMin + 1));
  const numPlates = numContinental + numOceanic;

  const minSeparation = Math.floor(Math.sqrt(n) * CONTINENTAL_SEED_MIN_SEP_FACTOR);

  // --- Seed placement ---
  // Continental seeds: first is random, subsequent cluster near existing
  // continental seeds. Oceanic seeds: farthest-point from all existing seeds.

  const seedIndices: number[] = [];
  const hopDist = new Int32Array(n).fill(0x7fffffff); // min distance to any seed
  const continentalDist = new Int32Array(n).fill(0x7fffffff); // min distance to continental seeds

  const numCandidates = Math.min(n, 80);

  for (let s = 0; s < numPlates; s++) {
    let seedCell: number;

    if (s === 0) {
      // First continental seed: random
      seedCell = Math.floor(rng() * n);
    } else if (s < numContinental) {
      // Subsequent continental seeds: nearest to existing continental seeds,
      // but at least minSeparation hops away
      let bestCell = -1;
      let bestDist = 0x7fffffff;
      for (let c = 0; c < numCandidates; c++) {
        const ci = Math.floor(rng() * n);
        if (plateOf[ci] !== -1) continue;
        const d = continentalDist[ci];
        if (d >= minSeparation && d < bestDist) {
          bestDist = d;
          bestCell = ci;
        }
      }
      // Fallback: if no candidate meets minSeparation, just pick the closest
      // unassigned candidate
      if (bestCell === -1) {
        let fallbackDist = 0x7fffffff;
        for (let c = 0; c < numCandidates; c++) {
          const ci = Math.floor(rng() * n);
          if (plateOf[ci] === -1 && continentalDist[ci] < fallbackDist) {
            fallbackDist = continentalDist[ci];
            bestCell = ci;
          }
        }
      }
      seedCell = bestCell !== -1 ? bestCell : Math.floor(rng() * n);
    } else {
      // Oceanic seeds: farthest-point sampling from ALL existing seeds
      let bestCell = -1;
      let bestDist = -1;
      for (let c = 0; c < numCandidates; c++) {
        const ci = Math.floor(rng() * n);
        if (hopDist[ci] > bestDist && plateOf[ci] === -1) {
          bestDist = hopDist[ci];
          bestCell = ci;
        }
      }
      seedCell = bestCell !== -1 ? bestCell : Math.floor(rng() * n);
    }

    seedIndices.push(seedCell);
    plateOf[seedCell] = s;

    // BFS from this seed to update hop distances
    const dist = bfsDistances(cells, seedCell);
    for (let i = 0; i < n; i++) {
      if (dist[i] < hopDist[i]) hopDist[i] = dist[i];
      if (s < numContinental && dist[i] < continentalDist[i]) {
        continentalDist[i] = dist[i];
      }
    }
  }

  // --- Round-robin weighted BFS plate growth ---
  // Continental plates get higher growth weights so they claim more cells.
  const growthWeight: number[] = [];
  for (let i = 0; i < numPlates; i++) {
    if (i < numContinental) {
      growthWeight.push(profile.continentalGrowthMin + rng() * (profile.continentalGrowthMax - profile.continentalGrowthMin));
    } else {
      growthWeight.push(OCEANIC_GROWTH_MIN + rng() * (OCEANIC_GROWTH_MAX - OCEANIC_GROWTH_MIN));
    }
  }

  // Per-plate frontier queues
  const frontiers: number[][] = Array.from({ length: numPlates }, () => []);
  for (let i = 0; i < seedIndices.length; i++) {
    frontiers[i].push(seedIndices[i]);
  }

  let unassigned = n - numPlates;
  while (unassigned > 0) {
    let anyExpanded = false;
    for (let p = 0; p < numPlates; p++) {
      const steps = Math.max(1, Math.round(BASE_STEP_SIZE * growthWeight[p]));
      let expanded = 0;
      while (expanded < steps && frontiers[p].length > 0) {
        const ci = frontiers[p].shift()!;
        // Copy neighbors before shuffling to avoid corrupting the cell graph
        const neighbors = [...cells[ci].neighbors];
        for (let i = neighbors.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = neighbors[i];
          neighbors[i] = neighbors[j];
          neighbors[j] = tmp;
        }
        for (const ni of neighbors) {
          if (plateOf[ni] === -1) {
            plateOf[ni] = p;
            frontiers[p].push(ni);
            expanded++;
            unassigned--;
          }
        }
        if (expanded > 0) anyExpanded = true;
      }
    }
    if (!anyExpanded) break;
  }

  // Build plate objects — index-based continental assignment
  const plates: TectonicPlate[] = [];
  for (let i = 0; i < numPlates; i++) {
    const isContinental = i < numContinental;
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
 * Boost elevation along seams between adjacent continental plates.
 * This fills the gap between neighbouring continental plates so they
 * merge into a single landmass after the water-ratio ranking step.
 */
function boostContinentalSeams(
  cells: Cell[],
  plateOf: Int32Array,
  plates: TectonicPlate[],
  rng: () => number,
  profile: TerrainProfile
): Float64Array {
  const n = cells.length;
  const boost = new Float64Array(n);
  const mergeBoost = profile.seamBoostMin + rng() * (profile.seamBoostMax - profile.seamBoostMin);

  // Find cells on continental-continental plate boundaries
  const seamCells: number[] = [];
  for (let i = 0; i < n; i++) {
    const myPlate = plateOf[i];
    if (!plates[myPlate].isContinental) continue;
    for (const ni of cells[i].neighbors) {
      const otherPlate = plateOf[ni];
      if (otherPlate !== myPlate && plates[otherPlate].isContinental) {
        seamCells.push(i);
        break;
      }
    }
  }

  // BFS spread from seam cells with decay
  const visited = new Uint8Array(n);
  const dist = new Int32Array(n).fill(0x7fffffff);
  const queue: number[] = [];
  for (const ci of seamCells) {
    visited[ci] = 1;
    dist[ci] = 0;
    queue.push(ci);
    boost[ci] = mergeBoost;
  }
  let qi = 0;
  while (qi < queue.length) {
    const ci = queue[qi++];
    if (dist[ci] >= profile.seamSpreadRings) continue;
    for (const ni of cells[ci].neighbors) {
      if (!visited[ni] && plates[plateOf[ni]].isContinental) {
        visited[ni] = 1;
        dist[ni] = dist[ci] + 1;
        boost[ni] = mergeBoost * (1 - dist[ni] / (profile.seamSpreadRings + 1));
        queue.push(ni);
      }
    }
  }

  return boost;
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
// Continental shelf — BFS-based elevation boost for coastal water cells
// ---------------------------------------------------------------------------

function applyShelf(cells: Cell[], profile: TerrainProfile): void {
  if (profile.shelfWidth <= 0) return;

  // Find the elevation of the highest water cell (land/water boundary)
  let waterCeiling = 0;
  for (const cell of cells) {
    if (cell.isWater && cell.elevation > waterCeiling) {
      waterCeiling = cell.elevation;
    }
  }

  // BFS from coastal land cells outward through water, tracking hop distance
  const dist = new Int8Array(cells.length); // 0 = unvisited
  const queue: number[] = [];

  // Seed: all coastal land cells (land cells adjacent to water)
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.isWater) continue;
    for (const ni of cell.neighbors) {
      if (cells[ni].isWater && dist[ni] === 0) {
        dist[ni] = 1;
        queue.push(ni);
      }
    }
  }

  // BFS expansion through water up to shelfWidth hops
  let head = 0;
  while (head < queue.length) {
    const ci = queue[head++];
    const d = dist[ci];
    if (d >= profile.shelfWidth) continue;
    for (const ni of cells[ci].neighbors) {
      if (cells[ni].isWater && dist[ni] === 0) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }

  // Apply elevation boost: strongest at hop 1, fading to 0 at shelfWidth edge
  for (const ci of queue) {
    const d = dist[ci]; // 1-based distance
    const factor = profile.shelfStrength * (1 - (d - 1) / profile.shelfWidth);
    cells[ci].elevation += (waterCeiling - cells[ci].elevation) * factor;
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
  seed: string,
  profile: TerrainProfile
): void {
  const rng = seededPRNG(seed + '_tectonics');
  const n = cells.length;

  // --- Step 1: Generate tectonic plates ---
  // 3–5 continental plates (clustered, larger) + 8–12 oceanic plates (spread)
  const { plateOf, plates } = assignPlates(cells, rng, profile);

  // --- Step 1b: Boost seams between adjacent continental plates ---
  const seamBoost = boostContinentalSeams(cells, plateOf, plates, rng, profile);

  // --- Step 2: Compute plate boundary effects ---
  const { stress, convergent } = computeBoundaryEffects(
    cells, plateOf, plates, width
  );

  // --- Step 3: Assign elevation per cell ---
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const plate = plates[plateOf[i]];

    // Base elevation from plate type + continental seam boost
    let elev = plate.baseElev + seamBoost[i];

    // --- Plate boundary effects ---
    if (stress[i] > 0.01) {
      if (convergent[i] > 0) {
        // Convergent boundary: mountain building
        if (plate.isContinental) {
          // Continental collision → tall mountains (Himalayas)
          elev += stress[i] * profile.convergentCCBoost;
        } else {
          // Oceanic subduction → volcanic arc, island chains
          elev += stress[i] * profile.convergentOCBoost;
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

    if (polarDist > profile.polarIceStart) {
      // Reduced southern offset for more symmetric poles
      const polarOffset = ny > 0 ? 0.0 : width * 0.17;
      const polarNoise = fbmCylindrical(
        noise.continent, cell.x + polarOffset, cell.y, width, height, 4, 2.0
      );
      // Smoothstep blend over range [polarIceStart, polarIceEnd] to avoid banding
      const polarRange = profile.polarIceEnd - profile.polarIceStart;
      const t = Math.min(1, Math.max(0, (polarDist - profile.polarIceStart) / polarRange));
      const polarBlend = t * t * (3 - 2 * t);
      const polarLand = (polarNoise - 0.25) * profile.polarNoiseAmplitude * polarBlend;
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

  // --- Step 4b: Elevation power curve ---
  if (profile.elevationPower !== 1.0) {
    for (const cell of cells) {
      cell.elevation = Math.pow(cell.elevation, profile.elevationPower);
    }
  }

  // --- Step 5: Mark water cells by elevation rank ---
  const targetWaterCount = Math.round(waterRatio * cells.length);
  const byElevation = [...cells].sort((a, b) => a.elevation - b.elevation);
  byElevation.forEach((cell, i) => {
    cell.isWater = i < targetWaterCount;
  });

  // --- Step 5b: Continental shelf — boost coastal water elevations ---
  applyShelf(cells, profile);

  // --- Step 6: Thermal erosion (smooth unrealistic cliffs) ---
  thermalErosion(cells, profile.thermalErosionIters, profile.thermalErosionTalus);

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
