# CLAUDE.md

This file provides context and guidelines for AI assistants working on this codebase.

## Project Overview

Procedural fantasy map generator built with React, TypeScript, and Vite. Generates Voronoi-based terrain maps with biomes and rivers (always), partitions the terrain into geographic continents and regions (always), and optionally runs a full civilizational history (countries, wars, conquests, city placement, kingdom borders, roads) — all deterministic from a seed string.

**Key design principles**:
- The physical world (continents, regions, resources) is always built from terrain — it runs even without history.
- Cities and kingdoms are outputs of the history simulation, not independent pipeline steps. When history is disabled, the map shows terrain and geographic structure only.

## Commands

```bash
npm run dev       # Start Vite dev server (hot reload)
npm run build     # TypeScript type-check + Vite production build
npm run preview   # Serve the production build locally
```

There is no test suite. Verify correctness by running `npm run build` (catches type errors) and visually inspecting the map in the browser.

## Architecture

### Generation Pipeline

All heavy computation runs in `src/workers/mapgen.worker.ts` (a Web Worker). The pipeline is strictly sequential:

```
voronoi → elevation → oceanCurrents → moisture → temperature → biomes → rivers (initial)
  → hydraulicErosion → rivers (final) → temperature (refresh) → biomes (refresh)
  → buildPhysicalWorld
  └─ (if generateHistory=true) → HistoryGenerator → roads
                                    ├─ buildPhysicalWorld (World + Continents + Regions + Resources + Cities)
                                    ├─ TimelineGenerator (5000 years via YearGenerator)
                                    │    └─ 12 Phase 5 generators per year:
                                    │       Foundation → Contact → Country → Illustrate → Religion
                                    │       → Trade → Wonder → Cataclysm → War → Tech → Conquer → Empire
                                    └─ serialize → HistoryData (ownership snapshots + events)
```

The terrain steps (voronoi through rivers + hydraulic erosion) always run. After rivers are initially traced, hydraulic erosion carves valleys using a stream power model (erosion proportional to flow^0.5 × slope), with sediment deposition creating floodplains and valley widening for hillshading visibility. Rivers are then re-traced on the carved terrain for precise valley-following paths. Temperature and biomes are refreshed after erosion since they depend on elevation (lapse rate, elevation bands). Moisture and ocean currents are NOT re-run (they depend on coarse geography, not fine elevation detail). Elevation uses tectonic plate simulation with controlled continental/oceanic split (3–5 large continental plates clustered via nearest-neighbor seeding, 8–12 oceanic plates spread via farthest-point sampling; size-biased round-robin BFS gives continental plates ~3× more cells; continental seam elevation boost merges adjacent continental plates; convergent/divergent boundary effects, polar ice caps with smoothstep blending for gradual transitions, thermal erosion). Ocean currents run after elevation: BFS flood-fill identifies connected ocean basins, then an analytical gyre model computes per-cell SST anomalies (warm poleward currents on western basin margins, cold equatorward currents on eastern margins, scaled by latitude envelope). Moisture applies three layers: base FBM + smooth Hadley cell latitude curve (damped cosine modeling three atmospheric cells per hemisphere — wet equator, dry subtropics, moderate midlatitudes, dry poles) + coastal boost (modulated by ocean currents — cold currents suppress evaporation for drier eastern-margin coasts), then continentality gradient (BFS distance-from-ocean decay for dry interiors), then rain shadow (upwind mountain barrier march using prevailing wind simulation). Temperature is computed from latitude + continentality modifier (continental interiors more extreme, maritime cells milder) + windward ocean proximity (west-coast effect via upwind march through neighbor graph) + ocean current influence (SST anomaly of upwind ocean cells propagated to nearby land) + elevation lapse rate + noise perturbation; water cells incorporate SST anomaly directly; it drives the polar biome thresholds and nudges the Whittaker moisture lookup at margins. `buildPhysicalWorld` also always runs — it annotates cells with `regionId`, and produces `RegionData[]`/`ContinentData[]` in `MapData` regardless of the history flag. The history simulation is opt-in via `GenerateRequest.generateHistory`. When enabled, the **HistoryGenerator** (Phase 6) orchestrates the full pipeline: it calls `buildPhysicalWorld` to create the physical world hierarchy, then `TimelineGenerator` to run 5000 years of simulation, then serializes the result into the flat `HistoryData` format for the UI. If history is disabled, the pipeline ends after `buildPhysicalWorld` — no kingdom simulation, roads, or timeline data is generated.

