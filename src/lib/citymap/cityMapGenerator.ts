import type { Cell, City, MapData } from '../types';
import { createNoiseSamplers, fbm, seededPRNG } from '../terrain/noise';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';
import type {
  CityBlock,
  CityBuilding,
  CityEnvironment,
  CityLandmark,
  CityMapData,
  CitySize,
  DistrictRole,
} from './cityMapTypes';

// Re-export types so existing deep imports from './cityMapGenerator' keep resolving.
export type {
  CityBlock,
  CityBuilding,
  CityEnvironment,
  CityLandmark,
  CityMapData,
  CitySize,
  DistrictRole,
};

// ── Constants ──

const CANVAS_SIZE = 720;

const GRID_SIZES: Record<CitySize, number> = {
  small: 28,
  medium: 36,
  large: 44,
  metropolis: 54,
  megalopolis: 64,
};

const SIZE_TIER: Record<CitySize, number> = {
  small: 0,
  medium: 0.25,
  large: 0.5,
  metropolis: 0.75,
  megalopolis: 1,
};

// ── Environment derivation ──

export function deriveCityEnvironment(
  city: City,
  cells: Cell[],
  mapData: MapData,
  citySizesAtYear?: Uint8Array,
  selectedYear?: number,
  wonderCellIndices?: number[],
  religionCellIndices?: number[],
): CityEnvironment {
  const cell = cells[city.cellIndex];
  const neighborCells = cell.neighbors.map(i => cells[i]);

  // Determine water side
  let waterSide: 'north' | 'south' | 'east' | 'west' | null = null;
  if (cell.isCoast || neighborCells.some(n => n.isWater)) {
    let wx = 0, wy = 0, wcount = 0;
    for (const n of neighborCells) {
      if (n.isWater) {
        wx += n.x - cell.x;
        wy += n.y - cell.y;
        wcount++;
      }
    }
    if (wcount > 0) {
      wx /= wcount;
      wy /= wcount;
      if (Math.abs(wx) > Math.abs(wy)) {
        waterSide = wx > 0 ? 'east' : 'west';
      } else {
        waterSide = wy > 0 ? 'south' : 'north';
      }
    }
  }

  // Resolve dynamic size
  let size: CitySize = city.size;
  if (citySizesAtYear) {
    const cityIdx = mapData.cities.indexOf(city);
    if (cityIdx >= 0 && citySizesAtYear[cityIdx] != null) {
      size = INDEX_TO_CITY_SIZE[citySizesAtYear[cityIdx]] ?? city.size;
    }
  }

  const isRuin = city.isRuin && (selectedYear == null || city.ruinYear <= selectedYear);

  return {
    biome: cell.biome,
    isCoastal: cell.isCoast || neighborCells.some(n => n.isWater),
    hasRiver: cell.riverFlow > 0,
    waterSide,
    elevation: cell.elevation,
    moisture: cell.moisture,
    temperature: cell.temperature,
    isCapital: city.isCapital,
    size,
    wonderCount: wonderCellIndices?.filter(i => i === city.cellIndex).length ?? 0,
    religionCount: religionCellIndices?.filter(i => i === city.cellIndex).length ?? 0,
    isRuin,
    neighborBiomes: neighborCells.map(n => n.biome),
  };
}

// ── Wall footprint ──

type Edge = [[number, number], [number, number]];

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function generateWallFootprint(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  gridW: number,
): Set<string> {
  const samplers = createNoiseSamplers(seed + '_city_' + cityName + '_walls');

  const tier = SIZE_TIER[env.size];
  const coverage = 0.5 + (0.85 - 0.5) * tier;
  const targetCount = Math.round(coverage * gridW * gridW);

  const cx = (gridW - 1) / 2;
  const cy = (gridW - 1) / 2;
  const maxR = Math.min(cx, cy);

  // Score every tile by (radial distance + FBM perturbation). Lower = more central.
  type Scored = { x: number; y: number; score: number };
  const scored: Scored[] = [];
  for (let y = 0; y < gridW; y++) {
    for (let x = 0; x < gridW; x++) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.sqrt(dx * dx + dy * dy);
      const noise = fbm(samplers.elevation, x * 0.18, y * 0.18, 4);
      const perturb = (noise - 0.5) * 0.6;
      scored.push({ x, y, score: r + perturb });
    }
  }
  scored.sort((a, b) => a.score - b.score);

  const inSet = new Set<string>();
  for (let i = 0; i < targetCount && i < scored.length; i++) {
    inSet.add(tileKey(scored[i].x, scored[i].y));
  }

  // Keep only the connected component containing the center-most selected tile.
  let seedTile: [number, number] | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < Math.min(targetCount, scored.length); i++) {
    const t = scored[i];
    const d = Math.hypot(t.x - cx, t.y - cy);
    if (d < bestDist) {
      bestDist = d;
      seedTile = [t.x, t.y];
    }
  }
  if (!seedTile) return new Set();

  const connected = new Set<string>();
  const queue: [number, number][] = [seedTile];
  connected.add(tileKey(seedTile[0], seedTile[1]));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const k = tileKey(nx, ny);
      if (inSet.has(k) && !connected.has(k)) {
        connected.add(k);
        queue.push([nx, ny]);
      }
    }
  }

  // Fill any holes (non-interior tiles fully enclosed by interior).
  const exterior = new Set<string>();
  const exQueue: [number, number][] = [];
  for (let i = 0; i < gridW; i++) {
    const seeds: [number, number][] = [
      [i, 0], [i, gridW - 1], [0, i], [gridW - 1, i],
    ];
    for (const [x, y] of seeds) {
      const k = tileKey(x, y);
      if (!connected.has(k) && !exterior.has(k)) {
        exterior.add(k);
        exQueue.push([x, y]);
      }
    }
  }
  while (exQueue.length > 0) {
    const [x, y] = exQueue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridW) continue;
      const k = tileKey(nx, ny);
      if (connected.has(k) || exterior.has(k)) continue;
      exterior.add(k);
      exQueue.push([nx, ny]);
    }
  }
  for (let y = 0; y < gridW; y++) {
    for (let x = 0; x < gridW; x++) {
      const k = tileKey(x, y);
      if (!exterior.has(k)) connected.add(k);
    }
  }

  return connected;
}

