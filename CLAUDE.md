# CLAUDE.md

This file documents the **overall simulation framework** — the conventions, data shapes, and wiring that hold every layer of the procgen project together. Layer-specific details (universe, world map, world history, city map, characters) live in `claude_specs/`. Read this file first for the framework; jump to a spec when you need depth on a particular system.

## Project Overview

The project is a layered procedural generator. The user picks a generation mode on a landing screen and drills down through nested zoom levels, each one deterministic from a seed string and seeded sub-streams of it:

```
universe ──► galaxy ──► solar system ──► planet (or satellite)
                                          │
                                          └─► world map (terrain + biomes + rivers)
                                                │
                                                └─► world history (5000-yr civilizational sim, optional)
                                                      │
                                                      └─► city map  (V1 tile / V2 Voronoi-polygon)
                                                            │
                                                            └─► characters (PC/NPC roster)
```

**Key design principles**:
- **The physical world is always built from terrain.** Continents / regions / resources run even without history.
- **Cities and kingdoms are outputs of the history simulation, not independent pipeline steps.** When history is disabled, the map shows terrain + geographic structure only.
- **City maps and character rosters are render-only zoom-in features** — they never affect the simulation and are never reached by the sweep harness.
- **The universe layer is an outer wrapper, not a hard dependency.** The world-map flow can run on its own; the universe flow drills down into it via a seed hand-off.

## Commands

```bash
npm run dev       # Start Vite dev server (hot reload)
npm run build     # TypeScript type-check + Vite production build
npm run preview   # Serve the production build locally
npm run sweep     # Phase 4 seed sweep — runs full history across 5 fixed seeds in Node
                  # via tsx, writes scripts/results/<label>.json. Use `-- --label foo` to tag.
```

There is no test suite. Verify correctness by running `npm run build` (catches type errors) and visually inspecting the map in the browser. For history-simulation changes that might shift balance, run `npm run sweep -- --label <experiment>` and diff the resulting JSON against `scripts/results/baseline-a.json` to catch regressions. The sweep is byte-deterministic — re-running with the same args produces byte-identical output modulo timestamps. The sweep covers the world-map + world-history pipelines only; the universe / city-map / characters layers are render-only and never reached.

## Documentation Map

The simulation is split into five layers, each documented in its own `claude_specs/` file:

| Spec | Scope |
|------|-------|
| **[`claude_specs/universe_map.md`](claude_specs/universe_map.md)** | `src/lib/universe/` — Universe → Galaxy → SolarSystem → Star/Planet → Satellite. Generators, naming, galaxy layout, subtype tables, drill-down renderer (frustum culling, spiral layout cache, no-glow invariants, zoom 0.15–2000×), hand-off to the world-map flow |
| **[`claude_specs/world_map.md`](claude_specs/world_map.md)** | Physical terrain pipeline (Voronoi → biomes → rivers → erosion), terrain profiles (7 biome presets) + landmass shapes (4 partial overlays), canvas renderer, world-map UI panels (MapCanvas, Minimap, Legend, Generation tab) |
| **[`claude_specs/world_history.md`](claude_specs/world_history.md)** | Phase 6 HistoryGenerator orchestration, `buildPhysicalWorld`, Timeline + 12 Phase 5 generators, tech / religion / cataclysm / war / conquer / empire mechanics, HistoryStats + sweep harness, render-time concerns (overlay tabs, Timeline panel, ownership reconstruction) |
| **[`claude_specs/city_map.md`](claude_specs/city_map.md)** | City-map popups: V1 (tile, frozen) + V2 (Voronoi-polygon, in-progress through PR 5). Polygon graph, walls, river, roads, streets, bridges, open spaces, blocks, landmarks, buildings, sprawl |
| **[`claude_specs/characters.md`](claude_specs/characters.md)** | PC/NPC roster generation — `lib/fantasy/` D&D 3.5e engine, `lib/citychars.ts` lazy roller, `Country.raceBias` + `Religion.deity/alignment` simulation metadata, `World.seed` threading |