Each step is a pure function in `src/lib/` that takes cells and returns updated cells or derived data.

### Key Files

`src/lib/` is split into three subdirectories by concern, plus a shared types file:

| File | Responsibility |
|------|---------------|
| `src/lib/types.ts` | All shared TypeScript types — start here |
| **`src/lib/terrain/`** | Physical map generation |
| `src/lib/terrain/noise.ts` | Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers |
| `src/lib/terrain/voronoi.ts` | Cell generation via D3-Delaunay + Lloyd relaxation |
| `src/lib/terrain/elevation.ts` | Tectonic plate simulation (3–5 continental plates clustered + size-biased growth, 8–12 oceanic plates, continental seam boost, convergent/divergent boundaries) + FBM elevation + polar ice caps (smoothstep blend over [0.72, 0.94] with reduced hemisphere asymmetry) + thermal erosion + water ratio marking |
| `src/lib/terrain/oceanCurrents.ts` | Ocean gyre simulation: BFS basin detection (flood-fills connected water cells, skips basins < 50 cells), cylindrical wrap-aware bounding box computation, analytical SST anomaly model (warm poleward currents on western margins, cold equatorward on eastern, latitude envelope scaling); returns `OceanCurrentData { sstAnomaly: Float32Array }` |
| `src/lib/terrain/moisture.ts` | FBM moisture + smooth Hadley cell cosine curve (damped amplitude, 3 cells/hemisphere) + coastal boost (modulated by ocean current SST — cold currents reduce coastal moisture via `COASTAL_MOISTURE_SENSITIVITY`) → continentality gradient (BFS distance-from-ocean) → rain shadow (upwind mountain barrier march); returns `distFromOcean` Float32Array for temperature computation; exports `getWindDirection()` |
| `src/lib/terrain/temperature.ts` | Continental climate effects: computes per-cell `temperature` (0–1) from latitude + continentality modifier (continental interiors more extreme, maritime cells milder) + windward ocean proximity (upwind march detects nearby ocean for west-coast effect, also returns SST anomaly of first ocean cell found) + ocean current land influence (`CURRENT_LAND_INFLUENCE` attenuates SST anomaly for coastal land cells) + elevation lapse rate + FBM noise; water cells incorporate SST anomaly directly; feeds into biome assignment |
| `src/lib/terrain/biomes.ts` | Whittaker biome classification (5 elevation bands including alpine meadow transition) + `BIOME_INFO` palette (19 biome types) + temperature-driven polar thresholds (ICE/SNOW/TUNDRA use `cell.temperature` with `fbmCylindrical` noise dither for organic edges — continental interiors extend polar biomes equatorward, maritime coasts push them poleward) + temperature-driven moisture nudge for Whittaker lookup (hot continental cells lose effective moisture, cool maritime cells gain it) + `getVegetationDensity(cell)` (returns 0–1 based on position within moisture band, with spatial-hash dither) + `modulateBiomeColor(hex, density)` (shifts fill color ±12% for per-cell variation) + `getSeasonalBiome(cell, season)` (render-time seasonal threshold shifts for polar biomes — ICE/SNOW/TUNDRA boundaries expand in winter, retreat in summer, with spatial-hash dither for organic edges) + `getPermafrostAlpha(cell, season)` (returns blue-gray overlay alpha for sub-polar land cells in temperature band 0.10–0.30) |
| `src/lib/terrain/rivers.ts` | Drainage map + flow accumulation + river tracing |
| `src/lib/terrain/hydraulicErosion.ts` | Stream power erosion: carves river valleys (erosion ~ flow^0.5 × slope), sediment deposition for floodplains, valley widening for hillshading visibility; re-normalizes elevation and re-marks coast cells |
| **`src/lib/history/`** | Civilizational simulation + physical world model |
| `src/lib/history/HistoryGenerator.ts` | **Phase 6 orchestrator**: ties physical world + timeline together; serializes rich simulation state into `HistoryData` for UI; computes ownership snapshots from region-based countries; emits `HistoryStats` |
| `src/lib/history/history.ts` | `buildPhysicalWorld()` (always runs) + climate-aware `scoreCellForCity` (river/harbor/biome scoring) + legacy year-by-year simulation + `getOwnershipAtYear` |
| `src/lib/history/cities.ts` | City placement with spacing + kingdom grouping |
| `src/lib/history/borders.ts` | BFS flood-fill kingdom borders from capitals |
| `src/lib/history/roads.ts` | A* road pathfinding between cities + trade route pathfinding (`computeDistanceFromLand` BFS, `tradeRouteAStar` with dual land/water cost, `generateTradeRoutePath` wrapper) |
| **`src/lib/history/physical/`** | Physical model — data classes (Phase 2) + generators/visitors (Phase 3) |
| `src/lib/history/physical/Resource.ts` | Resource entity: weighted type enum (17 types across strategic/agricultural/luxury), TRADE_MIN=10, TRADE_USE=5 |
| `src/lib/history/physical/CityEntity.ts` | City entity: full lifecycle (founded, contacted, size enum, population rolls, `canTradeMore()` + `effectiveTradeCap()` applying the TRADE_TECHS `(1 + level/10)` multiplier per spec, `contactCities` set, `knownTechs` map); distinct from render-type `City` in `types.ts` |
| `src/lib/history/physical/Region.ts` | Region entity: `RegionBiome` enum with growth multipliers, cell grouping, neighbour graph, `BIOME_TO_REGION_BIOME` mapping, `potentialNeighbours` BFS layers |
| `src/lib/history/physical/Continent.ts` | Continent entity: groups regions, world back-reference |
| `src/lib/history/physical/World.ts` | World entity: continent list + typed runtime index Maps (`mapRegions`, `mapCities`, `mapUsableCities`, `mapCountries`, `mapIllustrates`, `mapWonders`, `mapReligions`, `mapWars`, `mapAliveWars`) |
| `src/lib/history/physical/ResourceGenerator.ts` | Generates `Resource` instances: samples weighted type, rolls `10d10+20` for `original` |
| `src/lib/history/physical/CityGenerator.ts` | Generates `CityEntity`: sets `regionId`, inserts into `world.mapCities` |
| `src/lib/history/physical/RegionGenerator.ts` | Generates `Region`; `assignNeighbours` (symmetric cell-geometry adjacency); `updatePotentialNeighbours` (BFS-layered distance graph for all regions) |
| `src/lib/history/physical/ContinentGenerator.ts` | Generates `Continent`: sets `worldId`, inserts into `world.mapContinents` |
| `src/lib/history/physical/WorldGenerator.ts` | Generates `World` |
| `src/lib/history/physical/CityVisitor.ts` | Utility: iterate all/usable cities; random selection with predicate (Fisher-Yates, samples without replacement) |
| `src/lib/history/physical/RegionVisitor.ts` | Utility: iterate all regions; `selectUpToN` / `selectOne` with predicate (randomized order) |
| **`src/lib/history/timeline/`** | Timeline model — temporal simulation layer (Phase 4) |
| `src/lib/history/timeline/events.ts` | Re-exports all 13 event type interfaces (Foundation, Contact, CountryEvent, Illustrate, Wonder, Religion, Trade, Cataclysm, War, Tech, Conquer, Empire, Merge) |
| `src/lib/history/timeline/Timeline.ts` | Timeline entity: container for all simulated years, anchored by random `startOfTime` in [-3000, -1001], holds 5000 `Year` records |
| `src/lib/history/timeline/Year.ts` | Year entity: absolute year number, `worldPopulation`, 12 typed event collection arrays populated by Phase 5 generators |
| `src/lib/history/timeline/TimelineGenerator.ts` | Generates `Timeline`: sets random `startOfTime`, creates 5000 Year objects via `yearGenerator` |
| `src/lib/history/timeline/YearGenerator.ts` | Generates `Year` with 9 preprocessing steps (population growth, illustrate death, religion propagation, war expiry, resource recompute) + calls all 12 Phase 5 generators in order |
| **`src/lib/history/timeline/` Phase 5 entities** | Each file contains an entity interface + generator singleton |
| `src/lib/history/timeline/Foundation.ts` | Foundation event + `foundationGenerator`: founds a dormant city, adds to `mapUsableCities`/`mapUncontactedCities` |
| `src/lib/history/timeline/Contact.ts` | Contact event + `contactGenerator`: first-contact between two cities via BFS over region adjacency; adds symmetric contact links |
| `src/lib/history/timeline/Country.ts` | CountryEvent + `countryGenerator`: forms when all cities in a region are founded+contacted; `Spirit` enum (military/religious/industrious/neutral); merges city techs |
| `src/lib/history/timeline/Illustrate.ts` | Illustrate event + `illustrateGenerator`: illustrious figure born in large+ cities; 6 types (religion/science/philosophy/industry/military/art) with weighted selection and variable active lifespan |
| `src/lib/history/timeline/Religion.ts` | Religion event + `religionGenerator`: Path 1 = found new religion (requires religious illustrate in city with no religions); Path 2 = expand existing religion to neighbouring city |
| `src/lib/history/timeline/Trade.ts` | Trade event + `tradeGenerator`: trade route between contacted cities in different regions with available resources; consumes `TRADE_USE` from each resource |
| `src/lib/history/timeline/Wonder.ts` | Wonder event + `wonderGenerator`: wonder built in large/metropolis/megalopolis cities; can be destroyed by cataclysms |
| `src/lib/history/timeline/Cataclysm.ts` | Cataclysm event + `cataclysmGenerator`: 9 disaster types with cascading strength (local→regional→continental→global); kills population, may destroy cities/wonders/illustrates; can end the world |
| `src/lib/history/timeline/War.ts` | War event + `warGenerator`: conflict between neighbouring countries not in the same empire; weighted reason enum; disrupts cross-region trades |
| `src/lib/history/timeline/Tech.ts` | Tech event + `techGenerator`: technology discovered by an illustrate; 9 tech fields; `mergeAllTechs` (union by max level) and `getNewTechs` (delta); `TRADE_TECHS` affect trade capacity |
| `src/lib/history/timeline/Conquer.ts` | Conquer event + `conquerGenerator`: outcome of a finishing war; winner assimilates loser's tech; updates empire membership |
| `src/lib/history/timeline/Empire.ts` | Empire event + `empireGenerator`: multi-country entity formed when a non-empire conqueror wins; tracks member countries and territorial reach |
| `src/lib/history/timeline/Merge.ts` | Merge placeholder interface — reserved for future peaceful country merging |
| **`src/lib/renderer/`** | Canvas drawing logic |
| `src/lib/renderer/noisyEdges.ts` | Recursive midpoint displacement for organic coastlines |
| `src/lib/renderer/renderer.ts` | Canvas 2D rendering — all layers, biome fill (with per-cell vegetation density color modulation), hillshading, ocean current-tinted water depth, borders, icons (tree density/size/color vary by vegetation density) |
| `src/components/Draggable.tsx` | Reusable drag-to-reposition wrapper using Pointer Events; drag handles identified by `data-drag-handle` attribute; viewport clamping keeps panels visible; `touch-action: none` on handles for mobile; `baseTransform` prop for combining CSS transforms |
| `src/components/Legend.tsx` | Draggable biome legend React component (replaces the old canvas-drawn legend); visibility controlled by `layers.legend` |
| `src/components/MapCanvas.tsx` | Zoom/pan interaction and canvas lifecycle |
| `src/components/Minimap.tsx` | Draggable minimap overlay: offscreen canvas cache, viewport indicator rectangle, click-to-navigate; visibility controlled by `layers.minimap` |
| `src/components/Controls.tsx` | Seed input, cell count, water ratio slider, terrain/political view toggle, layer toggles, history toggle + sim-years slider |
| `src/components/Timeline.tsx` | Two independent draggable panels: (1) bottom timeline controls (play/pause, step ±1/±10, year slider, population/nation stats), (2) right-side event log (collapsible via ▴/▾ toggle, yearly population entries). Rendered only when `mapData.history` exists |
| `src/workers/mapgen.worker.ts` | Orchestrates terrain pipeline (voronoi → elevation → ocean currents → moisture → temperature → biomes → rivers) + delegates to `HistoryGenerator` for history, posts progress events |

