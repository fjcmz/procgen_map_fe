import type { Cell, City, Road } from '../types';

function terrainCost(cell: Cell): number {
  if (cell.isWater) return 999;
  if (cell.elevation > 0.75) return 8; // mountains
  if (cell.elevation > 0.6) return 3;  // hills
  return 1;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/** A* pathfinding between two cell indices. Returns cell index path or null. */
function aStar(
  cells: Cell[],
  startIdx: number,
  goalIdx: number
): number[] | null {
  const goal = cells[goalIdx];
  const open = new Set<number>([startIdx]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();

  gScore.set(startIdx, 0);
  fScore.set(startIdx, Math.sqrt(dist2(cells[startIdx].x, cells[startIdx].y, goal.x, goal.y)));

  const getG = (i: number) => gScore.get(i) ?? Infinity;
  const getF = (i: number) => fScore.get(i) ?? Infinity;

  let iterations = 0;
  while (open.size > 0 && iterations++ < 5000) {
    // Get open node with lowest fScore
    let current = -1;
    let bestF = Infinity;
    for (const idx of open) {
      const f = getF(idx);
      if (f < bestF) { bestF = f; current = idx; }
    }
    if (current === goalIdx) {
      // Reconstruct path
      const path: number[] = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.push(current);
      }
      return path.reverse();
    }

    open.delete(current);
    for (const ni of cells[current].neighbors) {
      const neighbor = cells[ni];
      const tentativeG = getG(current) + terrainCost(neighbor);
      if (tentativeG < getG(ni)) {
        cameFrom.set(ni, current);
        gScore.set(ni, tentativeG);
        fScore.set(ni, tentativeG + Math.sqrt(dist2(neighbor.x, neighbor.y, goal.x, goal.y)) * 0.01);
        open.add(ni);
      }
    }
  }
  return null;
}

export function generateRoads(cells: Cell[], cities: City[]): Road[] {
  const roads: Road[] = [];
  const addedPairs = new Set<string>();

  for (let i = 0; i < cities.length; i++) {
    // Connect each city to its 2 nearest cities
    const others = cities
      .filter((_, j) => j !== i)
      .sort((a, b) =>
        dist2(cells[cities[i].cellIndex].x, cells[cities[i].cellIndex].y,
              cells[a.cellIndex].x, cells[a.cellIndex].y) -
        dist2(cells[cities[i].cellIndex].x, cells[cities[i].cellIndex].y,
              cells[b.cellIndex].x, cells[b.cellIndex].y)
      );

    const targets = others.slice(0, 2);
    for (const target of targets) {
      const key = [cities[i].cellIndex, target.cellIndex].sort().join('-');
      if (addedPairs.has(key)) continue;
      addedPairs.add(key);

      const path = aStar(cells, cities[i].cellIndex, target.cellIndex);
      if (path && path.length >= 2) {
        roads.push({ path });
      }
    }
  }

  return roads;
}

// ---------------------------------------------------------------------------
// Trade route pathfinding — allows water traversal, penalises open ocean
// ---------------------------------------------------------------------------

/** BFS from all land cells through water neighbors. Returns Float32Array 0–1
 *  where 0 = land/coastal water, 1 = most remote ocean cell. */
export function computeDistanceFromLand(cells: Cell[]): Float32Array {
  const n = cells.length;
  const dist = new Float32Array(n).fill(-1);
  const queue: number[] = [];

  // Seed: every land cell starts at distance 0
  for (let i = 0; i < n; i++) {
    if (!cells[i].isWater) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  // BFS through water neighbors only
  let qi = 0;
  let maxDist = 0;
  while (qi < queue.length) {
    const ci = queue[qi++];
    for (const ni of cells[ci].neighbors) {
      if (dist[ni] < 0) {
        dist[ni] = dist[ci] + 1;
        if (dist[ni] > maxDist) maxDist = dist[ni];
        queue.push(ni);
      }
    }
  }

  // Normalize water distances to 0–1
  if (maxDist > 0) {
    for (let i = 0; i < n; i++) {
      if (dist[i] > 0 && cells[i].isWater) {
        dist[i] = dist[i] / maxDist;
      } else {
        dist[i] = 0;
      }
    }
  }

  return dist;
}

/** Cost function for trade route A*. Water cells are traversable but penalised
 *  by distance from land — coastal water is cheap, open ocean is expensive. */
function tradeRouteCost(cell: Cell, distFromLand: Float32Array): number {
  if (!cell.isWater) {
    if (cell.elevation > 0.75) return 8;  // mountains
    if (cell.elevation > 0.6) return 3;   // hills
    return 1;                              // flat land
  }
  // Water: base cost 2 near coast, scaling up to ~14 in deep ocean
  return 2 + 12 * distFromLand[cell.index];
}

/** Wrapping-aware squared Euclidean distance (cylindrical east-west map). */
function wrappedDist2(ax: number, ay: number, bx: number, by: number, width: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > width / 2) dx = width - dx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** A* pathfinding for trade routes. Allows water traversal with coast-hugging
 *  cost gradient. Returns cell-index path or null. */
function tradeRouteAStar(
  cells: Cell[],
  distFromLand: Float32Array,
  startIdx: number,
  goalIdx: number,
  width: number,
): number[] | null {
  const goal = cells[goalIdx];
  const open = new Set<number>([startIdx]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();

  gScore.set(startIdx, 0);
  fScore.set(startIdx, Math.sqrt(wrappedDist2(cells[startIdx].x, cells[startIdx].y, goal.x, goal.y, width)));

  const getG = (i: number) => gScore.get(i) ?? Infinity;
  const getF = (i: number) => fScore.get(i) ?? Infinity;

  let iterations = 0;
  while (open.size > 0 && iterations++ < 15000) {
    let current = -1;
    let bestF = Infinity;
    for (const idx of open) {
      const f = getF(idx);
      if (f < bestF) { bestF = f; current = idx; }
    }
    if (current === goalIdx) {
      const path: number[] = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.push(current);
      }
      return path.reverse();
    }

    open.delete(current);
    for (const ni of cells[current].neighbors) {
      const neighbor = cells[ni];
      const tentativeG = getG(current) + tradeRouteCost(neighbor, distFromLand);
      if (tentativeG < getG(ni)) {
        cameFrom.set(ni, current);
        gScore.set(ni, tentativeG);
        fScore.set(ni, tentativeG + Math.sqrt(wrappedDist2(neighbor.x, neighbor.y, goal.x, goal.y, width)) * 0.5);
        open.add(ni);
      }
    }
  }
  return null;
}

/** Compute a pathfound trade route between two city cells. Falls back to a
 *  straight two-point path if A* fails (e.g. disconnected landmasses). */
export function generateTradeRoutePath(
  cells: Cell[],
  distFromLand: Float32Array,
  cell1: number,
  cell2: number,
  width: number,
): number[] {
  const path = tradeRouteAStar(cells, distFromLand, cell1, cell2, width);
  return path ?? [cell1, cell2];
}
