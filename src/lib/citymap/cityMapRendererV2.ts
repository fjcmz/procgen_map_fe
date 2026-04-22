// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 renderer — Voronoi foundation (PR 1) + walls (PR 2) + river /
// streets / roads / bridges (PR 3) + open spaces + landmarks (PR 4 slices)
// + buildings + outside-walls sprawl (PR 5 slices)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles. Every geometric
// primitive this renderer consumes comes from the polygon graph emitted by
// `cityMapGeneratorV2.ts` and the polygon-edge traversals done by
// `cityMapWalls.ts` (PR 2) / `cityMapRiver.ts` + `cityMapNetwork.ts` (PR 3) /
// `cityMapOpenSpaces.ts` + `cityMapLandmarks.ts` (PR 4 slices) /
// `cityMapBuildings.ts` + `cityMapSprawl.ts` (PR 5 slices).
//
//   Layer 1  — flat cream base #ece5d3
//   Layer 2  — faint Voronoi polygon edges (the "organic cadastral grid")
//   Layer 4  — outside-walls sprawl (PR 5 slice): sparse axis-aligned rects
//              on slum / agricultural isEdge polygons. Same #2a241c ink as
//              interior buildings but thinner hollow strokes and lower
//              density per spec line 73 ("sparse scattered building rects
//              in fringe tiles"). Drawn BEFORE roads / river / streets so
//              infrastructure ink visibly sits on top if a road ever exits
//              the wall into the fringe.
//   Layer 6  — streets 2 px #b8ad92 (PR 3) [polygon-edge street paths]
//   Layer 9  — open spaces (PR 4 slice): pale fills over polygon RINGS for
//              squares + markets, greenish fills for parks, plus market
//              stall dots and park trees scattered inside each polygon
//   Layer 10 — buildings (PR 5 slice): 4–12 axis-aligned rects per non-
//              reserved interior polygon, 1 px mortar, mix of solid #2a241c
//              fills and hollow #2a241c strokes. Packed per polygon inside
//              the polygon.vertices ring with a 2 px inset from edges so
//              streets / roads / walls stay visible on polygon boundaries.
//   Layer 12 — landmarks (PR 4 slice): castle / palace / temple / monument
//              glyphs centered on `polygon.site`, sized from √polygon.area,
//              "all ink on white" per spec. CASTLE / PALACE labels below
//              capital glyphs.
//   Layer 11 — walls (PR 2): continuous thick black polyline along the
//              polygon-edge wall path. No gate gaps, no decorations.
//   Layer 7  — roads 4 px (PR 3) [polygon-edge road paths] — continuous
//              thick lines drawn on top of walls for ingress visibility.
//   Layer 5  — river (PR 3): single continuous light-blue stroke along
//              the polygon-edge river path.
//   Layer 8  — bridges (PR 3): white rect + two dark rail dashes per
//              road∩river edge, drawn ON TOP of the river so road
//              crossings read above the water.
//   …gap…    — Layers 3, 13 reserved for PR 5 (docks, district labels)
//   Layer 14 — top-centered city name + "V2" QA tag
//
// LAYER ORDER NOTE — walls, roads, and the river are drawn LAST (after
// buildings and landmarks) so all three sit clearly on top of every other
// feature. The river is the very last continuous fill; bridges are drawn
// after the river so road crossings still mask the water at the bridge
// span. Open spaces are still drawn early so the road / wall ink visibly
// covers the pale plaza fills. The polygon ring is filled directly: every
// market / square / park entry from `data.openSpaces` carries `polygonIds`
// indexing into `data.polygons`, so the renderer just walks each polygon's
// `vertices` ring (UNCLOSED, per the `CityPolygon` contract).
//
// NOTE ON LAYER 2: the spec calls for a rigid 4×4 cadastral grid. We
// deliberately substitute a faint stroke of every Voronoi polygon's vertex
// ring. Two reasons:
//   1. PR 2-5 build all geometry from the polygon graph — surfacing the
//      polygons directly means the V2 foundation is visible from PR 1 and
//      future PR authors immediately see the pivot away from tiles.
//   2. Two overlapping grid systems (4×4 + polygons) would mislead about the
//      data model. The polygons ARE the cadastral grid in V2.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CityBuildingV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
} from './cityMapTypesV2';
import { seededPRNG } from '../terrain/noise';

