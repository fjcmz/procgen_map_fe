// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 renderer — Voronoi foundation (PR 1) + walls (PR 2) + river /
// streets / roads / bridges (PR 3) + open spaces + landmarks (PR 4 slices)
// + buildings + outside-walls sprawl (PR 5 slices) + ruin overlay
// ─────────────────────────────────────────────────────────────────────────────
// RUIN OVERLAY — when `env.isRuin` is true, the renderer switches several
// layers into a "decayed" mode: roads/streets are drawn per-segment with a
// random fraction dropped (patchy, missing edges), a fraction of interior
// buildings and sprawl rects are skipped entirely ("collapsed"), and a final
// overgrowth pass fills a fraction of non-water polygons with a semi-
// transparent green reclaim colour and stipples green moss dots on the
// remaining buildings. The ruin overlay is render-only — the generator and
// its RNG streams are untouched, so non-ruin cities are byte-identical to
// pre-overlay output. All ruin randomness flows through a dedicated seeded
// stream `${seed}_city_${cityName}_ruin_render` (seed-stable per city).
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
  CityEnvironment,
  CityMapDataV2,
  CityPolygon,
  DistrictType,
  LandmarkKind,
} from './cityMapTypesV2';
import type { BiomeType } from '../types';
import { seededPRNG } from '../terrain/noise';

const BASE_FILL = '#ece5d3';
const POLYGON_EDGE_STROKE = 'rgba(180, 180, 180, 0.5)';

// Coastal water — polygons bordering `env.waterSide`. Light-blue sea fill
// slightly bluer than the river channel so the two read as separate bodies.
const WATER_FILL = '#9fc9e8';
const WATER_EDGE_STROKE = 'rgba(70, 110, 140, 0.35)';

// Mountain polygons — stone-grey fill with darker outline. Drawn early in
// the layer stack (between the polygon-edge grid and the sprawl layer) so
// infrastructure and buildings still sit visibly on top for absorbed
// foothill blocks. Mountain peaks are stippled as dark triangles on the
// polygon sites to suggest an elevated silhouette from above.
const MOUNTAIN_FILL = '#b4aea0';
const MOUNTAIN_EDGE_STROKE = 'rgba(70, 60, 45, 0.5)';
const MOUNTAIN_PEAK_INK = '#4a3d2a';
const MOUNTAIN_PEAK_HIGHLIGHT = '#dcd4c4';
const MOUNTAIN_PEAK_HALF_WIDTH = 6;
const MOUNTAIN_PEAK_HEIGHT = 9;

// Dock blocks (large+ coastal cities) — wooden plank styling per spec.
// Filled light brown with darker brown stripes to read as wharves / piers.
const DOCK_FILL = '#c9a673';        // light brown base (weathered wood)
const DOCK_STRIPE_INK = '#7a5a2e';  // darker brown plank seams
const DOCK_STRIPE_WIDTH = 1.2;
const DOCK_STRIPE_SPACING = 5;      // px between plank seams
const DOCK_OUTLINE = '#5c4020';
const DOCK_OUTLINE_WIDTH = 1;

// Layer 11 — wall styling (PR 2). All rings use the same near-black ink;
// width decreases inward so outer reads as the primary fortification.
const WALL_INK = '#111118';
const WALL_WIDTH = 5;
const MIDDLE_WALL_INK = '#111118';
const MIDDLE_WALL_WIDTH = 3.5;
const INNER_WALL_INK = '#111118';
const INNER_WALL_WIDTH = 2.5;
// Tower dots along walls (filled circles at vertex positions).
const TOWER_RADIUS = 4.5;  // outer wall towers
const MIDDLE_TOWER_RADIUS = 3.5;  // middle wall towers
const INNER_TOWER_RADIUS = 3;     // inner wall towers


// Layer 5 — river styling (PR 3).
const RIVER_CHANNEL_INK = '#a8d4f0';
const RIVER_CHANNEL_WIDTH = 8;

// Layer 6 — street styling (PR 3).
const STREET_INK = '#b8b0a0';
const STREET_WIDTH = 1.5;

// Layer 7 — road styling (PR 3). Dark grey for strong visual contrast.
const ROAD_INK = '#7c7c78';
const ROAD_WIDTH = 5;

// Layer 8 — bridge styling (PR 3, redesigned).
// Bridge is now drawn PERPENDICULAR to the river edge (crossing the channel),
// at 1/4 the scale of the original to read as a compact crossing.
const BRIDGE_FILL = '#d4c9a8';    // warm stone colour
const BRIDGE_RAIL_INK = '#2a241c';
const BRIDGE_CROSS_HALF = 6;      // half-length of bridge perpendicular to river (crossing span)
const BRIDGE_ROAD_HALF = 2;       // half-width of bridge along river direction (road footprint)
const BRIDGE_RAIL_WIDTH = 1.2;

// Layer 9 — open-space styling (PR 4 slice). Lighter palette per spec.
const OPEN_SPACE_SQUARE_FILL = '#f0eadc';   // civic squares — warm parchment
const OPEN_SPACE_SQUARE_STROKE = 'rgba(120, 100, 60, 0.4)';
const OPEN_SPACE_MARKET_FILL = '#f5e8b0';   // markets — pale straw yellow
const OPEN_SPACE_MARKET_STROKE = 'rgba(150, 100, 20, 0.4)';
const OPEN_SPACE_PARK_FILL = '#c8e8a8';     // parks — light sage green
const OPEN_SPACE_PARK_STROKE = 'rgba(60, 120, 30, 0.45)';
const MARKET_STALL_INK = '#5a3000';
const MARKET_STALL_RADIUS = 1.5;
const MARKET_STALLS_PER_POLYGON_MIN = 6;
const MARKET_STALLS_PER_POLYGON_MAX = 12;
const PARK_TREE_FILL = '#4a8820';
const PARK_TREE_STROKE = 'rgba(20, 60, 5, 0.7)';
const PARK_TREE_RADIUS = 3;
const PARK_TREES_PER_POLYGON_MIN = 4;
const PARK_TREES_PER_POLYGON_MAX = 10;

// Layer 12 — landmark styling (Phase 7 cutover). Covers all 32 LandmarkKind
// values. Body fills are medium-light tones; detail ink is dark for contrast.
const LANDMARK_COLORS: Partial<Record<LandmarkKind, { fill: string; ink: string }>> = {
  // Named structural landmarks (Phase 3)
  castle:          { fill: '#6e9cc8', ink: '#0e1e3c' },
  palace:          { fill: '#6e9cc8', ink: '#0e1e3c' },
  temple:          { fill: '#a870c8', ink: '#2c0844' },
  wonder:          { fill: '#dca030', ink: '#3c2400' },
  civic_square:    { fill: '#efe7cb', ink: '#8a8070' },
  market:          { fill: '#f8eebc', ink: '#5a3000' },
  park:            { fill: '#d8dcbf', ink: '#6a7a4a' },
  // Industrial (Phase 4)
  forge:           { fill: '#dcc8a8', ink: '#2a1a0a' },
  tannery:         { fill: '#dcc8a8', ink: '#2a1a0a' },
  textile:         { fill: '#dcc8a8', ink: '#2a1a0a' },
  potters:         { fill: '#dcc8a8', ink: '#2a1a0a' },
  mill:            { fill: '#dcc8a8', ink: '#2a1a0a' },
  // Military (Phase 4)
  barracks:        { fill: '#b0c078', ink: '#20280a' },
  citadel:         { fill: '#b0c078', ink: '#20280a' },
  arsenal:         { fill: '#b0c078', ink: '#20280a' },
  watchmen:        { fill: '#b0c078', ink: '#20280a' },
  // Faith aux (Phase 4)
  temple_quarter:  { fill: '#e8cce8', ink: '#280838' },
  necropolis:      { fill: '#e8cce8', ink: '#280838' },
  plague_ward:     { fill: '#e8cce8', ink: '#280838' },
  academia:        { fill: '#e8cce8', ink: '#280838' },
  archive:         { fill: '#e8cce8', ink: '#280838' },
  // Entertainment (Phase 4)
  theater:         { fill: '#f8c890', ink: '#3a1a00' },
  bathhouse:       { fill: '#f8c890', ink: '#3a1a00' },
  pleasure:        { fill: '#f8c890', ink: '#3a1a00' },
  festival:        { fill: '#f8c890', ink: '#3a1a00' },
  // Trade (Phase 4)
  foreign_quarter: { fill: '#f4e4ac', ink: '#3a2a08' },
  caravanserai:    { fill: '#f4e4ac', ink: '#3a2a08' },
  bankers_row:     { fill: '#f4e4ac', ink: '#3a2a08' },
  warehouse:       { fill: '#f4e4ac', ink: '#3a2a08' },
  // Excluded (Phase 4)
  gallows:         { fill: '#c8ccd4', ink: '#1a1c22' },
  workhouse:       { fill: '#c8ccd4', ink: '#1a1c22' },
  ghetto_marker:   { fill: '#c8ccd4', ink: '#1a1c22' },
};
const LANDMARK_FALLBACK_COLORS = { fill: '#f5f0e8', ink: '#2a241c' };
const LANDMARK_SIZE_MIN = 20;
const LANDMARK_SIZE_MAX = 36;
const LANDMARK_SIZE_COEFF = 0.7; // multiplies √polygon.area before clamping
// Landmark kinds that get a text label below their glyph.
const LANDMARK_LABEL_TYPES: ReadonlySet<LandmarkKind> = new Set<LandmarkKind>([
  'castle',
  'palace',
  'wonder',
  'temple',
  'park',
  'market',
]);

// Light pastel block fills keyed by city biome — used for both slum and
// agricultural outside-wall districts so the fringe reads as the surrounding
// terrain type rather than a generic colour.
const BIOME_OUTSIDE_FILL: Record<BiomeType, string> = {
  GRASSLAND:                  '#c8eab0',
  SUBTROPICAL_DESERT:         '#f0e0a8',
  TEMPERATE_DESERT:           '#ead8a0',
  SHRUBLAND:                  '#ccdca0',
  TAIGA:                      '#b4d4a0',
  TEMPERATE_DECIDUOUS_FOREST: '#aac88e',
  TEMPERATE_RAIN_FOREST:      '#a4c28a',
  TROPICAL_SEASONAL_FOREST:   '#b0cc96',
  TROPICAL_RAIN_FOREST:       '#9cc08e',
  TUNDRA:                     '#ccd8b8',
  BARE:                       '#d8d0c0',
  SCORCHED:                   '#d4c4b0',
  SNOW:                       '#ecf0f8',
  MARSH:                      '#acd0ac',
  ICE:                        '#dceef8',
  ALPINE_MEADOW:               '#c8dca0',
  LAKE:                       '#b4d8f4',
  OCEAN:                      '#b4d0e4',
  COAST:                      '#b4daf0',
  BEACH:                      '#e8dcb8',
};