Each subdirectory has an `index.ts` that re-exports its public API.

### Data Model

The central type is `Cell` (defined in `types.ts`). Every terrain step annotates cells with new fields:

- `elevation`, `moisture` → set by `terrain/elevation.ts` / `terrain/moisture.ts`
- `temperature` → set by `terrain/temperature.ts` (0 = coldest polar extreme, 1 = hottest equatorial extreme; accounts for latitude, continentality, windward ocean proximity, and elevation lapse rate)
- `biome` → set by `terrain/biomes.ts`
- `river`, `flow` → set by `terrain/rivers.ts`
- `regionId` → set by `history/history.ts` (`buildPhysicalWorld`), always present after generation
- `kingdom` → set by `history/history.ts` (year-0 BFS, updated by renderer at selected year)

`Season` (0–3): render-time-only type controlling seasonal ice/snow/tundra boundary shifts and permafrost overlay. 0 = Spring (baseline, no change), 1 = Summer (ice retreats), 2 = Autumn (slight expansion), 3 = Winter (maximum expansion). Not stored on cells — applied at draw time via `getSeasonalBiome()` and `getPermafrostAlpha()`.

`MapData` (returned from worker) carries:
- `cells` — always present; each cell has `regionId?` after generation
- `regions?`, `continents?` — always present (built even without history); serializable `RegionData[]`/`ContinentData[]` for rendering geographic structure
- `cities?`, `roads?` — only present when history was generated
- `history?` — `HistoryData` with `countries`, `years[]`, decade `snapshots`