When working on a change, identify which layer it touches and read the relevant spec. Most changes also need to respect the framework conventions documented below.

## Architecture

### Two Workers

Heavy generation runs in two Web Workers, each owning one pipeline:

- **`src/workers/mapgen.worker.ts`** — terrain → physical world → optional 5000-year history → roads. Posts `MapData` to the main thread.
- **`src/workers/universegen.worker.ts`** — universe → galaxies → systems → stars / planets / satellites. Posts `UniverseData` to the main thread.

The two workers never share state. They run from independent RNG roots and produce independent payloads. The only glue between them is the **seed hand-off** in `App.tsx`: when the user picks a habitable rock planet/satellite in the universe view and clicks "Generate World", the world-map worker is seeded with `${universe.seed}_${planet.id}` (or `..._${satellite.id}`) and the chosen body's biome snaps the world generator's profile + water ratio defaults. See `universe_map.md` for the hand-off contract.

### World-Map Pipeline (`mapgen.worker.ts`)

The pipeline is strictly sequential:

```
voronoi → elevation → oceanCurrents → moisture → temperature → biomes
  → fillDepressions → rivers (initial) → hydraulicErosion → fillDepressions
  → rivers (final) → temperature (refresh) → biomes (refresh)
  → buildPhysicalWorld
  └─ (if generateHistory=true) → HistoryGenerator → roads
                                    ├─ buildPhysicalWorld (World + Continents + Regions + Resources + Cities)
                                    ├─ TimelineGenerator (5000 years via YearGenerator)
                                    │    └─ 12 Phase 5 generators per year:
                                    │       Foundation → Contact → Country → Illustrate → Religion
                                    │       → Trade → Wonder → Cataclysm → War → Tech → Conquer → Empire
                                    └─ serialize → HistoryData (ownership snapshots + events)
```

Terrain steps are documented in `world_map.md`. The history pipeline is documented in `world_history.md`.

### Universe Pipeline (`universegen.worker.ts`)

```
UniverseGenerator
  ├─ for i in 0..numSolarSystems: solarSystemGenerator.generate(universe, rng)
  │    ├─ rndSize(rng, 3, 1) stars  via starGenerator (names on isolated stream)
  │    └─ stars.length*2 + floor(rng()*15) planets via planetGenerator
  │         ├─ subtype on isolated sub-stream `${seed}_planetsubtype_${planet.id}`
  │         └─ rndSize(rng, 15, -5) satellites via satelliteGenerator
  │              └─ subtype on isolated sub-stream `${seed}_satsubtype_${satellite.id}`
  ├─ chunk into ceil(N/100) galaxies (single galaxy when N ≤ 100 — legacy single-spiral path)
  ├─ name galaxies + universe (each entity's name on its own isolated sub-stream)
  └─ layoutGalaxies via `${universeSeed}_galaxy_layout` (sunflower disc + relaxation)
```

See `universe_map.md` for the full breakdown.

### Lazy Zoom-In Features

Two layers run **on demand**, not in the worker pipeline:

- **City maps** (`city_map.md`) generate when the user clicks Map / MapV2 in the Details tab.
- **Character rosters** (`characters.md`) generate when the user opens a city in the Details tab via a `useMemo` inside `DetailsTab.tsx`.

Both run on the main thread, complete in milliseconds, and are seeded from `worldSeed` + the entity's id so re-opening the same entity produces a byte-identical artifact.

## File Organization

`src/lib/` is split by concern; each subdirectory has an `index.ts` barrel exporting its public API.

