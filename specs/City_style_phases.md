# City map generator redux
This document contains a series of sequential changes to implement a new style for the city maps. 
Each change is described as a pull request (PR) that builds on the previous ones.
Each PR in this document is independently buildable, visually verifiable in npm run dev, and keeps the generateCityMap / renderCityMap signatures stable.

## City map components
A city wil have these components with this detailed geometry:
* A city map will be 720x720 px, with an adaptative display for mobile devices.
* A city map will be composed of Voronoi polygons.
* The number of polygons will be based on the city size tier (150/250/350/500/1000)
* A capital city will have a castle or a palace or both
* A city will have a temple per religion
* A city will have a monument per wonder; higher tier wonders appear bigger
* Medium+ cities will have a wall; megalopolis will have 2 walls, one around a core area and another around the whole city
* Cities with coast and some trade will have a dock
* Cities on or next to a river cell will show the river in the map; the river will follow polygon edges and will cross the city from opposing side walls; if the city is on the coast the river must finish on the coast; a river might bifurcate and join again forming islands
* Walls will have at least on gate per main side
* Cities will have streets and roads represented along the edges between polygons; roads will always go from wall gates to the palace or castle
* Roads can cross a river and if they do they will have a bridge
* Districts will be densely packed with buildings
* Cities will have ~10% of their area covered by open spaces like squares, parks, and markets
* All buildings will be rendered from a top view
* Cities will show some sparse buildings in cells out of their area; the bigger the city the more such sparse buildings
* Cities will show roads going from the gates to the outer limits of the map, as roads connecting to other non visible cities 

## PR 0 - New Generator based on Voronoi Polygons
PR 0 - New Generator based on Voronoi Polygons
* Scope: create a new city map generator implementation that lives along the existing one but that is not used yet.
* This new city map generation appears as a new button called "MapV2" in the details tab, next to the existing "Map" button
* Goal: the new implementation will start as a dummy skeleton that will be improved in subsequent pull requests and will replace the existing generator once all the features are complete.
* Reuse as much as possible of the exist data structures.
* Ditch all the existing city map generator and renderer logic that is based on tiles.
* Extract the data structures for a city map into its own file to split the data structures from the generator and rendering logic.

## PR 1 - Foundations
PR 1 — Foundation: env counts, new data shape, flat-paper base
* Scope: data contract + minimal renderer, no geometry yet.
* Define new CityMapData / CityBlock / CityBuilding / CityLandmark types (fields present but mostly empty arrays this PR).
* Grid sizing by size tier as described.
* Renderer with draw layer 1 (solid #ece5d3) + layer 2 (faint 4×4 cadastral grid) + layer 14 (city name).
* Barrel index.ts re-exports new types.
* Verify: flat neutral canvas with city title; no regressions in CityMapPopup; sweep unaffected.

## PR 2 — Walls + gates
PR 2 — Walls + gates
* Wall footprint via centered radial distance field + FBM perturbation (reuse createNoiseSamplers / fbm), tile count = lerp(0.50, 0.85, sizeTier) * totalTiles.
* Boundary-edge walk → wallPath (closed polyline on tile corners).
* Gates: pick best-aligned edge per cardinal direction, skip env.waterSide.
* Renderer layer 11: stroke walls 3–5 px ink, tower circles at corners, gate gaps with flanking door dashes.
* Verify: each size tier produces a recognisable walled blob with 1–4 gates and no gate on the water edge.

## PR 3 — Rivers, roads, streets, bridges
PR 3 — Rivers, roads, streets, bridges
* River edge-graph A* with small meander cost between two non-adjacent boundary points; bifurcation on large+ cities (35% per stretch, 1–2 tile offset, 3–6 tiles then rejoin); detect island tiles.
* Main roads A* from each gate to city center with turn penalty.
* Streets: space-filling pass until every interior tile touches a street within ≤1 tile.
* Bridges: mark road edges that cross river edges.
* Renderer layers 5–8: river channel fill #6d665a with outline, streets 2 px #b8ad92, roads 4 px #2a241c, bridges as white rect + rails.
* Verify: ≥1 bifurcation/island on metropolis; bridges appear wherever a road crosses river; roads visibly bolder than streets.

## PR 4 — Blocks, open spaces, landmarks
PR 4 — Blocks, open spaces, landmarks
* Flood-fill interior tiles bounded by roads/streets/river/walls → CityBlock[] with role assignment (civic/market/harbor/residential/slum/agricultural).
* Medieval name combiner (ELM+BANK, BLUE+GATE…) keyed off block index.
* Open spaces: 1 central civic square, 1 market square per market block, 1–3 parks scaling with size.
* Landmarks: capital castle-or-palace (small capital → one, large+ → both), religionCount temples, wonderCount monuments, placed on civic/market tiles with de-dup.
* Renderer layer 9 (open-space pale fills, park circles, market stall dots) + layer 12 (castle/palace/temple/monument glyphs, all ink on white).
* Verify: multi-religion/multi-wonder city shows correct counts; capitals at year ≥ 1000 show castle and/or palace.

## PR 5 — Buildings, outside-walls sprawl, docks, district labels
PR 5 — Buildings, outside-walls sprawl, docks, district labels
* Per-tile building packing: 4–12 axis-aligned rects per non-reserved interior tile, 1 px mortar, seeded mix of hollow outlined and solid #2a241c ink.
* Outside-walls fringe: sparse scattered building rects in fringe tiles.
* Dock hatching: perpendicular dashes along env.waterSide coast edges.
* District labels: Georgia uppercase, font size scales with block area, rotated along block long axis.
* Renderer layers 3, 4, 10, 13 wired in; final pass against reference images.
* Verify: dense top-down building look matches reference; labels like "BLUEGATE"/"GLASS DOCKS" render rotated; re-opening a city → identical output (seed stability); npm run sweep still unaffected.

## Cross-cutting invariants
Cross-cutting invariants (every PR):
* only seededPRNG from terrain/noise.ts — no Math.random()
* generateCityMap(seed, cityName, env) / renderCityMap(ctx, data, env, cityName) signatures frozen
* CityMapPopup.tsx and DetailsTab.tsx untouched; npm run build green
