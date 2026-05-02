# Universe / Simulation Framework

This file documents the **simulation universe** — the framework that holds every layer of the procgen map together: the entity model that the simulation populates, the worker/main-thread boundary, the random-number contract, the data shapes that cross between threads, and the sweep harness that guards determinism. All five concrete layers (`world_map.md`, `world_history.md`, `city_map.md`, `characters.md`, plus the renderer) plug into the conventions described here. Read this file first when you need to understand *how a system fits in*; read the layer-specific file when you need to understand *what a system does*.

## Mental Model

The simulation produces a **deterministic, seeded universe** in three nested layers:

1. **Physical world** — Voronoi cells with terrain attributes (`Cell`s in `src/lib/terrain/`), grouped into Continents and Regions and seeded with Resources and Cities (`src/lib/history/physical/`). Always built — even when history is disabled.
2. **Timeline** — 5000 years of civilizational events layered on top of the physical world (`src/lib/history/timeline/`). Opt-in via `GenerateRequest.generateHistory`.
3. **Zoom-ins** — city maps (`src/lib/citymap/`) and character rosters (`src/lib/citychars.ts` + `src/lib/fantasy/`) generated lazily on demand from the simulation state.

Everything heavy runs in `src/workers/mapgen.worker.ts` (a Web Worker). The main thread receives plain serialized data via `postMessage`.

## File Organization

`src/lib/` is split by concern; each subdirectory has an `index.ts` barrel exporting its public API.

| Path | Layer | Spec |
|------|-------|------|
| `src/lib/types.ts` | Shared TypeScript types — `Cell`, `MapData`, `HistoryData`, `GenerateRequest`, `TerrainProfile`, etc. **Start here when looking up a type.** | (this file) |
| `src/lib/terrain/` | Physical terrain pipeline | `world_map.md` |
| `src/lib/history/` | Civilizational simulation + physical world model | `world_history.md` |
| `src/lib/history/physical/` | Entity classes + generators (World, Continent, Region, CityEntity, Resource) | `world_history.md` |
| `src/lib/history/timeline/` | Temporal simulation (Timeline, Year, Phase 5 generators) | `world_history.md` |
| `src/lib/renderer/` | Canvas 2D rendering for the world map | `world_map.md` |
| `src/lib/citymap/` | City map V1 (tile-based) + V2 (Voronoi-polygon-based) generators & renderers | `city_map.md` |
| `src/lib/fantasy/` | Race/Deity/Alignment specs + `generatePcChar` D&D 3.5e roller | `characters.md` |
| `src/lib/citychars.ts` | UI-only lazy roster roller for the Details tab | `characters.md` |
| `src/workers/mapgen.worker.ts` | Pipeline orchestrator (terrain → physical world → optional history) | this file + `world_map.md` + `world_history.md` |
| `src/components/` | React UI (canvas, overlays, timeline panel, popups) | `world_map.md` (rendering panels) + `world_history.md` (history panels) |

## Worker / Main-Thread Boundary

`src/workers/mapgen.worker.ts` is the single producer of every simulation artifact. It posts progress events and a final `MapData` payload to the main thread.

**Hard rule: class instances stay inside the worker.** `World`, `Continent`, `Region`, `CityEntity`, `Resource`, `Timeline`, `Year`, and every Phase 5 entity instance use `Map` and `Set` internally — those types are NOT structured-clone safe and cannot cross `postMessage`. The worker serializes them to plain `RegionData[]`, `ContinentData[]`, `City[]`, `HistoryData`, `HistoryStats` arrays/records before posting.

Anything you want to expose to the UI must be:
- a primitive,
- a typed array (`Int16Array`, `Uint8Array`, `Float32Array` — structured-clone safe),
- a plain object/array tree of the above, or
- a `Record<number, TypedArray>` (used for `snapshots`, `tradeSnapshots`, `empireSnapshots`, `techTimeline.byField`).

Keep the `WorkerMessage` schema in sync with `App.tsx`'s `onmessage` handler — drift here causes silent data loss.

## The Cell

`Cell` (in `types.ts`) is the universal terrain primitive. Every terrain step in `src/lib/terrain/` annotates cells with new fields:

- `elevation`, `moisture` → `terrain/elevation.ts` / `terrain/moisture.ts`
- `temperature` → `terrain/temperature.ts` (0 = coldest polar, 1 = hottest equatorial; accounts for latitude, continentality, windward ocean proximity, lapse rate)
- `biome` → `terrain/biomes.ts` (Whittaker classification with 5 elevation bands + LAKE)
- `river`, `flow` → `terrain/rivers.ts`
- `isLake` → `terrain/depressionFill.ts` (small closed basins materialized as inland lakes; also flips `isWater = true`, `biome = 'LAKE'`)
- `regionId` → `history/history.ts::buildPhysicalWorld` (always present after generation)
- `kingdom` → `history/history.ts` (year-0 BFS baseline; renderer overlays live ownership at the selected year but must NEVER mutate this field)

