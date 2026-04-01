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