// ── Wall edge tracing ──

function collectWallEdges(interior: Set<string>): Edge[] {
  const edges: Edge[] = [];
  for (const key of interior) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    // Edges traced clockwise around the interior (y-axis points down).
    if (!interior.has(tileKey(x, y - 1))) edges.push([[x, y], [x + 1, y]]);
    if (!interior.has(tileKey(x + 1, y))) edges.push([[x + 1, y], [x + 1, y + 1]]);
    if (!interior.has(tileKey(x, y + 1))) edges.push([[x + 1, y + 1], [x, y + 1]]);
    if (!interior.has(tileKey(x - 1, y))) edges.push([[x, y + 1], [x, y]]);
  }
  return edges;
}

function chainWallPath(edges: Edge[]): [number, number][] {
  if (edges.length === 0) return [];

  const adj = new Map<string, [number, number][]>();
  for (const [a, b] of edges) {
    const k = tileKey(a[0], a[1]);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push(b);
  }

  // Pick the start with the smallest (y, x) to make the trace deterministic.
  let start: [number, number] = edges[0][0];
  for (const [a] of edges) {
    if (a[1] < start[1] || (a[1] === start[1] && a[0] < start[0])) {
      start = [a[0], a[1]];
    }
  }

  const path: [number, number][] = [start];
  let prev: [number, number] | null = null;
  let current: [number, number] = start;
  const totalEdges = edges.length;

  for (let step = 0; step < totalEdges + 1; step++) {
    const k = tileKey(current[0], current[1]);
    const outs = adj.get(k);
    if (!outs || outs.length === 0) break;

    let chosenIdx = 0;
    if (outs.length > 1 && prev) {
      // Prefer continuing straight (same direction); otherwise turn right (CW).
      const inDx = current[0] - prev[0];
      const inDy = current[1] - prev[1];
      let bestScore = -Infinity;
      for (let i = 0; i < outs.length; i++) {
        const dx = outs[i][0] - current[0];
        const dy = outs[i][1] - current[1];
        const dot = inDx * dx + inDy * dy; // straight = +1, back = -1
        const cross = inDx * dy - inDy * dx; // CW turn (y-down) = +1
        const score = dot * 2 + cross;
        if (score > bestScore) {
          bestScore = score;
          chosenIdx = i;
        }
      }
    }

    const next = outs[chosenIdx];
    outs.splice(chosenIdx, 1);
    path.push(next);
    prev = current;
    current = next;
    if (current[0] === start[0] && current[1] === start[1]) break;
  }

  return path;
}

// ── Gates ──

function pickGates(
  wallPath: [number, number][],
  waterSide: CityEnvironment['waterSide'],
  gridW: number,
): { edge: Edge; dir: 'N' | 'S' | 'E' | 'W' }[] {
  if (wallPath.length < 2) return [];

  const dirs: Array<{
    dir: 'N' | 'S' | 'E' | 'W';
    normal: [number, number];
    waterKey: 'north' | 'south' | 'east' | 'west';
  }> = [
    { dir: 'N', normal: [0, -1], waterKey: 'north' },
    { dir: 'S', normal: [0, 1], waterKey: 'south' },
    { dir: 'E', normal: [1, 0], waterKey: 'east' },
    { dir: 'W', normal: [-1, 0], waterKey: 'west' },
  ];

  const center = (gridW - 1) / 2;
  const gates: { edge: Edge; dir: 'N' | 'S' | 'E' | 'W' }[] = [];
  const used = new Set<string>();

  for (const d of dirs) {
    if (waterSide === d.waterKey) continue;

    let bestEdge: Edge | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < wallPath.length - 1; i++) {
      const a = wallPath[i];
      const b = wallPath[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      // Outward normal for CW polygon (y-down): (dy, -dx).
      const nx = dy;
      const ny = -dx;
      const dot = nx * d.normal[0] + ny * d.normal[1];
      if (dot < 0.99) continue;

      const midx = (a[0] + b[0]) / 2;
      const midy = (a[1] + b[1]) / 2;
      const proj = midx * d.normal[0] + midy * d.normal[1];
      const perpDist = d.normal[0] !== 0 ? Math.abs(midy - center) : Math.abs(midx - center);
      const score = proj * 100 - perpDist;

      const k = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
      if (used.has(k)) continue;

      if (score > bestScore) {
        bestScore = score;
        bestEdge = [a, b];
      }
    }

    if (bestEdge) {
      gates.push({ edge: bestEdge, dir: d.dir });
      used.add(`${bestEdge[0][0]},${bestEdge[0][1]}|${bestEdge[1][0]},${bestEdge[1][1]}`);
    }
  }

  return gates;
}