| Path | Layer | Spec |
|------|-------|------|
| `src/lib/types.ts` | Shared world-map types — `Cell`, `MapData`, `HistoryData`, `GenerateRequest`, `TerrainProfile`, etc. **Start here when looking up a type for the world map.** | (this file) + `world_map.md` |
| `src/lib/universe/` | Universe pipeline (entities + generators + worker-facing types in `universe/types.ts`) | `universe_map.md` |
| `src/lib/terrain/` | Physical terrain pipeline | `world_map.md` |
| `src/lib/history/` | Civilizational simulation + physical world model | `world_history.md` |
| `src/lib/history/physical/` | Entity classes + generators (World, Continent, Region, CityEntity, Resource) | `world_history.md` |
| `src/lib/history/timeline/` | Temporal simulation (Timeline, Year, 12 Phase 5 generators) | `world_history.md` |
| `src/lib/renderer/` | Canvas 2D rendering for the world map | `world_map.md` |
| `src/lib/citymap/` | City map V1 (tile-based) + V2 (Voronoi-polygon-based) generators & renderers | `city_map.md` |
| `src/lib/fantasy/` | Race / Deity / Alignment specs + `generatePcChar` D&D 3.5e roller | `characters.md` |
| `src/lib/citychars.ts` | UI-only lazy roster roller for the Details tab | `characters.md` |
| `src/workers/mapgen.worker.ts` | World-map pipeline orchestrator | `world_map.md` + `world_history.md` |
| `src/workers/universegen.worker.ts` | Universe pipeline orchestrator | `universe_map.md` |
| `src/components/` | React UI (canvases, overlays, popups, timeline panel) | each spec covers its own panels |

## Worker / Main-Thread Boundary

Both workers follow the same discipline: **class instances stay inside the worker; only plain data crosses `postMessage`.**

The class hierarchies that stay inside their worker:
- **World-map worker**: `World`, `Continent`, `Region`, `CityEntity`, `Resource`, `Timeline`, `Year`, and every Phase 5 entity instance. They use `Map<string, …>` and `Set<string>` indexes which are NOT structured-clone safe.
- **Universe worker**: `Universe`, `Galaxy`, `SolarSystem`, `Star`, `Planet`, `Satellite`. Same `Map<string, …>` index pattern (`mapSolarSystems`, `mapStars`, `mapPlanets`, `mapSatellites`, `mapGalaxies`) on `Universe`.

Anything you want to expose to the UI must be:
- a primitive,
- a typed array (`Int16Array`, `Uint8Array`, `Float32Array` — structured-clone safe),
- a plain object/array tree of the above, or
- a `Record<number, TypedArray>` (used for `snapshots`, `tradeSnapshots`, `empireSnapshots`, `techTimeline.byField`).

Each worker has its own serializer:
- World-map worker → flattens `World` into `RegionData[]` / `ContinentData[]` / `City[]` / `HistoryData` / `HistoryStats` and packs them into `MapData`.
- Universe worker → `serializeUniverse(universe)` flattens into `UniverseData` (with `GalaxyData[]` / `SolarSystemData[]` / `StarData[]` / `PlanetData[]` / `SatelliteData[]` nested under it).

Keep each worker's `WorkerMessage` schema in sync with `App.tsx`'s `onmessage` handler — drift here causes silent data loss.

## Shared Data Types

### `Cell` (world map)

`Cell` (in `src/lib/types.ts`) is the universal terrain primitive. Every terrain step in `src/lib/terrain/` annotates cells with new fields:

- `elevation`, `moisture` → `terrain/elevation.ts` / `terrain/moisture.ts`
- `temperature` → `terrain/temperature.ts` (0 = coldest polar, 1 = hottest equatorial; accounts for latitude, continentality, windward ocean proximity, lapse rate)
- `biome` → `terrain/biomes.ts` (Whittaker classification with 5 elevation bands + LAKE)
- `river`, `flow` → `terrain/rivers.ts`
- `isLake` → `terrain/depressionFill.ts` (small closed basins materialized as inland lakes)
- `regionId` → `history/history.ts::buildPhysicalWorld` (always present after generation)
- `kingdom` → `history/history.ts` (year-0 BFS baseline; renderer overlays live ownership at the selected year but must NEVER mutate this field)

