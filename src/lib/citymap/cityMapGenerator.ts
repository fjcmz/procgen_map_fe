import type { BiomeType, Cell, City, MapData } from '../types';
import { buildCellGraph } from '../terrain/voronoi';
import { seededPRNG, createNoiseSamplers, fbm } from '../terrain/noise';
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
  hasWonder: boolean;
  hasReligion: boolean;
  isRuin: boolean;
  neighborBiomes: BiomeType[];
}

export interface CityDistrict {
  index: number;
  x: number;
  y: number;
  vertices: [number, number][];
  neighbors: number[];
  role: DistrictRole;
  /** 0–1, distance from center normalized */
  distFromCenter: number;
}

export interface CityBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  districtIndex: number;
}

export interface CityLandmark {
  x: number;
  y: number;
  type: 'castle' | 'temple' | 'monument';
}

export interface CityMapData {
  districts: CityDistrict[];
  walls: [number, number][] | null;
  gates: [number, number][];
  river: { path: [number, number][]; width: number } | null;
  bridges: [number, number][][];
  buildings: CityBuilding[];
  landmarks: CityLandmark[];
  mainRoads: [number, number][][];
  canvasSize: number;
}

// ── Constants ──

const CANVAS_SIZE = 720;
const CITY_MARGIN = CANVAS_SIZE * 0.15; // fringe area

const DISTRICT_COUNTS: Record<CitySize, number> = {
  small: 15,
  medium: 25,
  large: 40,
  metropolis: 60,
  megalopolis: 80,
};

const BUILDING_DENSITY: Record<CitySize, number> = {
  small: 0.3,
  medium: 0.5,
  large: 0.65,
  metropolis: 0.8,
  megalopolis: 0.9,
};

// ── Helpers ──

function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function offsetPolygon(poly: [number, number][], amount: number): [number, number][] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [x + (dx / len) * amount, y + (dy / len) * amount] as [number, number];
  });
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Find the shared edge between two Voronoi districts */
function findSharedEdge(a: CityDistrict, b: CityDistrict): [[number, number], [number, number]] | null {
  const eps = 1.5;
  for (let i = 0; i < a.vertices.length; i++) {
    for (let j = 0; j < b.vertices.length; j++) {
      if (dist(a.vertices[i], b.vertices[j]) < eps) {
        // Found a shared vertex, look for the second one
        const ai2 = (i + 1) % a.vertices.length;
        for (let k = 0; k < b.vertices.length; k++) {
          if (k === j) continue;
          if (dist(a.vertices[ai2], b.vertices[k]) < eps) {
            return [a.vertices[i], a.vertices[ai2]];
          }
        }
        const ai0 = (i - 1 + a.vertices.length) % a.vertices.length;
        for (let k = 0; k < b.vertices.length; k++) {
          if (k === j) continue;
          if (dist(a.vertices[ai0], b.vertices[k]) < eps) {
            return [a.vertices[ai0], a.vertices[i]];
          }
        }
      }
    }
  }
  return null;
}

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
    hasWonder: wonderCellIndices ? wonderCellIndices.includes(city.cellIndex) : false,
    hasReligion: religionCellIndices ? religionCellIndices.includes(city.cellIndex) : false,
    isRuin,
    neighborBiomes: neighborCells.map(n => n.biome),
  };
}

// ── Main generator ──