// ── Edge-graph helpers ──

// An "edge" in the tile-edge graph connects two adjacent tile-corner grid points.
// Corners are at integer coordinates (0..gridW, 0..gridW).
// Tile (tx, ty) has corners at (tx,ty),(tx+1,ty),(tx+1,ty+1),(tx,ty+1).

function cornerKey(x: number, y: number): string { return `${x},${y}`; }
function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  // canonical (smaller first)
  if (ay < by || (ay === by && ax < bx)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}

// Returns all tile-edge graph edges that border at least one interior tile.
// Used for routing on the city-interior edge-graph.
function buildInteriorEdgeGraph(
  interior: Set<string>,
): Map<string, string[]> {
  // adjacency: cornerKey → list of cornerKeys reachable via a single tile edge
  const adj = new Map<string, string[]>();
  function addEdge(ax: number, ay: number, bx: number, by: number) {
    const ka = cornerKey(ax, ay);
    const kb = cornerKey(bx, by);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(kb);
    adj.get(kb)!.push(ka);
  }
  for (const key of interior) {
    const [xs, ys] = key.split(',');
    const tx = Number(xs), ty = Number(ys);
    // top, right, bottom, left edges of this tile
    addEdge(tx, ty, tx + 1, ty);
    addEdge(tx + 1, ty, tx + 1, ty + 1);
    addEdge(tx + 1, ty + 1, tx, ty + 1);
    addEdge(tx, ty + 1, tx, ty);
  }
  // deduplicate
  for (const [k, v] of adj) {
    adj.set(k, [...new Set(v)]);
  }
  return adj;
}

// A* on corner graph. heuristic = manhattan to goal corner.
function aStarEdge(
  adj: Map<string, string[]>,
  startX: number, startY: number,
  endX: number, endY: number,
  extraCost?: (ax: number, ay: number, bx: number, by: number) => number,
): [number, number][] | null {
  const startK = cornerKey(startX, startY);
  const endK = cornerKey(endX, endY);
  if (startK === endK) return [[startX, startY]];

  type Node = { k: string; g: number; f: number };
  const open: Node[] = [{ k: startK, g: 0, f: Math.abs(startX - endX) + Math.abs(startY - endY) }];
  const gScore = new Map<string, number>([[startK, 0]]);
  const cameFrom = new Map<string, string>();

  while (open.length > 0) {
    // pop node with lowest f
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k: curr } = open.splice(bi, 1)[0];
    if (curr === endK) {
      // reconstruct
      const path: [number, number][] = [];
      let c = curr;
      while (c) {
        const [xs, ys] = c.split(',');
        path.unshift([Number(xs), Number(ys)]);
        c = cameFrom.get(c)!;
      }
      return path;
    }
    const [cxs, cys] = curr.split(',');
    const cx = Number(cxs), cy = Number(cys);
    for (const nb of (adj.get(curr) ?? [])) {
      const [nxs, nys] = nb.split(',');
      const nx = Number(nxs), ny = Number(nys);
      let step = 1;
      if (extraCost) step += extraCost(cx, cy, nx, ny);
      const ng = (gScore.get(curr) ?? Infinity) + step;
      if (ng < (gScore.get(nb) ?? Infinity)) {
        gScore.set(nb, ng);
        cameFrom.set(nb, curr);
        const h = Math.abs(nx - endX) + Math.abs(ny - endY);
        open.push({ k: nb, g: ng, f: ng + h });
      }
    }
  }
  return null;
}

// ── River generation ──