const BASE_FILL = '#ece5d3';
const POLYGON_EDGE_STROKE = 'rgba(180, 180, 180, 0.5)';
const CITY_NAME_INK = '#2a241c';
const QA_TAG_INK = '#8a8070';

// Layer 11 — wall styling (PR 2). All wall geometry is polygon-edge based;
// see cityMapWalls.ts for the generator. Walls render as a single continuous
// thick black polyline — no gate gaps, no tower studs, no door dashes.
const WALL_INK = '#000000';
const WALL_WIDTH = 4;

// Layer 5 — river styling (PR 3). All river geometry is polygon-edge based;
// see cityMapRiver.ts for the generator. Rendered as a single continuous
// light-blue stroke (no outline pass).
const RIVER_CHANNEL_INK = '#a8d4f0';
const RIVER_CHANNEL_WIDTH = 8;

// Layer 6 — street styling (PR 3). Thin paths along polygon edges.
const STREET_INK = '#b0b0b0';
const STREET_WIDTH = 1.5;

// Layer 7 — road styling (PR 3). Bold paths along polygon edges.
const ROAD_INK = '#444444';
const ROAD_WIDTH = 4;

// Layer 8 — bridge styling (PR 3). A white rect perpendicular to each
// road-∩-river edge (overwriting the river underneath), plus two dark
// dashes parallel to the edge to read as rails / handrails.
const BRIDGE_FILL = '#ffffff';
const BRIDGE_RAIL_INK = '#2a241c';
const BRIDGE_PAD_PX = 6;          // extends the white rect past each endpoint
const BRIDGE_HALF_WIDTH = 6;      // half-width of the rect perpendicular to the edge
const BRIDGE_RAIL_OFFSET = 3;     // perpendicular offset of each rail from the edge centerline
const BRIDGE_RAIL_WIDTH = 1.5;

// Layer 9 — open-space styling (PR 4 slice). Each open space kind has a
// distinct palette: civic squares (purple-white), markets (yellow-orange),
// parks (greens).
const OPEN_SPACE_SQUARE_FILL = '#e8d5f5';   // civic squares — light lavender
const OPEN_SPACE_SQUARE_STROKE = 'rgba(100, 50, 150, 0.55)';
const OPEN_SPACE_MARKET_FILL = '#f0b840';   // markets — warm amber-yellow
const OPEN_SPACE_MARKET_STROKE = 'rgba(160, 80, 10, 0.6)';
const OPEN_SPACE_PARK_FILL = '#7ec44a';     // parks — bright grass green
const OPEN_SPACE_PARK_STROKE = 'rgba(30, 90, 10, 0.65)';
const MARKET_STALL_INK = '#7a3a00';
const MARKET_STALL_RADIUS = 1.5;
const MARKET_STALLS_PER_POLYGON_MIN = 6;
const MARKET_STALLS_PER_POLYGON_MAX = 12;
const PARK_TREE_FILL = '#2d6a0a';
const PARK_TREE_STROKE = 'rgba(10, 40, 5, 0.85)';
const PARK_TREE_RADIUS = 3;
const PARK_TREES_PER_POLYGON_MIN = 4;
const PARK_TREES_PER_POLYGON_MAX = 10;

// Layer 12 — landmark styling (PR 4 slice). Each landmark type has its own
// palette: castle/palace = navy blue, temple = purple, monument = golden.
// Fill is the plaque/body color; ink is the detail/label color on top.
const LANDMARK_COLORS: Record<CityLandmarkV2['type'], { fill: string; ink: string }> = {
  castle:   { fill: '#1a3a6e', ink: '#c8d8ff' }, // navy blue
  palace:   { fill: '#1a3a6e', ink: '#c8d8ff' }, // navy blue
  temple:   { fill: '#6a2080', ink: '#f0d0ff' }, // purple
  monument: { fill: '#c89010', ink: '#fff5cc' }, // golden
};
const LANDMARK_SIZE_MIN = 20;
const LANDMARK_SIZE_MAX = 36;
const LANDMARK_SIZE_COEFF = 0.7; // multiplies √polygon.area before clamping
const LANDMARK_LABEL_TYPES: ReadonlySet<CityLandmarkV2['type']> = new Set<CityLandmarkV2['type']>([
  'castle',
  'palace',
]);

