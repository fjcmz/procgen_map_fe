// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 generator — Voronoi-polygon foundation
// ─────────────────────────────────────────────────────────────────────────────
// PR 1 (specs/City_style_phases.md) — returns a CityMapDataV2 populated with a
// full Voronoi polygon graph sized by city tier (150/250/350/500/1000) and
// placeholder arrays for every geometric feature PR 2-5 will add.
//
// The polygon graph is this generator's PRIMARY OUTPUT. Walls (PR 2), rivers
// and roads (PR 3), blocks and landmarks (PR 4), buildings and labels (PR 5)
// all read `polygons[].vertices` / `polygons[].neighbors` / `polygons[].isEdge`
// / `polygons[].area`. Do NOT reintroduce a tile grid.
//
// Reference pattern: src/lib/terrain/voronoi.ts::buildCellGraph — copy the D3
// + Lloyd-relaxation recipe but strip the ghost-point / east-west wrapping
// logic (cities are bounded, not toroidal).
// ─────────────────────────────────────────────────────────────────────────────

import { Delaunay } from 'd3-delaunay';
import { seededPRNG } from '../terrain/noise';
import type { Cell, City, MapData, WonderSnapshotEntry } from '../types';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';
import type {
  CityBlockV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
  CitySize,
} from './cityMapTypesV2';
import { generateWallsAndGates, type WallConfig } from './cityMapWalls';
import { selectCityFootprint } from './cityMapShape';
import {
  buildPolygonEdgeGraph,
  aStarEdgeGraph,
  keyPathToPoints,
  nearestVertexKey,
  type EdgeNeighbor,
  type Point,
  type PolygonEdgeGraph,
} from './cityMapEdgeGraph';
import { generateRiver } from './cityMapRiver';
import { generateNetwork } from './cityMapNetwork';
import { generateOpenSpaces } from './cityMapOpenSpaces';
import { generateBlocks, assignCraftRoles, buildBlocksFromDistricts } from './cityMapBlocks';
import { assignSFHRoles } from './cityMapSFHQuarters';
import { assignMilitaryRoles } from './cityMapMilitaryQuarters';
import { assignTradeFinanceRoles } from './cityMapTradeFinanceQuarters';
import { assignEntertainmentRoles } from './cityMapEntertainmentQuarters';
import { assignExcludedRoles } from './cityMapExcludedQuarters';
import { generateLandmarks } from './cityMapLandmarks';
import { generateBuildings } from './cityMapBuildings';
import { generateSprawl } from './cityMapSprawl';
import { generateWaterPolygons } from './cityMapWater';
import { generateMountainPolygons } from './cityMapMountains';
import { buildCandidatePool } from './cityMapCandidatePool';
import { placeUnifiedLandmarks } from './cityMapLandmarksUnified';
import { assignDistricts } from './cityMapDistricts';

// ── Environment derivation ──

export function deriveCityEnvironment(
  city: City,
  cells: Cell[],
  mapData: MapData,
  citySizesAtYear?: Uint8Array,
  selectedYear?: number,
  wonderEntries?: WonderSnapshotEntry[],
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
    wonderCount: wonderEntries?.filter(e => e.cellIndex === city.cellIndex).length ?? 0,
    wonderNames: wonderEntries?.filter(e => e.cellIndex === city.cellIndex).map(e => e.name) ?? [],
    religionCount: religionCellIndices?.filter(i => i === city.cellIndex).length ?? 0,
    isRuin,
    neighborBiomes: neighborCells.map(n => n.biome),
    mountainDirection: findNearestMountainDirection(cell, cells),
  };
}

// Mountain threshold mirrors renderer.ts:655 — any land cell with
// elevation >= 0.75 is a mountain for icon rendering, so we reuse the same
// cutoff when deciding whether a city is "near mountains".
const MOUNTAIN_ELEVATION_THRESHOLD = 0.75;
// Spec: "Cities that are close to mountains (5 or less cells away from a
// mountain cell) should show some mountains". BFS over the cell neighbour
// graph up to this depth.
const MOUNTAIN_SEARCH_DEPTH = 5;

/**
 * BFS the world cell graph from the city's cell up to MOUNTAIN_SEARCH_DEPTH
 * hops, looking for the nearest cell with `elevation >= 0.75` (and not
 * water). Returns a unit direction vector from the city to that cell plus
 * the hop count; `null` when no mountain cell is within range.
 *
 * Ties on hop distance resolve by choosing the smallest cell index, which
 * keeps output deterministic across re-generations with the same seed.
 */
