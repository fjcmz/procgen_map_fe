import type { Cell, River, TerrainProfile } from '../types';

/** Find the lowest-elevation neighbor for each land cell (drainage direction). */
function buildDrainageMap(cells: Cell[]): (number | null)[] {
  const drainage: (number | null)[] = new Array(cells.length).fill(null);
  for (const cell of cells) {
    if (cell.isWater) continue;
    let lowestElev = cell.elevation;
    let lowestIdx: number | null = null;
    for (const ni of cell.neighbors) {
      if (cells[ni].elevation < lowestElev) {
        lowestElev = cells[ni].elevation;
        lowestIdx = ni;
      }
    }
    drainage[cell.index] = lowestIdx;
  }
  return drainage;
}

/** Accumulate flow values downstream. */
function accumulateFlow(cells: Cell[], drainage: (number | null)[]): void {
  // Topological sort: process high cells first
  const order = cells
    .filter(c => !c.isWater)
    .sort((a, b) => b.elevation - a.elevation);

  for (const cell of cells) {
    cell.riverFlow = 1;
  }

  for (const cell of order) {
    const d = drainage[cell.index];
    if (d !== null && d < cells.length) {
      cells[d].riverFlow += cell.riverFlow;
    }
  }
}

/** Collect river paths as chains of cell indices. */
function collectRivers(cells: Cell[], drainage: (number | null)[], flowThreshold: number): River[] {
  // River segments: pairs (from, to) where flow > threshold
  const segments: [number, number][] = [];
  for (const cell of cells) {
    if (!cell.isWater && cell.riverFlow >= flowThreshold) {
      const d = drainage[cell.index];
      if (d !== null) {
        segments.push([cell.index, d]);
      }
    }
  }

  // Build adjacency for chain following
  const outgoing = new Map<number, number>();
  const incoming = new Set<number>();
  for (const [from, to] of segments) {
    outgoing.set(from, to);
    incoming.add(to);
  }

  // Start chains from sources (cells with outgoing but not incoming in river graph)
  const sources = segments
    .map(([from]) => from)
    .filter(i => !incoming.has(i));

  const rivers: River[] = [];

  for (const source of sources) {
    const path: number[] = [source];
    let cur = source;
    const visited = new Set<number>([source]);
    while (outgoing.has(cur)) {
      const next = outgoing.get(cur)!;
      if (visited.has(next)) break;
      path.push(next);
      visited.add(next);
      if (cells[next].isWater) break;
      cur = next;
    }
    if (path.length >= 2) {
      let maxFlow = 0;
      for (const idx of path) {
        if (cells[idx].riverFlow > maxFlow) maxFlow = cells[idx].riverFlow;
      }
      rivers.push({
        path,
        maxFlow,
      });
    }
  }

  return rivers;
}

export function generateRivers(cells: Cell[], profile: TerrainProfile): River[] {
  const drainage = buildDrainageMap(cells);
  accumulateFlow(cells, drainage);
  return collectRivers(cells, drainage, profile.riverFlowThreshold);
}