// Block background fills for slum and agricultural districts.
const BLOCK_SLUM_FILL = '#1a2818';        // dark green, almost black
const BLOCK_AGRICULTURAL_FILL = '#f2e8a0'; // light yellow

export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
  void env;

  const size = data.canvasSize;

  // ── Layer 1: flat cream base ────────────────────────────────────────────
  ctx.fillStyle = BASE_FILL;
  ctx.fillRect(0, 0, size, size);

  // ── Layer 2: faint Voronoi polygon edges (organic cadastral grid) ───────
  // [Voronoi foundation] — each polygon's vertex ring is stroked at 12% ink.
  ctx.strokeStyle = POLYGON_EDGE_STROKE;
  ctx.lineWidth = 1;
  for (const polygon of data.polygons) {
    const verts = polygon.vertices;
    if (verts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i][0], verts[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ── Layers 3, 13 reserved for PR 5 (remainder) ─────────────────────────
  //   Layer 3  — docks (PR 5, env.waterSide hatching)
  //   Layer 13 — district labels (PR 5)
  //   Layer 10 — buildings (PR 5) — drawn below after bridges and before walls.
  //   (Layer 12 landmarks — PR 4 slice — drawn below after walls.)

  // ── Layer 2.5: block background fills (slum + agricultural) ─────────────
  // Fills the polygon areas of slum and agricultural blocks before any
  // infrastructure or building layers so the colored ground shows through
  // the sparse sprawl rects placed on top.
  drawBlockBackgrounds(ctx, data);

  // ── Layer 4: outside-walls sprawl (PR 5 slice) ─────────────────────────
  // [Voronoi-polygon] Sparse rects on slum / agricultural isEdge polygons.
  // Drawn early (after the polygon-edge grid and before every infrastructure
  // layer) so any future gate-exiting road (spec line 24: "roads going from
  // the gates to the outer limits of the map") will sit visibly on top of
  // any sprawl rect it happens to cross. In this slice roads stay inside
  // the wall, so the stacking is effectively moot — but the ordering keeps
  // the visual contract stable against that future addition.
  drawSprawl(ctx, data);

  // ── Layer 9: open spaces (PR 4 slice — squares + markets + parks) ──────
  // [Voronoi-polygon] Each entry references polygons by id; the renderer
  // fills the union of those polygons' vertex rings (UNCLOSED, per the
  // CityPolygon contract). Drawn BEFORE river / streets / roads / walls so
  // those infrastructure layers visibly overlap the pale plaza fills.
  drawOpenSpaces(ctx, data, seed, cityName);

  // ── Layer 6: streets (PR 3) ────────────────────────────────────────────
  // [Voronoi-polygon] Each street path is a sequence of polygon vertices
  // threaded through adjacency by `cityMapNetwork.ts`. Streets stay below
  // the buildings / landmarks / wall-road-river stack so the dominant
  // infrastructure ink reads on top.
  drawPathList(ctx, data.streets, STREET_INK, STREET_WIDTH);

  // ── Layer 10: buildings (PR 5 slice) ───────────────────────────────────
  // [Voronoi-polygon] Every building carries a `polygonId` and sits inside
  // the corresponding polygon's vertex ring (2 px inset from polygon edges
  // at generation time — see cityMapBuildings.ts). Drawn AFTER streets so
  // buildings cover the street ink that would otherwise bleed under their
  // footprints, and BEFORE the wall / road / river stack so all three
  // dominant features sit visibly on top of every building they cross.
  drawBuildings(ctx, data);

  // ── Layer 12: landmarks (PR 4 slice) ────────────────────────────────────
  // [Voronoi-polygon] Each landmark references one `polygon.id`; we center
  // the glyph on `polygon.site` and size it from `√polygon.area`. Drawn
  // before walls / roads / river so those infrastructure layers cover any
  // landmark glyph they cross. See cityMapLandmarks.ts for the polygon-
  // graph placement.
  drawLandmarks(ctx, data);

  // ── Layer 11: walls (PR 2) ─────────────────────────────────────────────
  // [Voronoi-polygon] Continuous thick black polyline along the polygon-
  // edge wall path. Drawn after every other feature so the city's defensive
  // perimeter remains the strongest read on the map.
  drawWalls(ctx, data);

  // ── Layer 7: roads (PR 3) ──────────────────────────────────────────────
  // [Voronoi-polygon] Road paths come from gate→center A* over the polygon
  // edge graph; see cityMapNetwork.ts. Drawn on top of the walls so road
  // crossings (e.g. through gates) read as continuous thoroughfares.
  drawPathList(ctx, data.roads, ROAD_INK, ROAD_WIDTH);

  // ── Layer 5: river (PR 3) ──────────────────────────────────────────────
  // [Voronoi-polygon] Single continuous light-blue stroke along the
  // polygon-edge river path. Drawn AFTER walls and roads so the water
  // surface reads on top of any dry feature it crosses; bridges (next
  // layer) re-mask the river at road-river intersections.
  drawRiver(ctx, data);

  // ── Layer 8: bridges (PR 3) ────────────────────────────────────────────
  // [Voronoi-polygon] Each bridge is a polygon edge that belongs to both
  // a road path and the river edge set — `cityMapNetwork.ts` emits the
  // intersection as a `[a, b]` pair, the renderer turns it into a white
  // rect + rails so the crossing reads above the river stroke.
  drawBridges(ctx, data);

  // ── Layer 14: city name + V2 QA tag ─────────────────────────────────────
  ctx.fillStyle = CITY_NAME_INK;
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(cityName, size / 2, 16);

  ctx.fillStyle = QA_TAG_INK;
  ctx.font = '10px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('V2', size - 8, size - 8);
}

// [Voronoi-polygon] Fill block polygons for slum and agricultural districts
// so the ground color is visible through sparse sprawl buildings. Only these
// two roles need a distinct background; all other roles read through the
// cream base or the open-space / building layers above them.
function drawBlockBackgrounds(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.blocks.length === 0) return;
  for (const block of data.blocks) {
    const fill =
      block.role === 'slum' ? BLOCK_SLUM_FILL :
      block.role === 'agricultural' ? BLOCK_AGRICULTURAL_FILL :
      null;
    if (!fill) continue;
    ctx.fillStyle = fill;
    for (const pid of block.polygonIds) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;
      tracePolygonRing(ctx, polygon);
      ctx.fill();
    }
  }
}