function findNearestMountainDirection(
  originCell: Cell,
  cells: Cell[],
): { dx: number; dy: number; distance: number } | null {
  const visited = new Set<number>([originCell.index]);
  let frontier: number[] = [originCell.index];
  for (let depth = 1; depth <= MOUNTAIN_SEARCH_DEPTH; depth++) {
    const next: number[] = [];
    let bestCellIdx = -1;
    for (const idx of frontier) {
      const cell = cells[idx];
      for (const nbIdx of cell.neighbors) {
        if (visited.has(nbIdx)) continue;
        visited.add(nbIdx);
        const nb = cells[nbIdx];
        if (!nb.isWater && nb.elevation >= MOUNTAIN_ELEVATION_THRESHOLD) {
          if (bestCellIdx === -1 || nbIdx < bestCellIdx) bestCellIdx = nbIdx;
        }
        next.push(nbIdx);
      }
    }
    if (bestCellIdx !== -1) {
      const target = cells[bestCellIdx];
      const dx = target.x - originCell.x;
      const dy = target.y - originCell.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) return null;
      return { dx: dx / len, dy: dy / len, distance: depth };
    }
    frontier = next;
  }
  return null;
}

// Every city renders on a fixed-size polygon canvas regardless of city
// tier. The CITY itself (the polygons inside the walls) is allocated as a
// subset of these via `cityMapShape.ts::selectCityFootprint`, with the
// per-tier subset count coming from `POLYGON_COUNTS` below. The rest of
// the canvas (~500–1350 polygons) hosts outside-walls sprawl,
// agricultural/slum blocks, gate-exiting roads, and any other extramural
// detail.
export const CANVAS_POLYGON_COUNT = 3000;

// Single source of truth for the V2 CITY polygon counts per size tier.
// These now describe the in-wall city footprint (what
// `cityMapShape.ts::selectCityFootprint` allocates out of the
// `CANVAS_POLYGON_COUNT` total), not the canvas polygon count.
//
// Previously the wall coverage was a percentage roll over the canvas
// (`COVERAGE_MIN..MAX` lerp in `cityMapWalls.ts`); that percentage logic
// has been removed entirely. Allocation is now an absolute count from
// this table, grown organically from the canvas center outward.
export const POLYGON_COUNTS: Record<CitySize, number> = {
  small: 150,
  medium: 250,
  large: 350,
  metropolis: 500,
  megalopolis: 1000,
};

const CANVAS_SIZE = 1000;
const LLOYD_ROUNDS = 2;

// Spec: "limit where a landmark can be set to no more than 5 polygons away
// from the city." BFS hop limit from any city interior polygon.
const MOUNTAIN_LANDMARK_MAX_DISTANCE = 5;

/**
 * Multi-source BFS from every interior polygon outward through the polygon
 * adjacency graph. Returns the subset of `mountainPolygonIds` that are
 * reachable within `maxDistance` hops from any interior polygon.
 *
 * Used to restrict temple / monument placement on mountain polygons so
 * only foothills-range peaks (within MOUNTAIN_LANDMARK_MAX_DISTANCE steps
 * of the city wall) are eligible — distant peaks that the city would never
 * realistically claim are excluded.
 */
function findNearMountainPolygons(
  polygons: CityPolygon[],
  interiorPolygonIds: Set<number>,
  mountainPolygonIds: Set<number>,
  maxDistance: number,
): Set<number> {
  if (mountainPolygonIds.size === 0 || interiorPolygonIds.size === 0) {
    return new Set<number>();
  }
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const pid of interiorPolygonIds) {
    dist.set(pid, 0);
    queue.push(pid);
  }
  let head = 0;
  while (head < queue.length) {
    const pid = queue[head++];
    const d = dist.get(pid)!;
    if (d >= maxDistance) continue;
    for (const nb of polygons[pid].neighbors) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  const result = new Set<number>();
  for (const pid of mountainPolygonIds) {
    const d = dist.get(pid);
    if (d !== undefined && d <= maxDistance) result.add(pid);
  }
  return result;
}

/**
 * For each landmark placed on a mountain polygon, A* a street path from the
 * canvas center to that polygon's site vertex, allowing mountain polygon
 * edges (only water edges remain impassable). Returns additional path
 * segments to append to the main `streets` array.
 *
 * Spec: "if a landmark is set on mountains, there must be a street from
 * the city to that landmark."
 */
