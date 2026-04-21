import type { CityEnvironment, CityMapData, CitySize } from './cityMapTypes';
import { createNoiseSamplers, fbm } from '../terrain/noise';

// Size tier maps the 5 city sizes onto [0, 1] for all size-scaled constants.
const SIZE_TIER_INDEX: Record<CitySize, number> = {
  small: 0,
  medium: 0.25,
  large: 0.5,
  metropolis: 0.75,
  megalopolis: 1,
};

const WALL_FRAC_MIN = 0.5;
const WALL_FRAC_MAX = 0.85;
const WARP_STRENGTH = 0.35;
const FBM_SCALE = 3;
const FBM_OCTAVES = 4;

const WATER_SIDE_TO_DIR: Record<NonNullable<CityEnvironment['waterSide']>, 'N' | 'S' | 'E' | 'W'> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
};

type Gate = CityMapData['gates'][number];
type Dir = Gate['dir'];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sizeTierIndex(size: CitySize): number {
  return SIZE_TIER_INDEX[size];
}

/**
 * Radial-distance + FBM wall footprint. Marks the lowest-scoring
 * `lerp(0.50, 0.85, sizeTier) * totalTiles` tiles as inside the wall, then
 * keeps only the connected component reachable from the grid centre so the
 * boundary walk stays a single closed loop.
 */
function computeWallMask(
  grid: { w: number; h: number },
  env: CityEnvironment,
  seed: string,
): Uint8Array {
  const { w: n } = grid;
  const total = n * n;
  const tier = SIZE_TIER_INDEX[env.size];
  const target = Math.round(lerp(WALL_FRAC_MIN, WALL_FRAC_MAX, tier) * total);

  const samplers = createNoiseSamplers(seed);
  const scores = new Float32Array(total);
  const indices = new Int32Array(total);
  const cx = n / 2;
  const cy = n / 2;
  const radialDenom = n / 2;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const radial = Math.sqrt(dx * dx + dy * dy) / radialDenom;
      const warp = fbm(
        samplers.elevation,
        (x / n) * FBM_SCALE,
        (y / n) * FBM_SCALE,
        FBM_OCTAVES,
      );
      scores[idx] = radial + WARP_STRENGTH * (warp - 0.5);
      indices[idx] = idx;
    }
  }

  indices.sort((a, b) => scores[a] - scores[b]);

  const raw = new Uint8Array(total);
  for (let i = 0; i < target; i++) {
    raw[indices[i]] = 1;
  }

  // Keep only the connected component around the grid centre. Noise
  // perturbation can occasionally detach a few outlier tiles.
  const mask = new Uint8Array(total);
  const seedX = Math.floor(cx);
  const seedY = Math.floor(cy);
  const seedIdx = seedY * n + seedX;
  if (raw[seedIdx] === 0) {
    // Fallback: if the exact centre somehow got excluded, pick the closest
    // marked tile. This keeps the BFS deterministic.
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < total; i++) {
      if (raw[i] === 0) continue;
      const x = i % n;
      const y = (i / n) | 0;
      const dx = x - seedX;
      const dy = y - seedY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return mask;
    bfsFill(raw, mask, best, n);
  } else {
    bfsFill(raw, mask, seedIdx, n);
  }

  return mask;
}

function bfsFill(src: Uint8Array, dst: Uint8Array, start: number, n: number): void {
  const queue: number[] = [start];
  dst[start] = 1;
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const x = idx % n;
    const y = (idx / n) | 0;
    if (x > 0) {
      const ni = idx - 1;
      if (src[ni] && !dst[ni]) {
        dst[ni] = 1;
        queue.push(ni);
      }
    }
    if (x < n - 1) {
      const ni = idx + 1;
      if (src[ni] && !dst[ni]) {
        dst[ni] = 1;
        queue.push(ni);
      }
    }
    if (y > 0) {
      const ni = idx - n;
      if (src[ni] && !dst[ni]) {
        dst[ni] = 1;
        queue.push(ni);
      }
    }
    if (y < n - 1) {
      const ni = idx + n;
      if (src[ni] && !dst[ni]) {
        dst[ni] = 1;
        queue.push(ni);
      }
    }
  }
}

function isWall(mask: Uint8Array, n: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  return mask[y * n + x] === 1;
}

type Edge = [[number, number], [number, number]];

interface EdgeMeta {
  edge: Edge;
  /** Outward-facing cardinal direction for gate selection. */
  outward: Dir;
  key: string;
}

function edgeKey(a: [number, number], b: [number, number]): string {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax < bx || (ax === bx && ay <= by)) {
    return `${ax},${ay}-${bx},${by}`;
  }
  return `${bx},${by}-${ax},${ay}`;
}

/**
 * Collect every boundary edge of `mask`. An edge lies between two corners
 * (integer grid coords in [0..n]); it's a boundary iff the two tiles it
 * separates are on opposite sides of the mask. Each edge records the
 * outward-facing cardinal direction (away from the wall interior).
 */
