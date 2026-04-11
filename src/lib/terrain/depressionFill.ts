import type { Cell, TerrainProfile } from '../types';

// ---------------------------------------------------------------------------
// Priority-Flood + ε depression fill
//
// Runs after biome assignment and before river tracing (and again after
// hydraulic erosion). Solves the "rivers end mid-land" bug caused by closed
// basins where `drainage[i] === null`: after this pass every reachable land
// cell has a strictly-lower neighbor in the parallel `drainageElevation`
// array, so `buildDrainageMap` produces a no-sink graph and rivers always
// terminate at a water cell (ocean or materialized lake).
//
// Small closed basins (size ≤ profile.lakeMaxSize) are materialized as
// visible LAKE biome cells. Larger basins keep their land biomes and rely
// on the virtual drainage surface to route rivers through.
//
// Algorithm: Barnes, Lehman, Bigelow (2014) "Priority-Flood". Deterministic —
// the heap is tie-broken by cell index, neighbour traversal follows the
// stable `cell.neighbors` order, and no `Math.random()` is used, so the
// seed-reproducibility invariant is preserved.
// ---------------------------------------------------------------------------

export interface DepressionFillResult {
  /** Float32Array parallel to `cells[]`. Feeds `buildDrainageMap` via an
   *  optional parameter; cell objects keep their real `elevation` untouched
   *  so biomes, hillshading, and hydraulic erosion still see the true surface. */
  drainageElevation: Float32Array;
  /** Number of land cells converted to lakes this pass. */
  lakeCellCount: number;
}

// ---- Tiny binary min-heap local to this file ------------------------------
// Entries are encoded as a single number `(elev * MULT) + cellIndex` where
// MULT is large enough to keep the integer index in the low bits without
// colliding with the elevation. We avoid the allocation cost of wrapper
// objects and the heap is fully deterministic because ties on elev are
// broken by the cell-index tail.
class ElevIndexHeap {
  private elevs: number[] = [];
  private idxs: number[] = [];

  size(): number { return this.elevs.length; }

  push(elev: number, idx: number): void {
    this.elevs.push(elev);
    this.idxs.push(idx);
    this.siftUp(this.elevs.length - 1);
  }

  popIndex(): number {
    const idx = this.idxs[0];
    const lastE = this.elevs.pop()!;
    const lastI = this.idxs.pop()!;
    if (this.elevs.length > 0) {
      this.elevs[0] = lastE;
      this.idxs[0] = lastI;
      this.siftDown(0);
    }
    return idx;
  }

  /** Elevation at the top. Only valid when size() > 0. */
  topElev(): number { return this.elevs[0]; }

  private less(a: number, b: number): boolean {
    if (this.elevs[a] !== this.elevs[b]) return this.elevs[a] < this.elevs[b];
    return this.idxs[a] < this.idxs[b];
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  private siftDown(i: number): void {
    const n = this.elevs.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.less(l, smallest)) smallest = l;
      if (r < n && this.less(r, smallest)) smallest = r;
      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else break;
    }
  }

  private swap(a: number, b: number): void {
    const te = this.elevs[a]; this.elevs[a] = this.elevs[b]; this.elevs[b] = te;
    const ti = this.idxs[a]; this.idxs[a] = this.idxs[b]; this.idxs[b] = ti;
  }
}

// ---------------------------------------------------------------------------