function generateMountainLandmarkStreets(
  polygons: CityPolygon[],
  graph: PolygonEdgeGraph,
  landmarks: CityLandmarkV2[],
  mountainPolygonIds: Set<number>,
  waterPolygonIds: Set<number>,
  canvasSize: number,
): Point[][] {
  const mountainLandmarks = landmarks.filter(lm => mountainPolygonIds.has(lm.polygonId));
  if (mountainLandmarks.length === 0) return [];

  // Build water-only edge block set. Mountain polygon edges are intentionally
  // NOT included so the path can traverse from the city into the mountain.
  const waterEdgeKeys = new Set<string>();
  for (const [eKey, rec] of graph.edges) {
    for (const pid of rec.polyIds) {
      if (waterPolygonIds.has(pid)) { waterEdgeKeys.add(eKey); break; }
    }
  }

  const centerKey = nearestVertexKey(graph, [canvasSize / 2, canvasSize / 2]);
  if (!centerKey) return [];

  const result: Point[][] = [];
  for (const lm of mountainLandmarks) {
    const lmPoly = polygons[lm.polygonId];
    const targetKey = nearestVertexKey(graph, lmPoly.site);
    if (!targetKey || targetKey === centerKey) continue;
    const costFn = (
      _currKey: string,
      _currPoint: Point,
      nb: EdgeNeighbor,
      _prevKey: string | null,
    ): number => (waterEdgeKeys.has(nb.edgeKey) ? Infinity : nb.edgeLen);
    const pathKeys = aStarEdgeGraph(graph, centerKey, targetKey, costFn);
    if (pathKeys && pathKeys.length >= 2) {
      result.push(keyPathToPoints(graph, pathKeys));
    }
  }
  return result;
}

// [Voronoi foundation] — builds the city's polygon graph from N seeded points.
//
// PR 3 lifted the shared polygon-edge helpers (`buildEdgeOwnership`,
// `buildPolygonEdgeGraph`, A*, edge-key canonicalization) out of
// `cityMapWalls.ts` into `cityMapEdgeGraph.ts` so walls / river / roads /
// streets all consume the same graph. Future PRs (4+) should keep that
// file as the single home for polygon-edge graph machinery rather than
// re-scoping helpers per feature file.
function buildCityPolygonGraph(
  voronoiSeed: string,
  numPolygons: number,
  canvasSize: number,
): CityPolygon[] {
  const rng = seededPRNG(voronoiSeed);

  // 1. Seed-random point cloud in [0, canvasSize]².
  let points: [number, number][] = [];
  for (let i = 0; i < numPolygons; i++) {
    points.push([rng() * canvasSize, rng() * canvasSize]);
  }

  // 2. Two rounds of Lloyd relaxation — matches terrain/voronoi.ts default.
  //    Three rounds over-regularizes and starts to look grid-like; 1 is too
  //    clumpy. No ghost points: cities don't wrap.
  for (let round = 0; round < LLOYD_ROUNDS; round++) {
    const d = Delaunay.from(points);
    const v = d.voronoi([0, 0, canvasSize, canvasSize]);
    const relaxed: [number, number][] = [];
    for (let i = 0; i < numPolygons; i++) {
      const poly = v.cellPolygon(i);
      if (!poly || poly.length < 4) {
        relaxed.push(points[i]);
        continue;
      }
      let cx = 0;
      let cy = 0;
      const n = poly.length - 1; // poly is closed (first == last)
      for (let j = 0; j < n; j++) {
        cx += poly[j][0];
        cy += poly[j][1];
      }
      relaxed.push([cx / n, cy / n]);
    }
    points = relaxed;
  }

  // 3. Final Delaunay + Voronoi, clipped to the canvas bbox.
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, canvasSize, canvasSize]);

  const polygons: CityPolygon[] = [];
  for (let i = 0; i < numPolygons; i++) {
    const ring = voronoi.cellPolygon(i);
    const vertices: [number, number][] = [];
    if (ring) {
      // Strip the closing vertex (D3 returns last === first).
      const n = ring.length - 1;
      for (let j = 0; j < n; j++) {
        vertices.push([ring[j][0], ring[j][1]]);
      }
    }

    // Adjacency — spread the generator once; repeat calls are not free.
    const neighbors: number[] = [];
    for (const nb of delaunay.neighbors(i)) {
      if (nb !== i) neighbors.push(nb);
    }

    // Edge test: any vertex lying on the canvas bounding box.
    let isEdge = false;
    for (const [vx, vy] of vertices) {
      if (vx <= 0 || vx >= canvasSize || vy <= 0 || vy >= canvasSize) {
        isEdge = true;
        break;
      }
    }

    // Shoelace area (signed → abs). Cheap to compute once at gen time so PR 4
    // doesn't re-walk every polygon for label sizing.
    let area = 0;
    const vn = vertices.length;
    for (let j = 0; j < vn; j++) {
      const [ax, ay] = vertices[j];
      const [bx, by] = vertices[(j + 1) % vn];
      area += ax * by - bx * ay;
    }
    area = Math.abs(area) * 0.5;

    polygons.push({
      id: i,
      site: [points[i][0], points[i][1]],
      vertices,
      neighbors,
      isEdge,
      area,
    });
  }

  return polygons;
}