export function generateCityMap(seed: string, cityName: string, env: CityEnvironment): CityMapData {
  const rng = seededPRNG(seed + '_city_' + cityName);
  const noise = createNoiseSamplers(seed + '_city_' + cityName);

  const size = CANVAS_SIZE;
  const numDistricts = DISTRICT_COUNTS[env.size];

  // Generate Voronoi cells for districts
  const innerSize = size - CITY_MARGIN * 2;
  const cellGraph = buildCellGraph(seed + '_city_' + cityName, numDistricts, innerSize, innerSize);

  // Offset cells into the canvas center
  const cx = size / 2;
  const cy = size / 2;
  const offsetX = CITY_MARGIN;
  const offsetY = CITY_MARGIN;

  const districts: CityDistrict[] = cellGraph.cells.map(c => {
    const x = c.x + offsetX;
    const y = c.y + offsetY;
    const vertices = c.vertices.map(([vx, vy]) => [vx + offsetX, vy + offsetY] as [number, number]);
    const dx = x - cx;
    const dy = y - cy;
    const distFromCenter = Math.sqrt(dx * dx + dy * dy) / (innerSize / 2);
    return {
      index: c.index,
      x,
      y,
      vertices,
      neighbors: c.neighbors,
      role: 'residential' as DistrictRole,
      distFromCenter,
    };
  });

  // Assign district roles
  assignDistrictRoles(districts, env, rng);

  // Generate walls for medium+ cities
  const hasWalls = env.size !== 'small';
  let walls: [number, number][] | null = null;
  let gates: [number, number][] = [];

  if (hasWalls) {
    // Get outermost district centers
    const outerDistricts = districts
      .filter(d => d.distFromCenter > 0.55)
      .sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
      });

    if (outerDistricts.length >= 3) {
      const hullPts = outerDistricts.map(d => [d.x, d.y] as [number, number]);
      const hull = convexHull(hullPts);
      walls = offsetPolygon(hull, 15);

      // Add noise to wall vertices for organic look
      for (let i = 0; i < walls.length; i++) {
        const n = fbm(noise.elevation, walls[i][0] * 0.02, walls[i][1] * 0.02, 2);
        walls[i][0] += (n - 0.5) * 12;
        walls[i][1] += (n - 0.5) * 12;
      }

      // Place gates — one per cardinal direction (if wall extends that way)
      const directions: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [dirX, dirY] of directions) {
        // Skip gate on water side
        if (env.waterSide === 'north' && dirY < 0) continue;
        if (env.waterSide === 'south' && dirY > 0) continue;
        if (env.waterSide === 'east' && dirX > 0) continue;
        if (env.waterSide === 'west' && dirX < 0) continue;

        let bestIdx = 0;
        let bestDot = -Infinity;
        for (let i = 0; i < walls.length; i++) {
          const wx = walls[i][0] - cx;
          const wy = walls[i][1] - cy;
          const dot = wx * dirX + wy * dirY;
          if (dot > bestDot) {
            bestDot = dot;
            bestIdx = i;
          }
        }
        // Gate at midpoint of this wall segment
        const next = (bestIdx + 1) % walls.length;
        gates.push(lerp(walls[bestIdx], walls[next], 0.5));
      }
    }
  }

  // Generate river
  let river: CityMapData['river'] = null;
  const bridges: [number, number][][] = [];
  if (env.hasRiver) {
    const riverWidth = env.size === 'small' ? 6 : env.size === 'medium' ? 8 : 10;
    // River flows roughly through the center with some curve
    const entryEdge = rng() < 0.5 ? 'top' : 'left';
    const path: [number, number][] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let rx: number, ry: number;
      if (entryEdge === 'top') {
        rx = cx + (rng() - 0.5) * 40 + Math.sin(t * Math.PI) * 30 * (rng() > 0.5 ? 1 : -1);
        ry = t * size;
      } else {
        rx = t * size;
        ry = cy + (rng() - 0.5) * 40 + Math.sin(t * Math.PI) * 30 * (rng() > 0.5 ? 1 : -1);
      }
      path.push([rx, ry]);
    }
    river = { path, width: riverWidth };

    // Bridges where main roads would cross the river
    if (gates.length > 0) {
      for (const gate of gates) {
        // Find closest river segment to this gate-center line
        let closestPt: [number, number] | null = null;
        let closestDist = Infinity;
        for (const rp of path) {
          const d = dist(rp, [cx, cy]);
          const gd = dist(rp, gate);
          const combined = d + gd;
          if (combined < closestDist) {
            closestDist = combined;
            closestPt = rp;
          }
        }
        if (closestPt) {
          const bridgeHalf = riverWidth * 1.5;
          // Perpendicular bridge
          const idx = path.indexOf(closestPt);
          const prev = path[Math.max(0, idx - 1)];
          const next = path[Math.min(path.length - 1, idx + 1)];
          const dx = next[0] - prev[0];
          const dy = next[1] - prev[1];
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          bridges.push([
            [closestPt[0] + nx * bridgeHalf, closestPt[1] + ny * bridgeHalf],
            [closestPt[0] - nx * bridgeHalf, closestPt[1] - ny * bridgeHalf],
          ]);
        }
      }
    }
  }

  // Generate main roads (gate → center)
  const mainRoads: [number, number][][] = [];
  for (const gate of gates) {
    const road: [number, number][] = [gate];
    // Add a slight curve via midpoint
    const mid = lerp(gate, [cx, cy], 0.5);
    mid[0] += (rng() - 0.5) * 20;
    mid[1] += (rng() - 0.5) * 20;
    road.push(mid);
    road.push([cx, cy]);
    mainRoads.push(road);
  }

  // Generate buildings
  const buildings = generateBuildings(districts, env, rng, river);

  // Generate landmarks
  const landmarks: CityLandmark[] = [];
  // Castle for capitals
  if (env.isCapital) {
    const centerDistrict = districts.reduce((best, d) =>
      d.distFromCenter < best.distFromCenter ? d : best, districts[0]);
    landmarks.push({ x: centerDistrict.x, y: centerDistrict.y, type: 'castle' });
  }
  // Temple for religion
  if (env.hasReligion) {
    const candidates = districts.filter(d => d.role === 'civic' || d.distFromCenter < 0.4);
    const templeD = candidates.length > 0 ? candidates[Math.floor(rng() * candidates.length)] : districts[0];
    landmarks.push({
      x: templeD.x + (rng() - 0.5) * 10,
      y: templeD.y + (rng() - 0.5) * 10,
      type: 'temple',
    });
  }
  // Monument for wonders
  if (env.hasWonder) {
    const civicDs = districts.filter(d => d.role === 'civic' || d.role === 'market');
    const wonderD = civicDs.length > 0 ? civicDs[Math.floor(rng() * civicDs.length)] : districts[1 % districts.length];
    landmarks.push({
      x: wonderD.x + (rng() - 0.5) * 8,
      y: wonderD.y + (rng() - 0.5) * 8,
      type: 'monument',
    });
  }

  return {
    districts,
    walls,
    gates,
    river,
    bridges,
    buildings,
    landmarks,
    mainRoads,
    canvasSize: size,
  };
}