function generateRiver(
  env: CityEnvironment,
  interior: Set<string>,
  gridW: number,
  rng: () => number,
): { edges: [[number, number], [number, number]][]; islands: Set<string> } | null {
  if (!env.hasRiver) return null;

  const adj = buildInteriorEdgeGraph(interior);
  // Also add the full grid corner graph (river can exit through boundary)
  for (let y = 0; y <= gridW; y++) {
    for (let x = 0; x <= gridW; x++) {
      const k = cornerKey(x, y);
      if (!adj.has(k)) adj.set(k, []);
      const neighbors: [number, number][] = [];
      if (x > 0) neighbors.push([x - 1, y]);
      if (x < gridW) neighbors.push([x + 1, y]);
      if (y > 0) neighbors.push([x, y - 1]);
      if (y < gridW) neighbors.push([x, y + 1]);
      for (const [nx, ny] of neighbors) {
        const nk = cornerKey(nx, ny);
        if (!adj.get(k)!.includes(nk)) adj.get(k)!.push(nk);
        if (!adj.has(nk)) adj.set(nk, []);
        if (!adj.get(nk)!.includes(k)) adj.get(nk)!.push(k);
      }
    }
  }

  // Pick entry and exit: two points on opposite edges of the grid boundary
  const sides: Array<{ pts: [number, number][] }> = [
    { pts: Array.from({ length: gridW + 1 }, (_, i) => [i, 0] as [number, number]) },
    { pts: Array.from({ length: gridW + 1 }, (_, i) => [i, gridW] as [number, number]) },
    { pts: Array.from({ length: gridW + 1 }, (_, i) => [0, i] as [number, number]) },
    { pts: Array.from({ length: gridW + 1 }, (_, i) => [gridW, i] as [number, number]) },
  ];

  // Avoid water side
  const waterSideMap: Record<string, number> = { north: 0, south: 1, west: 2, east: 3 };
  const waterSideIdx = env.waterSide != null ? (waterSideMap[env.waterSide] ?? -1) : -1;
  const availSides = sides.filter((_, i) => i !== waterSideIdx);
  // Pick two non-adjacent (opposite) sides
  const sideA = availSides[Math.floor(rng() * availSides.length)];
  const opposites = availSides.filter(s => s !== sideA);
  const sideB = opposites[Math.floor(rng() * opposites.length)];

  const entryPt = sideA.pts[Math.floor(rng() * sideA.pts.length)];
  const exitPt = sideB.pts[Math.floor(rng() * sideB.pts.length)];

  // Meander cost: prefer bends (small turn penalty for straight runs)
  const meander = (_ax: number, _ay: number, _bx: number, _by: number) => rng() * 0.4;
  const mainPath = aStarEdge(adj, entryPt[0], entryPt[1], exitPt[0], exitPt[1], meander);
  if (!mainPath || mainPath.length < 2) return null;

  const riverEdges: [[number, number], [number, number]][] = [];
  const riverEdgeSet = new Set<string>();
  function addRiverEdge(ax: number, ay: number, bx: number, by: number) {
    const k = edgeKey(ax, ay, bx, by);
    if (!riverEdgeSet.has(k)) {
      riverEdgeSet.add(k);
      riverEdges.push([[ax, ay], [bx, by]]);
    }
  }

  for (let i = 0; i < mainPath.length - 1; i++) {
    addRiverEdge(mainPath[i][0], mainPath[i][1], mainPath[i + 1][0], mainPath[i + 1][1]);
  }

  // Bifurcation on large+ cities
  const canBifurcate = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  if (canBifurcate && mainPath.length > 8) {
    // Try one bifurcation: pick a stretch in the middle third
    const lo = Math.floor(mainPath.length * 0.25);
    const hi = Math.floor(mainPath.length * 0.70);
    for (let attempt = 0; attempt < 6; attempt++) {
      if (rng() > 0.35) continue;
      const startIdx = lo + Math.floor(rng() * (hi - lo - 5));
      const bifLen = 3 + Math.floor(rng() * 4); // 3–6 tiles
      const endIdx = Math.min(startIdx + bifLen, hi);
      if (endIdx >= mainPath.length) continue;

      const offset = (rng() > 0.5 ? 1 : -1) * (1 + Math.floor(rng() * 2));
      const [sx, sy] = mainPath[startIdx];
      const [ex, ey] = mainPath[endIdx];

      // Determine if stretch is mostly horizontal or vertical
      const dx = ex - sx;
      const dy = ey - sy;
      let bx: number, by: number, ex2: number, ey2: number;
      if (Math.abs(dx) >= Math.abs(dy)) {
        bx = sx; by = sy + offset;
        ex2 = ex; ey2 = ey + offset;
      } else {
        bx = sx + offset; by = sy;
        ex2 = ex + offset; ey2 = ey;
      }

      if (bx < 0 || by < 0 || bx > gridW || by > gridW) continue;
      if (ex2 < 0 || ey2 < 0 || ex2 > gridW || ey2 > gridW) continue;

      // Route the branch
      const branchPath = aStarEdge(adj, bx, by, ex2, ey2, meander);
      if (!branchPath || branchPath.length < 2) continue;

      // Connect start→branch start, branch end→end
      const connA = aStarEdge(adj, sx, sy, bx, by);
      const connB = aStarEdge(adj, ex2, ey2, ex, ey);
      if (!connA || !connB) continue;

      for (let i = 0; i < connA.length - 1; i++) addRiverEdge(connA[i][0], connA[i][1], connA[i + 1][0], connA[i + 1][1]);
      for (let i = 0; i < branchPath.length - 1; i++) addRiverEdge(branchPath[i][0], branchPath[i][1], branchPath[i + 1][0], branchPath[i + 1][1]);
      for (let i = 0; i < connB.length - 1; i++) addRiverEdge(connB[i][0], connB[i][1], connB[i + 1][0], connB[i + 1][1]);
      break;
    }
  }

  // Detect island tiles: interior tiles whose four edges are ALL river edges
  const islands = new Set<string>();
  for (const key of interior) {
    const [xs, ys] = key.split(',');
    const tx = Number(xs), ty = Number(ys);
    const tileEdges = [
      edgeKey(tx, ty, tx + 1, ty),
      edgeKey(tx + 1, ty, tx + 1, ty + 1),
      edgeKey(tx + 1, ty + 1, tx, ty + 1),
      edgeKey(tx, ty + 1, tx, ty),
    ];
    if (tileEdges.every(e => riverEdgeSet.has(e))) islands.add(key);
  }

  return { edges: riverEdges, islands };
}

// ── Road generation ──

