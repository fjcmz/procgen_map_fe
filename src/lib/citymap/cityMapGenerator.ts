import type { BiomeType, Cell, City, MapData } from '../types';
import { createNoiseSamplers, fbm } from '../terrain/noise';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';

// ── Public types ──

export type CitySize = 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';

export type DistrictRole = 'market' | 'residential' | 'civic' | 'harbor' | 'agricultural' | 'slum';

export interface CityEnvironment {
  biome: BiomeType;
  isCoastal: boolean;
  hasRiver: boolean;
  waterSide: 'north' | 'south' | 'east' | 'west' | null;
  elevation: number;
  moisture: number;
  temperature: number;
  isCapital: boolean;
  size: CitySize;
  wonderCount: number;
  religionCount: number;
  isRuin: boolean;
  neighborBiomes: BiomeType[];
}

export interface CityBlock {
  tiles: [number, number][];
  role: DistrictRole;
  name: string;
}

export interface CityBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
}

export interface CityLandmark {
  tile: [number, number];
  type: 'castle' | 'palace' | 'temple' | 'monument';
}

export interface CityMapData {
  grid: { w: number; h: number; tileSize: number };
  wallPath: [number, number][];
  gates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' }[];
  river: { edges: [[number, number], [number, number]][]; islands: Set<string> } | null;
  bridges: [[number, number], [number, number]][];
  roads: [number, number][][];
  streets: [number, number][][];
  blocks: CityBlock[];
  openSpaces: { kind: 'square' | 'market' | 'park'; tiles: [number, number][] }[];
  buildings: CityBuilding[];
  landmarks: CityLandmark[];
  districtLabels: { text: string; cx: number; cy: number; angle: number }[];
  canvasSize: number;
}

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

// ── Main generator ──

export function generateCityMap(seed: string, cityName: string, env: CityEnvironment): CityMapData {
  const gridW = GRID_SIZES[env.size];
  const tileSize = CANVAS_SIZE / gridW;

  const interior = generateWallFootprint(seed, cityName, env, gridW);
  const wallEdges = collectWallEdges(interior);
  const wallPath = chainWallPath(wallEdges);
  const gates = pickGates(wallPath, env.waterSide, gridW);

  return {
    grid: { w: gridW, h: gridW, tileSize },
    wallPath,
    gates,
    river: null,
    bridges: [],
    roads: [],
    streets: [],
    blocks: [],
    openSpaces: [],
    buildings: [],
    landmarks: [],
    districtLabels: [],
    canvasSize: CANVAS_SIZE,
  };
}
