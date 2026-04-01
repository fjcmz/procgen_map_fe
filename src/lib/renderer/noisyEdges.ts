import { seededPRNG } from '../terrain/noise';

type Point = [number, number];

let _rng: () => number = Math.random;

export function initNoisyEdges(seed: string): void {
  _rng = seededPRNG(seed + '_noisy');
}

/** Recursively displace midpoints to create a jagged edge. */
function noisyEdgePoints(
  p1: Point,
  p2: Point,
  depth: number,
  roughness: number
): Point[] {
  if (depth === 0) return [p1, p2];

  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;

  // Perpendicular direction
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  const px = -dy / len;
  const py = dx / len;

  const offset = (_rng() - 0.5) * len * roughness;
  const mid: Point = [mx + px * offset, my + py * offset];

  const left = noisyEdgePoints(p1, mid, depth - 1, roughness);
  const right = noisyEdgePoints(mid, p2, depth - 1, roughness);

  return [...left.slice(0, -1), ...right];
}

/** Get a noisy polyline between two polygon vertices.
 *  roughness 0..1, depth controls detail level. */
export function getNoisyEdge(
  p1: Point,
  p2: Point,
  depth = 3,
  roughness = 0.35
): Point[] {
  return noisyEdgePoints(p1, p2, depth, roughness);
}