export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  env: CityEnvironment,
  seed: string,
  cityName: string,
  showIcons = true,
  showLabels = true,
): void {
  const size = data.canvasSize;

  // Ruin overlay: when active, per-layer rolls come from this dedicated
  // stream so ruin output is seed-stable per city and cannot perturb any
  // other RNG stream used by the non-ruin renderer.
  const ruinRng: (() => number) | null = env.isRuin
    ? seededPRNG(`${seed}_city_${cityName}_ruin_render`)
    : null;

  // ── Layer 1: flat cream base ────────────────────────────────────────────
  ctx.fillStyle = BASE_FILL;
  ctx.fillRect(0, 0, size, size);

  // ── Layer 1.5: coastal water polygons ────────────────────────────────────
  // Drawn before the polygon-edge grid so the blue fill reads as a solid
  // waterbody with the faint cadastral grid stroked across it.
  drawWater(ctx, data);

  // ── Layer 1.7: mountain polygons ─────────────────────────────────────────
  // Drawn before the polygon-edge grid so the cadastral grid stays visible
  // across the mountain range. Infrastructure / buildings / landmarks draw
  // on top later so absorbed foothill polygons still read as city.
  drawMountains(ctx, data);

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

  // ── Layer 3 reserved for PR 5 (docks) ──────────────────────────────────
  //   Layer 3  — docks (PR 5, env.waterSide hatching, not yet implemented)
  //   Layer 13 — district labels (PR 5 slice, drawn late — see below)
  //   Layer 10 — buildings (PR 5) — drawn below after bridges and before walls.
  //   (Layer 12 landmarks — PR 4 slice — drawn below after walls.)

  // ── Layer 2.3: dock blocks (large+ coastal cities only) ─────────────────
  // Dock blocks sit on water polygons but are rendered as solid wooden
  // platforms — filled light brown with darker plank stripes. Drawn above
  // the water layer but below sprawl / infrastructure so wall and road ink
  // stays on top where a road happens to meet a dock.
  drawDockBlocks(ctx, data);

  // ── Layer 2.5: block background fills (slum + agricultural) ─────────────
  // Fills the polygon areas of slum and agricultural blocks before any
  // infrastructure or building layers so the colored ground shows through
  // the sparse sprawl rects placed on top.
  drawBlockBackgrounds(ctx, data, env);

  // ── Layer 4: outside-walls sprawl (PR 5 slice) ─────────────────────────
  drawSprawl(ctx, data, ruinRng);

  // ── Layer 9: landmark area fills (Phase 7) ──────────────────────────────
  // park / market / civic_square polygon fills sit below streets, buildings,
  // and walls. drawOpenSpaces() is kept but no longer called — Phase 8 deletes
  // it along with the legacy openSpaces field.
  drawLandmarkFills(ctx, data);

  // ── Layer 6: streets (PR 3) ────────────────────────────────────────────
  if (ruinRng) {
    drawPatchyPathList(ctx, data.streets, STREET_INK, STREET_WIDTH, ruinRng, RUIN_STREET_DROP_PROB);
  } else {
    drawPathList(ctx, data.streets, STREET_INK, STREET_WIDTH);
  }

  // ── Layer 10: buildings (PR 5 slice) ───────────────────────────────────
  drawBuildings(ctx, data, seed, cityName, ruinRng);

  // ── Layer 12: landmark glyphs + scatter (Phase 7) ──────────────────────
  // Glyphs (castle/palace/temple/monument/wonder) + market-stall/park-tree
  // scatter. Drawn after buildings so glyphs sit on top. Landmark name
  // labels are drawn later under `showLabels` (Layer 13.5) so the Icons /
  // Labels checkboxes are independent.
  if (showIcons) drawLandmarkGlyphs(ctx, data, seed, cityName);

  // ── Layer 12.5: district icons — small role glyphs at block centroids ──
  if (showIcons) drawDistrictIcons(ctx, data);

  // ── Wall rings — drawn innermost first so outer rings sit visually on top ──
  drawInnerWalls(ctx, data);
  drawMiddleWalls(ctx, data);

  // ── Layer 11: outer walls (PR 2) ──────────────────────────────────────
  drawWalls(ctx, data);

  // ── Tower dots — drawn on top of wall lines ─────────────────────────────
  drawWallTowers(ctx, data);

  // ── Layer 7: roads + exit roads (PR 3) ────────────────────────────────
  // Roads are drawn bending through the bridge midpoint instead of along the
  // river edge, so they visually approach the bridge perpendicularly.
  // Exit roads share the same style and are drawn in the same pass so they
  // read as a continuous road network from boundary through gate to center.
  drawRoadsWithBridgeRedirect(ctx, data, ruinRng);
  if (ruinRng) {
    drawPatchyPathList(ctx, data.exitRoads, ROAD_INK, ROAD_WIDTH, ruinRng, RUIN_EXIT_ROAD_DROP_PROB);
  } else {
    drawExitRoads(ctx, data);
  }

  // ── Layer 5: river (PR 3) ──────────────────────────────────────────────
  drawRiver(ctx, data);

  // ── Layer 8: bridges (PR 3) — perpendicular crossing ─────────────────
  // Each bridge is now a small rect PERPENDICULAR to the river edge, drawn
  // at the edge midpoint so it reads as a proper crossing of the channel.
  drawBridges(ctx, data);

  // ── Ruin overlay pass — semi-transparent overgrowth polygons + moss on
  //     remaining interior buildings. Drawn late (after all infrastructure)
  //     so the reclaim wash reads on top of everything. Alpha on the polygon
  //     fill keeps the underlying layers visible through the tint.
  if (ruinRng) {
    drawRuinOvergrowth(ctx, data, env, ruinRng);
  }

  // ── Layer 13: district labels + landmark labels + city name ────────────
  // All text labels (district names, landmark names, city name, V2 tag) are
  // gated together by `showLabels` so the Labels checkbox in the popup hides
  // every label at once — independent of the Icons checkbox above.
  if (showLabels) {
    drawDistrictLabels(ctx, data);
    drawLandmarkLabels(ctx, data);

    // ── Layer 14: city name + V2 QA tag ──────────────────────────────────
    ctx.font = 'bold 22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    drawOutlinedText(ctx, cityName, size / 2, 16, 3);

    ctx.font = '10px Georgia, serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    drawOutlinedText(ctx, 'V2', size - 8, size - 8, 2);
  }
}

// [Voronoi-polygon] Fill every water polygon with a light-blue sea colour
// plus a faint darker outline so the coastline reads cleanly against the
// cream land base. No RNG, no per-polygon variation — the sea is a single
// connected body and should look uniform.
function drawWater(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (!data.waterPolygonIds || data.waterPolygonIds.length === 0) return;
  ctx.fillStyle = WATER_FILL;
  ctx.strokeStyle = WATER_EDGE_STROKE;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const pid of data.waterPolygonIds) {
    const polygon = data.polygons[pid];
    if (!polygon || polygon.vertices.length < 3) continue;
    tracePolygonRing(ctx, polygon);
    ctx.fill();
    ctx.stroke();
  }
}

// [Voronoi-polygon] Fill every mountain polygon with a stone-grey colour
// and stipple a small triangular peak silhouette on each polygon's site
// so the range reads as elevated terrain from above. No RNG: peak
// dimensions are fixed and positions come directly from `polygon.site`,
// keeping the renderer byte-stable. Peaks include a thin pale highlight
// stroke on one side to suggest illumination.
function drawMountains(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (!data.mountainPolygonIds || data.mountainPolygonIds.length === 0) return;
  ctx.fillStyle = MOUNTAIN_FILL;
  ctx.strokeStyle = MOUNTAIN_EDGE_STROKE;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const pid of data.mountainPolygonIds) {
    const polygon = data.polygons[pid];
    if (!polygon || polygon.vertices.length < 3) continue;
    tracePolygonRing(ctx, polygon);
    ctx.fill();
    ctx.stroke();
  }

  // Peak silhouettes — one dark triangle per mountain polygon anchored on
  // `polygon.site`. Draw all triangles in a single batched path per style
  // so the canvas ctx state changes stay minimal.
  ctx.fillStyle = MOUNTAIN_PEAK_INK;
  ctx.beginPath();
  for (const pid of data.mountainPolygonIds) {
    const polygon = data.polygons[pid];
    if (!polygon) continue;
    const [cx, cy] = polygon.site;
    ctx.moveTo(cx, cy - MOUNTAIN_PEAK_HEIGHT);
    ctx.lineTo(cx + MOUNTAIN_PEAK_HALF_WIDTH, cy + MOUNTAIN_PEAK_HEIGHT * 0.35);
    ctx.lineTo(cx - MOUNTAIN_PEAK_HALF_WIDTH, cy + MOUNTAIN_PEAK_HEIGHT * 0.35);
    ctx.closePath();
  }
  ctx.fill();

  // Highlight stroke on the left face of each peak to suggest light from
  // the NW (matches the renderer's global hillshade convention).
  ctx.strokeStyle = MOUNTAIN_PEAK_HIGHLIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const pid of data.mountainPolygonIds) {
    const polygon = data.polygons[pid];
    if (!polygon) continue;
    const [cx, cy] = polygon.site;
    ctx.moveTo(cx, cy - MOUNTAIN_PEAK_HEIGHT);
    ctx.lineTo(cx - MOUNTAIN_PEAK_HALF_WIDTH, cy + MOUNTAIN_PEAK_HEIGHT * 0.35);
  }
  ctx.stroke();
}