Renderer-only types like `Season` (0–3, four seasons) are NOT stored on cells — they're applied at draw time via `getSeasonalBiome()` and `getPermafrostAlpha()`.

## Data Model — `MapData`

`MapData` is the single payload returned by the worker. Always present:

- `cells: Cell[]` — fully annotated by the terrain pipeline
- `regions: RegionData[]`, `continents: ContinentData[]` — built unconditionally by `buildPhysicalWorld`

Present only when `generateHistory = true`:

- `cities: City[]` — render-type cities (distinct from `CityEntity` simulation entities)
- `roads: Road[]` — A* paths between cities
- `history: HistoryData` — countries, years (events), ownership snapshots
- `historyStats: HistoryStats` — aggregate metrics (peak population, totals per event type, tech aggregates, etc.)

`HistoryData` carries:
- `countries: Country[]` — id, name, capitalCellIndex, isAlive
- `years: HistoryYear[]` — per-year events (15 types) + sparse `ownershipDeltas`
- `snapshots: Record<number, Int16Array>` — full cell→countryId every 20th year (fast scrubbing)
- `tradeSnapshots: Record<number, TradeRouteEntry[]>` — every 20 years; each entry has `cell1`, `cell2`, optional A* `path: number[]` for coastline-hugging maritime routes
- `empireSnapshots: Record<number, EmpireSnapshotEntry[]>` — every 20 years + final year; aligned with `snapshots` cadence (`Math.floor(year / 20) * 20`); each entry: `empireId`, display `name`, `founderCountryIndex`, sorted `memberCountryIndices`
- `techTimeline?: { byField: Record<TechField, Uint8Array> }` — per-field running-max tech level indexed by year offset (monotonic; see `world_history.md` for invariants)
- `religionDetails`, `cityReligions`, `worldSeed` — used by the character roster (`characters.md`)

## Data Model — `GenerateRequest`

Every user-controlled input flows through `GenerateRequest` (in `types.ts`). The worker resolves these in a fixed order: biome profile → shape overlay → user overrides.

| Parameter | Type | Description |
|-----------|------|-------------|
| `seed` | `string` | Deterministic seed string |
| `numCells` | `number` | Voronoi cell count (500–100,000) |
| `waterRatio` | `number` | Fraction of cells marked water (0–1, default 0.4) |
| `width` / `height` | `number` | Canvas dimensions |
| `generateHistory` | `boolean` | Run the timeline simulation (default false) |
| `numSimYears` | `number` | Years to simulate (50–5000, default 5000); only when history is on |
| `profileName` | `string?` | Named **biome** preset (e.g. `'desert'`, `'ice'`, `'default'`) |
| `shapeName` | `string?` | Named **landmass shape** preset (`'default'`, `'pangaea'`, `'continents'`, `'islands'`, `'archipelago'`) — applied as a `Partial<TerrainProfile>` overlay |
| `profileOverrides` | `Partial<TerrainProfile>?` | Fine-tuning overrides on top of the named presets |

`waterRatio` is implemented by ranking cells by elevation and marking the lowest `waterRatio * N` as water. Exact ratio regardless of terrain shape — see `world_map.md`.

## TerrainProfile Threading

`TerrainProfile` (in `types.ts`) is the single source of truth for ~40 tunable terrain constants. Every terrain function (`assignElevation`, `computeOceanCurrents`, `assignMoisture`, `assignTemperature`, `assignBiomes`, `hydraulicErosion`) takes the profile as its last parameter. The worker resolves it from `profileName + shapeName + profileOverrides` (three-way spread merge) and passes it down.

When adding a new tunable terrain constant: add it to `TerrainProfile`, set its default in `DEFAULT_PROFILE` (in `terrain/profiles.ts`), and read it from the profile parameter — do **NOT** add a new file-local const. See `world_map.md` for the full list of profiles + shapes.

## Generators & Visitors Pattern

The physical world model uses two complementary patterns:

- **Generator singletons** (one per entity class) encapsulate object creation and runtime-index insertion: `worldGenerator`, `continentGenerator`, `regionGenerator`, `resourceGenerator`, `cityGenerator`. Same idea in the timeline layer: `foundationGenerator`, `contactGenerator`, …, `empireGenerator`. Each Phase 5 file in `src/lib/history/timeline/` exports both an entity interface and a generator singleton.
- **Visitor singletons** provide iteration + predicate-based selection over the world's runtime index maps: `cityVisitor` (iterate all/usable cities, random selection with predicate via Fisher-Yates), `regionVisitor` (iterate all regions, `selectUpToN` / `selectOne` with predicate). Used heavily by Phase 5 generators.

The runtime indexes themselves live on `World` as typed `Map`s: `mapRegions`, `mapCities`, `mapUsableCities`, `mapCountries`, `mapDeadCountries`, `mapIllustrates`, `mapWonders`, `mapReligions`, `mapWars`, `mapAliveWars`, etc.

## Randomness

