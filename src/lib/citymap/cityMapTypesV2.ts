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

// Coarse district classification driven by the unified landmark layer.
// Populated by the district classifier in `cityMapDistricts.ts`.
//
// Extends the original 13-value union with three residential wealth tiers
// (high / medium / low) per spec line 59. Net union: 15 values.
//
// Park is intentionally NOT a member — park-cluster polygons
// (`LandmarkV2.polygonIds` where `kind === 'park'`) inherit whatever district
// their BFS / wealth pass produces (typically a residential tier). The renderer
// overlays park glyphs by reading `LandmarkV2.kind === 'park'` directly.
export type DistrictType =
  | 'civic'
  | 'market'
  | 'harbor'
  | 'residential_high'
  | 'residential_medium'
  | 'residential_low'
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
// implements the next 25 (quarter landmarks). Distinctive features add 30 more
// kinds, one per authored mega-landmark; they are placed only in megalopolis
// cities (one per city) by `cityMapLandmarksDistinctive.ts`.
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
  | 'gallows' | 'workhouse' | 'ghetto_marker'
  // Distinctive — geographical
  | 'dist_volcanic_caldera' | 'dist_sinkhole_cenote' | 'dist_sky_plateau'
  | 'dist_ancient_grove' | 'dist_geyser_field'
  // Distinctive — military
  | 'dist_bastion_citadel' | 'dist_triumphal_way' | 'dist_obsidian_wall_district'
  | 'dist_siege_memorial_field' | 'dist_under_warrens'
  // Distinctive — magical
  | 'dist_floating_spires' | 'dist_arcane_laboratorium' | 'dist_ley_convergence'
  | 'dist_mage_tower_constellation' | 'dist_eldritch_mirror_lake'
  // Distinctive — entertainment
  | 'dist_grand_colosseum' | 'dist_pleasure_gardens' | 'dist_carnival_quarter'
  | 'dist_royal_hippodrome' | 'dist_opera_quarter'
  // Distinctive — religious
  | 'dist_pilgrimage_cathedral' | 'dist_necropolis_hill' | 'dist_pantheon_of_all_gods'
  | 'dist_shrine_labyrinth' | 'dist_world_tree_pillar'
  // Distinctive — extraordinary
  | 'dist_meteor_crater' | 'dist_petrified_titan' | 'dist_crystal_bloom'
  | 'dist_ancient_portal_ruin' | 'dist_time_frozen_quarter';

/**
 * Six categories grouping the 30 distinctive `dist_*` LandmarkKinds. Drives
 * district BFS seed selection (`cityMapDistricts.ts`), character class/race
 * affinity (`citychars.ts`), and renderer dispatch (`cityMapRendererV2.ts`).
 */
export type DistinctiveFeatureCategory =
  | 'geographical'
  | 'military'
  | 'magical'
  | 'entertainment'
  | 'religious'
  | 'extraordinary';

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
 * A cluster of adjacent polygons sharing the same district type.
 * Produced by `buildBlocksFromDistricts` in `cityMapBlocks.ts`.
 */
export interface CityBlockNewV2 {
  polygonIds: number[];
  role: DistrictType;
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
 * Unified landmark record produced by `cityMapLandmarksUnified.ts`.
 * Anchors to one polygon and carries a 32-kind classification driving
 * district BFS seeding, label rendering, and glyph drawing.
 */
export interface LandmarkV2 {
  /** Anchor polygon (always present, used for label placement and BFS seeds). */
  polygonId: number;
  /** Full 32-kind classification — drives Phase 5 district BFS + Phase 7 labels. */
  kind: LandmarkKind;
  /**
   * Display name — set by the named placers in Phase 3 (`wonder` from
   * `env.wonderNames[i]`, others from procedural lists). Optional because
   * Phase 4 alignment kinds (forge, barracks, etc.) get their names from
   * the block layer in Phase 6, not from the landmark itself.
   */
  name?: string;
  /**
   * Cluster polygons for kinds that span multiple polygons (parks +
   * distinctive features). Single-polygon kinds leave this undefined;
   * consumers should treat absence as `[polygonId]`. Phase 3's park placer
   * sets it to the BFS cluster; distinctive features fill it with a 20–50
   * polygon BFS cluster.
   */
  polygonIds?: number[];
  /**
   * Populated only for distinctive (`dist_*`) landmarks — one per megalopolis.
   * Carries the category + visual mode the renderer dispatches on, plus the
   * cluster-level district seed type so the district classifier doesn't have
   * to redo the category lookup.
   */
  distinctive?: {
    category: DistinctiveFeatureCategory;
    visual: 'natural' | 'striking';
  };
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
   * into the renderer / blocks consumers.
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
  /**
   * Phase 7 of specs/City_districts_redux.md — promoted from `_blocksNew`.
   * Connected-component grouping of `districts` into named block clusters
   * keyed on the coarse DistrictType union. Phase 8 deletes `CityBlockV2` /
   * `DistrictRole`.
   */
  blocks: CityBlockNewV2[];
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
  /**
   * Phase 7 of specs/City_districts_redux.md — promoted from `_landmarksNew`.
   * Unified 32-kind landmark list produced by `cityMapLandmarksUnified.ts`.
   * Drives district BFS seeds, label rendering, and glyph placement.
   * Phase 8 deletes `CityLandmarkV2`.
   */
  landmarks: LandmarkV2[];
  /**
   * Phase 7 of specs/City_districts_redux.md — promoted from `_districtsNew`.
   * Per-polygon district classification from `assignDistricts`. Same length as
   * `polygons`; `array[polygonId]` is that polygon's DistrictType. Water and
   * unabsorbed-mountain polygons carry the sentinel `'residential_medium'`.
   */
  districts: DistrictType[];
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