// ── District role assignment ──

function assignDistrictRoles(districts: CityDistrict[], env: CityEnvironment, rng: () => number): void {
  // Center = civic/market
  const sorted = districts.slice().sort((a, b) => a.distFromCenter - b.distFromCenter);

  // Closest to center: civic
  const civicCount = Math.max(1, Math.floor(districts.length * 0.08));
  for (let i = 0; i < civicCount && i < sorted.length; i++) {
    sorted[i].role = 'civic';
  }

  // Next ring: market
  const marketCount = Math.max(1, Math.floor(districts.length * 0.12));
  for (let i = civicCount; i < civicCount + marketCount && i < sorted.length; i++) {
    sorted[i].role = 'market';
  }

  // Harbor districts near water side
  if (env.isCoastal && env.waterSide) {
    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;
    for (const d of districts) {
      const dx = d.x - cx;
      const dy = d.y - cy;
      const isNearWater =
        (env.waterSide === 'north' && dy < -CANVAS_SIZE * 0.2) ||
        (env.waterSide === 'south' && dy > CANVAS_SIZE * 0.2) ||
        (env.waterSide === 'east' && dx > CANVAS_SIZE * 0.2) ||
        (env.waterSide === 'west' && dx < -CANVAS_SIZE * 0.2);
      if (isNearWater && d.role === 'residential') {
        d.role = 'harbor';
      }
    }
  }

  // Outer ring: agricultural (for non-desert/ice biomes) or slum
  for (const d of districts) {
    if (d.role !== 'residential') continue;
    if (d.distFromCenter > 0.75) {
      if (env.biome.includes('DESERT') || env.biome === 'ICE' || env.biome === 'SNOW') {
        d.role = rng() < 0.5 ? 'slum' : 'residential';
      } else {
        d.role = rng() < 0.4 ? 'agricultural' : 'residential';
      }
    }
  }
}

// ── Building generation ──

function generateBuildings(
  districts: CityDistrict[],
  env: CityEnvironment,
  rng: () => number,
  river: CityMapData['river'],
): CityBuilding[] {
  const buildings: CityBuilding[] = [];
  const density = BUILDING_DENSITY[env.size];

  for (const d of districts) {
    if (d.role === 'agricultural') continue; // no buildings in fields

    // Compute bounding box of district
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [vx, vy] of d.vertices) {
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
    }

    // Density scales with proximity to center
    const localDensity = density * (1 - d.distFromCenter * 0.5);
    const area = (maxX - minX) * (maxY - minY);
    const numBuildings = Math.floor(area * localDensity * 0.003);

    // Building sizes by role
    const sizeScale = d.role === 'civic' ? 1.4 : d.role === 'market' ? 1.2 : d.role === 'slum' ? 0.7 : 1.0;

    for (let i = 0; i < numBuildings; i++) {
      const bx = minX + rng() * (maxX - minX);
      const by = minY + rng() * (maxY - minY);

      // Skip if outside district polygon (simple point-in-polygon)
      if (!pointInPolygon(bx, by, d.vertices)) continue;

      // Skip if in river area
      if (river) {
        let nearRiver = false;
        for (const [rx, ry] of river.path) {
          if (Math.abs(bx - rx) < river.width * 1.5 && Math.abs(by - ry) < river.width * 1.5) {
            nearRiver = true;
            break;
          }
        }
        if (nearRiver) continue;
      }

      const baseW = 3 + rng() * 5;
      const baseH = 3 + rng() * 5;
      buildings.push({
        x: bx,
        y: by,
        w: baseW * sizeScale,
        h: baseH * sizeScale,
        rotation: (rng() - 0.5) * 0.3,
        districtIndex: d.index,
      });
    }
  }

  return buildings;
}

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Export for use by renderer
export { findSharedEdge };