`HistoryData` structure:
- `countries: Country[]` — each country has id, name, capitalCellIndex, isAlive
- `years: HistoryYear[]` — per-year events (15 types: Foundation, Contact, Country, Illustrate, Wonder, Religion, Trade, Cataclysm, War, Tech, Conquest, Empire, plus legacy Merge/Collapse/Expansion) + sparse `ownershipDeltas`
- `snapshots` — full `Int16Array` of cell→countryId at every 20th year (for fast scrubbing)
- `tradeSnapshots` — `Record<number, TradeRouteEntry[]>` snapshotted every 20 years; each `TradeRouteEntry` has `cell1`, `cell2`, and an optional `path: number[]` (A*-pathfound cell-index sequence that hugs coastlines for maritime routes; absent only as fallback)

### Physical World Model

`buildPhysicalWorld(cells, width, rng)` in `history/history.ts` always runs before the optional history simulation. It uses the Phase 3 generator classes internally:

1. **Continents**: BFS flood-fill finds connected land cells; groups ≥ 10 cells form a `Continent` (via `continentGenerator`)
2. **Regions**: each continent is subdivided into ~30-cell clusters via multi-source BFS seeding; each gets a `RegionBiome` derived from its dominant Voronoi biome (via `regionGenerator`); geographic adjacency is wired with `regionGenerator.assignNeighbours`; `regionGenerator.updatePotentialNeighbours` computes BFS-layered `potentialNeighbours` (distance graph) for all regions after all continents are built
3. **Resources**: 1–10 `Resource` entities per region, weighted-random type (17 types: strategic/agricultural/luxury) via `resourceGenerator`
4. **Cities**: 1–5 `CityEntity` objects per region, placed on highest-scoring terrain cells via climate-aware `scoreCellForCity`, via `cityGenerator` (which also inserts into `world.mapCities`). Scoring boosts river cells (tiered by flow: >4/15/40), river mouths (coast+river), natural harbors (coastal cells with ≥4 land neighbors), and penalizes extreme biomes (tundra -5, desert -4, bare/scorched -3, temperate desert/marsh -2) with mitigation from rivers (-2) and coast (-1) so harsh-biome cities still appear near water features

