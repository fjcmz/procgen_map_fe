// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Voronoi-polygon foundation (PR 1 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Each `CityPolygon` wraps a single D3-Delaunay Voronoi cell inside the 1000×1000
// city canvas. The four primitives PR 2–5 will consume are:
//
//   polygon.vertices  — the polygon ring (unclosed), used for wall tracing,
//                       river edge-walks, street edges, and building packing.
//   polygon.neighbors — adjacency over the polygon graph, used for block
//                       flood-fill, road A*, river routing.
//   polygon.isEdge    — polygon touches the 1000×1000 bounding box; PR 2 wall
//                       footprint starts from the non-edge interior.
//   polygon.area      — shoelace area, used by PR 4 landmark placement and
//                       PR 5 district-label sizing.
//
// Reference pattern (world-map Voronoi): src/lib/terrain/voronoi.ts::buildCellGraph.
// City Voronoi strips the east-west wrapping logic from that helper — cities
// are bounded, not toroidal.
// ─────────────────────────────────────────────────────────────────────────────

import type { BiomeType } from '../types';

export type CitySize = 'small' | 'medium' | 'large' | 'metropolis' | 'megalopolis';

export type DistrictRole =
  | 'market' | 'residential' | 'civic' | 'harbor' | 'agricultural' | 'slum' | 'dock'
  | 'forge' | 'tannery' | 'textile' | 'potters' | 'mill'
  | 'temple_quarter' | 'necropolis' | 'academia' | 'plague_ward' | 'archive_quarter'
  | 'barracks' | 'citadel' | 'arsenal' | 'watchmen_precinct'
  | 'foreign_quarter' | 'caravanserai' | 'bankers_row' | 'warehouse_row'
  | 'theater_district' | 'bathhouse_quarter' | 'pleasure_quarter' | 'festival_grounds'
  | 'ghetto' | 'workhouse' | 'gallows_hill';

// Phase 1 of specs/City_districts_redux.md — coarse 13-value district
// classification. Populated by Phase 5's classifier; Phase 7 promotes it over
// `DistrictRole`. Coexists with `DistrictRole` until Phase 8 deletes the latter.
export type DistrictType =
  | 'civic'
  | 'market'
  | 'harbor'
  | 'residential'
  | 'agricultural'
  | 'slum'
  | 'dock'
  | 'industry'
  | 'education_faith'
  | 'military'
  | 'trade'
  | 'entertainment'
  | 'excluded';

// Phase 1 — landmark kinds the unified placer (cityMapLandmarksUnified.ts in
// Phase 2) will produce. Phase 3 implements the first 7 (user-named); Phase 4
// implements the remaining 25 (quarter landmarks).
export type LandmarkKind =
  // Phase 3 — named (consume env.wonderNames + isCapital + religionCount)
  | 'wonder' | 'palace' | 'castle' | 'civic_square' | 'temple' | 'market' | 'park'
  // Phase 4 — industrial
  | 'forge' | 'tannery' | 'textile' | 'potters' | 'mill'
  // Phase 4 — military
  | 'barracks' | 'citadel' | 'arsenal' | 'watchmen'
  // Phase 4 — faith aux
  | 'temple_quarter' | 'necropolis' | 'plague_ward' | 'academia' | 'archive'
  // Phase 4 — entertainment
  | 'theater' | 'bathhouse' | 'pleasure' | 'festival'
  // Phase 4 — trade
  | 'foreign_quarter' | 'caravanserai' | 'bankers_row' | 'warehouse'
  // Phase 4 — excluded
  | 'gallows' | 'workhouse' | 'ghetto_marker';

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
  /** Names of wonders standing at this city's cell at the selected year — Phase
   *  1 of City_districts_redux. Populated from WonderSnapshotEntry.name; same
   *  length as wonderCount. Consumed by the named-landmark placer in Phase 3. */
  wonderNames: string[];
  religionCount: number;
  isRuin: boolean;
  neighborBiomes: BiomeType[];
  /**
   * When the city sits within 5 BFS hops of a world cell with
   * `elevation >= 0.75` (mountain threshold, see renderer.ts:655), this
   * carries a unit vector pointing from the city toward the nearest
   * mountain cell plus the discovery hop count. Null when no mountain is
   * within range — downstream mountain-polygon generation is skipped.
   */
  mountainDirection: { dx: number; dy: number; distance: number } | null;
}

