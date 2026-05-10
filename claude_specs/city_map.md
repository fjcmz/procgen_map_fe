# City Map (V1 + V2)

This file documents the **city-map popup generators and renderers** under `src/lib/citymap/`. Click a city in the Details tab to open the popup. Two coexisting versions:

- **V1** — tile-based, frozen during the migration
- **V2** — Voronoi-polygon-based, in-progress (PR 1–5)

Read `universe_map.md` for framework conventions (especially: city-map generation is **render-only**, never reached by `npm run sweep` — any non-zero sweep diff after a citymap-only change means an accidental simulation-layer edit).

## Versions

The Details tab has two city-map buttons:

- **Map** (V1) — opens `CityMapPopup.tsx`, calls `generateCityMap` / `renderCityMap` from `cityMapGenerator.ts` / `cityMapRenderer.ts`
- **MapV2** (V2) — opens `CityMapPopupV2.tsx`, calls `generateCityMapV2` / `renderCityMapV2` from `cityMapGeneratorV2.ts` / `cityMapRendererV2.ts`

They are intentionally coexisting during a phased migration tracked in `specs/City_style_phases.md`. After all of PR 5 lands, V1 is retired (`cityMapGenerator.ts`, `cityMapRenderer.ts`, `CityMapPopup.tsx`, the "Map" button) and the popups are unified.

The four generator/renderer signatures are **frozen** — only the V2 data shape evolves.

## V1 (tile-based)

| File | Responsibility |
|------|---------------|
| `cityMapTypes.ts` | V1 type definitions — `CityMapData`, `CityBlock`, `CityBuilding`, `CityLandmark`, `CityEnvironment`, `CitySize`, `DistrictRole`. Frozen during V2 migration so V1 keeps compiling |
| `cityMapGenerator.ts` | V1 generator: tile-grid pipeline producing the legacy `CityMapData` (walls, river, roads, streets, blocks, buildings, landmarks). Exports `deriveCityEnvironment`, `generateCityMap` |
| `cityMapRenderer.ts` | V1 renderer: 14-layer tile-based draw sequence |
| `CityMapPopup.tsx` | V1 popup modal |

## V2 (Voronoi-polygon-based)

V2 replaces the V1 tile grid with a Voronoi polygon graph sized by city tier:

| Tier | Interior polygons | Canvas polygons |
|------|-------------------|-----------------|
| small | 150 | 3000 |
| medium | 250 | 3000 |
| large | 350 | 3000 |
| metropolis | 500 | 4000 |
| megalopolis | 1000 | 5000 |
| ecumenopolis | 2000 | 7000 |

The interior count (`POLYGON_COUNTS[size]`) is the in-wall city footprint allocated by `cityMapShape.ts::selectCityFootprint`. The canvas count (`CANVAS_POLYGON_COUNTS[size]`) is the total Voronoi cell budget for the 1000×1000 city canvas — the rest hosts outside-walls sprawl, agricultural/slum blocks, and gate-exiting roads. Larger tiers get a larger canvas so metropolis / megalopolis / ecumenopolis have proportionally more extramural acreage.