function generateRoads(
  gates: CityMapData['gates'],
  interior: Set<string>,
  riverEdgeSet: Set<string>,
  gridW: number,
  rng: () => number,
): [number, number][][] {
  if (gates.length === 0) return [];

  const adj = buildInteriorEdgeGraph(interior);
  // Extend adj to include boundary corners so gates (on boundary) are reachable
  for (let y = 0; y <= gridW; y++) {
    for (let x = 0; x <= gridW; x++) {
      const k = cornerKey(x, y);
      if (!adj.has(k)) adj.set(k, []);
      const neighbors: [number, number][] = [];
      if (x > 0) neighbors.push([x - 1, y]);
      if (x < gridW) neighbors.push([x + 1, y]);
      if (y > 0) neighbors.push([x, y - 1]);
      if (y < gridW) neighbors.push([x, y + 1]);
      for (const [nx, ny] of neighbors) {
        const nk = cornerKey(nx, ny);
        if (!adj.has(nk)) adj.set(nk, []);
        if (!adj.get(k)!.includes(nk)) adj.get(k)!.push(nk);
        if (!adj.get(nk)!.includes(k)) adj.get(nk)!.push(k);
      }
    }
  }

  const cx = Math.round((gridW - 1) / 2);
  const cy = Math.round((gridW - 1) / 2);

  const roads: [number, number][][] = [];

  for (const gate of gates) {
    // Gate midpoint corner (nearest interior corner to gate center)
    const [ga, gb] = gate.edge;
    const gmx = Math.round((ga[0] + gb[0]) / 2);
    const gmy = Math.round((ga[1] + gb[1]) / 2);

    // Turn penalty: charge extra when direction changes
    let prevDx = 0, prevDy = 0;
    const turnCost = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay;
      const straight = (dx === prevDx && dy === prevDy);
      prevDx = dx; prevDy = dy;
      // River crossing allowed but slightly expensive
      const riverCross = riverEdgeSet.has(edgeKey(ax, ay, bx, by)) ? 0.5 : 0;
      return (straight ? 0 : 1.2) + riverCross + rng() * 0.1;
    };

    const path = aStarEdge(adj, gmx, gmy, cx, cy, turnCost);
    if (path && path.length > 1) roads.push(path);
  }

  return roads;
}

// ── Street generation ──

function generateStreets(
  interior: Set<string>,
  roads: [number, number][][],
  riverEdgeSet: Set<string>,
  gridW: number,
  rng: () => number,
): [number, number][][] {
  // Build set of edges already covered by roads
  const roadEdgeSet = new Set<string>();
  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      roadEdgeSet.add(edgeKey(road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]));
    }
  }

  // For each interior tile, find its closest road/street edge distance.
  // We want every interior tile to be ≤1 tile away from a road or street.
  const adj = buildInteriorEdgeGraph(interior);

  // Track which tiles are "served" (adjacent to a road/street edge)
  function tileIsServed(tx: number, ty: number, coveredEdges: Set<string>): boolean {
    const tileEdges = [
      edgeKey(tx, ty, tx + 1, ty),
      edgeKey(tx + 1, ty, tx + 1, ty + 1),
      edgeKey(tx + 1, ty + 1, tx, ty + 1),
      edgeKey(tx, ty + 1, tx, ty),
    ];
    return tileEdges.some(e => coveredEdges.has(e));
  }

  const coveredEdges = new Set<string>([...roadEdgeSet, ...riverEdgeSet]);

  // Collect unserved tiles
  const getUnserved = () => {
    const unserved: [number, number][] = [];
    for (const key of interior) {
      const [xs, ys] = key.split(',');
      const tx = Number(xs), ty = Number(ys);
      if (!tileIsServed(tx, ty, coveredEdges)) unserved.push([tx, ty]);
    }
    return unserved;
  };

  const streets: [number, number][][] = [];
  let unserved = getUnserved();
  let iters = 0;

  while (unserved.length > 0 && iters < 300) {
    iters++;
    // Pick a random unserved tile and route a short street from its nearest covered edge
    const pick = unserved[Math.floor(rng() * unserved.length)];
    const [tx, ty] = pick;

    // Try each corner of the tile as a start toward the nearest served tile's corner
    const tileCorners: [number, number][] = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];

    // Find a target corner on a served neighbor tile
    let targetCorner: [number, number] | null = null;
    const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    outer: for (const [ddx, ddy] of dirs4) {
      const nx = tx + ddx, ny = ty + ddy;
      if (tileIsServed(nx, ny, coveredEdges) || roadEdgeSet.size === 0) {
        targetCorner = [nx + (ddx >= 0 ? 0 : 1), ny + (ddy >= 0 ? 0 : 1)];
        break outer;
      }
    }
    if (!targetCorner) {
      // Just pick a random covered corner nearby
      const startCorner = tileCorners[Math.floor(rng() * tileCorners.length)];
      targetCorner = [Math.round((gridW) / 2), Math.round((gridW) / 2)];
      const path = aStarEdge(adj, startCorner[0], startCorner[1], targetCorner[0], targetCorner[1]);
      if (path && path.length > 1) {
        // Only keep the first 3 segments
        const shortPath = path.slice(0, Math.min(path.length, 4));
        streets.push(shortPath);
        for (let i = 0; i < shortPath.length - 1; i++) {
          coveredEdges.add(edgeKey(shortPath[i][0], shortPath[i][1], shortPath[i + 1][0], shortPath[i + 1][1]));
        }
      }
    } else {
      const startCorner = tileCorners[Math.floor(rng() * tileCorners.length)];
      const path = aStarEdge(adj, startCorner[0], startCorner[1], targetCorner[0], targetCorner[1]);
      if (path && path.length > 1) {
        streets.push(path);
        for (let i = 0; i < path.length - 1; i++) {
          coveredEdges.add(edgeKey(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]));
        }
      }
    }

    unserved = getUnserved();
  }

  return streets;
}

// ── Bridge detection ──

function findBridges(
  roads: [number, number][][],
  riverEdgeSet: Set<string>,
): [[number, number], [number, number]][] {
  const bridges: [[number, number], [number, number]][] = [];
  const seen = new Set<string>();
  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const k = edgeKey(road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]);
      if (riverEdgeSet.has(k) && !seen.has(k)) {
        seen.add(k);
        bridges.push([road[i], road[i + 1]]);
      }
    }
  }
  return bridges;
}

