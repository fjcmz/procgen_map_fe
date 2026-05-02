# CLAUDE.md

This file provides context and guidelines for AI assistants working on this codebase. It is intentionally a thin overview — the deep documentation for each simulation layer lives in `claude_specs/`.

## Project Overview

Procedural fantasy map generator built with React, TypeScript, and Vite. Generates Voronoi-based terrain maps with biomes and rivers (always), partitions the terrain into geographic continents and regions (always), and optionally runs a full civilizational history (countries, wars, conquests, city placement, kingdom borders, roads) — all deterministic from a seed string. On top of the world map, lazy zoom-in features generate detailed city maps and PC/NPC rosters for cities the user opens in the Details tab.

**Key design principles**:
- The physical world (continents, regions, resources) is always built from terrain — it runs even without history.
- Cities and kingdoms are outputs of the history simulation, not independent pipeline steps. When history is disabled, the map shows terrain and geographic structure only.
- City maps and character rosters are render-only zoom-in features — they never affect the simulation and are never reached by the sweep harness.

## Commands

```bash
npm run dev       # Start Vite dev server (hot reload)
npm run build     # TypeScript type-check + Vite production build
npm run preview   # Serve the production build locally
npm run sweep     # Phase 4 seed sweep — runs full history across 5 fixed seeds in Node
                  # via tsx, writes scripts/results/<label>.json. Use `-- --label foo` to tag.
```

There is no test suite. Verify correctness by running `npm run build` (catches type errors) and visually inspecting the map in the browser. For history-simulation changes that might shift balance, run `npm run sweep -- --label <experiment>` and diff the resulting JSON against `scripts/results/baseline-a.json` to catch regressions. The sweep is deterministic — re-running with the same args produces byte-identical output modulo timestamps.

## Documentation Map

The simulation is split into five layers, each documented in its own `claude_specs/` file:

| Spec | Scope |
|------|-------|
| **[`claude_specs/universe_map.md`](claude_specs/universe_map.md)** | Simulation framework — entity model, worker boundary, RNG sub-streams, shared data types (`Cell`, `MapData`, `HistoryData`, `GenerateRequest`, `TerrainProfile`), Generators/Visitors patterns, sweep harness invariants. **Read this first.** |
| **[`claude_specs/world_map.md`](claude_specs/world_map.md)** | Physical terrain pipeline (Voronoi → biomes → rivers → erosion), terrain profiles (7 biome presets) + landmass shapes (4 partial overlays), canvas renderer, world-map UI panels (MapCanvas, Minimap, Legend, Generation tab) |
| **[`claude_specs/world_history.md`](claude_specs/world_history.md)** | Phase 6 HistoryGenerator orchestration, `buildPhysicalWorld`, Timeline + 12 Phase 5 generators, tech / religion / cataclysm / war / conquer / empire mechanics, HistoryStats + sweep harness, render-time concerns (overlay tabs, Timeline panel, ownership reconstruction) |
| **[`claude_specs/city_map.md`](claude_specs/city_map.md)** | City-map popups: V1 (tile, frozen) + V2 (Voronoi-polygon, in-progress through PR 5). Polygon graph, walls, river, roads, streets, bridges, open spaces, blocks, landmarks, buildings, sprawl |
| **[`claude_specs/characters.md`](claude_specs/characters.md)** | PC/NPC roster generation — `lib/fantasy/` D&D 3.5e engine, `lib/citychars.ts` lazy roller, `Country.raceBias` + `Religion.deity/alignment` simulation metadata, `World.seed` threading |

When working on a change, identify which layer it touches and read the relevant spec. Most changes also need to respect framework conventions in `universe_map.md`.

## Pipeline at a Glance

All heavy computation runs in `src/workers/mapgen.worker.ts` (a Web Worker). The pipeline is strictly sequential:

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

Terrain steps are documented in `world_map.md`. The history pipeline is documented in `world_history.md`. The framework that wires them together (worker boundary, RNG, profile threading) is documented in `universe_map.md`.

Lazy zoom-in features:
- **City maps** (`city_map.md`) generate when the user clicks Map / MapV2 in the Details tab — never during the worker pipeline.
- **Character rosters** (`characters.md`) generate when the user opens a city in the Details tab — never during the worker pipeline.

## File Organization (Top Level)