// [Voronoi-polygon] Fill each dock block's polygons with a wooden platform
// look: light brown base + evenly spaced darker plank stripes clipped to
// the polygon shape. Clipping is per-polygon so the stripes don't bleed
// across block boundaries. Stripe orientation is keyed off the block's
// polygon-id mod 2 so adjacent docks alternate between vertical and
// horizontal plank runs for visual variety (no RNG — deterministic).
function drawDockBlocks(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.blocks.length === 0) return;

  for (const block of data.blocks) {
    if (block.role !== 'dock') continue;
    // Orientation: polygon-id parity picks vertical or horizontal stripes
    // so neighbouring docks read as separate structures.
    const firstPid = block.polygonIds[0] ?? 0;
    const vertical = (firstPid % 2) === 0;

    for (const pid of block.polygonIds) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;

      // Fill the wooden base.
      tracePolygonRing(ctx, polygon);
      ctx.fillStyle = DOCK_FILL;
      ctx.fill();

      // Clip to the polygon and stroke stripes across it.
      ctx.save();
      tracePolygonRing(ctx, polygon);
      ctx.clip();

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [vx, vy] of polygon.vertices) {
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
      }

      ctx.strokeStyle = DOCK_STRIPE_INK;
      ctx.lineWidth = DOCK_STRIPE_WIDTH;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      if (vertical) {
        const start = Math.floor(minX / DOCK_STRIPE_SPACING) * DOCK_STRIPE_SPACING;
        for (let x = start; x <= maxX; x += DOCK_STRIPE_SPACING) {
          ctx.moveTo(x, minY);
          ctx.lineTo(x, maxY);
        }
      } else {
        const start = Math.floor(minY / DOCK_STRIPE_SPACING) * DOCK_STRIPE_SPACING;
        for (let y = start; y <= maxY; y += DOCK_STRIPE_SPACING) {
          ctx.moveTo(minX, y);
          ctx.lineTo(maxX, y);
        }
      }
      ctx.stroke();
      ctx.restore();

      // Outline — dark brown border so the dock reads as a distinct block.
      tracePolygonRing(ctx, polygon);
      ctx.strokeStyle = DOCK_OUTLINE;
      ctx.lineWidth = DOCK_OUTLINE_WIDTH;
      ctx.stroke();
    }
  }
}

// [Voronoi-polygon] Fill block polygons for slum and agricultural districts
// using a light pastel tint derived from the city's biome so the fringe reads
// as surrounding terrain rather than a generic colour. Both roles use the same
// tint (they are both outside the walls); the difference between them is
// visible via the sparse sprawl buildings placed on top.
function drawBlockBackgrounds(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  env: CityEnvironment,
): void {
  if (data.blocks.length === 0) return;
  const biomeFill = BIOME_OUTSIDE_FILL[env.biome] ?? '#e0dcc8';
  for (const block of data.blocks) {
    const coarseFill = COARSE_DISTRICT_BG_FILL[block.role];
    if (coarseFill) {
      ctx.fillStyle = coarseFill;
      for (const pid of block.polygonIds) {
        const polygon = data.polygons[pid];
        if (!polygon || polygon.vertices.length < 3) continue;
        tracePolygonRing(ctx, polygon);
        ctx.fill();
      }
      continue;
    }
    if (block.role === 'slum' || block.role === 'agricultural') {
      ctx.fillStyle = biomeFill;
      for (const pid of block.polygonIds) {
        const polygon = data.polygons[pid];
        if (!polygon || polygon.vertices.length < 3) continue;
        tracePolygonRing(ctx, polygon);
        ctx.fill();
      }
    }
  }
}

// [Voronoi-polygon] Draw the outer wall as one or more thick polylines.
// When mountains / water gaps split the footprint boundary, `wallSegments`
// holds each disconnected section; we draw all of them. For cities with a
// single unbroken perimeter, `wallSegments` has one entry matching `wallPath`.
function drawWalls(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.wallSegments && data.wallSegments.length > 0) {
    for (const seg of data.wallSegments) {
      strokePolyline(ctx, seg, WALL_INK, WALL_WIDTH);
    }
  } else {
    // Fallback for data generated before wallSegments was added.
    strokePolyline(ctx, data.wallPath, WALL_INK, WALL_WIDTH);
  }
}

// [Voronoi-polygon] Draw the intermediate wall ring (megalopolis only).
function drawMiddleWalls(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (!data.middleWallPath || data.middleWallPath.length < 2) return;
  strokePolyline(ctx, data.middleWallPath, MIDDLE_WALL_INK, MIDDLE_WALL_WIDTH);
}

// [Voronoi-polygon] Draw the inner wall (metropolis+ only) thinner.
function drawInnerWalls(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (!data.innerWallPath || data.innerWallPath.length < 2) return;
  strokePolyline(ctx, data.innerWallPath, INNER_WALL_INK, INNER_WALL_WIDTH);
}

