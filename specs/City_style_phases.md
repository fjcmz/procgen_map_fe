Here's a 5-PR breakdown. Each PR is independently buildable, visually verifiable in npm run dev, and keeps the generateCityMap / renderCityMap signatures stable.
PR 1 — Foundation: env counts, new data shape, flat-paper base
Scope: data contract + minimal renderer swap, no geometry yet.
cityMapGenerator.ts: swap hasWonder/hasReligion booleans → wonderCount/religionCount in deriveCityEnvironment (count occurrences in the already-passed cell-index arrays).
Define new CityMapData / CityBlock / CityBuilding / CityLandmark types (fields present but mostly empty arrays this PR).
Grid sizing by size tier (28/36/44/54/64) + tileSize = CANVAS_SIZE / gridW.
cityMapRenderer.ts: strip drawBackground parchment/grain/biome tint, drawTerrainFringe, drawCoastalWater, agricultural hatching. Draw layer 1 (solid #ece5d3) + layer 2 (faint 4×4 cadastral grid) + layer 14 (city name).
Barrel index.ts re-exports new types.
Verify: flat neutral canvas with city title; no regressions in CityMapPopup; sweep unaffected.
PR 2 — Walls + gates
Wall footprint via centered radial distance field + FBM perturbation (reuse createNoiseSamplers / fbm), tile count = lerp(0.50, 0.85, sizeTier) * totalTiles.
Boundary-edge walk → wallPath (closed polyline on tile corners).
Gates: pick best-aligned edge per cardinal direction, skip env.waterSide.
Renderer layer 11: stroke walls 3–5 px ink, tower circles at corners, gate gaps with flanking door dashes.
Verify: each size tier produces a recognisable walled blob with 1–4 gates and no gate on the water edge.
PR 3 — Rivers, roads, streets, bridges
River edge-graph A* with small meander cost between two non-adjacent boundary points; bifurcation on large+ cities (35% per stretch, 1–2 tile offset, 3–6 tiles then rejoin); detect island tiles.
Main roads A* from each gate to city center with turn penalty.
Streets: space-filling pass until every interior tile touches a street within ≤1 tile.
Bridges: mark road edges that cross river edges.
Renderer layers 5–8: river channel fill #6d665a with outline, streets 2 px #b8ad92, roads 4 px #2a241c, bridges as white rect + rails.
Verify: ≥1 bifurcation/island on metropolis; bridges appear wherever a road crosses river; roads visibly bolder than streets.
PR 4 — Blocks, open spaces, landmarks
Flood-fill interior tiles bounded by roads/streets/river/walls → CityBlock[] with role assignment (civic/market/harbor/residential/slum/agricultural).
Medieval name combiner (ELM+BANK, BLUE+GATE…) keyed off block index.
Open spaces: 1 central civic square, 1 market square per market block, 1–3 parks scaling with size.
Landmarks: capital castle-or-palace (small capital → one, large+ → both), religionCount temples, wonderCount monuments, placed on civic/market tiles with de-dup.
Renderer layer 9 (open-space pale fills, park circles, market stall dots) + layer 12 (castle/palace/temple/monument glyphs, all ink on white).
Verify: multi-religion/multi-wonder city shows correct counts; capitals at year ≥ 1000 show castle and/or palace.
PR 5 — Buildings, outside-walls sprawl, docks, district labels
Per-tile building packing: 4–12 axis-aligned rects per non-reserved interior tile, 1 px mortar, seeded mix of hollow outlined and solid #2a241c ink.
Outside-walls fringe: sparse scattered building rects in fringe tiles.
Dock hatching: perpendicular dashes along env.waterSide coast edges.
District labels: Georgia uppercase, font size scales with block area, rotated along block long axis.
Renderer layers 3, 4, 10, 13 wired in; final pass against reference images.
Verify: dense top-down building look matches reference; labels like "BLUEGATE"/"GLASS DOCKS" render rotated; re-opening a city → identical output (seed stability); npm run sweep still unaffected.
Cross-cutting invariants (every PR): only seededPRNG from terrain/noise.ts — no Math.random(); generateCityMap(seed, cityName, env) / renderCityMap(ctx, data, env, cityName) signatures frozen; CityMapPopup.tsx and DetailsTab.tsx untouched; npm run build green.
Want me to start on PR 1 on branch claude/city-map-style-phases-aV8Wz?