/**
 * Generate the V2 city-map payload for a given city.
 *
 * PR 1 populates only the Voronoi polygon graph. PR 2-5 will layer walls,
 * rivers, roads, blocks, buildings, and landmarks on top of the same
 * polygons — see `CityMapDataV2`'s `// TODO PR N:` markers for the plan.
 *
 * Seeding: every RNG call routes through `seededPRNG` (never `Math.random`).
 * The polygon graph uses a dedicated `_voronoi` suffix so it stays decoupled
 * from PR 2-5 random streams (walls, rivers, etc.) and avoids cross-PR drift.
 */

// Roles that don't get district labels (exterior / docks / special ground).
// Mirrors the NO_DISTRICT_ICON set in the renderer.
const NO_LABEL_ROLES: ReadonlySet<string> = new Set([
  'slum', 'agricultural', 'dock', 'festival_grounds', 'gallows_hill',
]);

// [Voronoi-polygon] Compute `districtLabels` from the block list. For each
// interior block, derives a centroid (mean polygon site), a principal-axis
// angle via PCA of the polygon sites (so labels lean along the block's long
// axis), and a font size scaled from the average polygon area (larger polygons
// in small cities get slightly bigger text; clamped to [8, 13] px).
// Blocks hosting a landmark glyph are omitted to avoid overlap.
function computeDistrictLabels(
  blocks: CityBlockV2[],
  landmarks: CityLandmarkV2[],
  polygons: CityPolygon[],
): { text: string; cx: number; cy: number; angle: number; fontSize: number }[] {
  const landmarkPids = new Set(landmarks.map(lm => lm.polygonId));
  const labels: { text: string; cx: number; cy: number; angle: number; fontSize: number }[] = [];
  for (const block of blocks) {
    if (NO_LABEL_ROLES.has(block.role)) continue;
    if (block.polygonIds.some(pid => landmarkPids.has(pid))) continue;
    let cx = 0, cy = 0, totalArea = 0, n = 0;
    for (const pid of block.polygonIds) {
      const p = polygons[pid];
      if (!p) continue;
      cx += p.site[0]; cy += p.site[1]; totalArea += p.area; n++;
    }
    if (n === 0) continue;
    cx /= n; cy /= n;
    // PCA: angle of principal axis through the block's polygon sites.
    let sxx = 0, sxy = 0, syy = 0;
    for (const pid of block.polygonIds) {
      const p = polygons[pid];
      if (!p) continue;
      const dx = p.site[0] - cx; const dy = p.site[1] - cy;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    // atan2(2·sxy, sxx−syy)/2 ∈ (−π/2, π/2] — never upside-down.
    const angle = n >= 2 ? Math.atan2(2 * sxy, sxx - syy) / 2 : 0;
    const fontSize = Math.max(8, Math.min(13, Math.sqrt(totalArea / n) * 0.12));
    labels.push({ text: block.name, cx, cy, angle, fontSize });
  }
  return labels;
}

export function generateCityMapV2(
  seed: string,
  cityName: string,
  env: CityEnvironment,
): CityMapDataV2 {
  // Lock the top-level seeded-PRNG invariant: every V2 consumer downstream
  // must derive its RNG from this base stream. PR 2-5 add per-feature
  // suffixes (e.g. `_voronoi`, `_shape`, `_river`, `_buildings`).
  seededPRNG(`${seed}_city_${cityName}`);

  // Always build the same canvas size in polygons regardless of city tier
  // (refactor: city size now controls the IN-WALL footprint, not the
  // canvas, so every map has identical extramural acreage to host sprawl).
  const polygons = buildCityPolygonGraph(
    `${seed}_city_${cityName}_voronoi`,
    CANVAS_POLYGON_COUNT,
    CANVAS_SIZE,
  );

  // Contract guard — cheap, catches d3 / clipping surprises before
  // downstream assumes `polygons.length === CANVAS_POLYGON_COUNT`.
  if (polygons.length !== CANVAS_POLYGON_COUNT) {
    throw new Error(
      `City V2 canvas polygon count mismatch: expected ${CANVAS_POLYGON_COUNT}, got ${polygons.length}`,
    );
  }

  // ── Coastal water polygons ──
  // For coastal cities, carve out up to 25% of the canvas polygons as water
  // along the matching `env.waterSide` edge. Downstream generators (shape,
  // walls, network, blocks, open spaces) all consume this set to keep land
  // and sea cleanly separated. Inland cities get an empty set — no
  // behavior change relative to pre-coastal builds.
  const waterPolygonIds = generateWaterPolygons(
    seed,
    cityName,
    env,
    polygons,
    CANVAS_SIZE,
  );

  // ── Mountain polygons ──
  // When the city sits within 5 world-cell hops of a mountain cell
  // (`env.mountainDirection` non-null), carve out a strip of canvas
  // polygons along the matching canvas edge, capped at 25% of polygons.
  // Mountain selection always excludes the water set so a coastal city
  // never gets mountains on top of its sea. Downstream, mountains are
  // treated like water for infrastructure purposes (no walls, roads, or
  // plazas on a mountain face); blocks may optionally absorb mountain-
  // adjacent polygons up to 10% of the city's polygons.
  const mountainPolygonIds = generateMountainPolygons(
    seed,
    cityName,
    env,
    polygons,
    CANVAS_SIZE,
    waterPolygonIds,
  );

  // Combined obstacle set — used by shape / walls / network / openSpaces /
  // river. These modules treat water and mountain identically: "not
  // buildable, not traversable". Blocks and the data payload keep the two
  // sets distinct because blocks can absorb mountains (not water) and the
  // renderer styles them differently.
  const obstaclePolygonIds = new Set<number>(waterPolygonIds);
  for (const id of mountainPolygonIds) obstaclePolygonIds.add(id);

  // City footprint allocation. Picks an organic shape (50% spheroid /
  // 30% rectangle / 15% half-sphere / 5% triangle) and allocates exactly
  // `POLYGON_COUNTS[env.size]` polygons from the canvas, growing outward
  // from the canvas center (shifted toward the coast for coastal cities).
  // The wall traces this set; downstream features query
  // `wall.interiorPolygonIds` for "inside the city?" tests. See
  // `cityMapShape.ts` for the score-and-pick algorithm and the rationale
  // for dropping the old percentage-based coverage roll.
  const cityPolygonCount = POLYGON_COUNTS[env.size];
  const footprint = selectCityFootprint(
    seed,
    cityName,
    env,
    polygons,
    CANVAS_SIZE,
    cityPolygonCount,
    obstaclePolygonIds,
  );

  // PR 2 — walls + gates.
  // Wall configuration is decided here by size + probabilistic rolls so that
  // `generateWallsAndGates` remains a pure geometry generator.
  //
  //   small      — no walls
  //   medium     — 50% outer wall
  //   large      — 80% outer wall OR 20% inner core wall only
  //   metropolis — always outer + 50% inner core wall (fraction 0.42)
  //   megalopolis — always outer + always small inner core (fraction 0.22)
  //                 + 50% intermediate middle ring (fraction 0.52)
  const wallRng = seededPRNG(`${seed}_city_${cityName}_wallconfig`);

  let wallConfig: WallConfig;
  switch (env.size) {
    case 'small':
      wallConfig = { hasOuterWall: false, hasInnerWall: false, innerFraction: 0, hasMiddleWall: false, middleFraction: 0 };
      break;
    case 'medium':
      wallConfig = { hasOuterWall: wallRng() < 0.5, hasInnerWall: false, innerFraction: 0, hasMiddleWall: false, middleFraction: 0 };
      break;
    case 'large': {
      const roll = wallRng();
      if (roll < 0.80) {
        wallConfig = { hasOuterWall: true, hasInnerWall: false, innerFraction: 0, hasMiddleWall: false, middleFraction: 0 };
      } else {
        // 20%: inner core wall only (no outer wall)
        wallConfig = { hasOuterWall: false, hasInnerWall: true, innerFraction: 0.30, hasMiddleWall: false, middleFraction: 0 };
      }
      break;
    }
    case 'metropolis':
      wallConfig = { hasOuterWall: true, hasInnerWall: wallRng() < 0.5, innerFraction: 0.42, hasMiddleWall: false, middleFraction: 0 };
      break;
    case 'megalopolis':
      wallConfig = { hasOuterWall: true, hasInnerWall: true, innerFraction: 0.22, hasMiddleWall: wallRng() < 0.5, middleFraction: 0.52 };
      break;
  }

  const wall = generateWallsAndGates(
    seed,
    cityName,
    env,
    polygons,
    footprint.interior,
    CANVAS_SIZE,
    wallConfig,
    obstaclePolygonIds,
  );
  const { wallPath, wallSegments, gates, wallTowers, innerWallPath, innerGates, middleWallPath, middleGates } = wall;

  // PR 3 — shared polygon-edge graph consumed by river + network A*.
  // Built once per city so rivers, roads, and streets share precomputed
  // edge lengths, vertex points, and adjacency.
  const edgeGraph = buildPolygonEdgeGraph(polygons);

  // PR 3 — river along polygon edges. Returns null when !env.hasRiver or
  // when the boundary vertex search fails; the renderer no-ops on null.
  const river = generateRiver(seed, cityName, env, polygons, edgeGraph, CANVAS_SIZE, waterPolygonIds);

  // PR 3 — roads (gate→center A*), space-filling streets, and bridges
  // (road∩river by canonical edge key). Receives the river result so
  // road cost can nudge around crossings and bridge detection is trivial.
  const { roads, streets, bridges, exitRoads } = generateNetwork(
    seed,
    cityName,
    env,
    polygons,
    edgeGraph,
    wall,
    river,
    CANVAS_SIZE,
    obstaclePolygonIds,
  );

  // PR 4 (open-spaces slice) — civic square + markets + parks. Polygon-based
  // throughout: civic = polygon nearest canvas center; markets = polygons
  // nearest each gate midpoint (with Lloyd-style spread for the rest);
  // parks = BFS clusters over polygon.neighbors. Eligibility filters out
  // polygons whose ring touches a wall / river / road edge so plazas never
  // overlap infrastructure. The blocks slice below consumes the civic /
  // market polygons from this result to stamp block roles; landmarks (the
  // remaining piece of spec PR 4) still stay deferred.
  const openSpaces = generateOpenSpaces(
    seed,
    cityName,
    env,
    polygons,
    wall,
    river,
    roads,
    CANVAS_SIZE,
    obstaclePolygonIds,
  );

  // PR 4 (blocks slice) — polygon-graph flood bounded by wall / river / road /
  // street edges. Every polygon lands in exactly one block. Role is assigned
  // from the already-computed open-space anchors (civic square → civic block,
  // market polygon → market block), `env.waterSide` proximity (harbor),
  // `polygon.isEdge` membership (slum / agricultural for the outside-walls
  // clusters PR 5 will render as sprawl), otherwise `residential`. Medieval
  // names via the V1 prefix+suffix combiner on a dedicated RNG sub-stream.
  // See `cityMapBlocks.ts` for the full algorithm + semantic-inversion note
  // (streets ARE block barriers, unlike open-space eligibility).
  const blocks = generateBlocks(
    seed,
    cityName,
    env,
    polygons,
    wall,
    river,
    roads,
    streets,
    openSpaces,
    CANVAS_SIZE,
    waterPolygonIds,
    cityPolygonCount,
    mountainPolygonIds,
  );

  // Re-classify a seeded subset of `residential` blocks as craft / industry
  // districts (forge / tannery / textile / potters / mill). Mutates
  // `block.role` and `block.name` in-place so all downstream consumers
  // (landmarks, buildings, sprawl, renderer) see the updated roles.
  assignCraftRoles(blocks, env, polygons, river, seed, cityName);

  // Filter mountain polygons for landmark eligibility: only those within
  // MOUNTAIN_LANDMARK_MAX_DISTANCE polygon hops of the city footprint
  // boundary are candidates. Distant peaks that the city cannot plausibly
  // claim are excluded from temple / monument pools.
  const nearMountainPolygonIds = findNearMountainPolygons(
    polygons,
    footprint.interior,
    mountainPolygonIds,
    MOUNTAIN_LANDMARK_MAX_DISTANCE,
  );

  // PR 4 (landmarks slice) — capital castle/palace + temple-per-religion +
  // monument-per-wonder. Every landmark anchors to one `polygon.id`, sourced
  // from civic / market blocks with a shared `used` set enforcing de-dup
  // (spec line 66). Three ordered passes fan off dedicated RNG sub-streams
  // (`_landmarks_capitals` / `_landmarks_temples` / `_landmarks_monuments`)
  // so future landmark kinds can be inserted without shifting existing
  // seeds. See `cityMapLandmarks.ts` for the full polygon-graph algorithm.
  const landmarks = generateLandmarks(
    seed,
    cityName,
    env,
    polygons,
    blocks,
    openSpaces,
    CANVAS_SIZE,
    nearMountainPolygonIds,
    innerWallPath as [number, number][],
    middleWallPath as [number, number][],
    wallPath as [number, number][],
  );

  // Phase 2 of specs/City_districts_redux.md — write-only scaffold. Builds
  // the interior ∪ 5-hop boundary band candidate pool and runs the unified
  // landmark placer (empty stubs in Phase 2). Result lands in `_landmarksNew`
  // on the return literal; the renderer ignores it. Phase 7 promotes the
  // field over `landmarks` and Phase 8 deletes the legacy path.
  const candidatePool = buildCandidatePool(wall, polygons, edgeGraph, {
    waterPolygonIds,
    mountainPolygonIds,
  });
  const landmarksNew = placeUnifiedLandmarks({
    seed,
    cityName,
    env,
    polygons,
    candidatePool,
    wall,
    edgeGraph,
    waterPolygonIds,
    mountainPolygonIds,
    river,
  });

  // Phase 5 of specs/City_districts_redux.md — district classifier. Consumes
  // `landmarksNew` to seed a multi-source BFS, plus geometric inputs (wall
  // interior, water/mountain sets, env.waterSide). Output lives on the new
  // `_districtsNew` field on the return literal; the renderer ignores it
  // until Phase 7 promotes it over `blocks`. No new generator-level RNG sub-
  // stream — `_districts_slums` lives inside `cityMapDistricts.ts` — so this
  // wiring cannot perturb any pre-existing seed-stable output (walls, river,
  // roads, streets, open-spaces, blocks, landmarks, buildings, sprawl).
  const districtsNew = assignDistricts(
    seed,
    cityName,
    env,
    polygons,
    wall,
    landmarksNew,
    waterPolygonIds,
    mountainPolygonIds,
    river,
    CANVAS_SIZE,
    cityPolygonCount,
  );

  // Phase 6 of specs/City_districts_redux.md — build coarse block clusters
  // from the district classifier output. Groups polygons with the same
  // DistrictType into connected components via BFS; each component becomes
  // one CityBlockNewV2 with a procedural medieval name. Water and unabsorbed-
  // mountain polygon ids are excluded (they carry the sentinel district
  // 'residential_medium' and must not appear in any named block).
  // RNG stream: `_blocks_districts_names` — independent from `_blocks_names`
  // so the new blocks don't shift existing block-name output.
  const blocksNew = buildBlocksFromDistricts(
    seed,
    cityName,
    polygons,
    districtsNew,
    waterPolygonIds,
    mountainPolygonIds,
  );

  // Re-classify a seeded subset of `residential` blocks (interior) and
  // `agricultural`/`slum` blocks (exterior) as scholarship / faith / health
  // districts: temple_quarter / necropolis / academia / plague_ward /
  // archive_quarter. Called AFTER generateLandmarks so temple polygon sites
  // are available for temple_quarter placement bias, and BEFORE
  // generateBuildings so the packer sees the updated roles.
  assignSFHRoles(blocks, env, polygons, landmarks, seed, cityName);

  // Re-classify a seeded subset of `residential` blocks as military & security
  // districts: barracks / citadel / arsenal / watchmen_precinct. Called AFTER
  // assignSFHRoles so both temple landmark sites AND temple_quarter blocks are
  // visible for placement bias, and BEFORE generateBuildings so the packer
  // sees the updated roles (all four are interior and in PACKING_ROLES).
  // `gates` is destructured from `wall` above and passed for barracks' wall/
  // gate adjacency bias.
  assignMilitaryRoles(blocks, env, polygons, landmarks, gates, seed, cityName);

  // Re-classify a seeded subset of `residential` blocks as trade & finance
  // districts: foreign_quarter / caravanserai / bankers_row / warehouse_row.
  // Called AFTER assignMilitaryRoles so citadel / arsenal polygons have
  // already been reserved, and BEFORE generateBuildings so the packer sees
  // the updated roles (all four are interior and in PACKING_ROLES).
  // `landmarks` is passed for bankers_row's monument/wonder bias, `openSpaces`
  // for foreign_quarter + warehouse_row market bias, `gates` for caravanserai
  // gate-adjacency bias.
  assignTradeFinanceRoles(blocks, env, polygons, landmarks, openSpaces, gates, seed, cityName);

  // Re-classify a seeded subset of `residential` blocks (interior 3) and
  // `agricultural`/`slum` blocks (festival_grounds only) as entertainment &
  // social districts: theater_district / bathhouse_quarter / pleasure_quarter
  // / festival_grounds. `landmarks` is passed for theater_district's
  // monument/wonder bias, `openSpaces` for marketBoost, `gates` for
  // pleasure_quarter gate-adjacency bias. Counts per env.size are
  // small:0 / medium:0-1 / large:1-2 / metropolis:1-3 / megalopolis:2-5.
  assignEntertainmentRoles(blocks, env, polygons, landmarks, openSpaces, gates, seed, cityName);

  // Re-classify a seeded subset of `residential` blocks (interior 2) and
  // `agricultural`/`slum` blocks (gallows_hill only) as excluded & outcast
  // districts: ghetto / workhouse / gallows_hill. Called LAST among the
  // assigners so it does not steal civic / market / military / trade /
  // entertainment picks. `landmarks` is passed for workhouse's monument/
  // wonder bias, `openSpaces` for ghetto's market bias. Counts per env.size
  // are small:0 / medium:0-1 / large:1-2 / metropolis:1-3 / megalopolis:2-5.
  assignExcludedRoles(blocks, env, polygons, landmarks, openSpaces, seed, cityName);

  // Spec: "if a landmark is set on mountains, there must be a street from
  // the city to that landmark." For each landmark placed on a mountain
  // polygon, A* a path from the city center through the polygon edge graph
  // (mountain edges allowed, water edges still blocked) and append it to
  // the streets array so the renderer draws it as a thin connecting path.
  const mountainStreets = generateMountainLandmarkStreets(
    polygons,
    edgeGraph,
    landmarks,
    nearMountainPolygonIds,
    waterPolygonIds,
    CANVAS_SIZE,
  );

  // Phase 6 (buildings slice) — polygon-interior Voronoi-subdivision packer.
  // Now driven by `blocksNew` (DistrictType) + `landmarksNew` (LandmarkV2[])
  // instead of the legacy `blocks` / `openSpaces` / `landmarks` trio. Reserved
  // set = all polygon ids in `landmarksNew` (single-polygon anchors + park
  // cluster polygons). PACKING_ROLES is re-keyed to the 12-type interior union
  // (civic / market / harbor / residential_{high,medium,low} / industry /
  // education_faith / military / trade / entertainment / excluded). RNG stream
  // `_buildings` is unchanged so seed-stable snapshots remain consistent.
  const buildings = generateBuildings(
    seed,
    cityName,
    env,
    polygons,
    blocksNew,
    landmarksNew,
    roads,
    CANVAS_SIZE,
  );

  // Phase 6 (sprawl slice) — outside-walls sparse fringe buildings. Now driven
  // by `blocksNew` + `landmarksNew`. SPRAWL_ROLES stays {slum, agricultural}
  // so only exterior blocks produce sprawl, unchanged from Phase 5. RNG stream
  // `_sprawl` is unchanged.
  const sprawlBuildings = generateSprawl(
    seed,
    cityName,
    env,
    polygons,
    blocksNew,
    landmarksNew,
    CANVAS_SIZE,
    wallPath,
  );

  return {
    canvasSize: CANVAS_SIZE,
    polygonCount: polygons.length,
    cityPolygonCount,
    polygons,
    waterPolygonIds: [...waterPolygonIds].sort((a, b) => a - b),
    mountainPolygonIds: [...mountainPolygonIds].sort((a, b) => a - b),
    wallPath,
    wallSegments,
    gates,
    river,
    bridges,
    roads,
    streets: mountainStreets.length > 0 ? [...streets, ...mountainStreets] : streets,
    blocks,
    openSpaces,
    buildings,
    sprawlBuildings,
    landmarks,
    _landmarksNew: landmarksNew,
    _districtsNew: districtsNew,
    _blocksNew: blocksNew,
    wallTowers,
    innerWallPath,
    innerGates,
    middleWallPath,
    middleGates,
    exitRoads,
    districtLabels: computeDistrictLabels(blocks, landmarks, polygons),
  };
}
