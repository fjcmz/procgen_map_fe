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
import type { Cell, City, MapData } from '../types';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';
import type {
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
  CitySize,
} from './cityMapTypesV2';
import { generateWallsAndGates, type WallConfig } from './cityMapWalls';
import { selectCityFootprint } from './cityMapShape';
import { buildPolygonEdgeGraph } from './cityMapEdgeGraph';
import { generateRiver } from './cityMapRiver';
import { generateNetwork } from './cityMapNetwork';
import { generateOpenSpaces } from './cityMapOpenSpaces';
import { generateBlocks } from './cityMapBlocks';
import { generateLandmarks } from './cityMapLandmarks';
import { generateBuildings } from './cityMapBuildings';
import { generateSprawl } from './cityMapSprawl';
import { generateWaterPolygons } from './cityMapWater';
import { generateMountainPolygons } from './cityMapMountains';

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

const CANVAS_SIZE = 720;
const LLOYD_ROUNDS = 2;

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
  const { wallPath, gates, wallTowers, innerWallPath, innerGates, middleWallPath, middleGates } = wall;

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
    mountainPolygonIds,
  );

  // PR 5 (buildings slice) — polygon-interior rejection-sampling packer.
  // For every non-reserved interior polygon inside a civic/market/harbor/
  // residential block, pack 4–12 axis-aligned rects (role-driven size bands,
  // 1 px mortar, mixed solid/hollow ink). Reserved set = openSpaces polygon
  // ids ∪ landmarks polygon ids so plazas, parks, and landmark glyphs stay
  // clean. Slum / agricultural blocks (all `isEdge` polygons) are skipped —
  // they belong to the outside-walls sprawl slice of PR 5, landing later.
  // Dedicated RNG sub-stream `_buildings` keeps the packing output decoupled
  // from every PR 2-4 stream and from future PR 5 streams (sprawl / docks /
  // labels). See cityMapBuildings.ts for the full polygon-interior algorithm.
  const buildings = generateBuildings(
    seed,
    cityName,
    env,
    polygons,
    blocks,
    openSpaces,
    landmarks,
    roads,
    CANVAS_SIZE,
  );

  // PR 5 (sprawl slice) — outside-walls sparse fringe rects. Consumes the
  // slum / agricultural blocks (all `isEdge`-containing clusters per
  // `cityMapBlocks.ts::isExteriorBlock`) that `generateBuildings` deliberately
  // skips. Same polygon-interior rejection-sampling recipe as buildings, but
  // smaller counts, smaller rects, and scaled by `env.size` per spec line 23
  // ("the bigger the city the more such sparse buildings"). Dedicated RNG
  // sub-stream `_sprawl` keeps it decoupled from `_buildings` and from future
  // PR 5 sub-streams (`_docks`, `_labels`). Rendered on Layer 4 (distinct
  // from Layer 10 interior buildings) per the spec's layer map at line 76.
  const sprawlBuildings = generateSprawl(
    seed,
    cityName,
    env,
    polygons,
    blocks,
    openSpaces,
    landmarks,
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
    gates,
    river,
    bridges,
    roads,
    streets,
    blocks,
    openSpaces,
    buildings,
    sprawlBuildings,
    landmarks,
    wallTowers,
    innerWallPath,
    innerGates,
    middleWallPath,
    middleGates,
    exitRoads,
    // TODO PR 5 (remainder): dock hatching + rotated district labels
    // ("BLUEGATE", "GLASS DOCKS", …).
    districtLabels: [],
  };
}
