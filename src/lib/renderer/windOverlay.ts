import type { MapData } from '../types';
import { createNoise2D } from 'simplex-noise';
import { seededPRNG, getWindDirection } from '../terrain';

/**
 * Static wind-streamline overlay for gas-giant maps. Samples a coarse grid,
 * integrates short trajectories using the existing prevailing-wind model
 * (`getWindDirection(ny)` from `moisture.ts`) plus a low-frequency Perlin
 * perturbation, and strokes them as curved poly-lines over the cell-fill
 * base layer.
 *
 * Storm cells (biome === 'GAS_STORM') get an extra spiral curl rendered on
 * top — the universe view's "great spot" / vortex equivalent at the world
 * scale.
 *
 * Sub-stream isolation: noise sampler keyed on `${seed}_windflow`, distinct
 * from `_clouds` (gas-band biome FBM) and every other terrain stream. Adding
 * the overlay can therefore not perturb cell biome assignment.
 */

const STREAMLINE_GRID_X = 32;
const STREAMLINE_GRID_Y = 16;
const STEPS_PER_STREAMLINE = 40;
const STEP_LEN_FRAC = 0.012;       // step length as fraction of width
const PERTURB_AMPLITUDE = 0.45;    // angular wiggle in radians
const PERTURB_FREQ = 1.8;          // noise frequency
const STORM_SPIRAL_TURNS = 1.6;
const STORM_SPIRAL_RADIUS_FRAC = 0.05; // radius as fraction of min(width, height)

export function drawWindOverlay(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  seed: string,
  scale: number = 1,
): void {
  const { cells, width, height } = data;
  const noise = createNoise2D(seededPRNG(seed + '_windflow'));

  const stepLen = width * STEP_LEN_FRAC;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.4, 1.0 / scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';

  for (let gx = 0; gx < STREAMLINE_GRID_X; gx++) {
    for (let gy = 0; gy < STREAMLINE_GRID_Y; gy++) {
      const x0 = ((gx + 0.5) / STREAMLINE_GRID_X) * width;
      const y0 = ((gy + 0.5) / STREAMLINE_GRID_Y) * height;

      ctx.beginPath();
      ctx.moveTo(x0, y0);

      let x = x0;
      let y = y0;
      for (let s = 0; s < STEPS_PER_STREAMLINE; s++) {
        const ny = (y / height) * 2 - 1;
        const wind = getWindDirection(ny);

        // Add a low-frequency rotational perturbation so streamlines wave
        // organically rather than tracing pure latitude lines.
        const perturb = noise(x / width * PERTURB_FREQ, y / height * PERTURB_FREQ) * PERTURB_AMPLITUDE;
        const baseAngle = Math.atan2(wind.dy, wind.dx);
        const angle = baseAngle + perturb;

        x += Math.cos(angle) * stepLen;
        y += Math.sin(angle) * stepLen;

        // Wrap east-west so streamlines never break at the seam.
        if (x < 0) x += width;
        else if (x >= width) x -= width;

        // Stop at top/bottom — gas giants have no flow across the poles.
        if (y < 0 || y >= height) break;

        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Storm spirals: stamp a tight inward spiral on each GAS_STORM cell.
  // Use the same color as streamlines but slightly thicker / more opaque.
  ctx.lineWidth = Math.max(0.6, 1.4 / scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.50)';
  const storms = new Set<number>();
  for (const cell of cells) {
    if (cell.biome !== 'GAS_STORM') continue;
    storms.add(cell.index);
  }
  // Find storm centroids (first cell of each connected component) so we
  // don't stamp one spiral per cell — only one per vortex.
  const visited = new Set<number>();
  const radius = Math.min(width, height) * STORM_SPIRAL_RADIUS_FRAC;
  for (const cell of cells) {
    if (cell.biome !== 'GAS_STORM' || visited.has(cell.index)) continue;
    // BFS the connected component of GAS_STORM cells.
    const compCells = [cell];
    const stack = [cell.index];
    visited.add(cell.index);
    while (stack.length) {
      const idx = stack.pop()!;
      const c = cells[idx];
      for (const ni of c.neighbors) {
        if (visited.has(ni) || !storms.has(ni)) continue;
        visited.add(ni);
        compCells.push(cells[ni]);
        stack.push(ni);
      }
    }
    let cx = 0, cy = 0;
    for (const c of compCells) { cx += c.x; cy += c.y; }
    cx /= compCells.length;
    cy /= compCells.length;
    drawStormSpiral(ctx, cx, cy, radius);
  }

  ctx.restore();
}

function drawStormSpiral(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  maxRadius: number,
): void {
  const TURNS = STORM_SPIRAL_TURNS;
  const STEPS = 64;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = t * TURNS * Math.PI * 2;
    const r = maxRadius * (1 - t * 0.85);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
