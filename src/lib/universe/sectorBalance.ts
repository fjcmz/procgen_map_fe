import { hashId, lcg } from './renderer';

/**
 * Balanced Voronoi-cell partitioning of stars into "sectors", each
 * containing 2–4 stars. Pure logic — no DOM, no Path2D — so this module
 * can be imported from the universe worker as well as the renderer.
 *
 *  1. Seed with `floor(N / 3)` random star positions as sites.
 *  2. Repeat up to MAX_BALANCE_ITER times:
 *     - Assign each star to its nearest site (= the cell it falls into).
 *     - For each site, if its cell has [2..4] stars → keep, move to centroid.
 *     - If > 4 → split into ceil(count / 3) sites via farthest-first traversal.
 *     - If < 2 → drop the site (its stars get reassigned to neighbours).
 *     - Stop early once every cell is in [2..4].
 *
 * Determinism: `lcg(hashId(\`${galaxyId}_sectors\`))` — isolated sub-stream,
 * stable across re-runs for the same galaxy id.
 *
 * The Delaunay computation uses a tiny incremental nearest-site search rather
 * than `d3-delaunay`'s Delaunay.from so this module has zero external
 * dependencies and runs on any JS host (browser main thread, web worker, node).
 */

export interface BalancedSectors {
  sites: Array<[number, number]>;
  assignment: number[];
}

interface Point { x: number; y: number }

const MIN_PER_CELL = 2;
const MAX_PER_CELL = 4;
const TARGET_PER_CELL = 3;
const MAX_BALANCE_ITER = 20;

function sampleIndices(n: number, k: number, rng: () => number): number[] {
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  const take = Math.min(k, n);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, take);
}

function nearestSite(px: number, py: number, sites: Array<[number, number]>): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const dx = sites[i][0] - px;
    const dy = sites[i][1] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

function farthestFirst(
  starIndices: number[],
  rawPositions: Point[],
  k: number,
  rng: () => number,
): Array<[number, number]> {
  const picks: number[] = [];
  const first = starIndices[Math.floor(rng() * starIndices.length)];
  picks.push(first);
  while (picks.length < k && picks.length < starIndices.length) {
    let bestIdx = -1;
    let bestMinD2 = -1;
    for (const si of starIndices) {
      if (picks.indexOf(si) >= 0) continue;
      let minD2 = Infinity;
      for (const pi of picks) {
        const dx = rawPositions[si].x - rawPositions[pi].x;
        const dy = rawPositions[si].y - rawPositions[pi].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      if (minD2 > bestMinD2) { bestMinD2 = minD2; bestIdx = si; }
    }
    if (bestIdx < 0) break;
    picks.push(bestIdx);
  }
  return picks.map(si => [rawPositions[si].x, rawPositions[si].y] as [number, number]);
}

export function balanceSites(rawPositions: Point[], galaxyId: string): BalancedSectors {
  const n = rawPositions.length;
  if (n === 0) return { sites: [], assignment: [] };

  const rng = lcg(hashId(`${galaxyId}_sectors`));
  const initialK = Math.max(1, Math.floor(n / TARGET_PER_CELL));
  let sites: Array<[number, number]> = sampleIndices(n, initialK, rng).map(
    i => [rawPositions[i].x, rawPositions[i].y] as [number, number],
  );

  let lastAssignment: number[] = new Array(n).fill(0);

  for (let iter = 0; iter < MAX_BALANCE_ITER; iter++) {
    if (sites.length === 0) {
      const j = Math.floor(rng() * n);
      sites = [[rawPositions[j].x, rawPositions[j].y]];
    }

    const cellStars: number[][] = sites.map(() => []);
    for (let i = 0; i < n; i++) {
      const c = nearestSite(rawPositions[i].x, rawPositions[i].y, sites);
      lastAssignment[i] = c;
      cellStars[c].push(i);
    }

    let balanced = true;
    for (const stars of cellStars) {
      if (stars.length < MIN_PER_CELL || stars.length > MAX_PER_CELL) {
        balanced = false;
        break;
      }
    }
    if (balanced) break;

    const next: Array<[number, number]> = [];
    for (let s = 0; s < sites.length; s++) {
      const stars = cellStars[s];
      if (stars.length >= MIN_PER_CELL && stars.length <= MAX_PER_CELL) {
        let sx = 0, sy = 0;
        for (const si of stars) {
          sx += rawPositions[si].x;
          sy += rawPositions[si].y;
        }
        next.push([sx / stars.length, sy / stars.length]);
      } else if (stars.length > MAX_PER_CELL) {
        const k = Math.ceil(stars.length / TARGET_PER_CELL);
        for (const p of farthestFirst(stars, rawPositions, k, rng)) next.push(p);
      }
    }
    sites = next;
  }

  // Final assignment under the final sites — guarantees `assignment` matches
  // the returned `sites` even if the loop exited early via the `balanced` check.
  if (sites.length === 0) {
    return { sites: [], assignment: [] };
  }
  for (let i = 0; i < n; i++) {
    lastAssignment[i] = nearestSite(rawPositions[i].x, rawPositions[i].y, sites);
  }

  return { sites, assignment: lastAssignment };
}
