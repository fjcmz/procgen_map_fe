import { seededPRNG } from '../terrain/noise';
import type { Galaxy } from './Galaxy';

/**
 * Galaxy layout: position galaxies in 2D world units so pairwise
 * (nearest-neighbor) center-to-center distance falls in [5×, 10×] of the
 * average galaxy diameter. Per-galaxy `spread`/`radius` are baked here in
 * **normalized world units** (a spread of 1.0 corresponds to the legacy
 * "single galaxy fills the viewport" scale); the renderer applies a viewport
 * fit factor at draw time so the whole layout stretches to fill whatever
 * canvas size the user has.
 *
 * Algorithm:
 *   1. Per-galaxy spread = sqrt(groupSize / 100): a half-full galaxy reads as
 *      ~0.7× the diameter of a full one.
 *   2. radius = 0.45 * spread (matches the cap baked into
 *      `galaxySpiralPositions`'s `b = 2.42 / (maxK * angleStep)` — outer arm
 *      reaches 0.45 × spread).
 *   3. Initial positions: golden-angle sunflower disc with r = target ×
 *      √(i/π) so nearest-neighbor distance starts close to the target
 *      separation (6 × avgDiameter, mid-band of [5, 10]).
 *   4. Relaxation pass — push pairs apart if dist < 5×avgDiameter. Capped at
 *      40 iterations; the sunflower seed already satisfies the bound for
 *      typical N so the loop usually exits on iter 0.
 *   5. Recenter so centroid is (0, 0).
 *
 * All RNG goes through `${universeSeed}_galaxy_layout` — isolated from the
 * physics streams so layout changes never perturb system / star generation.
 */

const SPREAD_AT_FULL_GALAXY = 1.0;
const RADIUS_FACTOR = 0.45;
const TARGET_SEPARATION_MULT = 6;
const MIN_SEPARATION_MULT = 5;
const RELAX_ITERS = 40;
const TINY_JITTER = 0.02;

export function layoutGalaxies(galaxies: Galaxy[], universeSeed: string): void {
  const n = galaxies.length;
  if (n === 0) return;

  for (const g of galaxies) {
    const groupFraction = g.solarSystems.length / 100;
    g.spread = SPREAD_AT_FULL_GALAXY * Math.sqrt(Math.max(0.01, groupFraction));
    g.radius = RADIUS_FACTOR * g.spread;
  }

  if (n === 1) {
    galaxies[0].cx = 0;
    galaxies[0].cy = 0;
    return;
  }

  const avgDiameter = galaxies.reduce((sum, g) => sum + 2 * g.radius, 0) / n;
  const target = TARGET_SEPARATION_MULT * avgDiameter;
  const minSep = MIN_SEPARATION_MULT * avgDiameter;
  const rng = seededPRNG(`${universeSeed}_galaxy_layout`);

  const positions = new Array<{ x: number; y: number }>(n);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = target * Math.sqrt(i / Math.PI);
    const theta = i * goldenAngle;
    const jitterR = (rng() - 0.5) * TINY_JITTER * target;
    const jitterTheta = (rng() - 0.5) * TINY_JITTER;
    positions[i] = {
      x: (r + jitterR) * Math.cos(theta + jitterTheta),
      y: (r + jitterR) * Math.sin(theta + jitterTheta),
    };
  }

  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const d = Math.hypot(dx, dy);
        const minPair = MIN_SEPARATION_MULT * (galaxies[i].radius + galaxies[j].radius);
        const requiredSep = Math.max(minSep, minPair);
        if (d < requiredSep) {
          const push = (requiredSep - d) / 2 + 1e-6;
          if (d < 1e-6) {
            const a = rng() * Math.PI * 2;
            positions[i].x -= Math.cos(a) * push;
            positions[i].y -= Math.sin(a) * push;
            positions[j].x += Math.cos(a) * push;
            positions[j].y += Math.sin(a) * push;
          } else {
            const ux = dx / d;
            const uy = dy / d;
            positions[i].x -= ux * push;
            positions[i].y -= uy * push;
            positions[j].x += ux * push;
            positions[j].y += uy * push;
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let centroidX = 0;
  let centroidY = 0;
  for (const p of positions) {
    centroidX += p.x;
    centroidY += p.y;
  }
  centroidX /= n;
  centroidY /= n;
  for (let i = 0; i < n; i++) {
    galaxies[i].cx = positions[i].x - centroidX;
    galaxies[i].cy = positions[i].y - centroidY;
  }
}

interface GalaxyExtent {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * Maximum extent of the galaxy layout from origin (used by the renderer to
 * compute a viewport fit factor). Returns `radius` only when there's a single
 * galaxy at the origin, or `max(|center| + radius)` otherwise. Accepts a
 * structural type so both runtime `Galaxy` and serialized `GalaxyData` work.
 */
export function computeLayoutExtent(galaxies: ReadonlyArray<GalaxyExtent>): number {
  if (galaxies.length === 0) return 1;
  let maxExtent = 0;
  for (const g of galaxies) {
    const distFromOrigin = Math.hypot(g.cx, g.cy);
    const extent = distFromOrigin + g.radius;
    if (extent > maxExtent) maxExtent = extent;
  }
  return Math.max(maxExtent, 1e-3);
}