// ── Block flood-fill ──

function computeWaterTiles(
  river: { edges: [[number, number], [number, number]][]; islands: Set<string> } | null,
): Set<string> {
  const waterTiles = new Set<string>();
  if (!river) return waterTiles;
  for (const [a, b] of river.edges) {
    if (a[1] === b[1]) {
      const tx = Math.min(a[0], b[0]);
      const k1 = tileKey(tx, a[1] - 1);
      const k2 = tileKey(tx, a[1]);
      if (!river.islands.has(k1)) waterTiles.add(k1);
      if (!river.islands.has(k2)) waterTiles.add(k2);
    } else {
      const ty = Math.min(a[1], b[1]);
      const k1 = tileKey(a[0] - 1, ty);
      const k2 = tileKey(a[0], ty);
      if (!river.islands.has(k1)) waterTiles.add(k1);
      if (!river.islands.has(k2)) waterTiles.add(k2);
    }
  }
  return waterTiles;
}

function buildBarrierSet(
  wallPath: [number, number][],
  roads: [number, number][][],
  streets: [number, number][][],
  river: { edges: [[number, number], [number, number]][]; islands: Set<string> } | null,
): Set<string> {
  const barriers = new Set<string>();
  for (let i = 0; i < wallPath.length - 1; i++) {
    const a = wallPath[i];
    const b = wallPath[i + 1];
    barriers.add(edgeKey(a[0], a[1], b[0], b[1]));
  }
  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      barriers.add(edgeKey(road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]));
    }
  }
  for (const street of streets) {
    for (let i = 0; i < street.length - 1; i++) {
      barriers.add(edgeKey(street[i][0], street[i][1], street[i + 1][0], street[i + 1][1]));
    }
  }
  if (river) {
    for (const [a, b] of river.edges) {
      barriers.add(edgeKey(a[0], a[1], b[0], b[1]));
    }
  }
  return barriers;
}

function generateBlocks(
  interior: Set<string>,
  waterTiles: Set<string>,
  barriers: Set<string>,
  gridW: number,
  env: CityEnvironment,
  rng: () => number,
): CityBlock[] {
  const visited = new Set<string>();
  const blocks: CityBlock[] = [];

  for (let y = 0; y < gridW; y++) {
    for (let x = 0; x < gridW; x++) {
      const k = tileKey(x, y);
      if (visited.has(k)) continue;
      visited.add(k);
      if (waterTiles.has(k)) continue;

      const tiles: [number, number][] = [];
      const queue: [number, number][] = [[x, y]];
      while (queue.length > 0) {
        const [tx, ty] = queue.shift()!;
        tiles.push([tx, ty]);
        // Right neighbor: shared edge (tx+1, ty) → (tx+1, ty+1)
        const rightEdge = edgeKey(tx + 1, ty, tx + 1, ty + 1);
        // Left neighbor: shared edge (tx, ty) → (tx, ty+1)
        const leftEdge = edgeKey(tx, ty, tx, ty + 1);
        // Bottom neighbor: shared edge (tx, ty+1) → (tx+1, ty+1)
        const bottomEdge = edgeKey(tx, ty + 1, tx + 1, ty + 1);
        // Top neighbor: shared edge (tx, ty) → (tx+1, ty)
        const topEdge = edgeKey(tx, ty, tx + 1, ty);
        const neighbors: [number, number, string][] = [
          [tx + 1, ty, rightEdge],
          [tx - 1, ty, leftEdge],
          [tx, ty + 1, bottomEdge],
          [tx, ty - 1, topEdge],
        ];
        for (const [nx, ny, e] of neighbors) {
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridW) continue;
          const nk = tileKey(nx, ny);
          if (visited.has(nk)) continue;
          if (barriers.has(e)) continue;
          if (waterTiles.has(nk)) { visited.add(nk); continue; }
          visited.add(nk);
          queue.push([nx, ny]);
        }
      }

      if (tiles.length > 0) {
        blocks.push({ tiles, role: 'residential', name: '' });
      }
    }
  }

  assignBlockRoles(blocks, interior, env, gridW);
  const usedNames = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].name = generateBlockName(i, blocks[i].role, rng, usedNames);
  }
  return blocks;
}

function blockCentroid(b: CityBlock): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of b.tiles) {
    sx += x + 0.5;
    sy += y + 0.5;
  }
  return [sx / b.tiles.length, sy / b.tiles.length];
}

