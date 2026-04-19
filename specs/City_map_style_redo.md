# Tile-based city-map restyle

## Context

The "Map" button on the Details tab opens a 720×720 canvas (CityMapPopup.tsx) that renders a procedural city view via generateCityMap + renderCityMap in src/lib/citymap/. Today the style is a Voronoi-district parchment drawing: free-form district polygons, a convex-hull wall, a smooth curving river, and rectangular buildings scattered inside polygons. The user wants a tile-edge-based medieval city map (see reference images): walls, rivers and streets snap to a grid, river can bifurcate around islands with bridges, tiles are densely packed with small top-down buildings, capitals get a castle/palace, cities get one temple per religion and one monument per wonder, plus squares/markets/parks. No background — the parchment fill and biome tint go away.
The public surface (deriveCityEnvironment, generateCityMap(seed, cityName, env), renderCityMap(ctx, data, env, cityName)) stays stable; internals get rewritten.

## Approach

### 1. Extend CityEnvironment to carry counts, not booleans
    * src/lib/citymap/cityMapGenerator.ts — replace hasWonder: boolean / hasReligion: boolean with wonderCount: number / religionCount: number. Update deriveCityEnvironment to count occurrences:
        * wonderCount = wonderCellIndices?.filter(i => i === city.cellIndex).length ?? 0
        * religionCount = religionCellIndices?.filter(i => i === city.cellIndex).length ?? 0
    * src/components/overlay/DetailsTab.tsx:520-532 already passes the full arrays — no call-site change needed.


### 2. Replace the generator with a tile-grid pipeline
New CityMapData shape (rewrite cityMapGenerator.ts):
```TS
interface CityMapData {
  grid: { w: number; h: number; tileSize: number };      // tile count + px-per-tile
  wallPath: [number, number][];                          // closed polyline on tile corners
  gates: { edge: [[number, number], [number, number]], dir: 'N'|'S'|'E'|'W' }[];
  river: { edges: [[number, number], [number, number]][], islands: Set<string> } | null;
  bridges: [[number, number], [number, number]][];       // tile edges carrying roads across river
  roads: [number, number][][];                           // edge-aligned polylines (bold)
  streets: [number, number][][];                         // edge-aligned polylines (thin)
  blocks: CityBlock[];                                   // groups of tiles inside walls
  openSpaces: { kind: 'square'|'market'|'park', tiles: [number, number][] }[];
  buildings: CityBuilding[];                             // many small top-down rects per tile
  landmarks: CityLandmark[];                             // castle/palace, temples, monuments
  districtLabels: { text: string, cx: number, cy: number, angle: number }[];
  canvasSize: number;
}
interface CityBlock { tiles: [number, number][]; role: DistrictRole; name: string; }
interface CityBuilding { x, y, w, h: number; solid: boolean; }      // axis-aligned, top-down
interface CityLandmark { tile: [number, number]; type: 'castle'|'palace'|'temple'|'monument'; }
```
Pipeline (all seeded from seed + '_city_' + cityName, seededPRNG from terrain/noise.ts):
1. Grid sizing — tile count scales with city size: small 28, medium 36, large 44, metropolis 54, megalopolis 64. tileSize = CANVAS_SIZE / gridW.
2. Wall footprint — pick a centered blobby region whose tile count = lerp(0.50, 0.85, sizeTier) * totalTiles (city occupies 50–85% of area per spec). Use a radial distance field with FBM perturbation (reuse createNoiseSamplers/fbm from terrain/noise.ts) to flag interior tiles, then take the boundary tile edges → wallPath.
3. Gates — one gate per cardinal direction: find the wall edge with largest dot-product with {N,S,E,W} that is not on the water side (env.waterSide). Skip gates on water-side.
4. River (when env.hasRiver):
    * Entry/exit: pick two non-adjacent boundary points (deterministic by seed); prefer opposite edges.
    * Route an axis-aligned path along tile edges between them using edge-graph A* with a small meander cost.
    * Bifurcation: with per-stretch probability ~35% for large+ cities, split into two parallel edge-paths offset by 1–2 tiles for 3–6 tiles then rejoin. Tiles fully surrounded by river edges become islands (flagged for buildings). Store every river edge in river.edges.
    * Bridges: for each gate→center road, if the road edge crosses a river edge, mark that edge as a bridge.
5. Main roads — A* on the tile-edge graph from each gate to the city center (or to the castle/palace tile for capitals). Roads follow edges. Cost: prefer straight continuations (turn penalty), avoid river tiles except at bridges.
6. Streets — finer edge-aligned paths: from each block boundary spur inward; use a space-filling pass that walks random edges until every interior tile touches a street within ≤1 tile.
7. Blocks + district names — flood-fill connected interior tile groups bounded by roads/streets/river/walls. Assign roles (civic near center, market adjacent, harbor on water side, residential otherwise, slum + agricultural outside walls). Name each block via a small medieval word-combiner (e.g. ELM+BANK, BLUE+GATE, RED+MARKET) keyed off block index — matches the reference labels like "BLUEGATE"/"RED MARKET".
8. Open spaces (spec: squares, markets, parks) — reserve:
    * 1 central civic square (1–2 tile block in front of castle/civic center)
    * 1 market square per market block (keep tiles empty, add stall dots later)
    * 1–3 parks in residential blocks (scaling with city size), chosen as random empty tiles.
