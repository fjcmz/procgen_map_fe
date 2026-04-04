import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical, seededPRNG } from './noise';

interface ContinentSeed {
  /** x position in [0, width) — wraps cylindrically */
  x: number;
  /** y position in [0, height) */
  y: number;
  /** base radius as fraction of map width */
  radius: number;
  /** elongation factor (1 = circular, >1 = stretched) */
  stretch: number;
  /** rotation angle for the stretch ellipse */
  angle: number;
}

/**
 * Cylindrical distance between two points, wrapping in x.
 * Returns the shortest distance considering east-west wrap.
 */
function cylDist(
  x1: number, y1: number,
  x2: number, y2: number,
  width: number
): number {
  let dx = Math.abs(x1 - x2);
  if (dx > width / 2) dx = width - dx;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Elliptical distance from a continent seed, accounting for stretch and rotation.
 * Returns a normalized distance where 1.0 = at the seed's radius boundary.
 */
function ellipticalDist(
  x: number, y: number,
  seed: ContinentSeed,
  width: number
): number {
  // Get wrapped dx
  let dx = x - seed.x;
  if (dx > width / 2) dx -= width;
  if (dx < -width / 2) dx += width;
  const dy = y - seed.y;

  // Rotate into ellipse-local coordinates
  const cos = Math.cos(seed.angle);
  const sin = Math.sin(seed.angle);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;

  // Apply stretch: major axis = radius * stretch, minor axis = radius
  const rx = seed.radius * seed.stretch;
  const ry = seed.radius;

  return Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2);
}

/**
 * Place continent seeds with minimum spacing to ensure separation.
 * Uses Poisson-disk-like rejection sampling.
 */
function placeContinentSeeds(
  rng: () => number,
  width: number,
  height: number,
  count: number,
  minSpacing: number
): ContinentSeed[] {
  const seeds: ContinentSeed[] = [];
  const maxAttempts = 200;

  for (let i = 0; i < count; i++) {
    let best: ContinentSeed | null = null;
    let bestMinDist = -1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = rng() * width;
      // Keep continents away from extreme poles (leave room for polar caps)
      const y = 0.08 * height + rng() * 0.84 * height;
      const radius = width * (0.08 + rng() * 0.10); // 8-18% of width
      const stretch = 1.0 + rng() * 0.8; // 1.0 to 1.8 elongation
      const angle = rng() * Math.PI; // random orientation

      const candidate: ContinentSeed = { x, y, radius, stretch, angle };

      // Check minimum distance to all existing seeds
      let minDist = Infinity;
      for (const existing of seeds) {
        const d = cylDist(x, y, existing.x, existing.y, width);
        minDist = Math.min(minDist, d);
      }

      // Accept if far enough from others, or keep the best candidate
      if (seeds.length === 0 || minDist > minSpacing) {
        best = candidate;
        break;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }

    if (best) seeds.push(best);
  }
  return seeds;
}

export function assignElevation(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D,
  waterRatio: number,
  seed: string
): void {
  const rng = seededPRNG(seed + '_continents');

  // --- Step 1: Place continent seeds ---
  const numContinents = 4 + Math.floor(rng() * 4); // 4-7 continents
  const minSpacing = width * 0.18; // ensure ocean gaps between continents
  const seeds = placeContinentSeeds(rng, width, height, numContinents, minSpacing);

  // Also place 1-2 smaller island chains
  const numIslandChains = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < numIslandChains; i++) {
    const x = rng() * width;
    const y = 0.15 * height + rng() * 0.7 * height;
    seeds.push({
      x, y,
      radius: width * (0.03 + rng() * 0.04), // small
      stretch: 1.0 + rng() * 1.2,
      angle: rng() * Math.PI,
    });
  }

  for (const cell of cells) {
    // --- Layer 1: Continent influence ---
    // Sum influence from all continent seeds with smooth falloff
    let continentInfluence = 0;
    for (const s of seeds) {
      const d = ellipticalDist(cell.x, cell.y, s, width);
      if (d < 2.0) {
        // Smooth cubic falloff: 1 at center, 0 at d=1, negative beyond
        // Using smoothstep-like curve for natural coastlines
        const t = Math.max(0, 1 - d);
        const influence = t * t * (3 - 2 * t); // smoothstep
        continentInfluence = Math.max(continentInfluence, influence);
      }
    }

    // --- Layer 2: Noise-based coastline shaping ---
    // Domain-warped noise adds organic irregularity to continent edges
    const warpX = fbmCylindrical(noise.warpX, cell.x, cell.y, width, height, 2, 1.0);
    const warpY = fbmCylindrical(noise.warpY, cell.x, cell.y, width, height, 2, 1.0);
    const warpedCellX = cell.x + (warpX - 0.5) * width * 0.12;
    const warpedCellY = cell.y + (warpY - 0.5) * height * 0.12;

    // Continent noise at warped position — adds peninsulas, bays, fjords
    const coastNoise = fbmCylindrical(
      noise.continent, warpedCellX, warpedCellY, width, height, 4, 2.0
    );

    // Blend noise into continent shape: noise pushes coastlines in/out
    // Strong effect near coastlines (influence ~0.3-0.7), weak at centers/deep ocean
    const coastEffect = (coastNoise - 0.5) * 0.45;
    let elev = continentInfluence + coastEffect;

    // --- Layer 3: Terrain detail (mountains, valleys) ---
    const detail = fbmCylindrical(
      noise.elevation, cell.x, cell.y, width, height, 5, 2.0
    );
    // Mountains tend toward continent interiors (higher influence = more mountainous)
    const mountainBoost = Math.pow(Math.max(0, continentInfluence - 0.5), 1.5) * 0.4;
    elev += detail * 0.25 + mountainBoost * detail;

    // --- Layer 4: Mid-ocean ridges and scattered islands ---
    const oceanNoise = fbmCylindrical(
      noise.oceanBasin, cell.x, cell.y, width, height, 3, 3.0
    );
    // Only boost in deep ocean areas (low continent influence)
    if (continentInfluence < 0.15) {
      // Rare sharp peaks create volcanic islands
      const islandChance = Math.pow(Math.max(0, oceanNoise - 0.72), 2.0) * 3.0;
      elev = Math.max(elev, islandChance);
    }

    // --- Layer 5: Polar ice caps ---
    const ny = (cell.y / height) * 2 - 1; // -1 (top) to 1 (bottom)
    const polarDist = Math.abs(ny);

    if (polarDist > 0.82) {
      // Polar continent noise — independent shape per pole
      const polarOffset = ny > 0 ? 0.0 : width * 0.5;
      const polarNoise = fbmCylindrical(
        noise.continent, cell.x + polarOffset, cell.y, width, height, 3, 1.5
      );
      const polarBlend = Math.min(1, (polarDist - 0.82) / 0.12);
      const polarLand = (polarNoise - 0.3) * 1.5 * polarBlend;
      elev = Math.max(elev, polarLand);
    }

    elev = Math.max(0, Math.min(1, elev));
    cell.elevation = elev;
  }

  // Normalize so the highest cell reaches 1.0 (required for mountain biomes)
  let maxElev = 0;
  for (const cell of cells) {
    if (cell.elevation > maxElev) maxElev = cell.elevation;
  }
  if (maxElev > 0) {
    for (const cell of cells) {
      cell.elevation /= maxElev;
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