/**
 * A single Voronoi polygon in the city graph.
 *
 * Produced by `buildCityPolygonGraph` in `cityMapGeneratorV2.ts` after two
 * rounds of Lloyd relaxation. PR 2 onwards will read `vertices` / `neighbors`
 * / `isEdge` / `area` to build walls, rivers, roads, blocks, and buildings.
 */
export interface CityPolygon {
  /** Stable index inside `CityMapDataV2.polygons` (matches D3 cell index). */
  id: number;
  /** Lloyd-relaxed site position in canvas pixels. */
  site: [number, number];
  /**
   * Polygon ring in canvas pixels. UNCLOSED — `vertices[0] !== vertices[last]`.
   * (The D3 `cellPolygon` closing vertex is stripped at generation time.)
   */
  vertices: [number, number][];
  /** Delaunay-adjacent polygon ids (never contains `id` itself). */
  neighbors: number[];
  /** True when any vertex touches the canvas bounding box. */
  isEdge: boolean;
  /** Shoelace-computed polygon area in px². */
  area: number;
}

/**
 * A cluster of adjacent polygons acting as a single district. PR 4 will
 * populate these by flood-filling the polygon graph along non-road edges.
 */
export interface CityBlockV2 {
  polygonIds: number[];
  role: DistrictRole;
  name: string;
}

/**
 * A building footprint polygon placed inside a specific lot polygon. Produced
 * by subdividing each block polygon into Voronoi lots and insetting each lot
 * by a uniform distance from its edges.
 */
export interface CityBuildingV2 {
  /** Inset polygon vertices (unclosed ring) in canvas pixels. */
  vertices: [number, number][];
  solid: boolean;
  /** Owning block-polygon id — for rendering order and block queries. */
  polygonId: number;
}

/**
 * A named landmark (castle / palace / temple / monument) anchored to one
 * polygon. PR 4 will place these on civic / market polygons.
 */
export interface CityLandmarkV2 {
  polygonId: number;
  type: 'castle' | 'palace' | 'temple' | 'monument';
}

/**
 * Top-level V2 city-map payload. PR 1 populates ONLY `canvasSize`,
 * `polygonCount`, and `polygons` — every other field is an empty array (or
 * `null` for `river`) and will be filled in by the PR marked on each field.
 */
export interface CityMapDataV2 {
  /** Always 1000 (px). */
  canvasSize: number;
  /**
   * Total polygons in the canvas. Always equals `polygons.length` and is
   * fixed at `CANVAS_POLYGON_COUNT` (1500) regardless of city tier — the
   * canvas is a constant-size Voronoi graph; tier only changes the city
   * footprint allocation (see `cityPolygonCount`).
   */
  polygonCount: number;
  /**
   * Target count of polygons allocated to the in-wall city footprint for
   * this city's tier — always equals `POLYGON_COUNTS[env.size]` from
   * `cityMapGeneratorV2.ts`. The actual interior set may end up slightly
   * smaller after BFS-prune / hole-fill (see `cityMapShape.ts`); the
   * authoritative interior is `wall.interiorPolygonIds` which is echoed
   * into the renderer / blocks / openSpaces consumers.
   */
  cityPolygonCount: number;
  /** Voronoi polygon foundation — the primary data contract for PR 2-5. */
  polygons: CityPolygon[];
  /**
   * Polygon ids that are rendered as water (coastal cities only). Up to 25%
   * of `polygonCount`, carved from the `env.waterSide` edge of the canvas.
   * Walls skip water-adjacent seams, roads never cross water edges, and the
   * standard block flood excludes these polygons entirely; only the special
   * `dock` block role (large+ cities) is allowed to sit on water.
   */
  waterPolygonIds: number[];
  /**
   * Polygon ids that are rendered as mountains — only populated when the
   * city sits within 5 world-cell BFS hops of a mountain cell (elevation
   * >= 0.75). Capped at 25% of `polygonCount`, biased to the canvas edge
   * in the direction of the real-world mountains. Excluded from the
   * standard city footprint; blocks may optionally absorb mountain-
   * adjacent polygons up to 10% of `cityPolygonCount` so foothill
   * districts read as integrated with the mountain.
   */
  mountainPolygonIds: number[];