9. Landmarks
    * Capitals: place both a castle (fortified keep, inside walls at civic) and a palace (larger ornate building at the biggest civic tile); if megalopolis, both; otherwise castle OR palace alternating by seed. Spec says "castle or palace, or both" — so: small capital → one, large+ capital → both.
    * Temples: env.religionCount temples, placed one per most-prominent civic/market block tile (avoid duplicates).
    * Monuments: env.wonderCount monuments, one per civic/market/square tile.
10. Buildings — for every interior non-reserved tile (not a road/street/river/open-space/landmark tile), pack 4–12 small axis-aligned rectangles (top-down) that fit the tile with 1px mortar. Sizes/orientations seeded. Outside-walls: sparse fringe buildings and dock hatching along water edges for harbor-side.

### 3. Rewrite the renderer
Rewrite cityMapRenderer.ts layer order (replaces the 14-layer parchment stack):

1. Clear — solid light neutral #ece5d3 (no FBM grain, no biome tint) — this is what "remove the background" means visually: a flat paper canvas, not a tinted parchment.
2. Faint big cadastral grid — 4×4 division (not 180px), rgba(0,0,0,0.12) thin lines — matches the reference image's large sparse grid.
3. Docks — parallel hatched lines along water edges (harbor/coast), drawn as short dashes perpendicular to waterline.
4. Outside-walls sprawl — small scattered building rects in fringe tiles (CityBuilding[] flagged outside walls).
5. River channel — fill cells spanned by river.edges with charcoal #6d665a; island tiles get the ground fill back. River is therefore tile-aligned; thin dark outline on river edges.
6. Streets — 2 px #b8ad92 along edges.
7. Roads — 4 px #2a241c along edges (roads bolder than streets per spec).
8. Bridges — white rectangle spanning the river tile with short ink rails.
9. Open spaces — subtle paler fill + optional park trees (small circles) or market stalls (tiny rects).
10. Buildings — top-down filled rects, mix of hollow (outline + pale fill) and solid ink (#2a241c) like the reference; dense packing per tile.
11. Walls — stroke wallPath with 3–5 px ink; tower circles at corners; gate gaps cleared and flanked with door dashes.
12. Landmarks — castle (crenellated square with towers at corners), palace (larger ornate rectangle with inner courtyard), temple (cross/dome glyph), monument (obelisk/tall rect glyph). All ink on white fill.
13. District labels — large Georgia uppercase per districtLabels (font size scales with block area), rotated along block's long axis, matching the "BLUEGATE"/"BREADGATE"/"GLASS DOCKS" look.
14. City name — top-centered bold label (keep existing 22 px Georgia).

Drop entirely: drawBackground parchment + grain + biome tint (cityMapRenderer.ts:183-210), drawTerrainFringe glyphs (L228-288), drawCoastalWater wavy polygon (we show water only through docks + river now — this is "tile-based, no background"), agricultural hatching outside walls (replaced by fringe sprawl).

### 4. Key files to modify
    * src/lib/citymap/cityMapGenerator.ts — full rewrite of the internals (new CityMapData shape, tile-grid pipeline). Keep deriveCityEnvironment and bump hasWonder/hasReligion → counts.
    * src/lib/citymap/cityMapRenderer.ts — full rewrite of renderCityMap + helpers for the new layer order.
    * src/lib/citymap/index.ts — re-export any new types if the barrel lists them.
    * src/components/CityMapPopup.tsx — no changes (same entry points, same canvas size).
    * src/components/overlay/DetailsTab.tsx — no changes (already passes wonder/religion cell-index arrays).

### 5. Utilities to reuse
    * seededPRNG, createNoiseSamplers, fbm — src/lib/terrain/noise.ts
    * INDEX_TO_CITY_SIZE — already used in deriveCityEnvironment
    * Nothing from buildCellGraph (Voronoi) — dropped in favor of the tile grid
    * Convex hull / findSharedEdge / offsetPolygon — dropped; wall tracing is now edge-following on the boundary tile set

### 6. Invariants to preserve
    * Deterministic from seed + cityName — every RNG call goes through the seeded PRNG, never Math.random().
    * generateCityMap / renderCityMap signatures unchanged; CityMapPopup still calls them the same way.
    * Canvas is still 720 px square with DPR scaling in CityMapPopup.tsx.
    * CityEnvironment fields used by other callers stay in place; only the hasWonder/hasReligion booleans change to counts (internal grep shows only cityMapGenerator.ts consumes them).

## Verification
1. npm run build — type-check passes (new CityMapData / CityEnvironment shape compiles and there are no stray consumers of the old booleans).
2. npm run dev, open any generated map with history, click a city → click Map and confirm:
    * No parchment background; flat paper canvas with faint big grid.
    * Wall is a polyline snapped to tile edges enclosing ~50–85% of the area (try small/medium/large cities — scaling visible).
    * River (where hasRiver) snakes along tile edges, with ≥1 bifurcation on large+ cities forming an island; bridges exist wherever a road crosses.
    * Every road is clearly thicker than streets; both follow edges.
    * Buildings are top-down axis-aligned rectangles, densely packed per tile.
    * Capital cities show a castle and/or palace; confirm on a capital at year ≥ 1000.
    * A city with 2 religions shows 2 temples; a city with 2 wonders shows 2 monuments (scrub year on a known multi-religion / multi-wonder city — inspect via Details tab counts).
    * Squares, markets, and parks visible as empty-ish tiles inside the walls.
3. Visual comparison against the two reference images — stylistic parity on wall thickness, dense building footprints, district label typography, river bridges.
4. Re-open the same city → identical output (seed stability).
5. npm run sweep — unaffected, since none of this touches the simulation pipeline (city-map generation is render-only).
