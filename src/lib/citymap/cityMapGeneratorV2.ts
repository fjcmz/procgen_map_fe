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
import type {
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
} from './cityMapTypesV2';
import type { CitySize } from './cityMapTypes';
import { generateWallsAndGates } from './cityMapWalls';
import { buildPolygonEdgeGraph } from './cityMapEdgeGraph';
import { generateRiver } from './cityMapRiver';
import { generateNetwork } from './cityMapNetwork';
import { generateOpenSpaces } from './cityMapOpenSpaces';
import { generateBlocks } from './cityMapBlocks';
import { generateLandmarks } from './cityMapLandmarks';
import { generateBuildings } from './cityMapBuildings';
import { generateSprawl } from './cityMapSprawl';

// Single source of truth for V2 polygon counts per city-size tier. Exported so
// PR 2-5 tests and helpers reference the same table rather than redefining it.
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
  // must derive its RNG from this base stream. PR 2-5 will add per-feature
  // suffixes (e.g. `_walls`, `_river`).
  seededPRNG(`${seed}_city_${cityName}`);

  const polygonCount = POLYGON_COUNTS[env.size];
  const polygons = buildCityPolygonGraph(
    `${seed}_city_${cityName}_voronoi`,
    polygonCount,
    CANVAS_SIZE,
  );

  // Contract guard — cheap, catches d3 / clipping surprises before PR 2-5
  // downstream assumes `polygons.length === POLYGON_COUNTS[env.size]`.
  if (polygons.length !== polygonCount) {
    throw new Error(
      `City V2 polygon count mismatch: expected ${polygonCount}, got ${polygons.length}`,
    );
  }

  // PR 2 — walls + gates. Polygon-based wall footprint + cardinal gates.
  // See cityMapWalls.ts for the Voronoi-polygon algorithm (score non-edge
  // polygons, BFS-prune, hole-fill, walk boundary polygon edges, pick
  // cardinal gates skipping env.waterSide).
  const wall = generateWallsAndGates(
    seed,
    cityName,
    env,
    polygons,
    CANVAS_SIZE,
  );
  const { wallPath, gates } = wall;

  // PR 3 — shared polygon-edge graph consumed by river + network A*.
  // Built once per city so rivers, roads, and streets share precomputed
  // edge lengths, vertex points, and adjacency.
  const edgeGraph = buildPolygonEdgeGraph(polygons);

  // PR 3 — river along polygon edges. Returns null when !env.hasRiver or
  // when the boundary vertex search fails; the renderer no-ops on null.
  const river = generateRiver(seed, cityName, env, polygons, edgeGraph, CANVAS_SIZE);

  // PR 3 — roads (gate→center A*), space-filling streets, and bridges
  // (road∩river by canonical edge key). Receives the river result so
  // road cost can nudge around crossings and bridge detection is trivial.
  const { roads, streets, bridges } = generateNetwork(
    seed,
    cityName,
    env,
    polygons,
    edgeGraph,
    wall,
    river,
    CANVAS_SIZE,
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
  );

  return {
    canvasSize: CANVAS_SIZE,
    polygonCount,
    polygons,
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
    // TODO PR 5 (remainder): dock hatching + rotated district labels
    // ("BLUEGATE", "GLASS DOCKS", …).
    districtLabels: [],
  };
}