// [Voronoi-polygon] Draw tower dots on all active wall rings. Outer towers
// come from stored `wallTowers`; middle and inner towers are derived from
// every 3rd vertex of their path at render time (no extra stored arrays needed).
function drawWallTowers(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  // Outer wall towers.
  if (data.wallTowers && data.wallTowers.length > 0) {
    ctx.fillStyle = WALL_INK;
    for (const [tx, ty] of data.wallTowers) {
      ctx.beginPath();
      ctx.arc(tx, ty, TOWER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Middle wall towers — every 3rd vertex.
  if (data.middleWallPath && data.middleWallPath.length > 2) {
    ctx.fillStyle = MIDDLE_WALL_INK;
    const n = data.middleWallPath.length - 1;
    for (let i = 0; i < n; i += 3) {
      const [tx, ty] = data.middleWallPath[i];
      ctx.beginPath();
      ctx.arc(tx, ty, MIDDLE_TOWER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Inner wall towers — every 3rd vertex.
  if (data.innerWallPath && data.innerWallPath.length > 2) {
    ctx.fillStyle = INNER_WALL_INK;
    const n = data.innerWallPath.length - 1;
    for (let i = 0; i < n; i += 3) {
      const [tx, ty] = data.innerWallPath[i];
      ctx.beginPath();
      ctx.arc(tx, ty, INNER_TOWER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// [Voronoi-polygon] Draw exit roads — polygon-edge paths from each gate to
// the canvas boundary — using the same solid style as internal roads so the
// road network reads as continuous from boundary through gate to city center.
function drawExitRoads(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  drawPathList(ctx, data.exitRoads, ROAD_INK, ROAD_WIDTH);
}

// Shared helper — stroke a polyline with the given style.
function strokePolyline(
  ctx: CanvasRenderingContext2D,
  path: [number, number][],
  ink: string,
  width: number,
): void {
  if (path.length < 2) return;
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
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

// [Voronoi-polygon] Stroke a list of paths. Used for streets (thin).
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

// [Voronoi-polygon] Ruin-mode variant of `drawPathList` — iterates each
// consecutive vertex pair as an independent segment and skips a fraction
// (`dropProb` coin flip per segment). Butt line cap so gaps read as gaps;
// a round cap would bleed into short gaps and mask them. Kept segments are
// batched into a single beginPath/stroke for performance.
function drawPatchyPathList(
  ctx: CanvasRenderingContext2D,
  paths: [number, number][][],
  ink: string,
  width: number,
  rng: () => number,
  dropProb: number,
): void {
  if (paths.length === 0) return;
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const path of paths) {
    if (path.length < 2) continue;
    for (let i = 0; i < path.length - 1; i++) {
      if (rng() < dropProb) continue;
      ctx.moveTo(path[i][0], path[i][1]);
      ctx.lineTo(path[i + 1][0], path[i + 1][1]);
    }
  }
  ctx.stroke();
}

// [Voronoi-polygon] Draw roads with a visual redirect through every bridge
// midpoint. When the path contains an edge [A→B] that is a bridge, the road
// is drawn as: ...prev → M → next... (where M is the bridge midpoint) instead
// of ...prev → A → B → next..., so the approach visually bends toward the
// bridge crossing rather than running along the river channel.
//
// When `ruinRng` is non-null, each segment of the redirected path rolls an
// independent drop probability — missing segments render as gaps, producing
// the "patchy roads" look required for ruin cities. Butt line cap keeps the
// gaps visible (a round cap would bleed into and mask short gaps).
function drawRoadsWithBridgeRedirect(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  ruinRng: (() => number) | null = null,
): void {
  if (data.roads.length === 0) return;

  // Build a set of bridge edge canonical keys for O(1) lookup.
  // We need `canonicalEdgeKey` — inline the rounding logic here so we don't
  // import from cityMapEdgeGraph (renderer is import-free from generators).
  const VPRECISION = 1000;
  const roundV = (v: number) => Math.round(v * VPRECISION) / VPRECISION;
  const vkey = (p: [number, number]) => `${roundV(p[0])},${roundV(p[1])}`;
  const edgeKey = (a: [number, number], b: [number, number]) => {
    const ka = vkey(a);
    const kb = vkey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  // Map bridge edge key → midpoint (for redirect).
  const bridgeMidpoints = new Map<string, [number, number]>();
  for (const [a, b] of data.bridges) {
    const k = edgeKey(a as [number, number], b as [number, number]);
    bridgeMidpoints.set(k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }

  ctx.strokeStyle = ROAD_INK;
  ctx.lineWidth = ROAD_WIDTH;
  ctx.lineCap = ruinRng ? 'butt' : 'round';
  ctx.lineJoin = 'round';

  for (const road of data.roads) {
    if (road.length < 2) continue;
    // Build a redirected point sequence: replace each bridge segment A→B
    // with just the midpoint M (which becomes the road's path through the bridge).
    const redirected: [number, number][] = [];
    redirected.push(road[0] as [number, number]);
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i] as [number, number];
      const b = road[i + 1] as [number, number];
      const k = edgeKey(a, b);
      const mid = bridgeMidpoints.get(k);
      if (mid) {
        // Replace the A→B segment with just M; next iteration starts from B
        // but we don't re-add A (already added) nor B (will be added below).
        redirected.push(mid);
        // Don't push B — it will be pushed on the next iteration's "current" point.
        // We need to push B explicitly if it's the last segment.
        if (i === road.length - 2) redirected.push(b);
      } else {
        redirected.push(b);
      }
    }

    if (ruinRng) {
      // Patchy: draw each segment independently and skip some.
      ctx.beginPath();
      for (let i = 0; i < redirected.length - 1; i++) {
        if (ruinRng() < RUIN_ROAD_DROP_PROB) continue;
        ctx.moveTo(redirected[i][0], redirected[i][1]);
        ctx.lineTo(redirected[i + 1][0], redirected[i + 1][1]);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(redirected[0][0], redirected[0][1]);
      for (let i = 1; i < redirected.length; i++) {
        ctx.lineTo(redirected[i][0], redirected[i][1]);
      }
      ctx.stroke();
    }
  }
}

// [Voronoi-polygon] Draw bridges as small rectangles PERPENDICULAR to the
// river edge — the bridge crosses the channel, not floats on top of it.
// The rect's long axis is perpendicular to the river edge (the crossing span),
// and its short axis is parallel to the river edge (the road footprint width).
// Two dark rails run along the long axis to suggest handrails.
function drawBridges(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.bridges.length === 0) return;

  for (const [a, b] of data.bridges) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    // Unit vector along the river edge (A→B direction).
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular to the edge = crossing direction (the bridge span).
    // For a CW wall in y-down coords: perp = (uy, -ux). We want the crossing
    // direction regardless of orientation, so use the absolute perp.
    const px = uy;
    const py = -ux;

    // Bridge midpoint (center of the crossing).
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;

    // Bridge rect corners:
    //   - ±BRIDGE_CROSS_HALF along the perpendicular (crossing span)
    //   - ±BRIDGE_ROAD_HALF along the river direction (road width at bridge)
    const corners: [number, number][] = [
      [mx + px * BRIDGE_CROSS_HALF + ux * BRIDGE_ROAD_HALF,
       my + py * BRIDGE_CROSS_HALF + uy * BRIDGE_ROAD_HALF],
      [mx + px * BRIDGE_CROSS_HALF - ux * BRIDGE_ROAD_HALF,
       my + py * BRIDGE_CROSS_HALF - uy * BRIDGE_ROAD_HALF],
      [mx - px * BRIDGE_CROSS_HALF - ux * BRIDGE_ROAD_HALF,
       my - py * BRIDGE_CROSS_HALF - uy * BRIDGE_ROAD_HALF],
      [mx - px * BRIDGE_CROSS_HALF + ux * BRIDGE_ROAD_HALF,
       my - py * BRIDGE_CROSS_HALF + uy * BRIDGE_ROAD_HALF],
    ];

    ctx.fillStyle = BRIDGE_FILL;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i][0], corners[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    // Two rails along the crossing direction (perpendicular to river).
    ctx.strokeStyle = BRIDGE_RAIL_INK;
    ctx.lineWidth = BRIDGE_RAIL_WIDTH;
    ctx.lineCap = 'round';
    for (const sign of [-1, 1] as const) {
      // Rail offset: parallel to the river edge (±BRIDGE_ROAD_HALF)
      const ox = ux * BRIDGE_ROAD_HALF * sign;
      const oy = uy * BRIDGE_ROAD_HALF * sign;
      ctx.beginPath();
      ctx.moveTo(mx + px * BRIDGE_CROSS_HALF + ox, my + py * BRIDGE_CROSS_HALF + oy);
      ctx.lineTo(mx - px * BRIDGE_CROSS_HALF + ox, my - py * BRIDGE_CROSS_HALF + oy);
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 5 (slice) — buildings on Layer 10
// ─────────────────────────────────────────────────────────────────────────────

// Layer 10 — building ink. Three neutral light greys cycled randomly per
// building (render-side seeded RNG). None of these shades appear elsewhere
// (roads/streets use warm beige tones; walls/ink use near-black).
const BUILDING_FILLS = ['#e6e6e4', '#d6d6d4', '#c6c6c4'] as const;
const BUILDING_OUTLINE = '#2a241c';
const BUILDING_STROKE_WIDTH = 0.75;

// Coarse DistrictType background fills for named interior district kinds.
const COARSE_DISTRICT_BG_FILL: Partial<Record<DistrictType, string>> = {
  industry:        '#c8b498', // warm brown, like old craft
  education_faith: '#e8cce8', // lavender, like old SFH
  military:        '#b0c880', // army green
  trade:           '#f0dc98', // gold-yellow
  entertainment:   '#f8c890', // orange
  excluded:        '#d8dce4', // silver-grey
};

// Layer 4 — outside-walls sprawl ink (PR 5 slice). Same #2a241c ink as
// interior buildings, slightly thinner stroke so sprawl reads airier.
const SPRAWL_INK = '#2a241c';
const SPRAWL_STROKE_WIDTH = 0.6;

// ── Ruin overlay constants ──────────────────────────────────────────────────
// Probabilities for the render-only decay mode. Each segment / building /
// polygon gets an independent coin flip through the `_ruin_render` stream.
const RUIN_ROAD_DROP_PROB = 0.40;      // per road segment, drop (gap)
const RUIN_STREET_DROP_PROB = 0.55;    // streets are smaller roads — more ruined
const RUIN_EXIT_ROAD_DROP_PROB = 0.35;
const RUIN_BUILDING_COLLAPSE_PROB = 0.40;  // per building, don't draw at all
const RUIN_SPRAWL_COLLAPSE_PROB = 0.50;
const RUIN_OVERGROWTH_POLY_PROB = 0.35;    // per interior polygon, fill w/ biome tint
const RUIN_OVERGROWTH_BLDG_PROB = 0.45;    // per standing interior building, add moss
const RUIN_OVERGROWTH_MOSS_DOT_MIN = 1;    // dots per mossy building
const RUIN_OVERGROWTH_MOSS_DOT_MAX = 3;

// Alpha values for the biome-derived overgrowth fills. Biome colors live in
// `BIOME_OUTSIDE_FILL` and are already pastel; alpha on top of the cream base
// yields a tinted wash of the surrounding terrain reclaiming the ruined
// blocks. Moss dots are small (1.8 px radius), so they use a higher alpha.
const RUIN_OVERGROWTH_FILL_ALPHA = 0.55;
const RUIN_MOSS_FILL_ALPHA = 0.85;
const RUIN_MOSS_RADIUS = 1.8;

// Standing buildings in a ruin city get a darker, cooler ink to read as
// weathered / soot-stained stone. Replaces the three-grey fill cycle.
const RUIN_BUILDING_FILL = '#9a948a';
const RUIN_BUILDING_OUTLINE = '#20180f';
const RUIN_SPRAWL_INK = '#201810';

// [Voronoi-polygon] Render every entry in `data.buildings`. Each building
// carries a `vertices` polygon ring (inset from the Voronoi lot boundary by
// BUILDING_INSET_PX at generation time) and is drawn as a filled or outlined
// polygon path. Fill colour is one of three neutral light greys chosen per
// building via a render-side seeded RNG (`_buildings_render` sub-stream).
//
// When `ruinRng` is non-null, each building rolls an independent collapse
// probability: skipped buildings are not drawn at all (they become rubble
// ground — the ruin overgrowth pass may later place moss there). Remaining
// buildings render with a darker weathered fill + stronger outline so the
// ruin city reads as clearly decayed. The `fillRng` color-cycle stream is
// still advanced for every building regardless of collapse status so the
// color choice for the standing-only subset stays seed-stable.
function drawBuildings(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  seed: string,
  cityName: string,
  ruinRng: (() => number) | null = null,
): void {
  if (data.buildings.length === 0) return;

  const fillRng = seededPRNG(`${seed}_city_${cityName}_buildings_render`);
  ctx.lineWidth = BUILDING_STROKE_WIDTH;
  ctx.lineJoin = 'round';

  for (const b of data.buildings) {
    if (b.vertices.length < 3) continue;
    // Advance the non-ruin fill stream even when collapsing so the stream
    // position matches non-ruin runs up to any survivor.
    const fillIdx = Math.floor(fillRng() * BUILDING_FILLS.length);
    if (ruinRng && ruinRng() < RUIN_BUILDING_COLLAPSE_PROB) continue;

    traceClosedRing(ctx, b.vertices);
    if (ruinRng) {
      ctx.fillStyle   = RUIN_BUILDING_FILL;
      ctx.strokeStyle = RUIN_BUILDING_OUTLINE;
    } else {
      ctx.fillStyle   = BUILDING_FILLS[fillIdx];
      ctx.strokeStyle = BUILDING_OUTLINE;
    }
    ctx.fill();
    ctx.stroke();
  }
}

// [Voronoi-polygon] Render every entry in `data.sprawlBuildings`. Each sprawl
// building carries a `vertices` polygon ring produced by shrinking the parent
// polygon toward its centroid (see `cityMapSprawl.ts`). Same polygon-path draw
// logic as `drawBuildings` — only ink / stroke width differ.
//
// When `ruinRng` is non-null, each sprawl building rolls an independent
// collapse probability (higher than interior buildings — outside-walls
// structures are typically wooden / wattle and would decay faster).
function drawSprawl(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  ruinRng: (() => number) | null = null,
): void {
  if (data.sprawlBuildings.length === 0) return;

  const ink = ruinRng ? RUIN_SPRAWL_INK : SPRAWL_INK;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = SPRAWL_STROKE_WIDTH;
  ctx.lineJoin = 'round';

  for (const b of data.sprawlBuildings) {
    if (b.vertices.length < 3) continue;
    if (ruinRng && ruinRng() < RUIN_SPRAWL_COLLAPSE_PROB) continue;
    traceClosedRing(ctx, b.vertices);
    if (b.solid) {
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

// Block roles that count as "inside the city". External blocks (slum /
// agricultural) sit outside the wall footprint and belong to the fringe —
// the overgrowth pass skips them so decay reads as the biome reclaiming
// the civic / residential core, not a uniform green wash over the canvas.
// `dock` blocks sit on water and are also excluded.
const RUIN_INTERIOR_ROLES: ReadonlySet<string> = new Set<string>([
  'civic',
  'market',
  'residential',
  'harbor',
  // Craft & industry districts are inside the city footprint and should
  // receive the overgrowth / decay treatment in ruin cities.
  'forge',
  'tannery',
  'textile',
  'potters',
  'mill',
  // Trade & finance districts — all four are interior and should also
  // receive the overgrowth / decay wash in ruin cities.
  'foreign_quarter',
  'caravanserai',
  'bankers_row',
  'warehouse_row',
]);

// Convert a `#rrggbb` color to an `rgba(r,g,b,a)` string. Used to derive the
// overgrowth and moss fill colors from the `BIOME_OUTSIDE_FILL` table at
// render time without maintaining a parallel alpha-baked palette.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// [Voronoi-polygon] Ruin overgrowth post-pass. Two sub-passes, both scoped
// to *interior* city blocks (civic / market / residential / harbor) so the
// biome tint reads as nature reclaiming the ruined city — external sprawl
// fringe stays its biome-colored block background and is not double-tinted.
//
//   1. For each interior polygon, flip a coin — on hit, fill the polygon's
//      ring with the city's biome colour (from `BIOME_OUTSIDE_FILL`) at
//      alpha 0.55, so the underlying streets / buildings / walls bleed
//      through as faded outlines under the tint.
//   2. For each remaining interior building, flip a coin — on hit, stipple
//      1–3 small biome-colored dots at random vertices of the building ring
//      at alpha 0.85 to suggest moss / vines on the surviving walls. Sprawl
//      buildings are skipped — they live on external blocks and already sit
//      on a biome-colored background.
//
// Runs late (after every infrastructure + building layer) so the reclaim
// pass sits on top of all the decayed structure. Drawn before the city
// name label so the name stays readable.
function drawRuinOvergrowth(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  env: CityEnvironment,
  rng: () => number,
): void {
  // Interior polygon set from block roles — the authoritative "inside the
  // city" partition maintained by `cityMapBlocks.ts`. Using block.role here
  // (rather than `wall.interiorPolygonIds`) keeps the filter consistent
  // with the same interior/exterior semantics the block layer uses. Water
  // polygons and mountain polygons never land in interior-role blocks, so
  // this one membership check subsumes the previous per-kind exclusions.
  const interiorIds = new Set<number>();
  for (const block of data.blocks) {
    if (!RUIN_INTERIOR_ROLES.has(block.role)) continue;
    for (const pid of block.polygonIds) interiorIds.add(pid);
  }

  // Resolve biome palette; fall back to the same neutral used by
  // `drawBlockBackgrounds` if the biome key somehow isn't in the table.
  const biomeHex = BIOME_OUTSIDE_FILL[env.biome] ?? '#e0dcc8';
  const fillColor = hexToRgba(biomeHex, RUIN_OVERGROWTH_FILL_ALPHA);
  const mossColor = hexToRgba(biomeHex, RUIN_MOSS_FILL_ALPHA);

  // Pass 1 — polygon overgrowth fills (interior only).
  ctx.fillStyle = fillColor;
  ctx.lineJoin = 'round';
  for (const polygon of data.polygons) {
    if (!interiorIds.has(polygon.id)) continue;
    if (polygon.vertices.length < 3) continue;
    if (rng() >= RUIN_OVERGROWTH_POLY_PROB) continue;
    tracePolygonRing(ctx, polygon);
    ctx.fill();
  }

  // Pass 2 — moss dots on interior buildings. Sprawl is intentionally
  // skipped: its parent blocks (slum / agricultural) are external.
  ctx.fillStyle = mossColor;
  for (const b of data.buildings) {
    if (!interiorIds.has(b.polygonId)) continue;
    if (b.vertices.length < 3) continue;
    if (rng() >= RUIN_OVERGROWTH_BLDG_PROB) continue;
    const dots = RUIN_OVERGROWTH_MOSS_DOT_MIN +
      Math.floor(rng() * (RUIN_OVERGROWTH_MOSS_DOT_MAX - RUIN_OVERGROWTH_MOSS_DOT_MIN + 1));
    for (let i = 0; i < dots; i++) {
      const vi = Math.floor(rng() * b.vertices.length);
      const [vx, vy] = b.vertices[vi];
      ctx.beginPath();
      ctx.arc(vx, vy, RUIN_MOSS_RADIUS, 0, Math.PI * 2);
      ctx.fill();
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

// Draw text with a black outline so it stays readable against any background.
// Stroke (outline) is drawn first, fill (white) on top.
function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  outlineWidth: number,
): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 4 (slice) — landmarks (castle / palace / temple / monument) on Layer 12
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Phase 7: fill the polygon areas for park / market /
// civic_square landmarks. Drawn at Layer 9 depth (before streets/buildings)
// so infrastructure ink sits on top of the area fills. No RNG — purely
// geometric. Area fills for glyphed kinds (castle/palace/etc.) are skipped;
// those polygons get the cream base and the glyph drawn on top.
function drawLandmarkFills(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.landmarks.length === 0) return;
  for (const lm of data.landmarks) {
    if (lm.kind === 'civic_square') {
      const polygon = data.polygons[lm.polygonId];
      if (!polygon || polygon.vertices.length < 3) continue;
      ctx.fillStyle = OPEN_SPACE_SQUARE_FILL;
      ctx.strokeStyle = OPEN_SPACE_SQUARE_STROKE;
      ctx.lineWidth = 1;
      tracePolygonRing(ctx, polygon);
      ctx.fill();
      ctx.stroke();
    } else if (lm.kind === 'market') {
      const polygon = data.polygons[lm.polygonId];
      if (!polygon || polygon.vertices.length < 3) continue;
      ctx.fillStyle = OPEN_SPACE_MARKET_FILL;
      ctx.strokeStyle = OPEN_SPACE_MARKET_STROKE;
      ctx.lineWidth = 1;
      tracePolygonRing(ctx, polygon);
      ctx.fill();
      ctx.stroke();
    } else if (lm.kind === 'park') {
      ctx.fillStyle = OPEN_SPACE_PARK_FILL;
      ctx.strokeStyle = OPEN_SPACE_PARK_STROKE;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      const pids = lm.polygonIds ?? [lm.polygonId];
      for (const pid of pids) {
        const polygon = data.polygons[pid];
        if (!polygon || polygon.vertices.length < 3) continue;
        tracePolygonRing(ctx, polygon);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// [Voronoi-polygon] Phase 7 cutover: render LandmarkV2 glyphs and scatter —
// glyphs (castle/palace/temple/monument/wonder), Phase 4 quarter glyphs
// (forge, barracks, temple_quarter, foreign_quarter, …) anchored to each
// landmark's polygon site via `drawDistrictGlyph`, plus scatter decorations
// (market stalls, park trees).
//
// Quarters reuse the white-disc + role-icon style of `drawDistrictGlyph` so
// they read the same as the block-level fallback that `drawDistrictIcons`
// would otherwise draw — `drawDistrictIcons` skips any block whose polygons
// host a landmark, so the quarter glyph stands in for the block icon at the
// landmark's specific polygon.
//
// Name labels are split into `drawLandmarkLabels` so the popup's `Icons` and
// `Labels` checkboxes can toggle them independently.
//
// RNG sub-streams `_landmarks_render_markets` and `_landmarks_render_parks`
// are distinct from the old `_openspaces_render_*` streams (iteration order
// may differ after Phase 7 promotion) so re-rendering is byte-stable per
// city without re-running the generator.
function drawLandmarkGlyphs(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  seed: string,
  cityName: string,
): void {
  if (data.landmarks.length === 0) return;

  // ── Glyph pass ────────────────────────────────────────────────────────────
  for (const lm of data.landmarks) {
    const polygon = data.polygons[lm.polygonId];
    if (!polygon) continue;
    const sz = landmarkGlyphSize(polygon);
    const [cx, cy] = polygon.site;
    const colors = LANDMARK_COLORS[lm.kind] ?? LANDMARK_FALLBACK_COLORS;
    const { fill, ink } = colors;
    switch (lm.kind) {
      case 'castle':   drawCastleGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'palace':   drawPalaceGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'temple':   drawTempleGlyph(ctx, cx, cy, sz, fill, ink); break;
      case 'wonder':   drawMonumentGlyph(ctx, cx, cy, sz, fill, ink); break;
      // park/market/civic_square fills were already drawn in drawLandmarkFills;
      // glyphs and scatter are handled in the passes below.
      case 'park':
      case 'market':
      case 'civic_square':
        break;
      // Phase 4 quarter kinds: dispatch through the shared role-icon helper
      // so each quarter gets its own white-disc + role glyph at its polygon.
      default:
        drawDistrictGlyph(ctx, cx, cy, DISTRICT_ICON_SIZE, lm.kind, fill, ink);
        break;
    }
  }

  // ── Scatter pass: market stalls ──────────────────────────────────────────
  const stallRng = seededPRNG(`${seed}_city_${cityName}_landmarks_render_markets`);
  ctx.fillStyle = MARKET_STALL_INK;
  for (const lm of data.landmarks) {
    if (lm.kind !== 'market') continue;
    const polygon = data.polygons[lm.polygonId];
    if (!polygon || polygon.vertices.length < 3) continue;
    const stallCount = randIntInclusive(stallRng, MARKET_STALLS_PER_POLYGON_MIN, MARKET_STALLS_PER_POLYGON_MAX);
    const spread = Math.sqrt(polygon.area) * 0.32;
    for (let i = 0; i < stallCount; i++) {
      const [px, py] = scatterInsidePolygon(polygon, stallRng, spread);
      ctx.beginPath();
      ctx.arc(px, py, MARKET_STALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Scatter pass: park trees ─────────────────────────────────────────────
  const treeRng = seededPRNG(`${seed}_city_${cityName}_landmarks_render_parks`);
  ctx.fillStyle = PARK_TREE_FILL;
  ctx.strokeStyle = PARK_TREE_STROKE;
  ctx.lineWidth = 0.75;
  for (const lm of data.landmarks) {
    if (lm.kind !== 'park') continue;
    const pids = lm.polygonIds ?? [lm.polygonId];
    for (const pid of pids) {
      const polygon = data.polygons[pid];
      if (!polygon || polygon.vertices.length < 3) continue;
      const treeCount = randIntInclusive(treeRng, PARK_TREES_PER_POLYGON_MIN, PARK_TREES_PER_POLYGON_MAX);
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

// [Voronoi-polygon] Render the name label below each labelled landmark
// (castle / palace / wonder / park / market — see `LANDMARK_LABEL_TYPES`).
// Split out from `drawLandmarkGlyphs` so the popup's Labels checkbox can
// toggle these independently of the icon glyphs.
function drawLandmarkLabels(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.landmarks.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const lm of data.landmarks) {
    if (!LANDMARK_LABEL_TYPES.has(lm.kind)) continue;
    const polygon = data.polygons[lm.polygonId];
    if (!polygon) continue;
    const sz = landmarkGlyphSize(polygon);
    const [cx, cy] = polygon.site;
    const fontPx = Math.max(8, Math.round(sz * 0.35));
    ctx.font = `bold ${fontPx}px Georgia, 'Times New Roman', serif`;
    const label = lm.name ?? lm.kind.replace(/_/g, ' ').toUpperCase();
    drawOutlinedText(ctx, label, cx, cy + sz / 2 + 1, 2.5);
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

// ─────────────────────────────────────────────────────────────────────────────
// District icons — small role-identifying glyphs drawn at each block's
// centroid. Shown only when `showIcons` is true in `renderCityMapV2`.
//
// Design rules:
//   - White background disc for readability on any block-fill color.
//   - Each glyph is drawn at DISTRICT_ICON_SIZE (16 px bounding box, s=8 px
//     half-size) centered on the block centroid.
//   - Colors are lighter versions of the block background fills so the icon
//     reads as part of the block's theme.
//   - Blocks that host a landmark glyph are skipped to avoid overlap.
//   - slum / agricultural / dock blocks are skipped — outside-walls territory
//     whose identity is already clear from the biome tint / plank styling.
// ─────────────────────────────────────────────────────────────────────────────

const DISTRICT_ICON_SIZE = 16;
const DISTRICT_ICON_BG_ALPHA = 0.85;

// Icon palette: slightly lighter/brighter than the block background fills.
const DISTRICT_ICON_PALETTE: Partial<Record<DistrictType, [fill: string, ink: string]>> = {
  civic:              ['#f0e8d8', '#3a2810'],
  market:             ['#f8eebc', '#5a3000'],
  harbor:             ['#b8d4e8', '#1a3858'],
  residential_high:   ['#ece4d4', '#3a2810'],
  residential_medium: ['#e8e0d0', '#3a2810'],
  residential_low:    ['#e4dccc', '#3a2810'],
  industry:           ['#dcc8a8', '#2a1a0a'],
  education_faith:    ['#e8cce8', '#280838'],
  military:           ['#b0c078', '#20280a'],
  trade:              ['#f4e4ac', '#3a2a08'],
  entertainment:      ['#f8c890', '#3a1a00'],
};

// Roles that do not receive a district icon (exterior / outcast ground).
const NO_DISTRICT_ICON: ReadonlySet<DistrictType> = new Set<DistrictType>([
  'slum', 'agricultural', 'dock', 'excluded',
]);

// [Voronoi-polygon] Compute the arithmetic mean of `site` positions across
// all valid polygons in a block's `polygonIds`. Falls back to canvas center.
function blockCentroid(polygonIds: number[], polygons: CityPolygon[]): [number, number] {
  let x = 0, y = 0, n = 0;
  for (const pid of polygonIds) {
    const p = polygons[pid];
    if (!p) continue;
    x += p.site[0]; y += p.site[1]; n++;
  }
  return n > 0 ? [x / n, y / n] : [500, 500];
}

// [Voronoi-polygon] Render a small role icon at the centroid of every
// interior block that has a defined palette entry. Blocks that already host
// a landmark glyph on any of their polygons are skipped to avoid overlap.
function drawDistrictIcons(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.blocks.length === 0) return;

  // Set of polygons that host a landmark — skip those blocks.
  const landmarkPolygons = new Set((data.landmarks).map(lm => lm.polygonId));

  for (const block of data.blocks) {
    if (NO_DISTRICT_ICON.has(block.role)) continue;
    const palette = DISTRICT_ICON_PALETTE[block.role];
    if (!palette) continue;
    if (block.polygonIds.some(pid => landmarkPolygons.has(pid))) continue;

    const [cx, cy] = blockCentroid(block.polygonIds, data.polygons);
    const [fill, ink] = palette;
    drawDistrictGlyph(ctx, cx, cy, DISTRICT_ICON_SIZE, block.role, fill, ink);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 5 (slice) — district labels on Layer 13
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Draw each block's name as a small white-fill label with a
// dark outline, centered on the block centroid and rotated along the block's
// principal axis (angle pre-computed by the generator via PCA of polygon sites).
// Font size is also pre-computed per block (8–13 px) so labels scale with
// polygon area — larger polygons in small cities get slightly bigger text.
// Skips exterior roles (slum / agricultural / dock / festival_grounds /
// gallows_hill) and landmark-hosting blocks — both handled at generation time,
// so `data.districtLabels` is already the filtered set.
function drawDistrictLabels(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.districtLabels.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const lbl of data.districtLabels) {
    const { text, cx, cy, angle, fontSize } = lbl;
    ctx.save();
    ctx.translate(cx, cy);
    if (angle !== 0) ctx.rotate(angle);
    ctx.font = `bold ${fontSize}px Georgia, 'Times New Roman', serif`;
    drawOutlinedText(ctx, text, 0, 0, Math.max(2, fontSize * 0.28));
    ctx.restore();
  }
}

// Draw a single district glyph: white background disc + role-specific icon.
function drawDistrictGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  role: string,
  fill: string,
  ink: string,
): void {
  const s = size / 2;

  // White background disc.
  ctx.beginPath();
  ctx.arc(cx, cy, s * 1.25, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${DISTRICT_ICON_BG_ALPHA})`;
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (role) {
    case 'civic':             drawCivicIcon(ctx, s, fill, ink); break;
    case 'residential':
    case 'residential_high':
    case 'residential_medium':
    case 'residential_low':   drawResidentialIcon(ctx, s, fill, ink); break;
    case 'harbor':            drawHarborIcon(ctx, s, fill, ink); break;
    case 'market':            drawMarketIcon(ctx, s, fill, ink); break;
    case 'industry':          drawForgeIcon(ctx, s, fill, ink); break;
    case 'education_faith':   drawAcademiaIcon(ctx, s, fill, ink); break;
    case 'military':          drawBarracksIcon(ctx, s, fill, ink); break;
    case 'trade':             drawCaravanseraiIcon(ctx, s, fill, ink); break;
    case 'entertainment':     drawTheaterIcon(ctx, s, fill, ink); break;
    case 'forge':            drawForgeIcon(ctx, s, fill, ink); break;
    case 'tannery':          drawTanneryIcon(ctx, s, fill, ink); break;
    case 'textile':          drawTextileIcon(ctx, s, fill, ink); break;
    case 'potters':          drawPottersIcon(ctx, s, fill, ink); break;
    case 'mill':             drawMillIcon(ctx, s, fill, ink); break;
    case 'temple_quarter':   drawTempleQuarterIcon(ctx, s, fill, ink); break;
    case 'necropolis':       drawNecropolisIcon(ctx, s, fill, ink); break;
    case 'academia':         drawAcademiaIcon(ctx, s, fill, ink); break;
    case 'plague_ward':      drawPlagueWardIcon(ctx, s, fill, ink); break;
    case 'archive':          drawArchiveIcon(ctx, s, fill, ink); break;
    case 'barracks':         drawBarracksIcon(ctx, s, fill, ink); break;
    case 'citadel':          drawCitadelIcon(ctx, s, fill, ink); break;
    case 'arsenal':          drawArsenalIcon(ctx, s, fill, ink); break;
    case 'watchmen':         drawWatchmenIcon(ctx, s, fill, ink); break;
    case 'foreign_quarter':  drawForeignQuarterIcon(ctx, s, fill, ink); break;
    case 'caravanserai':     drawCaravanseraiIcon(ctx, s, fill, ink); break;
    case 'bankers_row':      drawBankersRowIcon(ctx, s, fill, ink); break;
    case 'warehouse':        drawWarehouseRowIcon(ctx, s, fill, ink); break;
    case 'theater':          drawTheaterIcon(ctx, s, fill, ink); break;
    case 'bathhouse':        drawBathhouseIcon(ctx, s, fill, ink); break;
    case 'pleasure':         drawPleasureQuarterIcon(ctx, s, fill, ink); break;
    case 'festival':         drawTheaterIcon(ctx, s, fill, ink); break;
    case 'ghetto_marker':    drawGhettoIcon(ctx, s, fill, ink); break;
    case 'workhouse':        drawWorkhouseIcon(ctx, s, fill, ink); break;
    case 'gallows':          drawWorkhouseIcon(ctx, s, fill, ink); break;
  }

  ctx.restore();
}

// ── Civic: 3 columns + entablature (Greco-Roman civic hall) ─────────────────
function drawCivicIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  const lw = Math.max(0.4, s * 0.1);
  ctx.lineWidth = lw;
  const cw = s * 0.18;
  // 3 pillars
  for (const xOff of [-s * 0.42, 0, s * 0.42]) {
    ctx.fillStyle = fill; ctx.strokeStyle = ink;
    ctx.fillRect(xOff - cw / 2, -s * 0.48, cw, s * 0.88);
    ctx.strokeRect(xOff - cw / 2, -s * 0.48, cw, s * 0.88);
  }
  // Entablature (wider top bar)
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.fillRect(-s * 0.75, -s * 0.78, s * 1.5, s * 0.3);
  ctx.strokeRect(-s * 0.75, -s * 0.78, s * 1.5, s * 0.3);
  // Base step
  ctx.fillRect(-s * 0.75, s * 0.4, s * 1.5, s * 0.25);
  ctx.strokeRect(-s * 0.75, s * 0.4, s * 1.5, s * 0.25);
}

// ── Residential: simple house shape ─────────────────────────────────────────
function drawResidentialIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  // Body
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.fillRect(-s * 0.62, -s * 0.1, s * 1.24, s * 0.82);
  ctx.strokeRect(-s * 0.62, -s * 0.1, s * 1.24, s * 0.82);
  // Roof triangle
  ctx.beginPath();
  ctx.moveTo(-s * 0.75, -s * 0.1);
  ctx.lineTo(0, -s * 0.82);
  ctx.lineTo(s * 0.75, -s * 0.1);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Door
  ctx.fillStyle = ink;
  ctx.fillRect(-s * 0.18, s * 0.32, s * 0.36, s * 0.4);
}

// ── Harbor: anchor (ring + shaft + crossbar + flukes) ───────────────────────
function drawHarborIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.5, s * 0.13);
  // Ring at top
  ctx.beginPath();
  ctx.arc(0, -s * 0.6, s * 0.22, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Vertical shaft
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.38);
  ctx.lineTo(0, s * 0.52);
  ctx.stroke();
  // Crossbar
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.22);
  ctx.lineTo(s * 0.5, -s * 0.22);
  ctx.stroke();
  // Curved flukes (two short arcs at bottom)
  ctx.beginPath();
  ctx.arc(-s * 0.35, s * 0.42, s * 0.22, -Math.PI * 0.25, Math.PI * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.35, s * 0.42, s * 0.22, Math.PI * 0.35, -Math.PI * 0.65, true);
  ctx.stroke();
}

// ── Market: awning + open stall ──────────────────────────────────────────────
function drawMarketIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  // Stall body
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.fillRect(-s * 0.52, -s * 0.05, s * 1.04, s * 0.68);
  ctx.strokeRect(-s * 0.52, -s * 0.05, s * 1.04, s * 0.68);
  // Awning (trapezoid)
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, -s * 0.05);
  ctx.lineTo(-s * 0.52, -s * 0.58);
  ctx.lineTo(s * 0.52, -s * 0.58);
  ctx.lineTo(s * 0.72, -s * 0.05);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Two stall goods
  ctx.fillStyle = ink;
  ctx.fillRect(-s * 0.38, s * 0.08, s * 0.24, s * 0.26);
  ctx.fillRect(s * 0.14, s * 0.08, s * 0.24, s * 0.26);
}

// ── Forge: anvil shape ──────────────────────────────────────────────────────
function drawForgeIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Anvil top body
  ctx.fillRect(-s * 0.62, -s * 0.35, s * 1.24, s * 0.48);
  ctx.strokeRect(-s * 0.62, -s * 0.35, s * 1.24, s * 0.48);
  // Horn (left protrusion)
  ctx.beginPath();
  ctx.moveTo(-s * 0.62, -s * 0.35);
  ctx.lineTo(-s * 0.62, s * 0.13);
  ctx.lineTo(-s * 0.9, -s * 0.1);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Pedestal base
  ctx.fillRect(-s * 0.38, s * 0.13, s * 0.76, s * 0.52);
  ctx.strokeRect(-s * 0.38, s * 0.13, s * 0.76, s * 0.52);
}

// ── Tannery: barrel with hoops ──────────────────────────────────────────────
function drawTanneryIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.52, s * 0.72, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Barrel hoops (3)
  ctx.lineWidth = Math.max(0.3, s * 0.08);
  for (const hy of [-s * 0.38, 0, s * 0.38]) {
    ctx.beginPath();
    ctx.ellipse(0, hy, s * 0.52, s * 0.13, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ── Textile: thread spool / bobbin ──────────────────────────────────────────
function drawTextileIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  // Top flange
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.52, s * 0.48, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Bottom flange
  ctx.beginPath();
  ctx.ellipse(0, s * 0.52, s * 0.48, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Barrel body
  ctx.fillRect(-s * 0.2, -s * 0.52, s * 0.4, s * 1.04);
  ctx.strokeRect(-s * 0.2, -s * 0.52, s * 0.4, s * 1.04);
  // Thread wound around (diagonal lines)
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.3, s * 0.07);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, i * s * 0.2);
    ctx.lineTo(s * 0.2, i * s * 0.2 + s * 0.07);
    ctx.stroke();
  }
}

// ── Potters: pot / vase shape ────────────────────────────────────────────────
function drawPottersIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  // Vase body via bezier
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, -s * 0.72);
  ctx.lineTo(s * 0.2, -s * 0.72);
  ctx.bezierCurveTo(s * 0.62, -s * 0.35, s * 0.68, s * 0.2, s * 0.52, s * 0.58);
  ctx.lineTo(-s * 0.52, s * 0.58);
  ctx.bezierCurveTo(-s * 0.68, s * 0.2, -s * 0.62, -s * 0.35, -s * 0.2, -s * 0.72);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Rim at top
  ctx.fillRect(-s * 0.28, -s * 0.85, s * 0.56, s * 0.15);
  ctx.strokeRect(-s * 0.28, -s * 0.85, s * 0.56, s * 0.15);
}

// ── Mill: 4-blade windmill ────────────────────────────────────────────────────
function drawMillIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // 4 blades radiating from hub (each is a filled lozenge)
  const bladeR = s * 0.78;
  const bladeW = s * 0.2;
  const angles = [Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4];
  ctx.lineWidth = Math.max(0.3, s * 0.08);
  for (const a of angles) {
    const ex = Math.cos(a) * bladeR;
    const ey = Math.sin(a) * bladeR;
    const px = -Math.sin(a) * bladeW;
    const py = Math.cos(a) * bladeW;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex / 2 + px / 2, ey / 2 + py / 2);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex / 2 - px / 2, ey / 2 - py / 2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  // Central hub circle
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

// ── Temple quarter: pediment + 3 columns ─────────────────────────────────────
function drawTempleQuarterIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Triangular pediment
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, -s * 0.15);
  ctx.lineTo(0, -s * 0.78);
  ctx.lineTo(s * 0.72, -s * 0.15);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 3 columns
  const cw = s * 0.16;
  for (const xOff of [-s * 0.4, 0, s * 0.4]) {
    ctx.fillRect(xOff - cw / 2, -s * 0.15, cw, s * 0.88);
    ctx.strokeRect(xOff - cw / 2, -s * 0.15, cw, s * 0.88);
  }
  // Base
  ctx.fillRect(-s * 0.72, s * 0.68, s * 1.44, s * 0.2);
  ctx.strokeRect(-s * 0.72, s * 0.68, s * 1.44, s * 0.2);
}

// ── Necropolis: tombstone (arch-topped rectangle + cross) ────────────────────
function drawNecropolisIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  const hw = s * 0.5;
  const bodyTop = -s * 0.2;
  const bodyBot = s * 0.75;
  // Arch-topped tombstone path
  ctx.beginPath();
  ctx.moveTo(-hw, bodyTop);
  ctx.arc(0, bodyTop, hw, Math.PI, 0, false);
  ctx.lineTo(hw, bodyBot);
  ctx.lineTo(-hw, bodyBot);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Cross
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(0.4, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, bodyTop + s * 0.08);
  ctx.lineTo(0, bodyBot - s * 0.1);
  ctx.moveTo(-s * 0.28, bodyTop + s * 0.42);
  ctx.lineTo(s * 0.28, bodyTop + s * 0.42);
  ctx.stroke();
}

// ── Academia: open book ──────────────────────────────────────────────────────
function drawAcademiaIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Left page
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, -s * 0.72);
  ctx.lineTo(-s * 0.72, -s * 0.48);
  ctx.lineTo(-s * 0.72, s * 0.62);
  ctx.lineTo(-s * 0.06, s * 0.72);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right page
  ctx.beginPath();
  ctx.moveTo(s * 0.06, -s * 0.72);
  ctx.lineTo(s * 0.72, -s * 0.48);
  ctx.lineTo(s * 0.72, s * 0.62);
  ctx.lineTo(s * 0.06, s * 0.72);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Spine
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.5, s * 0.14);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.72);
  ctx.lineTo(0, s * 0.72);
  ctx.stroke();
  // Text lines
  ctx.lineWidth = Math.max(0.25, s * 0.06);
  for (const ty of [-s * 0.25, s * 0.08, s * 0.4]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.58, ty);
    ctx.lineTo(-s * 0.14, ty + s * 0.05);
    ctx.moveTo(s * 0.14, ty - s * 0.05);
    ctx.lineTo(s * 0.58, ty);
    ctx.stroke();
  }
}

// ── Plague ward: medical cross in circle ─────────────────────────────────────
function drawPlagueWardIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Circle
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Bold cross
  const arm = s * 0.48;
  const aw = s * 0.24;
  ctx.fillStyle = ink;
  ctx.fillRect(-aw / 2, -arm, aw, arm * 2);
  ctx.fillRect(-arm, -aw / 2, arm * 2, aw);
}

// ── Archive quarter: scroll with rolled ends ─────────────────────────────────
function drawArchiveIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Scroll body
  ctx.fillRect(-s * 0.52, -s * 0.32, s * 1.04, s * 0.64);
  ctx.strokeRect(-s * 0.52, -s * 0.32, s * 1.04, s * 0.64);
  // Left end roll (ellipse)
  ctx.beginPath();
  ctx.ellipse(-s * 0.52, 0, s * 0.2, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Right end roll
  ctx.beginPath();
  ctx.ellipse(s * 0.52, 0, s * 0.2, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Text lines on scroll body
  ctx.lineWidth = Math.max(0.25, s * 0.06);
  for (const ty of [-s * 0.16, 0, s * 0.16]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.38, ty);
    ctx.lineTo(s * 0.38, ty);
    ctx.stroke();
  }
}

// ── Barracks: crossed swords ─────────────────────────────────────────────────
function drawBarracksIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.5, s * 0.14);
  // Sword 1 (NW→SE blade)
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, -s * 0.7);
  ctx.lineTo(s * 0.58, s * 0.58);
  ctx.stroke();
  // Sword 2 (NE→SW blade)
  ctx.beginPath();
  ctx.moveTo(s * 0.7, -s * 0.7);
  ctx.lineTo(-s * 0.58, s * 0.58);
  ctx.stroke();
  // Cross-guards (perpendicular bars at center)
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(-s * 0.24, 0);
  ctx.lineTo(s * 0.24, 0);
  ctx.moveTo(0, -s * 0.24);
  ctx.lineTo(0, s * 0.24);
  ctx.stroke();
  // Pommels
  ctx.fillStyle = ink;
  for (const [px, py] of [[-s * 0.68, -s * 0.68], [s * 0.68, -s * 0.68]] as [number, number][]) {
    ctx.beginPath();
    ctx.arc(px, py, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Citadel: tower with crenellations ────────────────────────────────────────
function drawCitadelIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Tower body
  ctx.fillRect(-s * 0.44, -s * 0.38, s * 0.88, s * 1.1);
  ctx.strokeRect(-s * 0.44, -s * 0.38, s * 0.88, s * 1.1);
  // 3 merlons (battlements on top)
  const mw = s * 0.24;
  const mh = s * 0.28;
  for (const xOff of [-s * 0.28, 0, s * 0.28]) {
    ctx.fillRect(xOff - mw / 2, -s * 0.66, mw, mh);
    ctx.strokeRect(xOff - mw / 2, -s * 0.66, mw, mh);
  }
  // Window slit
  ctx.fillStyle = ink;
  ctx.fillRect(-s * 0.08, -s * 0.1, s * 0.16, s * 0.34);
}

// ── Arsenal: heater shield with central boss ─────────────────────────────────
function drawArsenalIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Shield outline (heater shape: straight top + curved taper to bottom point)
  ctx.beginPath();
  ctx.moveTo(-s * 0.68, -s * 0.68);
  ctx.lineTo(s * 0.68, -s * 0.68);
  ctx.lineTo(s * 0.68, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.68, s * 0.6, 0, s * 0.82);
  ctx.quadraticCurveTo(-s * 0.68, s * 0.6, -s * 0.68, -s * 0.1);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Central boss (circle)
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(0, s * 0.08, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

// ── Watchmen precinct: lantern with panes ────────────────────────────────────
function drawWatchmenIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Lantern body (hexagon rotated 30°)
  const r = s * 0.52;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const lx = Math.cos(a) * r;
    const ly = Math.sin(a) * r + s * 0.12;
    if (i === 0) ctx.moveTo(lx, ly);
    else ctx.lineTo(lx, ly);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Handle arc at top
  ctx.beginPath();
  ctx.arc(0, -s * 0.52, s * 0.22, Math.PI, 0, false);
  ctx.stroke();
  // Pane cross dividers
  ctx.lineWidth = Math.max(0.3, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.28);
  ctx.lineTo(0, s * 0.6);
  ctx.moveTo(-s * 0.44, s * 0.12);
  ctx.lineTo(s * 0.44, s * 0.12);
  ctx.stroke();
  // Warm glow fill
  ctx.fillStyle = 'rgba(255, 220, 100, 0.5)';
  ctx.beginPath();
  ctx.arc(0, s * 0.08, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

// ── Foreign quarter: crescent-banner on a pole ──────────────────────────────
function drawForeignQuarterIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.5, s * 0.12);
  ctx.strokeStyle = ink;
  // Flagpole
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.78);
  ctx.lineTo(-s * 0.42, s * 0.72);
  ctx.stroke();
  // Pennon: triangular banner swept to the right
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.72);
  ctx.lineTo(s * 0.58, -s * 0.42);
  ctx.lineTo(-s * 0.42, -s * 0.12);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Crescent moon on the banner — outer arc minus a clipped inner arc for
  // the classic "crescent with horns" silhouette.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(s * 0.02, -s * 0.42, s * 0.18, -Math.PI * 0.6, Math.PI * 0.6);
  ctx.arc(s * 0.10, -s * 0.42, s * 0.18, Math.PI * 0.5, -Math.PI * 0.5, true);
  ctx.closePath();
  ctx.fill();
  // Pole finial
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(-s * 0.42, -s * 0.82, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

// ── Caravanserai: tented wagon with pack canopy ─────────────────────────────
function drawCaravanseraiIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Wagon bed (rectangle)
  ctx.fillRect(-s * 0.62, s * 0.12, s * 1.24, s * 0.32);
  ctx.strokeRect(-s * 0.62, s * 0.12, s * 1.24, s * 0.32);
  // Curved canopy (arch above the bed)
  ctx.beginPath();
  ctx.moveTo(-s * 0.62, s * 0.12);
  ctx.quadraticCurveTo(0, -s * 0.72, s * 0.62, s * 0.12);
  ctx.lineTo(-s * 0.62, s * 0.12);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Canopy ribs (two thin arcs for that tented look)
  ctx.lineWidth = Math.max(0.3, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(-s * 0.25, s * 0.12);
  ctx.quadraticCurveTo(-s * 0.25, -s * 0.34, 0, -s * 0.48);
  ctx.moveTo(s * 0.25, s * 0.12);
  ctx.quadraticCurveTo(s * 0.25, -s * 0.34, 0, -s * 0.48);
  ctx.stroke();
  // Two wheels (filled circles)
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(-s * 0.38, s * 0.58, s * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.38, s * 0.58, s * 0.16, 0, Math.PI * 2); ctx.fill();
}

// ── Bankers row: stack of three coins ───────────────────────────────────────
function drawBankersRowIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.09);
  ctx.strokeStyle = ink;
  // Three stacked discs (back to front): bottom coin widest, top coin narrowest
  // to imply a leaning stack. All share the same colors for a gold-pile read.
  const cx = 0;
  const rOuter = s * 0.44;
  const rInner = s * 0.3;
  const ellH = s * 0.14;

  // Helper — draw one elliptical coin at vertical offset `oy`.
  function coin(oy: number): void {
    ctx.fillStyle = fill;
    // Front face
    ctx.beginPath();
    ctx.ellipse(cx, oy, rOuter, ellH, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Slot on the face
    ctx.beginPath();
    ctx.moveTo(cx - rInner * 0.45, oy);
    ctx.lineTo(cx + rInner * 0.45, oy);
    ctx.stroke();
  }

  // Draw bottom to top so each disc covers the one behind it.
  coin(s * 0.44);
  coin(s * 0.14);
  coin(-s * 0.18);
  // Tiny sparkle dot near the top coin for the "wealth" feel.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(s * 0.34, -s * 0.44, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

// ── Warehouse row: gable-roofed shed with a side door ───────────────────────
function drawWarehouseRowIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Shed body (wider than a house icon)
  ctx.fillRect(-s * 0.72, -s * 0.05, s * 1.44, s * 0.72);
  ctx.strokeRect(-s * 0.72, -s * 0.05, s * 1.44, s * 0.72);
  // Shallow gable roof (trapezoidal)
  ctx.beginPath();
  ctx.moveTo(-s * 0.82, -s * 0.05);
  ctx.lineTo(-s * 0.5, -s * 0.62);
  ctx.lineTo(s * 0.5, -s * 0.62);
  ctx.lineTo(s * 0.82, -s * 0.05);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Ridge cap
  ctx.lineWidth = Math.max(0.3, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.62);
  ctx.lineTo(s * 0.5, -s * 0.62);
  ctx.stroke();
  // Big cargo door (centre, darker)
  ctx.fillStyle = ink;
  ctx.fillRect(-s * 0.22, s * 0.22, s * 0.44, s * 0.45);
  // Horizontal bracing lines across the shed face
  ctx.lineWidth = Math.max(0.3, s * 0.06);
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, s * 0.22);
  ctx.lineTo(-s * 0.22, s * 0.22);
  ctx.moveTo(s * 0.22, s * 0.22);
  ctx.lineTo(s * 0.72, s * 0.22);
  ctx.stroke();
}

// ── Theater: arched proscenium with stage curtain centre-fold ───────────────
function drawTheaterIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Stage building base
  ctx.fillRect(-s * 0.7, s * 0.35, s * 1.4, s * 0.3);
  ctx.strokeRect(-s * 0.7, s * 0.35, s * 1.4, s * 0.3);
  // Arched proscenium (semicircle on top of a short rect)
  ctx.beginPath();
  ctx.moveTo(-s * 0.6, s * 0.35);
  ctx.lineTo(-s * 0.6, -s * 0.1);
  ctx.arc(0, -s * 0.1, s * 0.6, Math.PI, 0, false);
  ctx.lineTo(s * 0.6, s * 0.35);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Curtain centre fold (single vertical line)
  ctx.lineWidth = Math.max(0.3, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.lineTo(0, s * 0.35);
  ctx.stroke();
  // Two side curtain pleats
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.05);
  ctx.lineTo(-s * 0.35, s * 0.35);
  ctx.moveTo(s * 0.35, -s * 0.05);
  ctx.lineTo(s * 0.35, s * 0.35);
  ctx.stroke();
}

// ── Bathhouse: domed pool with rising steam squiggles ───────────────────────
function drawBathhouseIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.fillStyle = fill; ctx.strokeStyle = ink;
  // Pool basin (wide low rect)
  ctx.fillRect(-s * 0.7, s * 0.2, s * 1.4, s * 0.4);
  ctx.strokeRect(-s * 0.7, s * 0.2, s * 1.4, s * 0.4);
  // Dome (semicircle on top of basin)
  ctx.beginPath();
  ctx.arc(0, s * 0.2, s * 0.55, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Tiny finial on the dome
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(0, -s * 0.4, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // Steam squiggles rising above the dome (three short S-curves)
  ctx.lineWidth = Math.max(0.3, s * 0.08);
  ctx.strokeStyle = ink;
  for (const xOff of [-s * 0.3, 0, s * 0.3]) {
    ctx.beginPath();
    ctx.moveTo(xOff, -s * 0.55);
    ctx.bezierCurveTo(
      xOff + s * 0.12, -s * 0.7,
      xOff - s * 0.12, -s * 0.85,
      xOff, -s * 0.95,
    );
    ctx.stroke();
  }
}

// ── Pleasure quarter: hanging lantern silhouette ────────────────────────────
function drawPleasureQuarterIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.strokeStyle = ink;
  // Hanging cord from top
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.85);
  ctx.lineTo(0, -s * 0.55);
  ctx.stroke();
  // Lantern cap (small trapezoid)
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, -s * 0.55);
  ctx.lineTo(s * 0.22, -s * 0.55);
  ctx.lineTo(s * 0.16, -s * 0.45);
  ctx.lineTo(-s * 0.16, -s * 0.45);
  ctx.closePath();
  ctx.fill();
  // Lantern body (rounded rectangle / oval)
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, s * 0.05, s * 0.42, s * 0.5, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Horizontal ribs across the lantern (paper-lantern read)
  ctx.lineWidth = Math.max(0.3, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.18);
  ctx.lineTo(s * 0.4, -s * 0.18);
  ctx.moveTo(-s * 0.42, s * 0.05);
  ctx.lineTo(s * 0.42, s * 0.05);
  ctx.moveTo(-s * 0.4, s * 0.28);
  ctx.lineTo(s * 0.4, s * 0.28);
  ctx.stroke();
  // Tassel hanging below
  ctx.lineWidth = Math.max(0.4, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.55);
  ctx.lineTo(0, s * 0.78);
  ctx.stroke();
}

// ── Ghetto: arched walled gate (rounded arch on a plinth with a vertical bar) ─
// Reads as a walled minority quarter with a single gated entrance — spec line
// 90 ("walled minority quarter — religious/ethnic enclave, often gated at
// night"). Thick outer wall silhouette, a central arch opening, and a small
// lintel bar across the arch top.
function drawGhettoIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  // Outer wall silhouette — rounded-top rectangle (the enclosure).
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, s * 0.65);
  ctx.lineTo(-s * 0.7, -s * 0.2);
  ctx.arc(0, -s * 0.2, s * 0.7, Math.PI, 0, false);
  ctx.lineTo(s * 0.7, s * 0.65);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Central gate opening — rounded-top arch, cut out of the wall.
  ctx.fillStyle = '#f5f0e8'; // cream base so it reads as a cut-out
  ctx.beginPath();
  ctx.moveTo(-s * 0.28, s * 0.65);
  ctx.lineTo(-s * 0.28, s * 0.0);
  ctx.arc(0, s * 0.0, s * 0.28, Math.PI, 0, false);
  ctx.lineTo(s * 0.28, s * 0.65);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Lintel bar across the arch top (gated signal).
  ctx.lineWidth = Math.max(0.3, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, s * 0.0);
  ctx.lineTo(s * 0.32, s * 0.0);
  ctx.stroke();
  // Two dot studs on the wall flanking the gate (rivets / locks).
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(-s * 0.5, s * 0.28, s * 0.06, 0, Math.PI * 2);
  ctx.arc( s * 0.5, s * 0.28, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

// ── Workhouse: alms bowl with a cross above it ──────────────────────────────
// Reads as institutional charity / poorhouse — spec line 91 ("institutional
// poverty — almshouses, charity kitchens"). A small cross at top (monastic /
// charitable origin), a vertical bar descending to a shallow bowl at the
// bottom (the alms bowl or soup kettle).
function drawWorkhouseIcon(ctx: CanvasRenderingContext2D, s: number, fill: string, ink: string): void {
  ctx.lineWidth = Math.max(0.4, s * 0.1);
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  // Bowl (half-ellipse at the bottom).
  ctx.beginPath();
  ctx.moveTo(-s * 0.58, s * 0.18);
  ctx.ellipse(0, s * 0.18, s * 0.58, s * 0.38, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Rim line across the top of the bowl.
  ctx.beginPath();
  ctx.moveTo(-s * 0.58, s * 0.18);
  ctx.lineTo( s * 0.58, s * 0.18);
  ctx.stroke();
  // Steam wisp from the bowl centre.
  ctx.lineWidth = Math.max(0.3, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.05);
  ctx.quadraticCurveTo(-s * 0.12, -s * 0.1, 0, -s * 0.22);
  ctx.quadraticCurveTo( s * 0.12, -s * 0.34, 0, -s * 0.44);
  ctx.stroke();
  // Cross above the bowl (charitable / almshouse signal).
  ctx.lineWidth = Math.max(0.4, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.88);
  ctx.lineTo(0, -s * 0.5);
  ctx.moveTo(-s * 0.22, -s * 0.72);
  ctx.lineTo( s * 0.22, -s * 0.72);
  ctx.stroke();
}
