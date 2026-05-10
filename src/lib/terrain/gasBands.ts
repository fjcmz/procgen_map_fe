import type { Cell, BiomeType, TerrainProfile } from '../types';
import { createNoise3D } from 'simplex-noise';
import { seededPRNG } from './noise';

/**
 * Gas-giant cell-band assignment. Runs in place of the Earth-like terrain
 * pipeline when `profile.gasGiantMode === true`. Each cell receives:
 *
 *   - a `biome` from the gas-band vocabulary (GAS_BAND_LIGHT / DARK / HOT,
 *     GAS_HAZE for polar hoods, GAS_STORM for vortex stamps),
 *   - synthetic elevation / temperature / moisture so the renderer's hot
 *     path doesn't NaN on missing fields,
 *   - `isWater = false` and `isCoast = false` (no land/water concept),
 *   - `riverFlow = 0` and `kingdom = null`.
 *
 * The latitude → band mapping is a stepwise function with FBM perturbation
 * along x (cylindrical-wrapped), giving wavy band edges. Storm vortices are
 * sprinkled randomly using an isolated PRNG sub-stream.
 *
 * Sub-stream isolation (mandatory): all randomness routes through
 * `${seed}_gasbands` (RNG) and `${seed}_clouds` (noise), distinct from the
 * existing `_elev`/`_moist`/`_continent` etc. streams. This guarantees no
 * perturbation of the rocky-body sweep baseline.
 */
export function assignGasBands(
  cells: Cell[],
  width: number,
  height: number,
  seed: string,
  profile: TerrainProfile,
): void {
  const rng = seededPRNG(seed + '_gasbands');
  const cloudNoise = createNoise3D(seededPRNG(seed + '_clouds'));

  // Number of horizontal bands (5 zones/belts, mirroring the universe view).
  const NUM_BANDS = 5;
  const PERTURB_STRENGTH = 0.10; // band edge wiggle in normalized-y units

  for (const cell of cells) {
    const ny = (cell.y / height) * 2 - 1; // -1 = north pole, +1 = south pole

    // Cylindrical FBM perturbation along x — gives wavy band edges.
    const theta = (2 * Math.PI * cell.x) / width;
    const R = 1.5 / (2 * Math.PI);
    const cx = Math.cos(theta) * R;
    const cz = Math.sin(theta) * R;
    const perturb = cloudNoise(cx * 2, ny * 2, cz * 2) * PERTURB_STRENGTH;
    const perturbedNy = ny + perturb;
    const absNy = Math.abs(perturbedNy);

    let biome: BiomeType;
    if (absNy >= 0.85) {
      // Polar haze hood
      biome = 'GAS_HAZE';
    } else {
      // Map [-0.85, 0.85] to band index [0, NUM_BANDS - 1].
      const bandT = ((perturbedNy + 0.85) / 1.70) * NUM_BANDS;
      const bandIdx = Math.max(0, Math.min(NUM_BANDS - 1, Math.floor(bandT)));
      // Alternate light / dark with one HOT band in the middle for variety.
      if (bandIdx === Math.floor(NUM_BANDS / 2)) {
        biome = 'GAS_BAND_HOT';
      } else if (bandIdx % 2 === 0) {
        biome = 'GAS_BAND_LIGHT';
      } else {
        biome = 'GAS_BAND_DARK';
      }
    }

    cell.biome = biome;
    cell.isWater = false;
    cell.isCoast = false;
    cell.elevation = 0.5;
    cell.temperature = 0.5 + (1 - Math.abs(ny)) * 0.3;
    cell.moisture = 0.5;
    cell.riverFlow = 0;
    cell.kingdom = null;
  }

  // Sprinkle storm vortices. Count scales with cell count so big maps
  // don't get an absurd density. Each storm BFSes outward to a small radius
  // and stamps GAS_STORM on cells within.
  const stormCount = Math.max(1, Math.round(cells.length / 2000));
  for (let s = 0; s < stormCount; s++) {
    const seedIndex = Math.floor(rng() * cells.length);
    const seedCell = cells[seedIndex];
    if (!seedCell) continue;
    // Skip storms in polar haze (looks weird overlapping the hood).
    const seedNy = Math.abs((seedCell.y / height) * 2 - 1);
    if (seedNy >= 0.80) continue;

    // BFS up to `maxRadius` hops. Small radius keeps storms compact.
    const maxRadius = 2 + Math.floor(rng() * 2);
    const visited = new Set<number>([seedIndex]);
    let frontier = [seedIndex];
    seedCell.biome = 'GAS_STORM';
    for (let r = 0; r < maxRadius; r++) {
      const next: number[] = [];
      for (const idx of frontier) {
        const c = cells[idx];
        for (const ni of c.neighbors) {
          if (visited.has(ni)) continue;
          visited.add(ni);
          cells[ni].biome = 'GAS_STORM';
          next.push(ni);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }

  // Suppress lint warning: profile is read for type signature consistency.
  void profile;
}