export function fillDepressions(cells: Cell[], profile: TerrainProfile): DepressionFillResult {
  const n = cells.length;
  const epsilon = profile.depressionFillEpsilon;

  // Parallel elevation array — seeded with true elevations, then raised
  // inside depressions as the priority flood propagates inland.
  const drainageElevation = new Float32Array(n);
  for (let i = 0; i < n; i++) drainageElevation[i] = cells[i].elevation;

  const visited = new Uint8Array(n);
  const heap = new ElevIndexHeap();

  // Seed with every water cell (ocean, ICE, and pre-existing lakes from a
  // previous pass). Drainage always flows toward these.
  for (let i = 0; i < n; i++) {
    if (cells[i].isWater) {
      heap.push(drainageElevation[i], i);
      visited[i] = 1;
    }
  }

  // Main priority flood. Neighbours inherit `max(neighElev, curElev + ε)`,
  // guaranteeing the drainage surface is strictly monotonic away from water.
  while (heap.size() > 0) {
    const curElev = heap.topElev();
    const cur = heap.popIndex();
    const neigh = cells[cur].neighbors;
    for (let k = 0; k < neigh.length; k++) {
      const ni = neigh[k];
      if (visited[ni]) continue;
      visited[ni] = 1;
      const trueElev = cells[ni].elevation;
      const nextElev = trueElev > curElev + epsilon ? trueElev : curElev + epsilon;
      drainageElevation[ni] = nextElev;
      heap.push(nextElev, ni);
    }
  }

  // Disconnected-island fallback: any land cell that still isn't visited
  // belongs to a cluster with no water neighbour anywhere. Seed the lowest
  // cell of each unreached component and re-flood locally so rivers on
  // those islands still have a drainable surface.
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    // BFS the component to find its lowest cell.
    let lowestIdx = i;
    let lowestElev = cells[i].elevation;
    const stack: number[] = [i];
    const componentIdxs: number[] = [];
    const compSeen = new Set<number>();
    compSeen.add(i);
    while (stack.length > 0) {
      const c = stack.pop()!;
      componentIdxs.push(c);
      if (cells[c].elevation < lowestElev) {
        lowestElev = cells[c].elevation;
        lowestIdx = c;
      }
      for (const nj of cells[c].neighbors) {
        if (compSeen.has(nj)) continue;
        if (visited[nj]) continue;
        compSeen.add(nj);
        stack.push(nj);
      }
    }
    // Seed the lowest cell at its own elevation and flood the component.
    heap.push(cells[lowestIdx].elevation, lowestIdx);
    visited[lowestIdx] = 1;
    drainageElevation[lowestIdx] = cells[lowestIdx].elevation;
    while (heap.size() > 0) {
      const curElev = heap.topElev();
      const cur = heap.popIndex();
      for (const nk of cells[cur].neighbors) {
        if (visited[nk]) continue;
        visited[nk] = 1;
        const trueElev = cells[nk].elevation;
        const nextElev = trueElev > curElev + epsilon ? trueElev : curElev + epsilon;
        drainageElevation[nk] = nextElev;
        heap.push(nextElev, nk);
      }
    }
    // Suppress "unused" lint — componentIdxs is for humans reading the trace.
    void componentIdxs;
  }

  // Identify cells whose drainage elevation was raised above their true
  // elevation — these are the cells inside closed depressions.
  const halfEps = epsilon * 0.5;
  const isFilled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (cells[i].isWater) continue;
    if (drainageElevation[i] > cells[i].elevation + halfEps) {
      isFilled[i] = 1;
    }
  }

  // Group filled cells into connected components and convert small ones
  // into lakes. Large basins stay as land with virtual drainage only.
  const componentVisited = new Uint8Array(n);
  const maxLakeSize = profile.lakeMaxSize;
  let lakeCellCount = 0;

  for (let start = 0; start < n; start++) {
    if (!isFilled[start] || componentVisited[start]) continue;
    // BFS the connected filled component.
    const component: number[] = [];
    const queue: number[] = [start];
    componentVisited[start] = 1;
    while (queue.length > 0) {
      const c = queue.shift()!;
      component.push(c);
      for (const nj of cells[c].neighbors) {
        if (componentVisited[nj]) continue;
        if (!isFilled[nj]) continue;
        componentVisited[nj] = 1;
        queue.push(nj);
      }
    }

    if (component.length <= maxLakeSize) {
      for (const idx of component) {
        const cell = cells[idx];
        cell.isWater = true;
        cell.isLake = true;
        cell.biome = 'LAKE';
      }
      lakeCellCount += component.length;
    }
  }

  return { drainageElevation, lakeCellCount };
}