function assignBlockRoles(
  blocks: CityBlock[],
  interior: Set<string>,
  env: CityEnvironment,
  gridW: number,
): void {
  const cx = (gridW - 1) / 2 + 0.5;
  const cy = (gridW - 1) / 2 + 0.5;

  const interiorBlocks: CityBlock[] = [];
  const exteriorBlocks: CityBlock[] = [];
  for (const b of blocks) {
    const inside = b.tiles.filter(t => interior.has(tileKey(t[0], t[1]))).length;
    if (inside * 2 >= b.tiles.length) interiorBlocks.push(b);
    else exteriorBlocks.push(b);
  }

  const isHarborBlock = (b: CityBlock): boolean => {
    if (!env.waterSide) return false;
    const [bx, by] = blockCentroid(b);
    const threshold = gridW * 0.3;
    switch (env.waterSide) {
      case 'north': return by < threshold;
      case 'south': return by > gridW - threshold;
      case 'west': return bx < threshold;
      case 'east': return bx > gridW - threshold;
    }
  };

  const scored = interiorBlocks.map(b => {
    const [bx, by] = blockCentroid(b);
    return { b, d: Math.hypot(bx - cx, by - cy) };
  }).sort((a, b) => a.d - b.d);

  const marketCount =
    env.size === 'small' ? 1 :
    env.size === 'medium' ? 1 :
    env.size === 'large' ? 2 :
    env.size === 'metropolis' ? 2 : 3;

  for (let i = 0; i < scored.length; i++) {
    const entry = scored[i];
    if (i === 0) entry.b.role = 'civic';
    else if (i <= marketCount) entry.b.role = 'market';
    else if (isHarborBlock(entry.b)) entry.b.role = 'harbor';
    else entry.b.role = 'residential';
  }

  const slumThreshold = Math.max(6, Math.round(gridW / 4));
  for (const b of exteriorBlocks) {
    let touchesInterior = false;
    for (const [x, y] of b.tiles) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (interior.has(tileKey(x + dx, y + dy))) { touchesInterior = true; break; }
      }
      if (touchesInterior) break;
    }
    b.role = touchesInterior && b.tiles.length <= slumThreshold ? 'slum' : 'agricultural';
  }
}

// ── Medieval name combiner ──

const NAME_PREFIXES = [
  'ELM', 'OAK', 'ASH', 'ROSE', 'BRIAR', 'THORN',
  'BLUE', 'RED', 'GOLD', 'GREEN', 'WHITE', 'BLACK', 'SILVER', 'COPPER', 'IRON',
  'OLD', 'NEW', 'HIGH', 'LOW', 'FAR',
  'STONE', 'BRICK', 'GLASS', 'BREAD', 'SALT', 'WINE', 'CORN',
  'KING', 'QUEEN', 'BISHOP', 'ABBEY', 'GUILD',
];

const SUFFIXES_CIVIC = ['CROSS', 'COURT', 'SQUARE', 'GATE'];
const SUFFIXES_MARKET = ['MARKET', 'CROSS', 'SQUARE', 'ROW'];
const SUFFIXES_HARBOR = ['DOCKS', 'QUAY', 'WHARF', 'BANK'];
const SUFFIXES_RESIDENTIAL = ['LANE', 'ROW', 'END', 'HOLM', 'SIDE', 'YARD', 'HILL', 'HEATH', 'GATE'];
const SUFFIXES_SLUM = ['ROW', 'END', 'HEATH', 'LANE', 'SIDE'];
const SUFFIXES_AGRI = ['FIELDS', 'CROFT', 'MEADOW', 'ACRES'];

function suffixesForRole(role: DistrictRole): string[] {
  switch (role) {
    case 'civic': return SUFFIXES_CIVIC;
    case 'market': return SUFFIXES_MARKET;
    case 'harbor': return SUFFIXES_HARBOR;
    case 'slum': return SUFFIXES_SLUM;
    case 'agricultural': return SUFFIXES_AGRI;
    default: return SUFFIXES_RESIDENTIAL;
  }
}