The generator singletons (`worldGenerator`, `continentGenerator`, `regionGenerator`, `resourceGenerator`, `cityGenerator`) encapsulate object creation and map-insertion. The visitor singletons (`cityVisitor`, `regionVisitor`) provide iteration and predicate-based selection over the world's runtime index maps — used by Phase 4+ timeline simulation.

The `World`/`Continent`/`Region`/`CityEntity`/`Resource` class instances live **only inside the worker** — they use `Map`/`Set` which are not structured-clone safe and cannot cross the `postMessage` boundary. The worker serializes them into plain `RegionData[]` and `ContinentData[]` arrays for `MapData`.

`CityEntity` (in `physical/CityEntity.ts`) is the rich simulation entity tracking full lifecycle state. It is distinct from the lightweight render-type `City` in `types.ts`, which is used by the renderer for icon/label drawing.

### Timeline Model

`Timeline` and `Year` (in `history/timeline/`) form the temporal simulation layer (Phase 4) that runs on top of the physical world. The `TimelineGenerator` creates a `Timeline` anchored at a random start year ([-3000, -1001]) and generates 5000 `Year` records via `YearGenerator`.

Each `Year` holds 12 typed event collections (foundations, contacts, countries, illustrates, wonders, religions, trades, cataclysms, wars, techs, conquers, empires) populated by the Phase 5 generators during year generation.

