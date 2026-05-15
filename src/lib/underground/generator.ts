/**
 * Underground map generator — one-shot, deterministic, side-effect-free.
 *
 * Builds an independent Voronoi cell graph (same primitive as the surface
 * map, sized to the same cell count) and classifies each cell as
 * solid / cavern / tunnel:
 *
 * - Caverns are BFS-grown groups of cells around Poisson-disk-sampled seeds.
 *   Three kinds: large (combined area ~30 % of the world), small, and
 *   maze (a cluster of small caverns + maze-passage tunnel cells).
 * - Tunnels are 1-cell-wide chains found by A* between cavern boundary cells.
 *   Every cavern is reachable via the MST + a few loop edges.
 * - Connections are 4–20 cavern cells mapped to land cells in the SURFACE
 *   graph so the user can correlate the two views.
 *
 * All randomness routes through isolated `${seed}_underground_*` sub-streams.
 * See `claude_specs/underground_map.md` for the full design.
 */

import { seededPRNG } from '../terrain/noise';
import { buildCellGraph } from '../terrain/voronoi';
import type { Cell as SurfaceCell } from '../types';
import type {
  Cavern,
  CavernKind,
  UndergroundCell,
  UndergroundConnection,
  UndergroundMap,
} from './types';

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Poisson-disk sampler over indices into `cells`. Returns a list of cell
 *  indices spaced at least `minDist` apart, target count `targetCount`. */
function poissonDiskCells(
  rng: () => number,
  cells: UndergroundCell[],
  minDist: number,
  targetCount: number,
  maxAttempts: number,
  forbidden: Set<number> = new Set(),
): number[] {
  const picked: number[] = [];
  const minDistSq = minDist * minDist;
  let attempts = 0;
  while (picked.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const idx = Math.floor(rng() * cells.length);
    if (forbidden.has(idx)) continue;
    const c = cells[idx];
    let ok = true;
    for (const pIdx of picked) {
      const p = cells[pIdx];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < minDistSq) {
        ok = false;
        break;
      }
    }
    if (ok) picked.push(idx);
  }
  return picked;
}

/** BFS-grow a cavern footprint from a seed cell to `targetSize` cells,
 *  refusing to absorb cells already owned by another cavern. */
function growCavern(
  rng: () => number,
  cells: UndergroundCell[],
  seedIdx: number,
  targetSize: number,
  owned: Int32Array,
): number[] {
  const result: number[] = [];
  if (owned[seedIdx] !== -1) return result;
  // Frontier carries candidates; we pop one at random each step so the
  // growth fronts come out organically irregular rather than ring-perfect.
  const frontier: number[] = [seedIdx];
  const inFrontier = new Set<number>([seedIdx]);
  while (result.length < targetSize && frontier.length > 0) {
    const fi = Math.floor(rng() * frontier.length);
    const idx = frontier[fi];
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();
    inFrontier.delete(idx);
    if (owned[idx] !== -1) continue;
    owned[idx] = 1; // temporary mark; caller overrides with the cavern id
    result.push(idx);
    for (const nb of cells[idx].neighbors) {
      if (owned[nb] === -1 && !inFrontier.has(nb)) {
        frontier.push(nb);
        inFrontier.add(nb);
      }
    }
  }
  return result;
}

/** Compute a cavern's centroid from its member cell centroids. */
function centroidOf(cells: UndergroundCell[], cellIndices: number[]): { cx: number; cy: number } {
  let sx = 0;
  let sy = 0;
  for (const idx of cellIndices) {
    sx += cells[idx].x;
    sy += cells[idx].y;
  }
  const n = Math.max(1, cellIndices.length);
  return { cx: sx / n, cy: sy / n };
}

/** Binary min-heap of `{idx, f}` entries keyed on `f`. Inline implementation
 *  so A* below scales to the surface map's full cell count (defaults to
 *  100 000). A plain array with linear-scan find-min would dominate runtime
 *  at that size. */
interface HeapEntry { idx: number; f: number; }
function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
  heap.push(entry);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
    i = parent;
  }
}
function heapPop(heap: HeapEntry[]): HeapEntry | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  const n = heap.length;
  while (true) {
    const l = i * 2 + 1;
    const r = l + 1;
    let best = i;
    if (l < n && heap[l].f < heap[best].f) best = l;
    if (r < n && heap[r].f < heap[best].f) best = r;
    if (best === i) break;
    const tmp = heap[best]; heap[best] = heap[i]; heap[i] = tmp;
    i = best;
  }
  return top;
}