**All randomness goes through the seeded `mulberry32` PRNG in `terrain/noise.ts`.** Never use `Math.random()` directly anywhere in `src/lib/` or `src/workers/`. A single `Math.random` call breaks reproducibility for the whole run and silently desyncs the sweep harness.

The codebase uses **isolated PRNG sub-streams** liberally — they're how new behaviors get added without perturbing existing seeded outputs. Sub-streams are spawned via `seededPRNG(`${seed}_<purpose>_<entityId>`)` and consumed locally; their draws never leak back into the main `rng` parameter. Examples (non-exhaustive):

- `${seed}_racebias_<countryId>` (country race bias — `characters.md`)
- `${seed}_deity_<religionId>` (religion deity binding — `characters.md`)
- `${seed}_chars_<cellIndex>` (character roster roll — `characters.md`)
- `${seed}_city_<cityName>_voronoi` (V2 city polygon graph — `city_map.md`)
- `${seed}_city_<cityName>_walls` / `_river` / `_roads` / `_streets` / `_openspaces_*` / `_blocks_names` / `_landmarks_*` / `_buildings` / `_sprawl` (V2 city slices — `city_map.md`)

The discipline is: **a new feature that adds a behavioral roll must use its own sub-stream, OR be a no-op when its inputs are zero/default**. Otherwise the sweep baseline shifts.

## The Sweep Harness

`scripts/sweep-history.ts` is a single-file Node CLI run via `tsx` (dev dep) — `npm run sweep`. It runs the full pipeline (terrain + history) across 5 fixed seeds and writes `scripts/results/<label>.json`. Use `npm run sweep -- --label foo` to tag.

The sweep is **byte-deterministic** — re-running with the same args produces byte-identical JSON modulo timestamps. Any non-zero diff against `scripts/results/baseline-a.json` is a real behavior change. Diff after history-simulation tuning to catch regressions.

**Hard rules:**
- The harness must remain browser-free. Do NOT import from `src/components/`, `src/workers/`, or any DOM-dependent module — it must run in a bare Node shell.
- If the terrain or history pipeline grows a new step, mirror it in both `mapgen.worker.ts` and `sweep-history.ts` (same order, same arguments) or future sweeps will silently drift from in-browser behavior.
- The sweep currently uses `DEFAULT_PROFILE` directly with no biome/shape overlay — sweep baselines stay byte-identical. If the harness ever gains `--profile`/`--shape` flags, mirror the three-way merge from `mapgen.worker.ts` exactly.

City-map generation (`city_map.md`) and character rosters (`characters.md`) are render-only and never reached by the sweep harness. Any non-zero sweep diff after a citymap-only or characters-only change means an accidental simulation-layer edit.

## Verification

There is no test suite. Verify changes by:

1. `npm run build` — TypeScript type-check + Vite production build (catches type errors).
2. Visual inspection in `npm run dev` — hot-reload dev server.
3. `npm run sweep -- --label <experiment>` for any history-simulation change; diff against `scripts/results/baseline-a.json`.

For UI/frontend changes, exercise the feature in a browser — type-checking and sweep don't catch render-only regressions. If a UI feature can't be tested (e.g. mobile-only behavior in a desktop session), say so explicitly rather than claiming success.

## Pitfalls

- **Don't postMessage class instances.** `World`, `Region`, `Continent`, `CityEntity`, `Timeline`, `Year`, and Phase 5 entities all use `Map`/`Set` and won't structured-clone. Serialize to plain data inside the worker.
- **`buildPhysicalWorld` always runs.** `MapData.regions` and `MapData.continents` are populated for every generation, terrain-only or full-history. Do not gate region/resource rendering on `mapData.history`.
- **History is the source of cities and kingdoms when enabled.** Don't call `placeCities` or `drawKingdomBorders` from the worker when `generateHistory` is true — `HistoryGenerator` owns that responsibility (see `world_history.md`). Doing both double-places cities and corrupts state.
- **`HistoryStats` is forwarded, not recomputed.** New code that wants tech aggregates, total wars/trades/conquests, peak population, or tech-loss totals should read `mapData.historyStats` instead of re-walking `historyData.years` on the main thread.
- **Sub-stream isolation is the contract that keeps the sweep stable.** When adding a new randomness-driven feature, route it through `seededPRNG(`${seed}_<purpose>_<id>`)` and never let its draws fall back into the main `rng`. A non-zero sweep diff after a "decorative" change usually means a sub-stream draw leaked.
- **High-DPI canvas.** `MapCanvas.tsx` scales by `devicePixelRatio`. Don't set canvas width/height via CSS — use the component's resize logic.
- **Cell count performance.** Generation above ~10,000 cells is slow. Default 5,000. Test UI changes at low cell counts.
- **Base path.** Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source. Vite `base` config must stay `/procgen_map_fe/` to match the GitHub Pages deploy at `/procgen_map_fe/` (`.github/workflows/deploy.yml`).
- **Worker message schema.** Keep `WorkerMessage` in sync between `mapgen.worker.ts` and `App.tsx`'s `onmessage` handler. Drift causes silent data loss.