The polygon graph (`CityPolygon[]` in `CityMapDataV2.polygons`) is the **single data contract** PR 2-5 build on. Each polygon carries:
- `id` — index
- `site` — `[x, y]` Voronoi seed point
- `vertices` — unclosed ring (the `last === first` closing vertex returned by D3's `cellPolygon` is stripped; PR 2-5 assume unclosed)
- `neighbors` — Delaunay adjacency
- `isEdge` — touches canvas bbox (used by PR 2 wall footprint, PR 5 sprawl)
- `area` — shoelace (used by PR 4 landmark sizing, PR 5 building density)

### Files (V2)

| File | Responsibility |
|------|---------------|
| `cityMapTypesV2.ts` | V2 type definitions — `CityPolygon`, `CityMapDataV2`, `CityBlockV2`, `CityBuildingV2`, `CityLandmarkV2`. Re-exports `CityEnvironment` / `DistrictRole` from V1 so V2 is a one-stop import |
| `cityMapGeneratorV2.ts` | V2 generator: exports `POLYGON_COUNTS` and `generateCityMapV2`. Internal `buildCityPolygonGraph` seeds N random points (RNG sub-stream `${seed}_city_${cityName}_voronoi`), runs **2 rounds of Lloyd relaxation** (no ghost points / wrapping — cities are bounded), then builds the final `d3-delaunay` Voronoi |
| `cityMapEdgeGraph.ts` | **Centralized polygon-edge graph helpers** — `roundV`, `vertexKey`, `canonicalEdgeKey`, `EdgeRecord`, `buildEdgeOwnership`, `buildPolygonEdgeGraph`, `aStarEdgeGraph`, `keyPathToPoints`, `nearestVertexKey`. PR 2-5 features that touch polygon edges import from here |
| `cityMapWalls.ts` | **PR 2** walls + gates |
| `cityMapShape.ts` | **PR 2/3** organic city footprint allocator |
| `cityMapRiver.ts` | **PR 3** river |
| `cityMapNetwork.ts` | **PR 3** roads + streets + bridges |
| `cityMapOpenSpaces.ts` | **PR 4 slice** civic squares + markets + parks |
| `cityMapBlocks.ts` | **PR 4 slice** blocks / districts (polygon partition) |
| `cityMapLandmarks.ts` | **PR 4 slice** capitals (castle/palace) + temples + monuments |
| `cityMapBuildings.ts` | **PR 5 slice** interior building rects |
| `cityMapSprawl.ts` | **PR 5 slice** outside-walls building rects (huts/farmhouses) |
| `cityMapRendererV2.ts` | V2 renderer (14 layers) |
| `CityMapPopupV2.tsx` | V2 popup modal |

### Current Status (PR 5 in progress)

Landed:
- **PR 1** — polygon graph + flat-paper base + faint polygon-edge cadastral grid + city-name label
- **PR 2** — walled-blob rendering with 0–4 cardinal gates per city (`cityMapWalls.ts` + renderer Layer 11)
- **PR 3** — river + roads + streets + bridges (`cityMapRiver.ts` + `cityMapNetwork.ts` + shared `cityMapEdgeGraph.ts`, renderer Layers 5–8)
- **PR 4** — open spaces (`cityMapOpenSpaces.ts` + Layer 9), blocks (`cityMapBlocks.ts`, data-only), landmarks (`cityMapLandmarks.ts` + Layer 12)
- **PR 5 (in progress)** — buildings (`cityMapBuildings.ts` + Layer 10), outside-walls sprawl (`cityMapSprawl.ts` + Layer 4)

Pending:
- **PR 5 (remainder)** — dock hatching along `env.waterSide` and rotated district labels ("BLUEGATE", "GLASS DOCKS", …). Layers 3 and 13 reserved.

## Generation Slices (V2 detail)

### PR 1 — polygon graph

`buildCityPolygonGraph` in `cityMapGeneratorV2.ts`:
1. Seeds N random points on dedicated RNG stream `${seed}_city_${cityName}_voronoi`
2. Runs 2 rounds of Lloyd relaxation (3+ rounds over-regularizes — looks grid-like, defeats the organic look)
3. Builds final `d3-delaunay` Voronoi
4. Strips closing vertex from each `cellPolygon` so rings are unclosed
5. Computes Delaunay adjacency, bbox `isEdge` flag, shoelace area
6. Cheap contract assertion `polygons.length === POLYGON_COUNTS[env.size]`

### PR 2 — walls + gates

`generateWallsAndGates(seed, cityName, env, polygons, canvasSize)` in `cityMapWalls.ts` runs a five-stage polygon-based pipeline:

1. Score every non-`isEdge` polygon by `radial-distance-from-center + fbm(samplers.elevation, site*0.01) * 0.6`, sort ascending with id tie-break, take top `lerp(0.50, 0.85, SIZE_TIER[size])` fraction
2. Build canonical edge-ownership map (`Map<sortedRoundedVertexPair, {polyIds, a, b}>`) over every polygon's consecutive vertex pairs — shared Voronoi edges collapse to the same key
3. Collect wall boundary edges (exactly one owner is `interior`) in the interior owner's local vertex-walk direction
4. Chain edges into a closed CW polyline via deterministic start (min-y, min-x) + straight-preferring/CW-turn traversal (mirrors V1 `chainWallPath` shape)
5. Pick up to 4 cardinal gates by filtering wall segments whose normalized outward normal `(dy, -dx)/len` has `dot >= 0.99` with the cardinal direction, scored by `midProj * 100 − midPerpDistFromCenter`, skipping `env.waterSide`

Also BFS-prunes to one connected component and hole-fills from the `isEdge` frontier. RNG stream `${seed}_city_${cityName}_walls`. Polygon-based throughout — zero tile references. Degenerate cases (`interior.size < 3`, chain fails to close, `< 4` vertices) return `{ wallPath: [], gates: [] }` so the renderer can no-op cleanly.

### PR 3 — river + roads + streets + bridges

**Shared edge graph**: `cityMapGeneratorV2.ts` builds `buildPolygonEdgeGraph(polygons)` once after walls and hands the same `PolygonEdgeGraph` to `generateRiver` and `generateNetwork`. Don't rebuild it per feature — precomputed `edgeLen` and `avgEdgeLen` are how A* cost functions stay dimensionally consistent (e.g. `rng() * 0.4 * avgEdgeLen` for river meander, `ROAD_TURN_PENALTY_COEFF * avgEdgeLen` for road turn penalty).

**River** traces polygon edges between two non-adjacent canvas sides (boundary vertices come from `isEdge` polygon rings, not raw canvas-bbox vertices). Large+ cities attempt one bifurcation per river: 35% chance per attempt, up to 6 attempts, middle-third stretch of the main path. Interior vertices are blocked via `aStarEdgeGraph`'s `blockedKeys` option so the alternate route is **guaranteed disjoint** — locality-bounded to ~2.5 × avg-edge-length from the stretch.

**Island detection** uses `floodDetectIslands`: floods `polygon.neighbors` from every `isEdge` polygon with river edges treated as walls; polygons not reached are islands. A ring-of-river-edges check only finds single-polygon islands and misses multi-polygon islands the bifurcation naturally creates.

**Roads** A* from each gate's nearest polygon vertex to the polygon vertex nearest canvas center, with a normalized-dot turn penalty, moderate river-crossing cost, and small per-step noise. RNG stream `${seed}_city_${cityName}_roads`.

**Streets** space-fill the polygon graph until every interior polygon is "served" (has ≥1 ring edge in `coveredEdges = wallEdges ∪ roadEdges ∪ riverEdges ∪ streetEdges`) or has a served Delaunay neighbor — the polygon-graph analog of V1's "within ≤1 tile". `isEdge` polygons are never frontier candidates — they belong to PR 5's outside-walls sprawl. RNG stream `${seed}_city_${cityName}_streets`.

**Bridges** are the canonical-edge-key intersection of road edges and river edges (fully deterministic, no RNG).

### PR 4 — open spaces

`generateOpenSpaces(seed, cityName, env, polygons, wall, river, roads, canvasSize)` in `cityMapOpenSpaces.ts` populates `CityMapDataV2.openSpaces` with three kinds of polygon-keyed entries:

1. **Civic square** — single polygon whose `site` is closest to canvas center (deterministic, no RNG)
2. **Markets** — per-tier count `MARKET_COUNT[size]` (`small:2, medium:4, large:5, metropolis:8, megalopolis:16, ecumenopolis:28`), gate-anchored first via "polygon nearest each gate midpoint", then a Lloyd-style spread pass (`farthestPolygonBySite`) for the remainder
3. **Parks** — per-tier count `PARK_COUNT[size]` (`small:1, medium:3, large:5, metropolis:7, megalopolis:10, ecumenopolis:16`), each grown by BFS over `polygon.neighbors` from a seed polygon up to `PARK_MAX_POLYGONS[size]` (1–4 polygons; ecumenopolis caps at 4). Seeds prefer eligibility candidates that are not Delaunay neighbors of any already-used polygon, falling back to any unused eligible polygon when the strict pool runs dry

**Eligibility filter**: exclude `polygon.isEdge` (PR 5 sprawl territory) and any polygon whose vertex ring shares a canonical edge key with the wall path / river edges / road paths. **Streets are NOT in the exclusion set** — plazas should front streets.

RNG sub-streams: `${seed}_city_${cityName}_openspaces_markets` (tie-breaking + spread fallback) and `..._openspaces_parks` (seed pick + cluster size). The renderer fans off `_openspaces_render_markets` and `..._openspaces_render_parks` for stall / tree scatter.

### PR 4 — blocks / districts

`generateBlocks(seed, cityName, env, polygons, wall, river, roads, streets, openSpaces, canvasSize)` in `cityMapBlocks.ts` populates `CityMapDataV2.blocks` with `CityBlockV2[]` (`{ polygonIds, role, name }`).

Algorithm:
1. Build `barrierEdgeKeys: Set<string>` covering every wall / river / road / **street** canonical polygon edge
2. BFS over `polygon.neighbors` in polygon-id order, refusing to cross any neighbor whose shared Voronoi edge (resolved via `buildEdgeOwnership`) is in that set AND refusing to cross the footprint boundary (O(1) `wall.interiorPolygonIds` membership compare — decouples interior/exterior from the wall path so unwalled small/medium cities still get a clean partition)
3. Each connected component is one raw block; every polygon ends up in exactly one
4. Classify each block:
   - OUTSIDE `wall.interiorPolygonIds` → `slum` when `polygonIds.length <= SLUM_SIZE_THRESHOLD[size]` (`small:2, medium:3, large:4, metropolis:5, megalopolis:6, ecumenopolis:7`) else `agricultural`
   - else if any polygon matches an `openSpaces` civic square → `civic`
   - else if any matches a market → `market`
   - else if `env.isCoastal && env.waterSide` and block centroid (mean of `polygon.site`) within `canvasSize * 0.30` of the matching canvas edge → `harbor`
   - else `residential`

Names via a V1-verbatim prefix/suffix combiner ported from `cityMapGenerator.ts:956-969`. 35% space-joiner, up to 12 retries to avoid duplicates, `DISTRICT ${i+1}` fallback. RNG sub-stream `${seed}_city_${cityName}_blocks_names` — naming is the only RNG use; flood + role classification are fully deterministic from geometry.

**Block barriers INCLUDE streets** — semantic inversion vs. open-space eligibility. Blocks are *bounded by* streets (spec line 63's flood-fill); open spaces *front* streets. Future feature files must NOT copy `cityMapOpenSpaces.ts`'s `blockedEdgeKeys` verbatim when they mean "block barrier" — the two sets have different semantics.

**Block membership is a strict partition**: every polygon in `polygons` appears in exactly one `block.polygonIds`. The interior/exterior split is driven by `wall.interiorPolygonIds` (the organic city footprint), NOT `polygon.isEdge` — blocks whose polygons sit outside the footprint become `slum`/`agricultural` regardless of whether the city is walled. This decoupling lets small/medium unwalled cities still produce civic/market/harbor/residential blocks inside the footprint.

Role assignment precedence: `slum/agricultural > civic > market > harbor > residential` — exterior short-circuits first so an open-space polygon outside the footprint never taints an agricultural cluster with a civic tag.

### PR 4 — landmarks

`generateLandmarks(seed, cityName, env, polygons, blocks, openSpaces, canvasSize)` in `cityMapLandmarks.ts` populates `CityMapDataV2.landmarks` with `CityLandmarkV2[]` (`{ polygonId, type }`).

Three ordered passes share one `used: Set<number>` for de-duplication:

1. **Capitals** — only when `env.isCapital`. Small/medium capitals get ONE of `{castle, palace}` via RNG coin-flip; large/metropolis/megalopolis/ecumenopolis get BOTH. Anchored to civic-block polygons sorted by squared distance from canvas center with stable id tie-break (mirrors V1 `byDistanceToCenter` at `cityMapGenerator.ts:1085-1090`). Castle counts ramp per size: `CASTLE_ROLLS_NON_CAPITAL[ecumenopolis] = [1.00, 0.85, 0.50, 0.25]` (up to 4 castles in non-capital ecumenopolis cities); `CASTLE_ROLLS_CAPITAL[ecumenopolis] = [0.80, 0.50, 0.25]` (up to 3 *additional* castles on top of the capital pass).
2. **Temples** — `env.religionCount` of them, random pick from full civic+market block polygon pool minus `used`
3. **Monuments** — `env.wonderCount` of them, hybrid pool concatenating openSpaces civic+market polygons FIRST with civicAndMarket block polygons SECOND (V1 `cityMapGenerator.ts:1126-1138` parity — plaza polygons appear twice in the concat and get ~2× random-pick weight so monuments cluster near plaza centers)

RNG sub-streams: `${seed}_city_${cityName}_landmarks_{capitals,temples,monuments}` so future landmark kinds can be inserted without shifting existing seeds. Capital distance-from-center sort is fully deterministic (no RNG).

Returns `[]` on degenerate input (`blocks.length === 0`); each pass early-breaks on pool exhaustion.

### PR 5 — buildings

`generateBuildings(seed, cityName, env, polygons, blocks, openSpaces, landmarks, canvasSize)` in `cityMapBuildings.ts` populates `CityMapDataV2.buildings` with `CityBuildingV2[]` (`{ x, y, w, h, solid, polygonId }`).

Algorithm:
1. Build `reservedPolygonIds: Set<number>` = union of every `openSpaces[].polygonIds` (plazas, markets, parks) and every `landmarks[].polygonId` (castle/palace/temple/monument)
2. Iterate `blocks` in natural order, skip blocks whose role is `slum` or `agricultural` (sprawl territory)
3. For each polygon in `civic`/`market`/`harbor`/`residential` blocks, skip if reserved or `polygon.isEdge`, else pack `N = clamp(4, 12, round(BASE_COUNT[role] + area / DENSITY_DIVISOR[role]))` rects via rejection sampling

`BASE_COUNT` `{civic:5, market:8, harbor:7, residential:10}`. `DENSITY_DIVISOR` `{civic:300, market:180, harbor:220, residential:140}` px².

Each candidate rect rolls a role-driven size (civic 12–22 px, market 6–12, harbor 10–18, residential 8–14), an aspect ratio (`SIZE_BAND[role].aspectMin..aspectMax`, harbor 1.4–2.4 for elongated warehouses), and a 50/50 orientation flip.

A candidate is accepted iff:
- All four corners pass `pointInPolygon` AND
- Every corner sits ≥ `INSET_PX = 2` px from every polygon edge (Voronoi cells are convex, so all-four-corners-inside ⇒ whole rect inside; 2 px inset keeps buildings from kissing streets / roads / walls which all live on polygon edges) AND
- It does not overlap any previously accepted rect in the same polygon expanded by `MORTAR_PX = 1` on each side (AABB test in `rectsOverlapWithMortar`)

Up to `MAX_RETRIES_PER_SLOT = 12` attempts per slot; failed slots drop silently so tightly packed polygons end up slightly under-filled rather than stalling.

Each accepted rect sets `solid = rng() < SOLID_PROBABILITY (0.55)`.

RNG sub-stream `${seed}_city_${cityName}_buildings` — single stream, fixed iteration order (block order → polygon.id order → slot-by-slot rect rolls).

Local helpers (`pointInPolygon`, `distanceToPolygonEdge`, `pointSegmentDistance`, `rectsOverlapWithMortar`) consume `CityPolygon.vertices` directly with `(j + 1) % n` edge walks. **NO import of `cityMapEdgeGraph.ts`** because buildings are polygon-interior rejection sampling, not edge-graph traversal.

### PR 5 — outside-walls sprawl

`generateSprawl(seed, cityName, env, polygons, blocks, openSpaces, landmarks, canvasSize)` in `cityMapSprawl.ts` is the mirror-image of `cityMapBuildings.ts`, targeting exactly the block roles that module skips.

Algorithm:
1. Build the same `reservedPolygonIds` set as buildings (`openSpaces ∪ landmarks`)
2. Iterate `blocks`, keep only roles in `SPRAWL_ROLES = {'slum', 'agricultural'}`
3. For each polygon (whole-block iteration; `isExteriorBlock` already swept in via "ANY isEdge" rule), skip if reserved or degenerate, else pack `N = clamp(0, 4, round((SPRAWL_BASE_COUNT[role] + area / SPRAWL_DENSITY_DIVISOR[role]) * SPRAWL_TIER_SCALE[env.size]))` rects via the same rejection-sampling recipe

Constants:
- `SPRAWL_BASE_COUNT` `{slum:2, agricultural:1}`
- `SPRAWL_DENSITY_DIVISOR` `{slum:600, agricultural:1000}` px²
- `SPRAWL_TIER_SCALE` `{small:0.5, medium:0.75, large:1.0, metropolis:1.15, megalopolis:1.3, ecumenopolis:1.6}` (addresses spec line 23: "the bigger the city the more such sparse buildings"). Wall-proximity sprawl bonus is active for `metropolis | megalopolis | ecumenopolis`.

Role-driven size bands: `slum 4–8 px (aspect 1.0–1.3)`, `agricultural 6–11 px (aspect 1.0–1.6)` — smaller than interior buildings (huts / farmhouses, not administrative blocks).

`INSET_PX = 2`, `MORTAR_PX = 1`, `MAX_RETRIES_PER_SLOT = 8`, `SOLID_PROBABILITY = 0.45` (slightly airier than interior's 0.55). `MIN_SPRAWL_PER_POLYGON = 0` — fringe polygons are allowed to end up empty so sprawl reads as "scattered huts" rather than a secondary dense ring.

RNG sub-stream `${seed}_city_${cityName}_sprawl` — independent of `_buildings`.

Local geometry helpers (`pointInPolygon`, `distanceToPolygonEdge`, `pointSegmentDistance`, `rectsOverlapWithMortar`, `clamp`, `lerp`) are **DUPLICATED** from `cityMapBuildings.ts:319-385` — each V2 slice keeps its own polygon-interior geometry helpers (same convention as `cityMapLandmarks.ts` / `cityMapOpenSpaces.ts`). If you later factor them out, do buildings + sprawl together so the inset / mortar math stays byte-identical.

## Renderer (V2)

`cityMapRendererV2.ts`. Layer order:

| Layer | Content |
|-------|---------|
| 1 | Flat `#ece5d3` paper background |
| 2 | Faint Voronoi polygon edges at `rgba(0,0,0,0.12)` — the "organic cadastral grid" replacing the spec's rigid 4×4 grid to surface the Voronoi foundation visually |
| 3 | *Reserved (PR 5 docks)* |
| 4 | Sprawl rects (`drawSprawl`) — `#2a241c` ink, `SPRAWL_STROKE_WIDTH = 0.6` (thinner than 0.75), drawn EARLY so future gate-exiting roads will sit on top |
| 5–8 | River + streets + roads + bridges |
| 9 | Open spaces (`drawOpenSpaces`) — squares + markets share `#efe7cb` plaza fill with `rgba(138,128,112,0.55)` outline; parks `#d8dcbf` sage fill with `rgba(106,122,74,0.55)` outline. Drawn BEFORE river/streets/roads/walls so wall and road ink visibly overlap the pale plaza fills. Markets get 6–12 small `#2a241c` stall dots (radius 1.5); parks get 4–10 `#6a7a4a` tree circles (radius 3, dark outline). Stall / tree positions jittered around `polygon.site` with spread bounded by `√polygon.area`, sampled from dedicated render-side RNG sub-streams |
| 10 | Buildings (`drawBuildings`) — drawn AFTER bridges (Layer 8) and BEFORE walls (Layer 11) so buildings cover the cream base but walls/landmarks sit visibly on top of any rect that butts up against them. `solid` rects use `fillRect` with `#2a241c`; hollow rects use `strokeRect` at `lineWidth = 0.75` with a `0.375` px inset on all sides so the stroke stays inside rect bounds (keeps 1 px mortar gap crisp). **No render-time RNG** — every dimension is baked in |
| 11 | Walls + gates (`drawWallsAndGates`) — 4 px `#2a241c` wall stroke with round joins, gate segments split into two stubs flanking an 18 px gap, 3 px tower studs at sharp polygon-corner turns (`dot < 0.7` between adjacent edges), flanking door dashes (5 px, offset 4 px along the outward normal) at each gate jamb |
| 12 | Landmarks (`drawLandmarks`) — drawn AFTER walls so capital silhouettes sit on top of wall ink. Each landmark glyph centered on `polygon.site`, sized from `√polygon.area * 0.7` clamped to `[20, 36]` px, rendered as a pale `#f5f0e8` plaque with `#2a241c` silhouette ("all ink on white" per spec line 67). Four glyph helpers ported from V1 — `drawCastleGlyph`, `drawPalaceGlyph`, `drawTempleGlyph`, `drawMonumentGlyph`. CASTLE / PALACE labels rendered below capital glyphs in bold Georgia |
| 13 | *Reserved (PR 5 district labels)* |
| 14 | Top-centered city name + bottom-right "V2" QA tag |

## RNG Sub-Streams (V2)

All routed through `seededPRNG` from `terrain/noise.ts`. The shared prefix is `${seed}_city_${cityName}_`:

| Suffix | Purpose | Slice |
|--------|---------|-------|
| `_voronoi` | Polygon graph seeding + Lloyd | PR 1 |
| `_walls` | Wall footprint perturbation (`fbm` over `samplers.elevation`) | PR 2 |
| `_river` | Meander + side/endpoint choice | PR 3 |
| `_roads` | Per-step noise | PR 3 |
| `_streets` | Polygon pick + vertex pick | PR 3 |
| `_openspaces_markets` | Lloyd-style spread fallback + tie-breaking | PR 4 |
| `_openspaces_parks` | Seed pick + cluster size | PR 4 |
| `_openspaces_render_markets` | Stall scatter (renderer) | PR 4 |
| `_openspaces_render_parks` | Tree scatter (renderer) | PR 4 |
| `_blocks_names` | District naming (only RNG use in blocks) | PR 4 |
| `_landmarks_capitals` | Castle/palace coin-flip | PR 4 |
| `_landmarks_temples` | Temple polygon pick | PR 4 |
| `_landmarks_monuments` | Monument polygon pick | PR 4 |
| `_buildings` | Slot rolls (interior buildings) | PR 5 |
| `_sprawl` | Slot rolls (outside-walls huts) | PR 5 |
| `_distinctive_select[_<i>]` | Distinctive feature spec pick (megalopolis: no suffix; ecumenopolis: 3–5 slots, suffix `_0`..`_4`) | Distinctive landmarks |
| `_distinctive_place[_<i>]` | Seed-polygon pick + cluster grow for the corresponding distinctive feature | Distinctive landmarks |
| `_distinctive_count` | Ecumenopolis-only: how many distinctive features to roll (3–5) | Distinctive landmarks |

Bridge detection and the civic-square pick are **fully deterministic** and use no RNG.

## Ecumenopolis Tier (above megalopolis)

The new top tier extends every existing per-size table along the same trends. The simulation-layer gate is in `claude_specs/world_history.md`; the citymap-layer parameters all live under `src/lib/citymap/` and are summarized here for cross-reference.

**Polygon footprint**: `CANVAS_POLYGON_COUNTS[ecumenopolis] = 7000`, `POLYGON_COUNTS[ecumenopolis] = 2000` (vs megalopolis 5000 / 1000).

**Walls + gates** (`cityMapGeneratorV2.ts` switch + `cityMapWalls.ts`):
- Always-on three-ring fortification: outer wall + middle ring (fraction 0.55) + small inner core (fraction 0.18). The tighter inner-fraction is the implied "arcology spire" cluster.
- `GATE_COUNT_MIN[ecumenopolis] = 8`, `GATE_COUNT_MAX[ecumenopolis] = 12` on the outer wall (megalopolis is 6/8). Inner + middle rings still respect `INNER_WALL_MIN_GATES = 3`.

**Distinctive features** (`cityMapLandmarksDistinctive.ts`):
- Megalopolis places exactly 1 distinctive feature; ecumenopolis places **3–5** (count rolled from sub-stream `${seed}_city_${cityName}_distinctive_count`).
- Each ecumenopolis slot uses isolated `_select_<i>` / `_place_<i>` sub-streams so adding/removing a slot doesn't shift the others.
- Per-slot duplicate avoidance: an ecumenopolis re-rolls up to 12 times to avoid placing the same `spec.id` twice; if the same display name lands twice the second copy is suffixed with `(2)`.

**Quarter / landmark counts** (`cityMapLandmarksQuarters.ts` + `cityMapLandmarksNamed.ts`):
- Industrial 16–28, Military 6–10, Faith-Aux 8–14, Entertainment 5–9, Trade-Finance 7–12, Excluded 4–8.
- Markets 28, parks 16 (max 4 polygons each), `NON_RES_BLOCK_SIZE_LIMIT = 14`, `SLUM_SIZE_THRESHOLD = 7`.
- Castle ramps: non-capital `[1.00, 0.85, 0.50, 0.25]` (up to 4); capital extras `[0.80, 0.50, 0.25]` (up to 3 on top of the capital pass).
- Palace non-capital probability rises to 1.00.

**Districts** (`cityMapDistricts.ts`):
- Slums: ecumenopolis rolls a second cluster at 55% (`ECUMENOPOLIS_SECOND_SLUM_PROB`) and a third at 30% (`ECUMENOPOLIS_THIRD_SLUM_PROB`), vs megalopolis 25% second / no third.
- Docks: shares megalopolis's `DOCK_SECOND_CLUSTER_PROB = 0.30` second-cluster roll.

**Sprawl** (`cityMapSprawl.ts`): `SPRAWL_TIER_SCALE[ecumenopolis] = 1.6`; wall-proximity bonus active.

**River** (`cityMapRiver.ts`): bifurcation eligible (set extended from `large/metropolis/megalopolis`).

**Continent cap**: at most one ecumenopolis per continent. Cap is enforced in `YearGenerator` step 4b — see `world_history.md` for details. The citymap layer itself is unaware of this cap (it just renders whatever `env.size` it's handed).

## Sea Cities (stilted variant)

When the world-map city is a sea city (`City.isSeaCity` set by `CitySettlement.ts` — see `world_history.md`), `deriveCityEnvironment` populates `CityEnvironment.isSeaCity = true`. The V2 generator orchestrator branches on this flag to produce a stilted-platform variant of the canvas — the city sits on a small footprint of polygons surrounded by open ocean on all sides.

**Slice reuse / replace / skip matrix**:

| Slice | Sea-city behaviour |
|---|---|
| `cityMapWater` (water polygon carving) | **Skipped**. The orchestrator computes `waterPolygonIds` as the **inverse** of the city footprint instead — every polygon NOT in `footprint.interior` becomes open ocean. |
| `cityMapMountains` | **Skipped**. `env.mountainDirection` is forced to `null` for sea cities; the canvas has no land for mountains. |
| `cityMapShape` | **Reused**. The footprint allocator runs with an empty obstacle set, so it picks an organic shape sitting in the middle of the canvas. |
| `cityMapWalls` | **Skipped** (`wallConfig` is forced to no-walls). The sea is the perimeter; gates would have nowhere to lead. |
| `cityMapRiver` | **Skipped**. `env.hasRiver` is forced to `false`. There is no inland river through a sea city. |
| `cityMapNetwork` (roads/streets/bridges) | **Reused** unchanged — the existing A* still routes through the platform polygons. Surrounding water is in `obstaclePolygonIds` so paths never cross open ocean. |
| `cityMapDistricts` / `cityMapBlocks` | **Reused** — same district classifier, same block clustering. Dock and harbour district roles still apply and now have direct ocean access on every block edge. |
| `cityMapLandmarksUnified` | **Reused** — landmark types unchanged. (Future work: a lighthouse landmark variant for sea cities.) |
| `cityMapBuildings` | **Reused** — interior packing fills the platform polygons. The "stilted" reading comes from the surrounding ocean rendered by the existing water-polygon layer. |
| `cityMapSprawl` | **Skipped**. There's no land to sprawl onto — every isEdge / exterior polygon is already water. |
| `cityMapRendererV2` | **Reused** — the existing water-polygon rendering already covers the inverted water set. The footer label reads "Sea City" instead of "Coastal". |

**Culture fallback**: a sea city's world cell is OCEAN/COAST/LAKE biome, which would map `baseCulture` to a marine palette. To keep the stilted city's architectural styling sensible, `deriveCityEnvironment` falls back to a neighbouring land cell's biome when the city is a sea city, producing a normal western/arabic/eastern palette.

**No new RNG sub-streams** are introduced for the stilted variant — every existing slice continues to draw from its existing `${seed}_city_${cityName}_<suffix>` stream. The skipped slices simply don't draw at all. This preserves seed-stable parity for land cities (their stream order is unchanged) and keeps sea cities byte-deterministic via the same hashing.

## Pitfalls

- **Do NOT reintroduce tiles under `src/lib/citymap/`.** V2 is polygon-based by design; the pivot away from tiles is called out in every V2 file header. The spec's V1 tile language ("tile count", "1–2 tile offset", "within ≤1 tile") is translated to polygon/edge language inside each generator. Keep spec quotes inside file headers, not inside code.
- **No `Math.random` anywhere under `src/lib/citymap/`** — always route through `seededPRNG` from `terrain/noise.ts`. PR 2-5 RNG streams stay decoupled and seed-stable across PR landings.
- **Polygon-edge graph helpers are centralized** in `cityMapEdgeGraph.ts`. PR 4+ feature files must import from there rather than re-declaring float-tolerance-sensitive helpers in their own modules — inconsistent `VERTEX_PRECISION` values would silently break shared-edge collapse and index the same edge under two different keys.
- **`generateCityMap` / `renderCityMap` (V1) and `generateCityMapV2` / `renderCityMapV2` (V2) signatures are frozen** — only the V2 data shape evolves.
- **V2 Lloyd relaxation runs 2 rounds** (mirrors `terrain/voronoi.ts`); 3+ rounds over-regularize and start to look grid-like.
- **`buildCityPolygonGraph` strips the `last===first` closing vertex** so `polygon.vertices` is always unclosed; PR 2-5 assume unclosed rings.
- **River + roads + streets share one polygon-edge graph.** Don't rebuild it per feature; precomputed `edgeLen` and `avgEdgeLen` are how A* cost functions stay dimensionally consistent.
- **River bifurcation must produce a disjoint detour.** The A* alternate path blocks the stretch's interior vertex keys via `aStarEdgeGraph`'s `blockedKeys`. Do NOT just remove stretch edges and re-run A* — A* could still snake back through interior vertices via other edges and produce a 1-vertex spike instead of an island.
- **Island detection must use polygon flood, not ring-check.** A ring-of-river-edges check only finds single-polygon islands and misses multi-polygon islands the bifurcation naturally creates.
- **Street "served" semantics**: a polygon is served iff it has ≥1 ring edge in `coveredEdges = wallEdges ∪ roadEdges ∪ riverEdges ∪ streetEdges`. Eligible street-frontier iff not served AND no Delaunay neighbor is served. `isEdge` polygons are never frontier candidates.
- **Open-space eligibility excludes infrastructure-touching polygons, NOT street-touching polygons.** Streets are deliberately omitted from the blocked set so plazas, markets, and small parks front streets. If you add new infrastructure that should reject open-space placement (e.g. PR 5 docks), add its edges to that same `blockedEdgeKeys` set rather than walking polygon-by-polygon.
- **Open-space iteration order is fixed** (civic → markets → parks). Flipping the order shifts which polygons end up in which kind on every seed.
- **Block barriers INCLUDE streets — semantic inversion vs. open-space eligibility.** Streets are the primary boundary between urban districts (the spec's "bounded-by-streets" flood-fill at line 63). Future feature files must NOT copy `cityMapOpenSpaces.ts`'s `blockedEdgeKeys` verbatim when they mean "block barrier" — the two sets have different semantics and are intentionally out of sync.
- **Block membership is a strict partition** — every polygon appears in exactly one `block.polygonIds`. The interior/exterior split is driven by `wall.interiorPolygonIds` (the organic city footprint), NOT `polygon.isEdge`. This decoupling lets small/medium unwalled cities still produce civic/market/harbor/residential blocks inside the footprint.
- **Block role precedence**: `slum/agricultural > civic > market > harbor > residential`. Exterior short-circuits first.
- **Landmarks anchor to one polygon, never two.** Three ordered passes share a single `used: Set<number>`. Once a polygon is used, no later pass can place on it. Candidate pools are sourced from block ROLES (`civic` / `market`), NOT raw polygon geometry — the block layer is the canonical "where can landmarks go?" authority.
- **Landmark pass order is fixed** (capitals → temples → monuments). Flipping shifts which polygon each lands on for every seed.
- **Monument hybrid pool intentionally duplicates plaza polygons** across the concat (`[...squarePool, ...civicAndMarket]`) for ~2× random-pick weight. Treat the concat as part of the seed-stable contract — do not dedupe it.
- **V2 landmark glyphs are sized from `√polygon.area`, not `tileSize`.** V2 has NO tile concept. If a future change wants variable-size wonders ("higher tier wonders appear bigger"), thread a `tier?` field into `CityLandmarkV2` at the generator layer rather than re-reading `env.wonderCount` from the renderer — the renderer is intentionally RNG-free and data-driven.
- **Buildings are polygon-interior rejection-sampled, NOT edge-graph traversed.** `cityMapBuildings.ts` INTENTIONALLY does NOT import `cityMapEdgeGraph.ts`. When extending (chimneys, courtyards, variable roofs), keep the polygon-interior-only discipline; reach for the edge graph only if the new feature needs to align to polygon edges (like future sprawl might, to lean buildings against walls).
- **Buildings skip slum / agricultural blocks by design.** `PACKING_ROLES` is `{'civic', 'market', 'harbor', 'residential'}`. Slum + agricultural live on `polygon.isEdge`-containing clusters and belong to the sprawl slice.
- **The `reserved` set is precisely `openSpaces ∪ landmarks` — nothing else.** Adding future reserved kinds (cemeteries, guildhall yards) must route through either `openSpaces` or `landmarks`, not a third set, otherwise building-eligibility silently drifts out of sync with the visual layer semantics.
- **Sprawl inhabits exactly what buildings skip.** `SPRAWL_ROLES = {'slum', 'agricultural'}` is the complement of `PACKING_ROLES`. Output is a separate `sprawlBuildings: CityBuildingV2[]` field — do NOT fold sprawl into `buildings`. Layer 4 vs Layer 10 lets future tuning change sprawl ink/stroke/scatter independently.
- **Sprawl iterates the WHOLE block**, not a per-polygon `isEdge` filter. The block role is the authoritative "outside-walls" tag (`isExteriorBlock` classifies by `wall.interiorPolygonIds` membership).
- **Polygon-interior geometry helpers are DUPLICATED across slices** (buildings/sprawl/landmarks/openspaces). Each slice keeps its own; if you factor them out, do all slices together so inset/mortar math stays byte-identical.
- **`npm run sweep` is unaffected by citymap changes** (city-map generation is render-only, never reached). Any non-zero sweep diff after a citymap-only change means an accidental simulation-layer edit.
- **Sea-city water set is the inverse of the footprint, not the coastal carve.** Don't try to combine `generateWaterPolygons` output with the inverse — for sea cities only the inverse is used, and the obstacle set is recomputed accordingly. Mixing the two would leave the city footprint half-flooded.
- **Sea-city walls / river / sprawl are skipped, not "produced empty".** Code that consumes those outputs already handles empty arrays, but new consumers must not assume non-empty (e.g. don't iterate `wallTowers` without a length check on sea cities).