  // TODO PR 2: closed polyline walking the wall boundary along polygon edges.
  wallPath: [number, number][];
  /**
   * ALL disconnected outer-wall segments (mountains / water gaps split the
   * footprint boundary into multiple sections). Sorted longest-first.
   * Empty for unwalled cities. The renderer draws every segment; barrier
   * builders iterate all segments to cover every disconnected wall section.
   */
  wallSegments: [number, number][][];
  // TODO PR 2: gates placed on wall edges (4 for small/medium/large, 5–8 for metropolis+).
  gates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' }[];
  // TODO PR 3: river routed along polygon edges; `islandPolygonIds` lists
  // polygons encircled by river edges.
  river: { edges: [[number, number], [number, number]][]; islandPolygonIds: number[] } | null;
  // TODO PR 3: polygon edges carrying roads across the river.
  bridges: [[number, number], [number, number]][];
  // TODO PR 3: main roads (bold) from gates to city center.
  roads: [number, number][][];
  // TODO PR 3: space-filling streets (thin) along polygon edges.
  streets: [number, number][][];
  // TODO PR 4: district clusters with roles and medieval names.
  blocks: CityBlockV2[];
  // TODO PR 4: reserved squares, markets, and parks (polygon-keyed).
  openSpaces: { kind: 'square' | 'market' | 'park'; polygonIds: number[] }[];
  // PR 5: per-lot building footprint polygons — Voronoi-subdivided lots inset
  // from their edges, one footprint per lot.
  buildings: CityBuildingV2[];
  // PR 5 (sprawl slice): sparse rects on isEdge polygons in slum/agricultural
  // blocks — the "outside-walls fringe" from spec line 73. Kept separate from
  // `buildings` so the renderer can draw them on Layer 4 (the reserved sprawl
  // slot) distinct from Layer 10 interior packing, matching the spec's
  // "Renderer layers 3, 4, 10, 13 wired in" (line 76). Same CityBuildingV2
  // shape — only the owning polygon's role + isEdge differ.
  sprawlBuildings: CityBuildingV2[];
  // TODO PR 4: castle / palace / temple / monument placements.
  landmarks: CityLandmarkV2[];
  districtLabels: { text: string; cx: number; cy: number; angle: number; fontSize: number }[];

  /** Vertex positions along the outer wall where towers are placed (every ~3 edges + sharp bends). */
  wallTowers: [number, number][];
  /** Inner wall path for metropolis+ cities (empty for smaller cities). Closed polyline like wallPath. */
  innerWallPath: [number, number][];
  /** Inner wall gates (≥3 for metropolis+, empty for smaller cities). */
  innerGates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' }[];
  /**
   * Intermediate wall path (megalopolis only, 50% chance). Sits between the outer wall and the
   * small inner core wall. Empty for all other city sizes.
   */
  middleWallPath: [number, number][];
  /** Intermediate wall gates (megalopolis only, when middleWallPath is present). */
  middleGates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' }[];
  /** Roads extending outward from each outer gate to the canvas boundary (one per gate). */
  exitRoads: [number, number][][];
}