// [Voronoi-polygon] Draw the wall layer as a single continuous thick black
// polyline along the polygon-edge wall path produced by
// `cityMapWalls.ts::generateWallsAndGates`. Every segment in `data.wallPath`
// is a polygon edge; the path is closed (first === last). Gate gaps, tower
// studs, and door dashes were dropped intentionally so the wall reads as
// one strong unbroken silhouette on top of every other feature.
function drawWalls(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
): void {
  const path = data.wallPath;
  if (path.length < 2) return;

  ctx.strokeStyle = WALL_INK;
  ctx.lineWidth = WALL_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i][0], path[i][1]);
  }
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 3 — river + streets + roads + bridges (polygon-edge renderers)
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Draw the river channel as a single continuous light-blue
// stroke. Every edge in `data.river.edges` is a polygon edge emitted by
// `cityMapRiver.ts`. Round line caps + joins keep the per-edge segments
// reading as one continuous line. Island polygons don't need explicit
// handling — they simply have no river edges inside them.
function drawRiver(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  const river = data.river;
  if (!river || river.edges.length === 0) return;

  ctx.strokeStyle = RIVER_CHANNEL_INK;
  ctx.lineWidth = RIVER_CHANNEL_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [a, b] of river.edges) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

// [Voronoi-polygon] Stroke a list of paths where each path is a sequence of
// polygon vertices (pixel coords) emitted by `cityMapNetwork.ts`. Used for
// both streets (thin) and roads (bold) — only the stroke style differs.
function drawPathList(
  ctx: CanvasRenderingContext2D,
  paths: [number, number][][],
  ink: string,
  width: number,
): void {
  if (paths.length === 0) return;
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const path of paths) {
    if (path.length < 2) continue;
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i][0], path[i][1]);
    }
  }
  ctx.stroke();
}