function collectBoundaryEdges(mask: Uint8Array, n: number): EdgeMeta[] {
  const edges: EdgeMeta[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!isWall(mask, n, x, y)) continue;
      // North edge (y = y, runs from (x, y) to (x+1, y)) — outward is -y = 'N'.
      if (!isWall(mask, n, x, y - 1)) {
        const a: [number, number] = [x, y];
        const b: [number, number] = [x + 1, y];
        edges.push({ edge: [a, b], outward: 'N', key: edgeKey(a, b) });
      }
      // South edge (y = y+1) — outward is +y = 'S'.
      if (!isWall(mask, n, x, y + 1)) {
        const a: [number, number] = [x, y + 1];
        const b: [number, number] = [x + 1, y + 1];
        edges.push({ edge: [a, b], outward: 'S', key: edgeKey(a, b) });
      }
      // West edge — outward is -x = 'W'.
      if (!isWall(mask, n, x - 1, y)) {
        const a: [number, number] = [x, y];
        const b: [number, number] = [x, y + 1];
        edges.push({ edge: [a, b], outward: 'W', key: edgeKey(a, b) });
      }
      // East edge — outward is +x = 'E'.
      if (!isWall(mask, n, x + 1, y)) {
        const a: [number, number] = [x + 1, y];
        const b: [number, number] = [x + 1, y + 1];
        edges.push({ edge: [a, b], outward: 'E', key: edgeKey(a, b) });
      }
    }
  }
  return edges;
}

function cornerKey(p: [number, number]): string {
  return `${p[0]},${p[1]}`;
}

/**
 * Walk the boundary-edge list into a single closed polyline. Returns the
 * ordered corner sequence (no duplicated first/last). Collinear runs are
 * collapsed so vertices survive only at true 90° corners.
 */
function walkBoundary(edges: EdgeMeta[]): [number, number][] {
  if (edges.length === 0) return [];

  const adj = new Map<string, [number, number][]>();
  for (const { edge } of edges) {
    const [a, b] = edge;
    const ak = cornerKey(a);
    const bk = cornerKey(b);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(b);
    adj.get(bk)!.push(a);
  }

  // Deterministic start: lowest y, then lowest x.
  let startKey = '';
  let startPt: [number, number] = [0, 0];
  let bestY = Infinity;
  let bestX = Infinity;
  for (const key of adj.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (y < bestY || (y === bestY && x < bestX)) {
      bestY = y;
      bestX = x;
      startKey = key;
      startPt = [x, y];
    }
  }

  const path: [number, number][] = [startPt];
  const visited = new Set<string>();
  visited.add(startKey);

  let current = startPt;
  let currentKey = startKey;
  while (true) {
    const neighbours = adj.get(currentKey) ?? [];
    let next: [number, number] | null = null;
    for (const nb of neighbours) {
      const nk = cornerKey(nb);
      if (!visited.has(nk)) {
        next = nb;
        break;
      }
    }
    if (!next) {
      // Close the loop if possible, otherwise stop (defensive).
      break;
    }
    path.push(next);
    visited.add(cornerKey(next));
    current = next;
    currentKey = cornerKey(current);
  }

  return simplifyCollinear(path);
}

function simplifyCollinear(path: [number, number][]): [number, number][] {
  if (path.length < 3) return path;
  const out: [number, number][] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n];
    const cur = path[i];
    const next = path[(i + 1) % n];
    const dx1 = cur[0] - prev[0];
    const dy1 = cur[1] - prev[1];
    const dx2 = next[0] - cur[0];
    const dy2 = next[1] - cur[1];
    // Collapse when direction vectors are parallel (cross product == 0).
    if (dx1 * dy2 - dy1 * dx2 !== 0) {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Pick up to 4 gates — one per cardinal direction not matching `env.waterSide`.
 * For each direction we filter boundary edges whose outward normal points that
 * way, then pick the edge whose midpoint is closest to the opposite-axis
 * centerline (so the gate visually faces the city centre).
 */
function selectGates(
  edges: EdgeMeta[],
  grid: { w: number; h: number },
  waterSide: CityEnvironment['waterSide'],
): Gate[] {
  const skip: Dir | null = waterSide ? WATER_SIDE_TO_DIR[waterSide] : null;
  const dirs: Dir[] = ['N', 'S', 'E', 'W'];
  const midX = grid.w / 2;
  const midY = grid.h / 2;
  const gates: Gate[] = [];

  for (const dir of dirs) {
    if (dir === skip) continue;
    let best: EdgeMeta | null = null;
    let bestScore = Infinity;
    for (const e of edges) {
      if (e.outward !== dir) continue;
      const [a, b] = e.edge;
      const midA = (a[0] + b[0]) / 2;
      const midB = (a[1] + b[1]) / 2;
      // For N/S gates we want x close to midX; for E/W we want y close to midY.
      const score =
        dir === 'N' || dir === 'S'
          ? Math.abs(midA - midX)
          : Math.abs(midB - midY);
      if (
        score < bestScore ||
        (score === bestScore &&
          best &&
          (a[0] < best.edge[0][0] ||
            (a[0] === best.edge[0][0] && a[1] < best.edge[0][1])))
      ) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      gates.push({ edge: best.edge, dir });
    }
  }

  return gates;
}

export function computeWallsAndGates(
  grid: { w: number; h: number; tileSize: number },
  env: CityEnvironment,
  seed: string,
): {
  wallMask: Uint8Array;
  wallPath: [number, number][];
  gates: Gate[];
} {
  const wallMask = computeWallMask(grid, env, seed);
  const edges = collectBoundaryEdges(wallMask, grid.w);
  const wallPath = walkBoundary(edges);
  const gates = selectGates(edges, grid, env.waterSide);
  return { wallMask, wallPath, gates };
}
