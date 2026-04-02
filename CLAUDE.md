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
voronoi → elevation → moisture → biomes → rivers → buildPhysicalWorld
  └─ (if generateHistory=true) → history simulation → roads
```

The terrain steps (voronoi through rivers) always run. `buildPhysicalWorld` also always runs — it annotates cells with `regionId`, and produces `RegionData[]`/`ContinentData[]` in `MapData` regardless of the history flag. The history simulation is opt-in via `GenerateRequest.generateHistory`. If history is disabled, the pipeline ends after `buildPhysicalWorld` — no kingdom simulation, roads, or timeline data is generated.

Each step is a pure function in `src/lib/` that takes cells and returns updated cells or derived data.

### Key Files

`src/lib/` is split into three subdirectories by concern, plus a shared types file:

| File | Responsibility |
|------|---------------|
| `src/lib/types.ts` | All shared TypeScript types — start here |
| **`src/lib/terrain/`** | Physical map generation |
| `src/lib/terrain/noise.ts` | Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers |
| `src/lib/terrain/voronoi.ts` | Cell generation via D3-Delaunay + Lloyd relaxation |
| `src/lib/terrain/elevation.ts` | FBM elevation + island falloff + water ratio marking |
| `src/lib/terrain/moisture.ts` | FBM moisture assignment |
| `src/lib/terrain/biomes.ts` | Whittaker biome classification + `BIOME_INFO` palette |
| `src/lib/terrain/rivers.ts` | Drainage map + flow accumulation + river tracing |
| **`src/lib/history/`** | Civilizational simulation + physical world model |
| `src/lib/history/history.ts` | `buildPhysicalWorld()` (always runs) + year-by-year simulation (expansion, wars, merges, collapses) + `getOwnershipAtYear` |
| `src/lib/history/cities.ts` | City placement with spacing + kingdom grouping |
| `src/lib/history/borders.ts` | BFS flood-fill kingdom borders from capitals |
| `src/lib/history/roads.ts` | A* road pathfinding between cities |
| **`src/lib/history/physical/`** | Phase 2: Physical model data classes |
| `src/lib/history/physical/Resource.ts` | Resource entity: weighted type enum (17 types across strategic/agricultural/luxury), TRADE_MIN=10, TRADE_USE=5 |
| `src/lib/history/physical/CityEntity.ts` | City entity: full lifecycle (founded, contacted, size enum, population rolls, `canTradeMore()`); distinct from render-type `City` in `types.ts` |
| `src/lib/history/physical/Region.ts` | Region entity: `RegionBiome` enum with growth multipliers, cell grouping, neighbour graph, `BIOME_TO_REGION_BIOME` mapping |
| `src/lib/history/physical/Continent.ts` | Continent entity: groups regions, world back-reference |
| `src/lib/history/physical/World.ts` | World entity: continent list + runtime index Maps (`mapRegions`, `mapCities`, `mapUsableCities`, etc.) |
| **`src/lib/renderer/`** | Canvas drawing logic |
| `src/lib/renderer/noisyEdges.ts` | Recursive midpoint displacement for organic coastlines |
| `src/lib/renderer/renderer.ts` | Canvas 2D rendering — all layers, biome fill, borders, icons, legend |
| `src/components/MapCanvas.tsx` | Zoom/pan interaction and canvas lifecycle |
| `src/components/Controls.tsx` | Seed input, cell count, water ratio slider, layer toggles, history toggle + sim-years slider |
| `src/components/Timeline.tsx` | Playback controls (play/pause, step ±1/±10), year slider, and cumulative event log side panel (rendered only when `mapData.history` exists) |
| `src/workers/mapgen.worker.ts` | Orchestrates the full generation pipeline, posts progress events |

Each subdirectory has an `index.ts` that re-exports its public API.

### Data Model

The central type is `Cell` (defined in `types.ts`). Every terrain step annotates cells with new fields:

- `elevation`, `moisture` → set by `terrain/elevation.ts` / `terrain/moisture.ts`
- `biome` → set by `terrain/biomes.ts`
- `river`, `flow` → set by `terrain/rivers.ts`
- `regionId` → set by `history/history.ts` (`buildPhysicalWorld`), always present after generation
- `kingdom` → set by `history/history.ts` (year-0 BFS, updated by renderer at selected year)

`MapData` (returned from worker) carries:
- `cells` — always present; each cell has `regionId?` after generation
- `regions?`, `continents?` — always present (built even without history); serializable `RegionData[]`/`ContinentData[]` for rendering geographic structure
- `cities?`, `roads?` — only present when history was generated
- `history?` — `HistoryData` with `countries`, `years[]`, decade `snapshots`

`HistoryData` structure:
- `countries: Country[]` — each country has id, name, capitalCellIndex, color, isAlive
- `years: HistoryYear[]` — per-year events (Wars, Conquests, Merges, Collapses) + sparse `ownershipDeltas`
- `snapshots` — full `Int16Array` of cell→countryId at every 10th year (for fast scrubbing)

### Physical World Model

`buildPhysicalWorld(cells, width, rng)` in `history/history.ts` always runs before the optional history simulation:

1. **Continents**: BFS flood-fill finds connected land cells; groups ≥ 10 cells form a `Continent`
2. **Regions**: each continent is subdivided into ~30-cell clusters via multi-source BFS seeding; each gets a `RegionBiome` derived from its dominant Voronoi biome
3. **Resources**: 1–10 `Resource` entities per region, weighted-random type (17 types: strategic/agricultural/luxury)
4. **Cities**: 1–5 `CityEntity` objects per region, placed on highest-scoring terrain cells

The `World`/`Continent`/`Region`/`CityEntity`/`Resource` class instances live **only inside the worker** — they use `Map`/`Set` which are not structured-clone safe and cannot cross the `postMessage` boundary. The worker serializes them into plain `RegionData[]` and `ContinentData[]` arrays for `MapData`.

`CityEntity` (in `physical/CityEntity.ts`) is the rich simulation entity tracking full lifecycle state. It is distinct from the lightweight render-type `City` in `types.ts`, which is used by the renderer for icon/label drawing.

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
| `numSimYears` | `number` | Years to simulate (50–500, default 200); only used when `generateHistory` is true |

`waterRatio` is implemented by ranking all cells by elevation and marking the lowest `waterRatio * N` as water. This guarantees the exact ratio regardless of the terrain shape, unlike a fixed elevation threshold.

### Rendering

`renderer/renderer.ts` draws everything onto a single `<canvas>` element. Layer visibility is controlled by the `LayerVisibility` type. When modifying rendering:
- Biome colors are defined in `terrain/biomes.ts` (`BIOME_INFO`)
- Coastlines use noisy edges from `renderer/noisyEdges.ts` for an organic look
- City icons are drawn as simple SVG-path-like canvas commands
- `drawBiomeFill` renders land cells first, water cells second — this ensures water always wins at shared polygon edges (Voronoi cell indices have no spatial order, so rendering in index order causes land to bleed over water)
- The biome legend is drawn on the canvas and controlled by `layers.legend` (part of `LayerVisibility`); it is not a separate React component
- When `historyData` is present, kingdom borders/fills use `getOwnerAtYear(history, selectedYear, cellIndex)` instead of `cell.kingdom`; city/road/border layers are hidden entirely when no history data exists
- `getOwnerAtYear` finds the nearest decade snapshot ≤ target year, then replays `ownershipDeltas` forward to the exact year

### UI Panels

- **Controls panel** (`Controls.tsx`): has a collapse toggle (▴/▾) in the title row; when collapsed it shows only the title bar, hiding all generation parameters. Collapse state is local to the component (`useState`).
- **Legend**: toggled via the "Legend" checkbox in the Layers section of the Controls panel — this sets `layers.legend` which is checked in `renderer/renderer.ts` before calling `drawLegend`.
- **History settings**: "Generate History" checkbox + "Sim years" slider (50–500) appear in the Controls panel. When history is off, the roads/borders/icons/labels layer toggles are hidden (they have no effect without history data).
- **Timeline panel** (`Timeline.tsx`): rendered only when `mapData.history` exists. Two parts:
  - **Bottom controls**: year slider (0 to `numYears`), play/pause auto-advance (200ms per year), step buttons (±1, ±10 years). Timeline starts at year 0 after generation. Play restarts from 0 if already at the end. Dragging the slider or pressing step buttons pauses auto-play.
  - **Event log side panel** (right side): toggleable via "Show/Hide Log" button. Shows a cumulative list of all events from year 0 to the selected year, with year labels and event-type icons. Current-year events are highlighted. Auto-scrolls to the latest events as the year advances.
  - Year changes update `selectedYear` state in `App.tsx`, which triggers a re-render of the canvas.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages at `/procgen_map_fe/`. The Vite `base` config must stay as `/procgen_map_fe/` to match this path.

## Common Pitfalls

- **Worker communication**: `mapgen.worker.ts` uses `postMessage` with typed `WorkerMessage` objects. Keep the message schema in sync with `App.tsx`'s `onmessage` handler.
- **High-DPI canvas**: `MapCanvas.tsx` scales the canvas by `devicePixelRatio`. Don't set canvas width/height via CSS — use the component's resize logic.
- **Cell count performance**: Generation above ~10,000 cells is slow. Default is 5,000. Test UI changes at low cell counts.
- **Base path**: Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source.
- **Elevation normalization**: After computing FBM + island-falloff elevations, `terrain/elevation.ts` divides all values by the observed maximum so the highest cell always reaches 1.0. Without this, FBM noise in practice tops out around 0.8, and the island mask compresses it further — leaving the Whittaker mountain band (elevation > 0.8) unreachable. Do not remove this normalization step.
- **History is the cities/kingdoms source**: Do not call `placeCities` or `drawKingdomBorders` from the worker when `generateHistory` is true — `history/history.ts` owns that responsibility. Calling both would double-place cities and corrupt kingdom state.
- **Ownership reconstruction**: `getOwnerAtYear` must apply deltas in strict year order. Out-of-order application produces incorrect borders. The snapshots are keyed by decade (0, 10, 20…); always start from `Math.floor(year / 10) * 10`.
- **`cell.kingdom` vs history**: `cell.kingdom` is written once by `history/history.ts` as the year-0 state. The renderer overwrites the visual ownership at the selected year but must never mutate `cell.kingdom` — it is the baseline and is needed to reconstruct history from scratch.
- **`buildPhysicalWorld` always runs**: Unlike the history simulation, `buildPhysicalWorld` is called for every generation (terrain-only or history). `MapData.regions` and `MapData.continents` are always populated. Do not gate region/resource rendering on `mapData.history`.
- **Don't postMessage class instances**: `World`, `Region`, `Continent` use `Map` and `Set` which are not structured-clone safe. Only the plain `RegionData[]`/`ContinentData[]` arrays cross the worker boundary. Keep the class instances inside the worker.