Renderer-only types like `Season` (0–3, four seasons) are NOT stored on cells — they're applied at draw time. See `world_map.md` for details.

### `MapData` (world-map worker output)

Always present:
- `cells: Cell[]` — fully annotated by the terrain pipeline
- `regions: RegionData[]`, `continents: ContinentData[]` — built unconditionally by `buildPhysicalWorld`

Present only when `generateHistory = true`:
- `cities: City[]` — render-type cities (distinct from `CityEntity` simulation entities)
- `roads: Road[]` — A* paths between cities
- `history: HistoryData` — countries, years (events), ownership snapshots
- `historyStats: HistoryStats` — aggregate metrics (forwarded, not recomputed; see `world_history.md`)

### `UniverseData` (universe-worker output)

```
UniverseData {
  id, humanName, scientificName, seed,
  solarSystems: SolarSystemData[]   // each has stars[], planets[]; planet has satellites[]
  galaxies: GalaxyData[]            // baked layout fields cx/cy/radius/spread
}
```

See `universe_map.md` for the full shape.

### `GenerateRequest` (world-map worker input)

Every user-controlled input flows through `GenerateRequest` (in `src/lib/types.ts`). The worker resolves these in a fixed order: biome profile → shape overlay → user overrides.

| Parameter | Type | Description |
|-----------|------|-------------|
| `seed` | `string` | Deterministic seed string |
| `numCells` | `number` | Voronoi cell count (500–100,000) |
| `waterRatio` | `number` | Fraction of cells marked water (0–1, default 0.4) |
| `width` / `height` | `number` | Canvas dimensions |
| `generateHistory` | `boolean` | Run the timeline simulation (default false) |
| `numSimYears` | `number` | Years to simulate (50–5000, default 5000); only when history is on |
| `profileName` | `string?` | Named **biome** preset (`'desert'`, `'ice'`, `'default'`, …) |
| `shapeName` | `string?` | Named **landmass shape** preset (`'pangaea'`, `'continents'`, `'islands'`, `'archipelago'`, `'default'`) — applied as a `Partial<TerrainProfile>` overlay |
| `profileOverrides` | `Partial<TerrainProfile>?` | Fine-tuning overrides on top of the named presets |

`waterRatio` is implemented by ranking cells by elevation and marking the lowest `waterRatio * N` as water (exact ratio regardless of terrain shape). `UniverseGenerateRequest` is much simpler — `{ type, seed, numSolarSystems }`.

### `TerrainProfile` Threading

`TerrainProfile` (in `src/lib/types.ts`) is the single source of truth for ~40 tunable terrain constants. Every terrain function (`assignElevation`, `computeOceanCurrents`, `assignMoisture`, `assignTemperature`, `assignBiomes`, `hydraulicErosion`) takes the profile as its last parameter. The worker resolves it from `profileName + shapeName + profileOverrides` (three-way spread merge) and passes it down.

When adding a new tunable terrain constant: add it to `TerrainProfile`, set its default in `DEFAULT_PROFILE` (in `terrain/profiles.ts`), and read it from the profile parameter — do **NOT** add a new file-local const. See `world_map.md` for the full list of profiles + shapes.

## Generators & Visitors Pattern

The simulation entity model uses two complementary patterns repeated across the universe + world-history layers:

- **Generator singletons** (one per entity class) encapsulate object creation and runtime-index insertion: `worldGenerator`, `continentGenerator`, `regionGenerator`, `resourceGenerator`, `cityGenerator` (world-history physical layer); `foundationGenerator`, `contactGenerator`, … `empireGenerator` (timeline layer); `universeGenerator`, `solarSystemGenerator`, `starGenerator`, `planetGenerator`, `satelliteGenerator` (universe layer). Each entity file in `src/lib/history/timeline/` exports both an entity interface and a generator singleton.
- **Visitor singletons** provide iteration + predicate-based selection over the world's runtime index maps: `cityVisitor` (iterate all/usable cities, random selection with predicate via Fisher-Yates), `regionVisitor` (iterate all regions, `selectUpToN` / `selectOne` with predicate). Used heavily by Phase 5 generators.