// [Voronoi-polygon] For each bridge edge (a road edge whose canonical key
// also appears in the river edge set), paint a white rect centered on the
// edge midpoint, perpendicular to the edge, plus two short dark rails
// parallel to the edge. This reads as a bridge platform + handrails and
// masks the river stroke at the crossing so the road visibly passes over.
function drawBridges(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.bridges.length === 0) return;

  for (const [a, b] of data.bridges) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular to the edge, y-down: (uy, -ux).
    const nx = uy;
    const ny = -ux;

    // White platform rect: extend `BRIDGE_PAD_PX` past each endpoint so
    // the rails visibly overlap the road, and take `BRIDGE_HALF_WIDTH`
    // either side of the edge perpendicular.
    const padAx = a[0] - ux * BRIDGE_PAD_PX;
    const padAy = a[1] - uy * BRIDGE_PAD_PX;
    const padBx = b[0] + ux * BRIDGE_PAD_PX;
    const padBy = b[1] + uy * BRIDGE_PAD_PX;
    const corners: [number, number][] = [
      [padAx + nx * BRIDGE_HALF_WIDTH, padAy + ny * BRIDGE_HALF_WIDTH],
      [padBx + nx * BRIDGE_HALF_WIDTH, padBy + ny * BRIDGE_HALF_WIDTH],
      [padBx - nx * BRIDGE_HALF_WIDTH, padBy - ny * BRIDGE_HALF_WIDTH],
      [padAx - nx * BRIDGE_HALF_WIDTH, padAy - ny * BRIDGE_HALF_WIDTH],
    ];
    ctx.fillStyle = BRIDGE_FILL;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i][0], corners[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    // Two rails parallel to the edge.
    ctx.strokeStyle = BRIDGE_RAIL_INK;
    ctx.lineWidth = BRIDGE_RAIL_WIDTH;
    ctx.lineCap = 'round';
    for (const sign of [-1, 1]) {
      const ox = nx * BRIDGE_RAIL_OFFSET * sign;
      const oy = ny * BRIDGE_RAIL_OFFSET * sign;
      ctx.beginPath();
      ctx.moveTo(padAx + ox, padAy + oy);
      ctx.lineTo(padBx + ox, padBy + oy);
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 5 (slice) — buildings on Layer 10
// ─────────────────────────────────────────────────────────────────────────────

// Layer 10 — building ink. Solid footprints use fill; hollow footprints use
// stroke. Buildings are now polygon paths (Voronoi lot insets) rather than
// axis-aligned rects — each `CityBuildingV2.vertices` holds the inset polygon
// ring produced by `cityMapBuildings.ts`.
const BUILDING_FILL = '#b5ae9f';
const BUILDING_OUTLINE = '#2a241c';
const BUILDING_STROKE_WIDTH = 0.75;

// Layer 4 — outside-walls sprawl ink (PR 5 slice). Same #2a241c ink as
// interior buildings, slightly thinner stroke so sprawl reads airier.
const SPRAWL_INK = '#2a241c';
const SPRAWL_STROKE_WIDTH = 0.6;

// [Voronoi-polygon] Render every entry in `data.buildings`. Each building
// carries a `vertices` polygon ring (inset from the Voronoi lot boundary by
// BUILDING_INSET_PX at generation time) and is drawn as a filled or outlined
// polygon path. No RNG at render time — vertices are baked in at generation.
function drawBuildings(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.buildings.length === 0) return;

  ctx.lineWidth = BUILDING_STROKE_WIDTH;
  ctx.lineJoin = 'round';

  for (const b of data.buildings as CityBuildingV2[]) {
    if (b.vertices.length < 3) continue;
    traceClosedRing(ctx, b.vertices);
    ctx.fillStyle = BUILDING_FILL;
    ctx.fill();
    ctx.strokeStyle = BUILDING_OUTLINE;
    ctx.stroke();
  }
}

// [Voronoi-polygon] Render every entry in `data.sprawlBuildings`. Each sprawl
// building carries a `vertices` polygon ring produced by shrinking the parent
// polygon toward its centroid (see `cityMapSprawl.ts`). Same polygon-path draw
// logic as `drawBuildings` — only ink / stroke width differ.
function drawSprawl(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.sprawlBuildings.length === 0) return;

  ctx.fillStyle = SPRAWL_INK;
  ctx.strokeStyle = SPRAWL_INK;
  ctx.lineWidth = SPRAWL_STROKE_WIDTH;
  ctx.lineJoin = 'round';

  for (const b of data.sprawlBuildings as CityBuildingV2[]) {
    if (b.vertices.length < 3) continue;
    traceClosedRing(ctx, b.vertices);
    if (b.solid) {
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 4 (slice) — open spaces (squares + markets + parks) on Layer 9
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Render every entry in `data.openSpaces`. Each entry's
// `polygonIds` indexes into `data.polygons`; we fill the union of those
// polygons' vertex rings (UNCLOSED — `CityPolygon.vertices` is unclosed by
// the contract documented in `cityMapTypesV2.ts`). On top of the fill we
// scatter market stalls (small dark dots) or park trees (filled green
// circles) using a seeded RNG keyed off the city, so re-rendering the same
// city produces identical scatter positions.
//
// Sub-streams: `_openspaces_render_markets` and `_openspaces_render_parks`,
// matching the generator's `_openspaces_markets` / `_openspaces_parks`
// sub-stream pattern. Render-side streams are kept distinct from generation
// streams so re-rendering without re-generating doesn't perturb generation
// output (and vice versa).
function drawOpenSpaces(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  seed: string,
  cityName: string,
): void {
  if (data.openSpaces.length === 0) return;

  // Pass 1 — fill polygon rings. Each kind has its own palette.
  fillOpenSpaceKind(ctx, data, ['square'], OPEN_SPACE_SQUARE_FILL, OPEN_SPACE_SQUARE_STROKE);
  fillOpenSpaceKind(ctx, data, ['market'], OPEN_SPACE_MARKET_FILL, OPEN_SPACE_MARKET_STROKE);
  fillOpenSpaceKind(ctx, data, ['park'], OPEN_SPACE_PARK_FILL, OPEN_SPACE_PARK_STROKE);

  // Pass 2 — market stall dots scattered inside each market polygon.
  const stallRng = seededPRNG(`${seed}_city_${cityName}_openspaces_render_markets`);
  ctx.fillStyle = MARKET_STALL_INK;
  for (const entry of data.openSpaces) {
    if (entry.kind !== 'market') continue;
    for (const pid of entry.polygonIds) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;
      const stallCount = randIntInclusive(
        stallRng,
        MARKET_STALLS_PER_POLYGON_MIN,
        MARKET_STALLS_PER_POLYGON_MAX,
      );
      // [Voronoi-polygon] Bias scatter around `polygon.site` with a
      // bounded radius so dots stay inside the polygon ring even on
      // elongated cells. The polygon's shoelace area informs how wide
      // we let the scatter spread.
      const spread = Math.sqrt(polygon.area) * 0.32;
      for (let i = 0; i < stallCount; i++) {
        const [px, py] = scatterInsidePolygon(polygon, stallRng, spread);
        ctx.beginPath();
        ctx.arc(px, py, MARKET_STALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Pass 3 — park trees. Same scatter pattern as stalls but greener and
  // bigger; outlined so dense clusters still read as individual trees.
  const treeRng = seededPRNG(`${seed}_city_${cityName}_openspaces_render_parks`);
  ctx.fillStyle = PARK_TREE_FILL;
  ctx.strokeStyle = PARK_TREE_STROKE;
  ctx.lineWidth = 0.75;
  for (const entry of data.openSpaces) {
    if (entry.kind !== 'park') continue;
    for (const pid of entry.polygonIds) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;
      const treeCount = randIntInclusive(
        treeRng,
        PARK_TREES_PER_POLYGON_MIN,
        PARK_TREES_PER_POLYGON_MAX,
      );
      const spread = Math.sqrt(polygon.area) * 0.36;
      for (let i = 0; i < treeCount; i++) {
        const [px, py] = scatterInsidePolygon(polygon, treeRng, spread);
        ctx.beginPath();
        ctx.arc(px, py, PARK_TREE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// [Voronoi-polygon] Stroke + fill every polygon listed under any of the
// requested `kinds`. Keeps the canvas style switches batched per kind.
function fillOpenSpaceKind(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  kinds: ('square' | 'market' | 'park')[],
  fillStyle: string,
  strokeStyle: string,
): void {
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const entry of data.openSpaces) {
    if (!kinds.includes(entry.kind)) continue;
    for (const pid of entry.polygonIds) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;
      tracePolygonRing(ctx, polygon);
      ctx.fill();
      ctx.stroke();
    }
  }
}

// [Voronoi-polygon] Trace a raw vertex array as a closed ring. Used for
// building / sprawl footprints whose vertices come directly from the
// generator (not wrapped in a CityPolygon).
function traceClosedRing(ctx: CanvasRenderingContext2D, verts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(verts[0][0], verts[0][1]);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i][0], verts[i][1]);
  }
  ctx.closePath();
}

// [Voronoi-polygon] Trace `polygon.vertices` as a closed ring on the
// current canvas path. The ring is UNCLOSED in the data (per the
// CityPolygon contract); `closePath` does the wrap.
function tracePolygonRing(ctx: CanvasRenderingContext2D, polygon: CityPolygon): void {
  const verts = polygon.vertices;
  ctx.beginPath();
  ctx.moveTo(verts[0][0], verts[0][1]);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i][0], verts[i][1]);
  }
  ctx.closePath();
}

// [Voronoi-polygon] Returns a point inside (or near the centre of) a
// polygon by jittering its `site`. We don't insist on strict point-in-
// polygon containment — a small jitter bounded by `Math.sqrt(area)` keeps
// stalls / trees visually inside the polygon even for elongated Voronoi
// cells, and the wall / road / river layers drawn on top hide any rare
// outliers. Keeping the helper geometry-only means determinism is governed
// solely by the caller's RNG.
function scatterInsidePolygon(
  polygon: CityPolygon,
  rng: () => number,
  spread: number,
): [number, number] {
  const [sx, sy] = polygon.site;
  const dx = (rng() - 0.5) * 2 * spread;
  const dy = (rng() - 0.5) * 2 * spread;
  return [sx + dx, sy + dy];
}

function randIntInclusive(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 4 (slice) — landmarks (castle / palace / temple / monument) on Layer 12
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Render every entry in `data.landmarks`. Each entry's
// `polygonId` indexes into `data.polygons`; we center the glyph on
// `polygon.site` and size it from `√polygon.area` (clamped to a legibility
// window — V2 has NO tileSize concept). All glyphs are "ink on white" per
// spec line 67: a pale plaque rect + dark silhouette details. Labels for
// CASTLE / PALACE mirror V1 `cityMapRenderer.ts:398-409` so major capital
// landmarks remain readable at a glance.
//
// No RNG — every dimension derives from `polygon.area` + `polygon.site`
// so re-rendering the same city is byte-stable without needing a dedicated
// render-side seed stream.
function drawLandmarks(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.landmarks.length === 0) return;

  for (const lm of data.landmarks) {
    const polygon = data.polygons[lm.polygonId];
    if (!polygon) continue;
    const sz = landmarkGlyphSize(polygon);
    const [cx, cy] = polygon.site;
    const { fill, ink } = LANDMARK_COLORS[lm.type];
    switch (lm.type) {
      case 'castle':   drawCastleGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'palace':   drawPalaceGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'temple':   drawTempleGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'monument': drawMonumentGlyph(ctx, cx, cy, sz, fill, ink); break;
    }
  }

  // Labels below castle / palace (mirrors V1 label pass) — centered on the
  // polygon site, placed just below the glyph bounding box.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const lm of data.landmarks) {
    if (!LANDMARK_LABEL_TYPES.has(lm.type)) continue;
    const polygon = data.polygons[lm.polygonId];
    if (!polygon) continue;
    const sz = landmarkGlyphSize(polygon);
    const [cx, cy] = polygon.site;
    const { ink } = LANDMARK_COLORS[lm.type];
    const fontPx = Math.max(8, Math.round(sz * 0.35));
    ctx.font = `bold ${fontPx}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = ink;
    ctx.fillText(lm.type.toUpperCase(), cx, cy + sz / 2 + 1);
  }
}

// [Voronoi-polygon] Derive the glyph bounding-box side length from polygon
// area. `√area` gives a characteristic polygon "radius"; the 0.7 coefficient
// fits the glyph inside the polygon even for elongated cells. Clamped to
// `[20, 36]` px so small-tier cities (150 polygons ⇒ larger average area)
// and megalopolis-tier cities (1000 polygons ⇒ smaller average area) both
// produce legible silhouettes.
function landmarkGlyphSize(polygon: CityPolygon): number {
  const raw = Math.sqrt(polygon.area) * LANDMARK_SIZE_COEFF;
  return Math.max(LANDMARK_SIZE_MIN, Math.min(LANDMARK_SIZE_MAX, raw));
}

// Ports of V1 glyphs at `cityMapRenderer.ts:412-554`. Signatures switched
// from (ctx, px, py, tileSize) — a top-left tile anchor — to
// (ctx, cx, cy, size) — a polygon-site center. Visual shape unchanged: each
// glyph still inscribes itself in an `size × size` bounding box centered
// on (cx, cy). No tile math inside the helpers; they operate purely on
// their size parameter.

function drawCastleGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  ink: string,
): void {
  const inset = size * 0.12;
  const x = cx - size / 2 + inset;
  const y = cy - size / 2 + inset;
  const w = size - inset * 2;
  const h = size - inset * 2;

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeRect(x, y, w, h);

  // Crenellated top — alternating notches (V1 parity: 5 notches).
  const notches = 5;
  const notchW = w / (notches * 2 - 1);
  ctx.fillStyle = ink;
  for (let i = 0; i < notches; i++) {
    const nx = x + i * 2 * notchW;
    ctx.fillRect(nx, y - notchW * 0.6, notchW, notchW * 0.6);
  }

  // Tower circles at the 4 corners.
  const r = Math.max(2, size * 0.1);
  ctx.fillStyle = fill;
  for (const [tx, ty] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Central door.
  const doorW = w * 0.2;
  const doorH = h * 0.4;
  ctx.fillStyle = ink;
  ctx.fillRect(x + w / 2 - doorW / 2, y + h - doorH, doorW, doorH);
}

function drawPalaceGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  ink: string,
): void {
  const inset = size * 0.08;
  const x = cx - size / 2 + inset;
  const y = cy - size / 2 + inset;
  const w = size - inset * 2;
  const h = size - inset * 2;

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.strokeRect(x, y, w, h);

  // Inner courtyard.
  const cInset = Math.max(2, size * 0.22);
  ctx.strokeRect(x + cInset, y + cInset, w - cInset * 2, h - cInset * 2);

  // Corner wings (solid squares).
  const sq = Math.max(2, size * 0.14);
  ctx.fillStyle = ink;
  for (const [wx, wy] of [[x, y], [x + w - sq, y], [x, y + h - sq], [x + w - sq, y + h - sq]]) {
    ctx.fillRect(wx, wy, sq, sq);
  }
}

function drawTempleGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  ink: string,
): void {
  const inset = size * 0.15;
  const x = cx - size / 2 + inset;
  const y = cy - size / 2 + inset;
  const w = size - inset * 2;
  const h = size - inset * 2;

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.strokeRect(x, y, w, h);

  // Dome (half circle at top) + cross (V1 parity).
  const mx = x + w / 2;
  const domeR = Math.min(w, h) * 0.22;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(mx, y + h * 0.45, domeR, Math.PI, 0, false);
  ctx.fill();

  // Cross centered in the lower half.
  const crossY = y + h * 0.55;
  const crossH = h * 0.3;
  const crossW = w * 0.18;
  const armW = crossH * 0.3;
  ctx.fillRect(mx - crossW / 2, crossY + armW, crossW, armW);
  ctx.fillRect(mx - armW / 2, crossY, armW, crossH);
}

function drawMonumentGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  _ink: string,
): void {
  const topY = cy - size / 2 + size * 0.18;
  const baseY = cy - size / 2 + size * 0.85;
  const halfW = size * 0.12;

  // Obelisk: tapered rectangle with a pointed cap.
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.55, topY);
  ctx.lineTo(cx + halfW * 0.55, topY);
  ctx.lineTo(cx + halfW, baseY);
  ctx.lineTo(cx - halfW, baseY);
  ctx.closePath();
  ctx.fill();

  // Cap triangle.
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.55, topY);
  ctx.lineTo(cx, topY - size * 0.08);
  ctx.lineTo(cx + halfW * 0.55, topY);
  ctx.closePath();
  ctx.fill();

  // Base step.
  const stepW = size * 0.42;
  const stepH = size * 0.07;
  ctx.fillRect(cx - stepW / 2, baseY, stepW, stepH);
}
