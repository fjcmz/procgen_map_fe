import type { Cell, TerrainProfile } from '../types';
import { seededPRNG } from './noise';

/**
 * Volcanic-event overlay. Runs after `remapBiomesForSubtype` and stamps
 * active LAVA cells around mountain peaks (and, for lava worlds, along
 * elevation rifts) so the two profiles read as visually distinct.
 *
 * - **Volcanic** profile: 1–5 hotspots placed near mountain peaks. Each
 *   stamps a small (radius 2–4) LAVA blob — visible but localised, the
 *   rest of the surface stays cooled.
 * - **Lava** profile: many more hotspots (12–20) with larger radii (3–6),
 *   plus rift streaks: high-gradient mid-elevation cells become LAVA,
 *   tracing tectonic seams across the world.
 *
 * Sub-stream: `${seed}_volcanism`. Isolated from terrain / biome streams
 * so adding/tweaking volcanism never perturbs the rocky-life sweep.
 */
export function applyVolcanism(cells: Cell[], seed: string, profile: TerrainProfile): void {
  const rule = profile.biomeRemap;
  if (rule !== 'volcanic' && rule !== 'lava') return;

  const rng = seededPRNG(seed + '_volcanism');
  const isLava = rule === 'lava';

  // Index every peak (elevation >= 0.75 land cell) as hotspot candidate.
  const peaks: number[] = [];
  for (const cell of cells) {
    if (cell.elevation >= 0.75 && !cell.isWater) peaks.push(cell.index);
  }
  if (peaks.length === 0) return;

  // Volcanic: 1-5 hotspots; lava: 12-20.
  const targetCount = isLava
    ? 12 + Math.floor(rng() * 9)
    : 1 + Math.floor(rng() * 5);
  const N = Math.min(targetCount, peaks.length);

  // Fisher-Yates partial shuffle to pick N peaks without bias.
  for (let i = 0; i < N; i++) {
    const j = i + Math.floor(rng() * (peaks.length - i));
    [peaks[i], peaks[j]] = [peaks[j], peaks[i]];
  }

  // Stamp LAVA blobs around each chosen peak.
  for (let i = 0; i < N; i++) {
    const seedIdx = peaks[i];
    const radius = isLava
      ? 3 + Math.floor(rng() * 4)   // 3-6
      : 2 + Math.floor(rng() * 3);  // 2-4

    const visited = new Set<number>([seedIdx]);
    let frontier = [seedIdx];
    cells[seedIdx].biome = 'LAVA';
    for (let r = 0; r < radius; r++) {
      const next: number[] = [];
      for (const idx of frontier) {
        const c = cells[idx];
        for (const ni of c.neighbors) {
          if (visited.has(ni)) continue;
          visited.add(ni);
          const nc = cells[ni];
          // Don't paint LAVA over water on a volcanic world (water is
          // already cooled basalt) — keep the contrast at the coastline.
          // On lava worlds, water is already LAVA so the check is a no-op.
          if (!isLava && nc.isWater) continue;
          nc.biome = 'LAVA';
          next.push(ni);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }

  // Lava-only: rift streaks. Find mid-elevation cells with a high
  // gradient to a neighbor (sharp tectonic seams) and convert a fraction
  // of them to LAVA. Creates visible "rift" channels distinct from the
  // hotspot blobs.
  if (isLava) {
    const RIFT_GRADIENT = 0.15;
    const RIFT_PROBABILITY = 0.45;
    for (const cell of cells) {
      if (cell.isWater || cell.biome === 'LAVA') continue;
      if (cell.elevation < 0.40 || cell.elevation > 0.75) continue;
      let maxGrad = 0;
      for (const ni of cell.neighbors) {
        const nb = cells[ni];
        const g = Math.abs(nb.elevation - cell.elevation);
        if (g > maxGrad) maxGrad = g;
      }
      if (maxGrad >= RIFT_GRADIENT && rng() < RIFT_PROBABILITY) {
        cell.biome = 'LAVA';
      }
    }
  }
}