function generateBlockName(
  index: number,
  role: DistrictRole,
  rng: () => number,
  used: Set<string>,
): string {
  const suffixes = suffixesForRole(role);
  for (let attempt = 0; attempt < 12; attempt++) {
    const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const suffix = suffixes[Math.floor(rng() * suffixes.length)];
    const joiner = rng() < 0.35 ? ' ' : '';
    const name = prefix + joiner + suffix;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `DISTRICT ${index + 1}`;
  used.add(fallback);
  return fallback;
}

// ── Open spaces ──

function generateOpenSpaces(
  blocks: CityBlock[],
  waterTiles: Set<string>,
  reservedTiles: Set<string>,
  env: CityEnvironment,
  gridW: number,
  rng: () => number,
): { kind: 'square' | 'market' | 'park'; tiles: [number, number][] }[] {
  const spaces: { kind: 'square' | 'market' | 'park'; tiles: [number, number][] }[] = [];
  const cx = (gridW - 1) / 2 + 0.5;
  const cy = (gridW - 1) / 2 + 0.5;

  const isFree = (t: [number, number]): boolean =>
    !reservedTiles.has(tileKey(t[0], t[1])) && !waterTiles.has(tileKey(t[0], t[1]));

  const civicBlock = blocks.find(b => b.role === 'civic');
  if (civicBlock) {
    const sorted = civicBlock.tiles
      .filter(isFree)
      .sort((a, b) => {
        const da = Math.hypot(a[0] + 0.5 - cx, a[1] + 0.5 - cy);
        const db = Math.hypot(b[0] + 0.5 - cx, b[1] + 0.5 - cy);
        return da - db;
      });
    const pickCount = env.size === 'small' ? 1 : 2;
    const picks = sorted.slice(0, Math.min(pickCount, sorted.length));
    if (picks.length > 0) {
      spaces.push({ kind: 'square', tiles: picks });
      for (const t of picks) reservedTiles.add(tileKey(t[0], t[1]));
    }
  }

  for (const b of blocks) {
    if (b.role !== 'market') continue;
    const free = b.tiles.filter(isFree);
    if (free.length === 0) continue;
    const t = free[Math.floor(rng() * free.length)];
    spaces.push({ kind: 'market', tiles: [t] });
    reservedTiles.add(tileKey(t[0], t[1]));
  }

  const parkCount =
    env.size === 'small' ? 1 :
    env.size === 'medium' ? 1 :
    env.size === 'large' ? 2 :
    env.size === 'metropolis' ? 3 : 3;
  const resBlocks = blocks.filter(b => b.role === 'residential');
  for (let i = 0; i < parkCount; i++) {
    if (resBlocks.length === 0) break;
    const b = resBlocks[Math.floor(rng() * resBlocks.length)];
    const free = b.tiles.filter(isFree);
    if (free.length === 0) continue;
    const t = free[Math.floor(rng() * free.length)];
    spaces.push({ kind: 'park', tiles: [t] });
    reservedTiles.add(tileKey(t[0], t[1]));
  }

  return spaces;
}

// ── Landmarks ──

function generateLandmarks(
  blocks: CityBlock[],
  openSpaces: { kind: 'square' | 'market' | 'park'; tiles: [number, number][] }[],
  reservedTiles: Set<string>,
  env: CityEnvironment,
  gridW: number,
  rng: () => number,
): CityLandmark[] {
  const landmarks: CityLandmark[] = [];
  const cx = (gridW - 1) / 2 + 0.5;
  const cy = (gridW - 1) / 2 + 0.5;
  const placed = new Set<string>();
  const markPlaced = (t: [number, number]) => {
    placed.add(tileKey(t[0], t[1]));
    reservedTiles.add(tileKey(t[0], t[1]));
  };

  const byDistanceToCenter = (tiles: [number, number][]): [number, number][] =>
    [...tiles].sort((a, b) => {
      const da = Math.hypot(a[0] + 0.5 - cx, a[1] + 0.5 - cy);
      const db = Math.hypot(b[0] + 0.5 - cx, b[1] + 0.5 - cy);
      return da - db;
    });

  const civicBlocks = blocks.filter(b => b.role === 'civic');
  const marketBlocks = blocks.filter(b => b.role === 'market');

  if (env.isCapital && civicBlocks.length > 0) {
    const bigEnough =
      env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
    const capitalTypes: ('castle' | 'palace')[] = bigEnough
      ? ['castle', 'palace']
      : [rng() < 0.5 ? 'castle' : 'palace'];

    const civicTiles = byDistanceToCenter(
      civicBlocks.flatMap(b => b.tiles).filter(t => !placed.has(tileKey(t[0], t[1]))),
    );
    for (const type of capitalTypes) {
      const t = civicTiles.shift();
      if (!t) break;
      landmarks.push({ tile: t, type });
      markPlaced(t);
    }
  }

  const civicAndMarket = [
    ...civicBlocks.flatMap(b => b.tiles),
    ...marketBlocks.flatMap(b => b.tiles),
  ];

  for (let i = 0; i < env.religionCount; i++) {
    const candidates = civicAndMarket.filter(t => !placed.has(tileKey(t[0], t[1])));
    if (candidates.length === 0) break;
    const t = candidates[Math.floor(rng() * candidates.length)];
    landmarks.push({ tile: t, type: 'temple' });
    markPlaced(t);
  }

  const squareTiles = openSpaces
    .filter(s => s.kind === 'square' || s.kind === 'market')
    .flatMap(s => s.tiles);
  for (let i = 0; i < env.wonderCount; i++) {
    const pool = [
      ...squareTiles,
      ...civicAndMarket,
    ].filter(t => !placed.has(tileKey(t[0], t[1])));
    if (pool.length === 0) break;
    const t = pool[Math.floor(rng() * pool.length)];
    landmarks.push({ tile: t, type: 'monument' });
    // Monuments may share an open-space tile with the square itself but not with another landmark.
    placed.add(tileKey(t[0], t[1]));
  }

  return landmarks;
}

// ── Main generator ──

export function generateCityMap(seed: string, cityName: string, env: CityEnvironment): CityMapData {
  const gridW = GRID_SIZES[env.size];
  const tileSize = CANVAS_SIZE / gridW;

  const rng = seededPRNG(seed + '_city_' + cityName);

  const interior = generateWallFootprint(seed, cityName, env, gridW);
  const wallEdges = collectWallEdges(interior);
  const wallPath = chainWallPath(wallEdges);
  const gates = pickGates(wallPath, env.waterSide, gridW);

  const river = generateRiver(env, interior, gridW, rng);
  const riverEdgeSet = new Set<string>(river?.edges.map(([a, b]) => edgeKey(a[0], a[1], b[0], b[1])) ?? []);

  const roads = generateRoads(gates, interior, riverEdgeSet, gridW, rng);
  const streets = generateStreets(interior, roads, riverEdgeSet, gridW, rng);
  const bridges = findBridges(roads, riverEdgeSet);

  const waterTiles = computeWaterTiles(river);
  const barriers = buildBarrierSet(wallPath, roads, streets, river);
  const blocks = generateBlocks(interior, waterTiles, barriers, gridW, env, rng);

  const reservedTiles = new Set<string>();
  const openSpaces = generateOpenSpaces(blocks, waterTiles, reservedTiles, env, gridW, rng);
  const landmarks = generateLandmarks(blocks, openSpaces, reservedTiles, env, gridW, rng);

  return {
    grid: { w: gridW, h: gridW, tileSize },
    wallPath,
    gates,
    river,
    bridges,
    roads,
    streets,
    blocks,
    openSpaces,
    buildings: [],
    landmarks,
    districtLabels: [],
    canvasSize: CANVAS_SIZE,
  };
}