/** A* through the cell graph from `start` to `end`. Returns the list of
 *  cell indices on the path (inclusive of both ends), or `null` if no
 *  path exists. */
function aStar(
  cells: UndergroundCell[],
  start: number,
  end: number,
  isBlocked: (idx: number) => boolean,
  costOf: (idx: number) => number,
): number[] | null {
  if (start === end) return [start];
  const N = cells.length;
  const gScore = new Float64Array(N);
  gScore.fill(Infinity);
  gScore[start] = 0;
  const cameFrom = new Int32Array(N);
  cameFrom.fill(-1);
  const closed = new Uint8Array(N);
  const open: HeapEntry[] = [];
  heapPush(open, { idx: start, f: heuristic(cells, start, end) });
  while (open.length > 0) {
    const current = heapPop(open)!;
    if (current.idx === end) {
      const path: number[] = [end];
      let cur = end;
      while (cameFrom[cur] !== -1) {
        cur = cameFrom[cur];
        path.push(cur);
      }
      path.reverse();
      return path;
    }
    if (closed[current.idx]) continue;
    closed[current.idx] = 1;
    const neighbours = cells[current.idx].neighbors;
    for (let n = 0; n < neighbours.length; n++) {
      const nb = neighbours[n];
      if (closed[nb]) continue;
      if (isBlocked(nb) && nb !== end) continue;
      const tentativeG = gScore[current.idx] + costOf(nb);
      if (tentativeG < gScore[nb]) {
        gScore[nb] = tentativeG;
        cameFrom[nb] = current.idx;
        heapPush(open, { idx: nb, f: tentativeG + heuristic(cells, nb, end) });
      }
    }
  }
  return null;
}

