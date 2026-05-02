import { seededPRNG } from '../terrain/noise';
import type { Galaxy } from './Galaxy';

/**
 * Galaxy layout: position galaxies in 2D world units so pairwise
 * center-to-center distances fall in [MIN_CENTER_DIST, MAX_CENTER_DIST].
 * Per-galaxy `spread`/`radius` are baked here in **normalized world units**
 * (a spread of 1.0 corresponds to a full 100-system galaxy); the renderer
 * applies a viewport fit factor at draw time.
 *
 * Algorithm:
 *   1. Per-galaxy spread = sqrt(groupSize / 100).
 *   2. radius = 0.45 * spread.
 *   3. Random placement via rejection sampling inside a disc sized to pack N
 *      galaxies with average spacing ~ (MIN_CENTER_DIST + MAX_CENTER_DIST) / 2.
 *      Up to MAX_ATTEMPTS tries per galaxy; on failure the galaxy is placed
 *      just outside the current cluster to guarantee min separation.
 *   4. Recenter so centroid is (0, 0).
 *
 * All RNG goes through `${universeSeed}_galaxy_layout` — isolated from the
 * physics streams so layout changes never perturb system / star generation.
 */

const SPREAD_AT_FULL_GALAXY = 1.0;
const RADIUS_FACTOR = 0.45;
const MIN_CENTER_DIST = 10;
const PLACEMENT_ATTEMPTS = 800;

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

  const rng = seededPRNG(`${universeSeed}_galaxy_layout`);

  // Container radius: sized so N galaxies with ~20-unit spacing fit comfortably.
  // sqrt(N) scaling keeps density roughly constant as galaxy count grows.
  const containerRadius = Math.max(MIN_CENTER_DIST, 10 * Math.sqrt(n));

  const positions: { x: number; y: number }[] = [];
  positions.push({ x: 0, y: 0 });

  for (let i = 1; i < n; i++) {
    let placed = false;
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const r = containerRadius * Math.sqrt(rng());
      const theta = rng() * Math.PI * 2;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      let valid = true;
      for (const p of positions) {
        if (Math.hypot(x - p.x, y - p.y) < MIN_CENTER_DIST) {
          valid = false;
          break;
        }
      }
      if (valid) {
        positions.push({ x, y });
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Fallback: place outside the current cluster so min distance is guaranteed.
      const theta = rng() * Math.PI * 2;
      const r = containerRadius + MIN_CENTER_DIST * (i + 1);
      positions.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
    }
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
