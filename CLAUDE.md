# CLAUDE.md

This file provides context and guidelines for AI assistants working on this codebase.

## Project Overview

Procedural fantasy map generator built with React, TypeScript, and Vite. Generates Voronoi-based terrain maps with biomes and rivers (always), and optionally a full civilizational history (countries, wars, conquests, city placement, kingdom borders, roads) — all deterministic from a seed string.

**Key design principle**: Cities and kingdoms are outputs of the history simulation, not independent pipeline steps. When history is disabled, the map shows terrain only.

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
voronoi → elevation → moisture → biomes → rivers
  └─ (if generateHistory=true) → history → roads
```

The terrain steps (voronoi through rivers) always run. The history step is opt-in via `GenerateRequest.generateHistory`. If history is disabled, the pipeline ends after rivers — no cities, roads, or kingdom borders are generated.

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
| **`src/lib/history/`** | Civilizational simulation |
| `src/lib/history/cities.ts` | City placement with spacing + kingdom grouping |
| `src/lib/history/borders.ts` | BFS flood-fill kingdom borders from capitals |
| `src/lib/history/roads.ts` | A* road pathfinding between cities |
| `src/lib/history/history.ts` | Year-by-year simulation (expansion, wars, merges, collapses) + `getOwnershipAtYear` |
| **`src/lib/renderer/`** | Canvas drawing logic |
| `src/lib/renderer/noisyEdges.ts` | Recursive midpoint displacement for organic coastlines |
| `src/lib/renderer/renderer.ts` | Canvas 2D rendering — all layers, biome fill, borders, icons, legend |
| `src/components/MapCanvas.tsx` | Zoom/pan interaction and canvas lifecycle |
| `src/components/Controls.tsx` | Seed input, cell count, water ratio slider, layer toggles, history toggle + sim-years slider |
| `src/components/Timeline.tsx` | Year scrubber + event log panel (rendered only when `mapData.history` exists) |
| `src/workers/mapgen.worker.ts` | Orchestrates the full generation pipeline, posts progress events |

Each subdirectory has an `index.ts` that re-exports its public API.

### Data Model

The central type is `Cell` (defined in `types.ts`). Every terrain step annotates cells with new fields:

- `elevation`, `moisture` → set by `terrain/elevation.ts` / `terrain/moisture.ts`
- `biome` → set by `terrain/biomes.ts`
- `river`, `flow` → set by `terrain/rivers.ts`
- `kingdom` → set by `history/history.ts` (year-0 BFS, updated by renderer at selected year)

`MapData` (returned from worker) carries:
- `cells` — always present
- `cities?`, `roads?` — only present when history was generated
- `history?` — `HistoryData` with `countries`, `years[]`, decade `snapshots`

`HistoryData` structure:
- `countries: Country[]` — each country has id, name, capitalCellIndex, color, isAlive
- `years: HistoryYear[]` — per-year events (Wars, Conquests, Merges, Collapses) + sparse `ownershipDeltas`
- `snapshots` — full `Int16Array` of cell→countryId at every 10th year (for fast scrubbing)

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
- **Timeline panel** (`Timeline.tsx`): rendered below the map canvas in `App.tsx`, only when `mapData.history` exists. Contains a year slider (0 to `numYears`) and a scrollable event log for the selected year. Year changes update `selectedYear` state in `App.tsx`, which triggers a re-render of the canvas.

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