function heuristic(cells: UndergroundCell[], a: number, b: number): number {
  const dx = cells[a].x - cells[b].x;
  const dy = cells[a].y - cells[b].y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Find the cell on a cavern's boundary whose centroid is nearest the
 *  given target point. "Boundary" = cell with at least one solid neighbour. */
function nearestBoundaryCell(
  cells: UndergroundCell[],
  cavernCells: number[],
  targetX: number,
  targetY: number,
): number {
  let best = cavernCells[0];
  let bestD = Infinity;
  for (const idx of cavernCells) {
    const c = cells[idx];
    // Boundary check: any neighbour outside this cavern's cell set.
    let isBoundary = false;
    for (const nb of c.neighbors) {
      if (cells[nb].cavernId !== c.cavernId) { isBoundary = true; break; }
    }
    if (!isBoundary) continue;
    const dx = c.x - targetX;
    const dy = c.y - targetY;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = idx; }
  }
  return best;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Build the underground cell array from `buildCellGraph`'s output. Strips
 *  surface-specific fields so the postMessage payload stays minimal. The
 *  underground graph uses the same cell count as the surface map so the
 *  polygon density matches; the actual layout is independent (the seed is
 *  isolated). */
function buildUndergroundCells(
  seed: string,
  numCells: number,
  width: number,
  height: number,
): UndergroundCell[] {
  const { cells } = buildCellGraph(`${seed}_underground_graph`, numCells, width, height);
  return cells.map((c: SurfaceCell): UndergroundCell => ({
    index: c.index,
    x: c.x,
    y: c.y,
    vertices: c.vertices,
    wrapVertices: c.wrapVertices,
    neighbors: c.neighbors,
    category: 'solid',
    cavernId: null,
  }));
}

interface CavernPlan {
  id: string;
  kind: CavernKind;
  seedCell: number;
  targetSize: number;
}

function planLargeCaverns(
  rng: () => number,
  cells: UndergroundCell[],
  totalCellCount: number,
): CavernPlan[] {
  const count = randInt(rng, 5, 15);
  // Target ~30% of total cells split across the chosen count.
  const targetTotalCells = Math.floor(totalCellCount * 0.30);
  const avgPer = Math.max(8, Math.floor(targetTotalCells / count));
  // Min Poisson distance: roughly the radius of an average cavern (sqrt of
  // cell area × avgPer / π), padded so caverns don't overlap.
  const cellArea = totalCellCount > 0 ? (cells[0]
    ? (() => {
        // Estimate via polygon vertices of the first cell.
        const v = cells[0].vertices;
        let s = 0;
        for (let i = 0; i < v.length; i++) {
          const a = v[i];
          const b = v[(i + 1) % v.length];
          s += a[0] * b[1] - b[0] * a[1];
        }
        return Math.max(1, Math.abs(s) * 0.5);
      })()
      : 100) : 100;
  const radius = Math.sqrt((cellArea * avgPer) / Math.PI);
  const minDist = radius * 2.0;
  const seedIndices = poissonDiskCells(rng, cells, minDist, count, count * 80);
  return seedIndices.map((seedCell, i): CavernPlan => ({
    id: `lg_${i}`,
    kind: 'large',
    seedCell,
    targetSize: Math.max(4, Math.floor(avgPer * (0.7 + rng() * 0.6))),
  }));
}

function planSmallCaverns(
  rng: () => number,
  cells: UndergroundCell[],
  width: number,
  height: number,
  forbidden: Set<number>,
): CavernPlan[] {
  const count = randInt(rng, 5, 50);
  const avgPer = randInt(rng, 4, 12);
  // World-coordinate-based spacing so the layout stays stable across cell
  // counts. Target spread for ~25 caverns across the map: ~sqrt(A/25) * 0.7.
  const minDist = Math.sqrt((width * height) / 25) * 0.7;
  const seedIndices = poissonDiskCells(rng, cells, minDist, count, count * 80, forbidden);
  return seedIndices.map((seedCell, i): CavernPlan => ({
    id: `sm_${i}`,
    kind: 'small',
    seedCell,
    targetSize: Math.max(2, Math.floor(avgPer * (0.5 + rng() * 1.0))),
  }));
}

function planMazeClusters(
  rng: () => number,
  cells: UndergroundCell[],
  width: number,
  height: number,
  forbidden: Set<number>,
): CavernPlan[] {
  const count = randInt(rng, 3, 10);
  // ~6 clusters average → wide spacing.
  const minDist = Math.sqrt((width * height) / 6) * 0.75;
  const seedIndices = poissonDiskCells(rng, cells, minDist, count, count * 80, forbidden);
  return seedIndices.map((seedCell, i): CavernPlan => ({
    id: `mz_${i}`,
    kind: 'maze',
    // A maze cluster's "seed cavern" is small; the cluster's character
    // comes from extra mini-caverns placed nearby, wired with passages.
    seedCell,
    targetSize: randInt(rng, 2, 4),
  }));
}

/** For a maze cluster, place 3–8 additional mini-caverns in its
 *  neighbourhood and wire them up with single-cell tunnels. Each mini-
 *  cavern is 1–3 cells. Tunnel cells are marked with `cavernId = clusterId`
 *  so the renderer can paint the whole cluster cohesively. */
function fleshOutMazeCluster(
  seed: string,
  index: number,
  cells: UndergroundCell[],
  owned: Int32Array,
  cluster: Cavern,
  caverns: Cavern[],
): void {
  const rng = seededPRNG(`${seed}_underground_maze_${index}`);
  const radiusInCells = Math.max(4, Math.floor(Math.sqrt(cells.length) * 0.30));
  // Candidate cell pool: BFS from cluster centroid up to `radiusInCells`
  // hops, excluding cells already in any cavern.
  const candidatePool: number[] = [];
  {
    const seen = new Uint8Array(cells.length);
    const queue: { idx: number; d: number }[] = [];
    // Pick the closest cell to the centroid as our BFS root.
    let root = cluster.cellIndices[0];
    let rootD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const dx = cells[i].x - cluster.cx;
      const dy = cells[i].y - cluster.cy;
      const d = dx * dx + dy * dy;
      if (d < rootD) { rootD = d; root = i; }
    }
    queue.push({ idx: root, d: 0 });
    seen[root] = 1;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (owned[cur.idx] === -1) candidatePool.push(cur.idx);
      if (cur.d >= radiusInCells) continue;
      for (const nb of cells[cur.idx].neighbors) {
        if (!seen[nb]) {
          seen[nb] = 1;
          queue.push({ idx: nb, d: cur.d + 1 });
        }
      }
    }
  }
  if (candidatePool.length === 0) return;

  const miniCount = randInt(rng, 3, 8);
  // Fisher-Yates partial shuffle for deterministic selection.
  for (let i = candidatePool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidatePool[i], candidatePool[j]] = [candidatePool[j], candidatePool[i]];
  }
  const minis: Cavern[] = [cluster];
  for (let i = 0; i < Math.min(miniCount, candidatePool.length); i++) {
    const seedCell = candidatePool[i];
    if (owned[seedCell] !== -1) continue;
    const targetSize = randInt(rng, 1, 3);
    const grown = growCavern(rng, cells, seedCell, targetSize, owned);
    if (grown.length === 0) continue;
    const miniId = `${cluster.id}_${i}`;
    for (const ci of grown) {
      cells[ci].category = 'cavern';
      cells[ci].cavernId = miniId;
    }
    const { cx, cy } = centroidOf(cells, grown);
    const mini: Cavern = {
      id: miniId,
      kind: 'maze',
      cellIndices: grown,
      cx,
      cy,
    };
    caverns.push(mini);
    minis.push(mini);
  }
  // Wire minis together with single-cell tunnel chains. Use Prim over the
  // small mini-cluster + a couple extra loop edges. Mark tunnel cells with
  // the cluster's id so the renderer can colour the whole maze cohesively.
  if (minis.length <= 1) return;
  const blocker = (idx: number) => {
    if (owned[idx] === -1) return false;
    // Allow passing through cells already owned by ANY mini in this cluster
    // (so chains can land directly on adjacent minis). Block everything else.
    const cid = cells[idx].cavernId;
    return cid === null || !minis.some(m => m.id === cid);
  };
  const cost = (_idx: number) => 1;
  const inTree = new Set<string>([minis[0].id]);
  const usedPairs = new Set<string>();
  while (inTree.size < minis.length) {
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (let i = 0; i < minis.length; i++) {
      if (!inTree.has(minis[i].id)) continue;
      for (let j = 0; j < minis.length; j++) {
        if (inTree.has(minis[j].id)) continue;
        const dx = minis[i].cx - minis[j].cx;
        const dy = minis[i].cy - minis[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;
    const start = nearestBoundaryCell(cells, minis[bestI].cellIndices, minis[bestJ].cx, minis[bestJ].cy);
    const end = nearestBoundaryCell(cells, minis[bestJ].cellIndices, minis[bestI].cx, minis[bestI].cy);
    const path = aStar(cells, start, end, blocker, cost);
    inTree.add(minis[bestJ].id);
    usedPairs.add(edgeKey(minis[bestI].id, minis[bestJ].id));
    if (!path) continue;
    for (const idx of path) {
      if (cells[idx].category === 'solid') {
        cells[idx].category = 'tunnel';
        cells[idx].cavernId = cluster.id; // attribute the passage to the cluster
        owned[idx] = 1;
      }
    }
  }
  const extras = randInt(rng, 0, Math.min(2, minis.length - 1));
  for (let e = 0; e < extras; e++) {
    const i = Math.floor(rng() * minis.length);
    let j = Math.floor(rng() * minis.length);
    if (j === i) j = (j + 1) % minis.length;
    const key = edgeKey(minis[i].id, minis[j].id);
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    const start = nearestBoundaryCell(cells, minis[i].cellIndices, minis[j].cx, minis[j].cy);
    const end = nearestBoundaryCell(cells, minis[j].cellIndices, minis[i].cx, minis[i].cy);
    const path = aStar(cells, start, end, blocker, cost);
    if (!path) continue;
    for (const idx of path) {
      if (cells[idx].category === 'solid') {
        cells[idx].category = 'tunnel';
        cells[idx].cavernId = cluster.id;
        owned[idx] = 1;
      }
    }
  }
}

/** Build the inter-cavern tunnel graph: MST + ~10–20% loop edges. Each
 *  edge becomes a chain of `tunnel` cells running A* between cavern
 *  boundaries. */
function carveInterCavernTunnels(
  seed: string,
  cells: UndergroundCell[],
  caverns: Cavern[],
  owned: Int32Array,
): void {
  if (caverns.length <= 1) return;
  const rng = seededPRNG(`${seed}_underground_tunnels`);
  // Skip mini-cluster sub-cells from the top-level wiring — represent each
  // maze cluster by its primary seed cavern (the first one created with
  // the cluster's bare id). Filter: keep caverns whose id has no underscore
  // beyond the kind prefix (`lg_`, `sm_`, `mz_<i>` only).
  const isTopLevel = (id: string): boolean => {
    // `mz_<i>_<j>` → false; `mz_<i>` → true
    const parts = id.split('_');
    return parts.length === 2;
  };
  const topNodes = caverns.filter(c => isTopLevel(c.id));
  if (topNodes.length <= 1) return;

  const blocker = (idx: number) => {
    if (owned[idx] === -1) return false;
    // Already in a cavern — only block if it's a DIFFERENT top-level cavern
    // than the endpoints (we'd be tunneling through it). Other tunnels are
    // fine to merge with.
    return cells[idx].category === 'cavern';
  };
  const cost = (idx: number) => {
    if (owned[idx] === -1) return 1.0;      // fresh solid rock
    if (cells[idx].category === 'tunnel') return 0.4; // re-use existing tunnel cheaply
    return 5.0;
  };

  const inTree = new Set<string>([topNodes[0].id]);
  const mstEdges: { a: Cavern; b: Cavern }[] = [];
  while (inTree.size < topNodes.length) {
    let bestA: Cavern | null = null, bestB: Cavern | null = null;
    let bestD = Infinity;
    for (const a of topNodes) {
      if (!inTree.has(a.id)) continue;
      for (const b of topNodes) {
        if (inTree.has(b.id)) continue;
        const dx = a.cx - b.cx;
        const dy = a.cy - b.cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestA = a; bestB = b; }
      }
    }
    if (!bestA || !bestB) break;
    mstEdges.push({ a: bestA, b: bestB });
    inTree.add(bestB.id);
  }
  const allEdges: { a: Cavern; b: Cavern; mandatory: boolean }[] = mstEdges.map(e => ({ ...e, mandatory: true }));

  // 10–20% loop edges.
  const loopCount = clamp(Math.floor((topNodes.length - 1) * (0.10 + rng() * 0.10)), 0, topNodes.length);
  const usedPairs = new Set<string>();
  for (const { a, b } of mstEdges) usedPairs.add(edgeKey(a.id, b.id));
  let tries = 0;
  while (allEdges.length < mstEdges.length + loopCount && tries < loopCount * 10) {
    tries++;
    const i = Math.floor(rng() * topNodes.length);
    let j = Math.floor(rng() * topNodes.length);
    if (j === i) j = (j + 1) % topNodes.length;
    const k = edgeKey(topNodes[i].id, topNodes[j].id);
    if (usedPairs.has(k)) continue;
    usedPairs.add(k);
    allEdges.push({ a: topNodes[i], b: topNodes[j], mandatory: false });
  }

  for (const { a, b } of allEdges) {
    const start = nearestBoundaryCell(cells, a.cellIndices, b.cx, b.cy);
    const end = nearestBoundaryCell(cells, b.cellIndices, a.cx, a.cy);
    const path = aStar(cells, start, end, blocker, cost);
    if (!path) continue;
    for (const idx of path) {
      if (cells[idx].category === 'solid') {
        cells[idx].category = 'tunnel';
        // Inter-cluster tunnels: leave cavernId null so the renderer paints
        // them with the generic tunnel colour rather than a cluster colour.
        cells[idx].cavernId = null;
        owned[idx] = 1;
      }
    }
  }
}

/** Sample 4–20 surface entrances. Each picks a cavern (weighted by cell
 *  count) and a cell within that cavern; then finds the nearest LAND cell
 *  in the surface graph and records the mapping. */
function generateConnections(
  seed: string,
  surfaceCells: SurfaceCell[],
  underground: UndergroundCell[],
  caverns: Cavern[],
): UndergroundConnection[] {
  const rng = seededPRNG(`${seed}_underground_connections`);
  if (caverns.length === 0) return [];
  const count = randInt(rng, 4, 20);

  // Weight caverns by member count; small clusters contribute less.
  const weights = caverns.map(c => Math.max(1, c.cellIndices.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w / total;
    cdf.push(acc);
  }

  const connections: UndergroundConnection[] = [];
  const usedSurface = new Set<number>();
  const usedUnderground = new Set<number>();
  let attempts = 0;
  const maxAttempts = count * 30;
  while (connections.length < count && attempts < maxAttempts) {
    attempts++;
    const r = rng();
    let cavIdx = cdf.findIndex(v => v >= r);
    if (cavIdx < 0) cavIdx = cdf.length - 1;
    const cavern = caverns[cavIdx];
    // Pick a random cell from the cavern.
    const ugCellIdx = cavern.cellIndices[Math.floor(rng() * cavern.cellIndices.length)];
    if (usedUnderground.has(ugCellIdx)) continue;
    const ugCell = underground[ugCellIdx];
    // Find the nearest land surface cell.
    const surfaceIdx = nearestLandSurfaceCell(surfaceCells, ugCell.x, ugCell.y);
    if (surfaceIdx < 0 || usedSurface.has(surfaceIdx)) continue;
    const sc = surfaceCells[surfaceIdx];
    connections.push({
      cavernId: cavern.id,
      surfaceCellIndex: surfaceIdx,
      undergroundCellIndex: ugCellIdx,
      xy: { x: sc.x, y: sc.y },
    });
    usedSurface.add(surfaceIdx);
    usedUnderground.add(ugCellIdx);
  }
  return connections;
}

function nearestLandSurfaceCell(cells: SurfaceCell[], x: number, y: number): number {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.isWater || c.isLake) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
}

export function generateUnderground(
  seed: string,
  width: number,
  height: number,
  surfaceCells: SurfaceCell[],
): UndergroundMap {
  // Step 1: build the underground Voronoi graph — same cell count as the
  // surface map so polygon density matches across the two views.
  const cells = buildUndergroundCells(seed, surfaceCells.length, width, height);
  const owned = new Int32Array(cells.length).fill(-1);

  // Step 2: plan + grow caverns. Each plan adds one Cavern record + marks
  // its member cells.
  const caverns: Cavern[] = [];

  const largeRng = seededPRNG(`${seed}_underground_largecaverns`);
  const largePlans = planLargeCaverns(largeRng, cells, cells.length);
  for (const plan of largePlans) {
    const grown = growCavern(largeRng, cells, plan.seedCell, plan.targetSize, owned);
    if (grown.length === 0) continue;
    for (const ci of grown) {
      cells[ci].category = 'cavern';
      cells[ci].cavernId = plan.id;
    }
    const { cx, cy } = centroidOf(cells, grown);
    caverns.push({ id: plan.id, kind: 'large', cellIndices: grown, cx, cy });
  }

  const usedSeeds = new Set<number>(largePlans.map(p => p.seedCell));
  const smallRng = seededPRNG(`${seed}_underground_smallcaverns`);
  const smallPlans = planSmallCaverns(smallRng, cells, width, height, usedSeeds);
  for (const plan of smallPlans) {
    const grown = growCavern(smallRng, cells, plan.seedCell, plan.targetSize, owned);
    if (grown.length === 0) continue;
    for (const ci of grown) {
      cells[ci].category = 'cavern';
      cells[ci].cavernId = plan.id;
    }
    const { cx, cy } = centroidOf(cells, grown);
    caverns.push({ id: plan.id, kind: 'small', cellIndices: grown, cx, cy });
  }

  for (const p of smallPlans) usedSeeds.add(p.seedCell);
  const mazeTopRng = seededPRNG(`${seed}_underground_maze_top`);
  const mazePlans = planMazeClusters(mazeTopRng, cells, width, height, usedSeeds);
  for (let mi = 0; mi < mazePlans.length; mi++) {
    const plan = mazePlans[mi];
    const grown = growCavern(mazeTopRng, cells, plan.seedCell, plan.targetSize, owned);
    if (grown.length === 0) continue;
    for (const ci of grown) {
      cells[ci].category = 'cavern';
      cells[ci].cavernId = plan.id;
    }
    const { cx, cy } = centroidOf(cells, grown);
    const cluster: Cavern = { id: plan.id, kind: 'maze', cellIndices: grown, cx, cy };
    caverns.push(cluster);
    fleshOutMazeCluster(seed, mi, cells, owned, cluster, caverns);
  }

  // Step 3: carve inter-cavern tunnels (top-level caverns + maze cluster
  // anchors). Maze cluster INTERNAL passages were already carved above.
  carveInterCavernTunnels(seed, cells, caverns, owned);

  // Step 4: pick surface↔underground entrances.
  // Use only top-level caverns for entrance placement; mini-cavities inside
  // maze clusters are tiny and would cluster entrances unrealistically.
  const topLevelCaverns = caverns.filter(c => c.id.split('_').length === 2);
  const connections = generateConnections(seed, surfaceCells, cells, topLevelCaverns);

  return {
    seed: `${seed}_underground`,
    width,
    height,
    cells,
    caverns,
    connections,
  };
}