The runtime indexes themselves live on the root entity (`World` or `Universe`) as typed `Map`s — see each spec for the full list.

## Randomness

**All randomness goes through the seeded `mulberry32` PRNG in `src/lib/terrain/noise.ts` (re-exported as `seededPRNG`).** Never use `Math.random()` directly anywhere in `src/lib/` or `src/workers/`. A single `Math.random` call breaks reproducibility for the whole run and silently desyncs the sweep harness.

The codebase uses **isolated PRNG sub-streams** liberally — they're how new behaviors get added without perturbing existing seeded outputs. Sub-streams are spawned via `seededPRNG(`${seed}_<purpose>_<entityId>`)` and consumed locally; their draws never leak back into the main `rng` parameter. Examples (non-exhaustive):

| Sub-stream | Layer |
|------------|-------|
| `${seed}_universe` | World-map vs universe pipeline isolation (universe worker root) |
| `${seed}_planetsubtype_<id>` / `_satsubtype_<id>` | Universe planet/satellite subtype rolls |
| `${seed}_<tier>name_<id>` | Universe entity naming (galaxy/star/planet/satellite/universe) |
| `${seed}_galaxy_layout` | Universe galaxy 2D layout |
| `${seed}_racebias_<countryId>` | Country race bias (`characters.md`) |
| `${seed}_deity_<religionId>` | Religion deity binding (`characters.md`) |
| `${seed}_chars_<cellIndex>` | Character roster roll (`characters.md`) |
| `${seed}_city_<cityName>_voronoi` / `_walls` / `_river` / `_roads` / `_streets` / `_openspaces_*` / `_blocks_names` / `_landmarks_*` / `_buildings` / `_sprawl` | V2 city slices (`city_map.md`) |

The discipline: **a new feature that adds a behavioral roll must use its own sub-stream, OR be a no-op when its inputs are zero/default**. Otherwise the sweep baseline shifts.

## The Sweep Harness

`scripts/sweep-history.ts` is a single-file Node CLI run via `tsx` (dev dep) — `npm run sweep`. It runs the **world-map + world-history** pipeline across 5 fixed seeds and writes `scripts/results/<label>.json`. Use `npm run sweep -- --label foo` to tag.

The sweep is **byte-deterministic** — re-running with the same args produces byte-identical JSON modulo timestamps. Any non-zero diff against `scripts/results/baseline-a.json` is a real behavior change. Diff after history-simulation tuning to catch regressions.

**Hard rules:**
- The harness must remain browser-free. Do NOT import from `src/components/`, `src/workers/`, or any DOM-dependent module — it must run in a bare Node shell.
- If the terrain or history pipeline grows a new step, mirror it in both `mapgen.worker.ts` and `sweep-history.ts` (same order, same arguments) or future sweeps will silently drift from in-browser behavior.
- The sweep currently uses `DEFAULT_PROFILE` directly with no biome/shape overlay — sweep baselines stay byte-identical. If the harness ever gains `--profile`/`--shape` flags, mirror the three-way merge from `mapgen.worker.ts` exactly.

The sweep does NOT cover:
- The **universe pipeline** (`src/lib/universe/`, `universegen.worker.ts`) — verify universe changes via `npm run build` and visual inspection.
- **City-map generation** (`src/lib/citymap/`) — render-only, never reached by the sweep.
- **Character rosters** (`src/lib/citychars.ts` + `src/lib/fantasy/`) — render-only, never reached by the sweep.

Any non-zero sweep diff after a citymap-only, characters-only, or universe-only change means an **accidental simulation-layer edit**.

## Verification

There is no test suite. Verify changes by:

1. `npm run build` — TypeScript type-check + Vite production build (catches type errors, including subtype/composition exhaustiveness checks in the universe layer and the `TechField` exhaustiveness check in the history layer).
2. Visual inspection in `npm run dev` — hot-reload dev server.
3. `npm run sweep -- --label <experiment>` for any history-simulation change; diff against `scripts/results/baseline-a.json`.

For UI/frontend changes, exercise the feature in a browser — type-checking and sweep don't catch render-only regressions. If a UI feature can't be tested (e.g. mobile-only behavior in a desktop session), say so explicitly rather than claiming success.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages at `/procgen_map_fe/`. The Vite `base` config must stay as `/procgen_map_fe/` to match this path.

## Common Pitfalls (Cross-Cutting)

These cut across multiple specs. Layer-specific pitfalls live in each spec's "Pitfalls" section.

- **Don't postMessage class instances.** `World`, `Region`, `Continent`, `CityEntity`, `Timeline`, `Year`, Phase 5 entities, AND `Universe` / `Galaxy` / `SolarSystem` / `Star` / `Planet` / `Satellite` all use `Map`/`Set` and won't structured-clone. Each worker has its own serializer; flatten to plain data inside the worker.
- **Worker message schemas.** Keep both `WorkerMessage` types in sync between `mapgen.worker.ts` / `universegen.worker.ts` and `App.tsx`'s respective `onmessage` handlers. Drift causes silent data loss.
- **`buildPhysicalWorld` always runs.** `MapData.regions` and `MapData.continents` are populated for every world-map generation, even terrain-only. Don't gate region/resource rendering on `mapData.history`.
- **HistoryGenerator owns cities + kingdoms when history is on.** Don't call `placeCities` / `drawKingdomBorders` from the world-map worker when `generateHistory = true` — `HistoryGenerator` owns that responsibility.
- **`HistoryStats` is forwarded, not recomputed.** New code that wants tech aggregates, total wars/trades/conquests, peak population, or tech-loss totals should read `mapData.historyStats` instead of re-walking `historyData.years` on the main thread.
- **Sub-stream isolation is the contract that keeps the sweep stable.** When adding a new randomness-driven feature, route it through `seededPRNG(`${seed}_<purpose>_<id>`)` and never let its draws fall back into the main `rng`. A non-zero sweep diff after a "decorative" or render-only change usually means a sub-stream draw leaked.
- **High-DPI canvas.** `MapCanvas.tsx` and `UniverseCanvas.tsx` scale by `devicePixelRatio`. Don't set canvas width/height via CSS — use the components' resize logic.
- **Cell count performance.** World-map generation above ~10,000 cells is slow. Default is 5,000. Test world-map UI changes at low cell counts. Universe generation scales up to 10,000 systems via the slider (the sliders default to 500/1000/5000/10000).
- **Base path.** Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source.
- **Universe ↔ world-map seed hand-off is a stable interface.** `${universe.seed}_${planet.id}` (or `..._${satellite.id}`) is what the user lands on when they generate a world from the universe view. Changing this format would break "the same universe seed always gives the same world for a given planet". See `universe_map.md`.

## When You Add a New Feature

1. Identify the layer (universe / world map / world history / city map / characters) — which spec applies?
2. Read the spec's "Pitfalls" section before designing.
3. If the feature needs randomness, route it through a new isolated sub-stream so the sweep stays byte-identical.
4. If the feature touches the world-map worker pipeline, mirror the change in `scripts/sweep-history.ts` (same order, same arguments).
5. Run `npm run build` to type-check.
6. For history-simulation tuning, run `npm run sweep -- --label <experiment>` and diff against `scripts/results/baseline-a.json`.
7. For UI changes, exercise the feature in `npm run dev` — type-checking and sweep don't catch render-only regressions.
8. Update the relevant spec file (and add a new pitfall if the change introduces a non-obvious invariant).