| Path | Layer | Spec |
|------|-------|------|
| `src/lib/types.ts` | Shared TypeScript types | `universe_map.md` |
| `src/lib/terrain/` | Physical terrain pipeline | `world_map.md` |
| `src/lib/history/` | Civilizational simulation + physical world model | `world_history.md` |
| `src/lib/renderer/` | Canvas 2D rendering for the world map | `world_map.md` |
| `src/lib/citymap/` | City map V1 + V2 generators / renderers | `city_map.md` |
| `src/lib/fantasy/` | D&D 3.5e race / deity / alignment engine | `characters.md` |
| `src/lib/citychars.ts` | UI-only roster roller | `characters.md` |
| `src/workers/mapgen.worker.ts` | Pipeline orchestrator | `universe_map.md` (+ `world_map.md`, `world_history.md`) |
| `src/components/` | React UI | `world_map.md` (terrain panels), `world_history.md` (history panels) |

Each `src/lib/` subdirectory has an `index.ts` barrel that re-exports its public API.

## Cross-Cutting Conventions

These apply across every layer. See `universe_map.md` for the long form.

- **Worker boundary**: class instances (`World`, `Region`, `Continent`, `CityEntity`, `Timeline`, `Year`, Phase 5 entities) use `Map`/`Set` and stay inside the worker. Only plain data, typed arrays, or trees of those cross `postMessage`.
- **Randomness**: all randomness goes through the seeded `mulberry32` PRNG in `terrain/noise.ts`. **Never use `Math.random()` directly** — anywhere. New behaviors that need randomness should use isolated sub-streams (`seededPRNG(`${seed}_<purpose>_<id>`)`) so they don't perturb the sweep baseline.
- **Sweep stability**: `npm run sweep` is byte-deterministic. Any non-zero diff against `scripts/results/baseline-a.json` after a "decorative" or render-only change usually means a sub-stream draw leaked into the main `rng`. Fix the leak rather than rebaseline.
- **`buildPhysicalWorld` always runs**: `MapData.regions` and `MapData.continents` are populated for every generation, even terrain-only.
- **HistoryGenerator owns cities + kingdoms when history is on**: don't call `placeCities` / `drawKingdomBorders` from the worker when `generateHistory = true`.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages at `/procgen_map_fe/`. The Vite `base` config must stay as `/procgen_map_fe/` to match this path.

## Common Pitfalls (Cross-Cutting)

These cut across multiple specs. Layer-specific pitfalls live in each spec's "Pitfalls" section.

- **Worker communication**: `mapgen.worker.ts` uses `postMessage` with typed `WorkerMessage` objects. Keep the message schema in sync with `App.tsx`'s `onmessage` handler.
- **High-DPI canvas**: `MapCanvas.tsx` scales the canvas by `devicePixelRatio`. Don't set canvas width/height via CSS — use the component's resize logic.
- **Cell count performance**: Generation above ~10,000 cells is slow. Default is 5,000. Test UI changes at low cell counts.
- **Base path**: Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source.
- **Sweep harness scope**: `scripts/sweep-history.ts` is browser-free — do NOT import from `src/components/`, `src/workers/`, or any DOM-dependent module. If the terrain or history pipeline grows a new step, mirror it in both `mapgen.worker.ts` and `sweep-history.ts` (same order, same arguments) or future sweeps will silently drift from in-browser behavior.
- **City-map and character changes must not touch simulation files**. Both layers are render-only. Any non-zero sweep diff after a citymap-only or characters-only change means an accidental simulation-layer edit.

## When You Add a New Feature

1. Identify the layer (universe / world map / world history / city map / characters) — which spec applies?
2. Read the spec's "Pitfalls" section before designing.
3. If the feature needs randomness, route it through a new isolated sub-stream so the sweep stays byte-identical.
4. If the feature touches the worker pipeline, mirror the change in `scripts/sweep-history.ts` (same order, same arguments).
5. Run `npm run build` to type-check.
6. For history-simulation tuning, run `npm run sweep -- --label <experiment>` and diff against `scripts/results/baseline-a.json`.
7. For UI changes, exercise the feature in `npm run dev` — type-checking and sweep don't catch render-only regressions.
8. Update the relevant spec file (and add a new pitfall if the change introduces a non-obvious invariant).
