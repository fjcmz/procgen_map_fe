// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Voronoi-polygon foundation (PR 1 of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Each `CityPolygon` wraps a single D3-Delaunay Voronoi cell inside the 720×720
// city canvas. The four primitives PR 2–5 will consume are:
//
//   polygon.vertices  — the polygon ring (unclosed), used for wall tracing,
//                       river edge-walks, street edges, and building packing.
//   polygon.neighbors — adjacency over the polygon graph, used for block
//                       flood-fill, road A*, river routing.
//   polygon.isEdge    — polygon touches the 720×720 bounding box; PR 2 wall
//                       footprint starts from the non-edge interior.
//   polygon.area      — shoelace area, used by PR 4 landmark placement and
//                       PR 5 district-label sizing.
//
// Reference pattern (world-map Voronoi): src/lib/terrain/voronoi.ts::buildCellGraph.
// City Voronoi strips the east-west wrapping logic from that helper — cities
// are bounded, not toroidal.
//
// V1 types live in ./cityMapTypes and stay frozen so the V1 generator/renderer
// keep compiling alongside V2 during the PR 1-5 migration.
// ─────────────────────────────────────────────────────────────────────────────

import type { CityEnvironment, DistrictRole } from './cityMapTypes';

// Re-exported so PR 2–5 files can import from the V2 barrel only.
// `CityEnvironment` and `DistrictRole` stay shared between V1 and V2.
export type { CityEnvironment, DistrictRole };

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
 * An axis-aligned building rectangle placed inside a specific polygon. PR 5
 * will pack 4–12 of these per interior polygon.
 */
export interface CityBuildingV2 {
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  /** Owning polygon id — for rendering order and block queries. */
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
  /** Always 720 (px). */
  canvasSize: number;
  /** Must equal `polygons.length`; derived from city size via `POLYGON_COUNTS`. */
  polygonCount: number;
  /** Voronoi polygon foundation — the primary data contract for PR 2-5. */
  polygons: CityPolygon[];

  // TODO PR 2: closed polyline walking the wall boundary along polygon edges.
  wallPath: [number, number][];
  // TODO PR 2: one gate per cardinal direction, placed on wall edges.
  gates: { edge: [[number, number], [number, number]]; dir: 'N' | 'S' | 'E' | 'W' }[];
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
  // TODO PR 5: axis-aligned top-down building rects (dense per polygon).
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
  // TODO PR 5: rotated district labels ("BLUEGATE", "GLASS DOCKS", …).
  districtLabels: { text: string; cx: number; cy: number; angle: number }[];
}