`YearGenerator.generate()` performs 9 preprocessing steps per year, then calls all 12 Phase 5 generators in order:

**Preprocessing (steps 1–9):**
1. Abort if `world.endedBy` is set
2. Compute absolute year from `timeline.startOfTime + years.length`
3. Sum `worldPopulation` from usable cities (before growth)
4. Grow each usable city's population using `REGION_BIOME_GROWTH` biome multipliers
5. Kill/retire illustrates (natural death when `birthYear + yearsActive <= currentYear`; 15% war-related death chance if origin city's country is at war)
6. Propagate religions (single-religion cities: adherence drifts +0.05 toward 0.9; multi-religion cities: random religion gains +0.05 if total < 0.9; recompute member counts)
7. End expired wars (`started + lasts < currentYear`), clear `atWar` flags
8. Reassert `atWar` flags for active wars
9. Recompute `region.hasResources` via `updateHasResources()`

**Event generation (Phase 5, in order):**
Foundation → Contact → Country → Illustrate → Religion → Trade → Wonder → Cataclysm → War → Tech → Conquer → Empire

Each generator produces 0 or 1 event per year and may mutate world state (e.g., founding a city, starting a war, destroying a wonder).

The timeline classes (`Timeline`, `Year`) and all Phase 5 entity instances live **only inside the worker** alongside the physical model — they are not serialized across the `postMessage` boundary. The generator singletons follow the same pattern as the physical model generators.

### Phase 6: HistoryGenerator (Orchestration)

`HistoryGenerator` in `history/HistoryGenerator.ts` is the top-level entry point for the history pipeline. It:

1. Calls `buildPhysicalWorld` to create the `World` with continents, regions, resources, and cities
2. Calls `TimelineGenerator.generate()` to run 5000 years of simulation
3. Builds a `CountryIndexMap` mapping internal string IDs → numeric indices for ownership arrays
4. Serializes timeline years into `HistoryYear[]` with `HistoryEvent` objects for each of the 12 Phase 5 event types
5. Computes cell-level ownership snapshots from the region-based country model (countries own regions; conquests transfer region ownership)
6. Converts founded `CityEntity` objects into render-type `City[]`
7. Generates roads via A* between founded cities
8. Produces `HistoryStats` for optional introspection (peak population, entity counts, etc.)

The worker delegates to `historyGenerator.generate()` when `generateHistory` is true. The old `generateHistory()` function in `history.ts` is preserved for backward compatibility but the worker now uses the Phase 6 orchestrator.

### Randomness

All randomness goes through the seeded `mulberry32` PRNG in `terrain/noise.ts`. Never use `Math.random()` directly — pass the seeded RNG to any function that needs randomness to ensure reproducibility.

### Generation Parameters

`GenerateRequest` (in `types.ts`) carries all user-controlled inputs to the worker:

| Parameter | Type | Description |
|-----------|------|-------------|
| `seed` | `string` | Deterministic seed string |
| `numCells` | `number` | Voronoi cell count (500–100,000) |
| `waterRatio` | `number` | Fraction of cells that are water (0–1, default 0.4) |
| `width` / `height` | `number` | Canvas dimensions |
| `generateHistory` | `boolean` | Whether to run the history simulation (default false) |
| `numSimYears` | `number` | Years to simulate (50–5000, default 5000); only used when `generateHistory` is true |

`waterRatio` is implemented by ranking all cells by elevation and marking the lowest `waterRatio * N` as water. This guarantees the exact ratio regardless of the terrain shape, unlike a fixed elevation threshold.

### Rendering

`renderer/renderer.ts` draws everything onto a single `<canvas>` element. Layer visibility is controlled by the `LayerVisibility` type. When modifying rendering:
- Biome colors are defined in `terrain/biomes.ts` (`BIOME_INFO`)
- Coastlines use noisy edges from `renderer/noisyEdges.ts` for an organic look
- City icons are drawn as simple SVG-path-like canvas commands
- `drawBiomeFill` renders land cells first, water cells second — this ensures water always wins at shared polygon edges (Voronoi cell indices have no spatial order, so rendering in index order causes land to bleed over water). Land cells use per-cell vegetation density modulation (`getVegetationDensity` + `modulateBiomeColor`) to vary fill color by ±12% based on moisture position within the Whittaker band, with spatial-hash dither to prevent banding. Tree icons also vary in density (10–30%), size (0.85–1.15×), and color (lighter green at dry edges, darker at wet edges) based on the same factor
- `drawHillshading` computes per-cell elevation gradients from Voronoi neighbors and applies directional illumination (NW light, 315° azimuth, 45° altitude) as an rgba overlay — white for lit slopes, black for shaded slopes. Placed between biome fill and water depth in the render order. Controlled by `layers.hillshading` (defaults to enabled). Uses elevation scale factor of 8.0 to exaggerate relief
- `drawPermafrost` renders a blue-gray overlay (`rgba(180, 200, 220, alpha)`) on sub-polar land cells (temperature 0.10–0.30). Placed between hillshading and water depth. Alpha scales with depth into the cold band and varies by season. Controlled by `layers.seasonalIce`
- `drawBiomeFill` accepts a `season` parameter; when season is non-zero (and `layers.seasonalIce` is enabled), it calls `getSeasonalBiome()` to determine the effective biome color for each cell, shifting polar biome boundaries per season
- `drawWaterDepth` renders ocean depth overlay with ocean current tinting: compares `cell.temperature` to latitude baseline to derive SST anomaly, then shifts rgb channels (warm currents → less blue/more green, cold currents → deeper blue); the effect is subtle and purely visual
- The biome legend is a React overlay component (`Legend.tsx`), not drawn on the canvas; it is controlled by `layers.legend` (part of `LayerVisibility`) and rendered in `App.tsx`
- When `historyData` is present, kingdom borders/fills use `getOwnerAtYear(history, selectedYear, cellIndex)` instead of `cell.kingdom`; city/road/border layers are hidden entirely when no history data exists
- `getOwnerAtYear` finds the nearest decade snapshot ≤ target year, then replays `ownershipDeltas` forward to the exact year
- **Political view** applies a parchment overlay (`rgba(245, 233, 200, 0.55)`) on land cells and uses bolder kingdom fills (0.35 alpha via `KINGDOM_COLORS_POLITICAL`) vs terrain view's subtle fills (0.12 alpha via `KINGDOM_COLORS_TERRAIN`)

### UI Panels

- **Controls panel** (`Controls.tsx`): has a collapse toggle (▴/▾) in the title row; when collapsed it shows only the title bar, hiding all generation parameters. Collapse state is local to the component (`useState`). Includes a terrain/political view toggle (two buttons) that sets `mapView` state. Includes a season selector (four buttons: Spring/Summer/Autumn/Winter) that sets `season` state; this is a render-time-only control that shifts polar biome boundaries and permafrost overlay intensity without re-running generation.
- **Legend** (`Legend.tsx`): a draggable React overlay component. Toggled via the "Legend" checkbox in the Layers section of the Controls panel — this sets `layers.legend` which is checked in `App.tsx`. Defaults to bottom-left position.
- **Minimap** (`Minimap.tsx`): a draggable React overlay that renders a scaled-down version of the full map using an offscreen canvas cache. Shows a white semi-transparent viewport indicator rectangle. Click to navigate the main viewport. Toggled via `layers.minimap` checkbox in the Layers section. Defaults to bottom-left position.
- **Terrain/Political view**: `mapView: 'terrain' | 'political'` state in `App.tsx`. Terrain view shows full biome detail. Political view adds a semi-transparent parchment overlay on land and uses bolder kingdom fill colors (0.35 alpha vs 0.12 in terrain mode).
- **History settings**: "Generate History" checkbox + "Sim years" slider (50–5000) appear in the Controls panel. When history is off, the roads/borders/icons/labels layer toggles are hidden (they have no effect without history data).
- **Timeline panel** (`Timeline.tsx`): rendered only when `mapData.history` exists. Two independent draggable panels:
  - **Bottom controls**: draggable panel (centered at bottom). Year slider (0 to `numYears`), play/pause auto-advance (200ms per year), step buttons (±1, ±10 years). Header shows year, world population (formatted as K/M), living/total nations count, and event count. Timeline starts at year 0 after generation. Play restarts from 0 if already at the end. Dragging the slider or pressing step buttons pauses auto-play.
  - **Event log side panel** (defaults to top-right): draggable and collapsible (▴/▾ button in header). Toggleable via "Show/Hide Log" button in the timeline controls. Shows a cumulative list of all events from year 0 to the selected year, with year labels, event-type icons, and yearly population entries. Current-year events are highlighted. Auto-scrolls to the latest events as the year advances.
  - Year changes update `selectedYear` state in `App.tsx`, which triggers a re-render of the canvas.
- **Draggable behavior** (`Draggable.tsx`): all draggable panels use `data-drag-handle` attributes on their title bars. Drag uses Pointer Events API (works on desktop and mobile). Panels are clamped so at least 40px remains visible within the viewport. Drag handles set `touch-action: none` to prevent browser scroll/pan interference on mobile. Re-clamps on window resize/orientation change.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages at `/procgen_map_fe/`. The Vite `base` config must stay as `/procgen_map_fe/` to match this path.

## Common Pitfalls

- **Worker communication**: `mapgen.worker.ts` uses `postMessage` with typed `WorkerMessage` objects. Keep the message schema in sync with `App.tsx`'s `onmessage` handler.
- **High-DPI canvas**: `MapCanvas.tsx` scales the canvas by `devicePixelRatio`. Don't set canvas width/height via CSS — use the component's resize logic.
- **Cell count performance**: Generation above ~10,000 cells is slow. Default is 5,000. Test UI changes at low cell counts.
- **Base path**: Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source.
- **Elevation normalization**: After computing FBM + island-falloff elevations, `terrain/elevation.ts` divides all values by the observed maximum so the highest cell always reaches 1.0. Without this, FBM noise in practice tops out around 0.8, and the island mask compresses it further — leaving the Whittaker mountain band (elevation > 0.75) unreachable. Do not remove this normalization step.
- **Mountain biome bands**: The Whittaker table uses 5 elevation bands: lowland (<0.3), midland (0.3–0.6), highland (0.6–0.65), alpine (0.65–0.75, yields `ALPINE_MEADOW` as a transitional biome), and mountain (0.75+, yields SCORCHED/BARE/TUNDRA/SNOW). Mountain icons are rendered on all land cells with elevation ≥ 0.75 regardless of biome `iconType`, at ~40% density with elevation-scaled sizing.
- **History is the cities/kingdoms source**: Do not call `placeCities` or `drawKingdomBorders` from the worker when `generateHistory` is true — `HistoryGenerator` owns that responsibility. Calling both would double-place cities and corrupt kingdom state.
- **HistoryGenerator is the new orchestrator**: When history is enabled, the worker calls `historyGenerator.generate()` (Phase 6), not the old `generateHistory()` from `history.ts`. The old function is preserved but not used by the worker.
- **Ownership reconstruction**: `getOwnerAtYear` must apply deltas in strict year order. Out-of-order application produces incorrect borders. The snapshots are keyed by decade (0, 10, 20…); always start from `Math.floor(year / 10) * 10`.
- **`cell.kingdom` vs history**: `cell.kingdom` is written once by `history/history.ts` as the year-0 state. The renderer overwrites the visual ownership at the selected year but must never mutate `cell.kingdom` — it is the baseline and is needed to reconstruct history from scratch.
- **`buildPhysicalWorld` always runs**: Unlike the history simulation, `buildPhysicalWorld` is called for every generation (terrain-only or history). `MapData.regions` and `MapData.continents` are always populated. Do not gate region/resource rendering on `mapData.history`.
- **Hydraulic erosion refreshes temperature/biomes**: After `hydraulicErosion` modifies elevations, the worker re-runs `assignTemperature` and `assignBiomes` because they depend on elevation (lapse rate, elevation bands). Moisture and ocean currents are NOT re-run — they depend on coarse geography. Rivers are also re-traced after erosion so they follow the carved terrain.
- **Don't postMessage class instances**: `World`, `Region`, `Continent` use `Map` and `Set` which are not structured-clone safe. Only the plain `RegionData[]`/`ContinentData[]` arrays cross the worker boundary. Keep the class instances inside the worker.
- **TRADE_TECHS duplication**: the trade-tech field list is hardcoded in two places — `TRADE_TECH_FIELDS` in `physical/CityEntity.ts` (consumed by `effectiveTradeCap()`) and `TRADE_TECHS` in `timeline/Tech.ts`. The duplication exists to avoid a `physical → timeline` circular import. If you change one, change the other. A dev-only monotonicity assertion in `mapgen.worker.ts` guards against regressions in the multiplier formula.
