import type { Cell, River, TerrainProfile } from '../types';

/**
 * Find the lowest-elevation neighbor for each land cell (drainage direction).
 *
 * When `drainageElev` is provided (produced by `fillDepressions`), both the
 * current cell and its neighbours are compared via that parallel surface
 * instead of raw `cell.elevation`. After a successful priority-flood pass
 * every reachable non-water cell has a strictly-lower neighbour in
 * `drainageElev`, so this function never returns `null` for those cells and
 * rivers always reach the ocean or a materialized lake. The `null` branch
 * is kept as a safety net for degenerate inputs and the disconnected-island
 * fallback path inside `fillDepressions`.
 */
function buildDrainageMap(
  cells: Cell[],
  drainageElev?: Float32Array,
): (number | null)[] {
  const drainage: (number | null)[] = new Array(cells.length).fill(null);
  for (const cell of cells) {
    if (cell.isWater) continue;
    const cellElev = drainageElev ? drainageElev[cell.index] : cell.elevation;
    let lowestElev = cellElev;
    let lowestIdx: number | null = null;
    for (const ni of cell.neighbors) {
      const nElev = drainageElev ? drainageElev[ni] : cells[ni].elevation;
      if (nElev < lowestElev) {
        lowestElev = nElev;
        lowestIdx = ni;
      }
    }
    drainage[cell.index] = lowestIdx;
  }
  return drainage;
}

/**
 * Accumulate flow values downstream.
 *
 * The topological order must match the drainage graph: every cell has to be
 * processed BEFORE its drainage target, otherwise the target propagates its
 * stale (partial) flow forward and the contribution never catches up.
 *
 * When `drainageElev` is provided, we sort by the PF+ε surface descending —
 * that surface is strictly monotonic along every drainage edge by
 * construction, so a cell always comes before its target. Without this, cells
 * inside a filled depression (whose drainage points uphill in raw elevation,
 * out to the pour point) are processed *after* their target and their flow
 * gets stranded at the pour point. This only became visible once small
 * basins stopped being lake-ified wholesale by `lakeMinSize` — lake cells
 * were skipped entirely, so no uphill-drainage edges existed in the graph.
 *
 * Falls back to raw `cell.elevation` when `drainageElev` is absent, which
 * preserves the pre-`fillDepressions` behavior for any caller that bypasses
 * the depression-fill pass.
 */
function accumulateFlow(
  cells: Cell[],
  drainage: (number | null)[],
  drainageElev?: Float32Array,
): void {
  const order = cells.filter(c => !c.isWater);
  if (drainageElev) {
    order.sort((a, b) => drainageElev[b.index] - drainageElev[a.index]);
  } else {
    order.sort((a, b) => b.elevation - a.elevation);
  }

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

export function generateRivers(
  cells: Cell[],
  profile: TerrainProfile,
  drainageElev?: Float32Array,
): River[] {
  const drainage = buildDrainageMap(cells, drainageElev);
  accumulateFlow(cells, drainage, drainageElev);
  return collectRivers(cells, drainage, profile.riverFlowThreshold);
}
