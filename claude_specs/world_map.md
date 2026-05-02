# World Map (Physical Terrain + Rendering)

This file documents the **physical world generation** — the pure, deterministic terrain pipeline that runs for every map (with or without history) — and the **canvas renderer** that draws it. Read `universe_map.md` first for the framework conventions (worker boundary, RNG sub-streams, `TerrainProfile` threading, the `Cell` data model).

## Terrain Pipeline

All terrain steps run inside `src/workers/mapgen.worker.ts` in a strict sequence:

```
voronoi → elevation → oceanCurrents → moisture → temperature → biomes
  → fillDepressions → rivers (initial) → hydraulicErosion → fillDepressions
  → rivers (final) → temperature (refresh) → biomes (refresh)
  → buildPhysicalWorld
```

Each step is a pure function in `src/lib/terrain/` that takes cells and returns updated cells or derived data. The pipeline is the same for sweep harness runs and worker runs (see `universe_map.md`).

### Step-by-step

1. **`voronoi.ts`** — Cell generation via D3-Delaunay + Lloyd relaxation. Produces the `Cell[]` graph every later step annotates.
2. **`elevation.ts`** — Tectonic plate simulation: 3–5 large continental plates clustered via nearest-neighbor seeding, 8–12 oceanic plates spread via farthest-point sampling, size-biased round-robin BFS (continental plates ~3× more cells), continental seam elevation boost merging adjacent continental plates, convergent/divergent boundary effects, FBM elevation, polar ice caps with smoothstep blend over `[0.72, 0.94]` (reduced hemisphere asymmetry), thermal erosion, water ratio marking. **After** computing FBM + island falloff, divides all elevations by the observed maximum so the highest cell hits 1.0 — without this normalization the Whittaker mountain band (>0.75) is unreachable. Do not remove.
3. **`oceanCurrents.ts`** — BFS flood-fill identifies connected ocean basins (skips basins <50 cells), cylindrical wrap-aware bbox, analytical SST anomaly model (warm poleward currents on western basin margins, cold equatorward on eastern, scaled by latitude envelope). Returns `OceanCurrentData { sstAnomaly: Float32Array }`.
4. **`moisture.ts`** — Three-layer moisture: base FBM + smooth Hadley cell cosine curve (damped amplitude, 3 cells per hemisphere) + coastal boost (modulated by ocean currents — cold currents reduce coastal moisture via `COASTAL_MOISTURE_SENSITIVITY`); then continentality gradient (BFS distance-from-ocean) → rain shadow (upwind mountain barrier march) → `globalMoistureOffset` additive shift (applied last, guarded by `!== 0` for default-profile no-op). Returns `distFromOcean: Float32Array` for temperature. Exports `getWindDirection()`.
5. **`temperature.ts`** — Per-cell `temperature` (0–1) = latitude + continentality modifier (interiors more extreme, coasts milder) + windward ocean proximity (upwind march for west-coast effect, also returns SST anomaly of the first ocean cell found) + ocean current land influence (`CURRENT_LAND_INFLUENCE` attenuates SST anomaly for coastal land) + elevation lapse rate + FBM noise + `globalTempOffset` additive shift (inside the final clamp). Water cells incorporate SST anomaly directly. Drives polar biome thresholds and nudges the Whittaker moisture lookup at margins.
6. **`biomes.ts`** — Whittaker biome classification with **5 elevation bands**: lowland (<0.3), midland (0.3–0.6), highland (0.6–0.65), alpine (0.65–0.75 → `ALPINE_MEADOW`), mountain (≥0.75 → SCORCHED/BARE/TUNDRA/SNOW). 20 biome types including LAKE in `BIOME_INFO`. Polar thresholds (ICE/SNOW/TUNDRA) use `cell.temperature` + `fbmCylindrical` noise dither for organic edges. Continental interiors extend polar biomes equatorward, maritime coasts push them poleward. Hot continental cells lose effective moisture; cool maritime cells gain it. Exports `getVegetationDensity(cell)` (0–1 based on moisture position within band, with spatial-hash dither), `modulateBiomeColor(hex, density)` (±12% per-cell variation), `getSeasonalBiome(cell, season)` (render-time polar boundary shifts), `getPermafrostAlpha(cell, season)` (sub-polar overlay alpha). The `isLake` short-circuit in `assignBiomes` runs **after** the polar ICE block so cold inland lakes can still freeze.
7. **`depressionFill.ts`** — Priority-Flood + ε pass (Barnes-Lehman-Bigelow 2014) producing a parallel `drainageElevation: Float32Array` so every reachable land cell has a strictly-lower neighbour toward the ocean. Materializes closed basins of size in `[profile.lakeMinSize, profile.lakeMaxSize]` as LAKE cells (`isWater = true`, `isLake = true`, `biome = 'LAKE'`); smaller components are filtered as FBM-noise micropits, larger ones stay as land relying on the virtual drainage surface. File-local binary min-heap tie-broken by `(elevation, cellIndex)` for determinism. Disconnected-island fallback re-seeds from the lowest unvisited cell of any component with no water neighbour. Does NOT modify `cell.elevation` — biomes/hillshading/erosion still see the true surface. Called **twice**: once after `assignBiomes`, once after `hydraulicErosion`.
8. **`rivers.ts`** — Drainage map + flow accumulation + river tracing. Each `River` stores `path: number[]` and `maxFlow: number` (peak `cell.riverFlow` along the path, raw and unclamped). `buildDrainageMap` and `generateRivers` both accept an optional `drainageElev?: Float32Array` from `fillDepressions`; when provided, drainage direction is chosen on the filled surface so closed basins never dead-end a river chain.
9. **`hydraulicErosion.ts`** — Stream power model (`erosion ∝ flow^0.5 × slope`), sediment deposition for floodplains, valley widening for hillshading visibility. Re-normalizes elevation, re-marks coast cells. **Deliberately does NOT consume `drainageElevation`** — its per-iteration `buildDrainageMap` uses raw `cell.elevation` because the deposition step (`cells[downstream].elevation += deposit`) breaks monotonicity, which would invalidate a cached drainage surface across iterations. Lakeshore land cells get `isCoast = true` from the post-erosion coast re-mark — `scoreCellForCity` in `history.ts` treats lakeshores as ocean coast (+3 score) for city placement. Intentional in v1 (lakeshore cities are realistic and visually rich).
10. **`fillDepressions` (second pass)** — runs again on the eroded terrain because erosion's deposition can create new sinks that the first pass never saw.
11. **Rivers (final)** — re-traced on the carved terrain for precise valley-following paths.
12. **Temperature & biomes (refresh)** — re-run after erosion because they depend on elevation (lapse rate, elevation bands). Moisture and ocean currents are NOT re-run (they depend on coarse geography, not fine elevation detail). The `isLake` short-circuit in `assignBiomes` protects LAKE cells from the refresh, but stays AFTER the polar ICE block so cold inland lakes can freeze.
13. **`buildPhysicalWorld`** — annotates cells with `regionId` and produces `RegionData[]` / `ContinentData[]` for `MapData`. Always runs, even when history is disabled. See `world_history.md` for what it does internally.

## Terrain Profiles

`src/lib/terrain/profiles.ts` is the single source of truth for ~40 tunable terrain constants. Per-file const declarations were deleted and replaced with profile field reads — every terrain function takes `profile: TerrainProfile` as its last parameter.

`DEFAULT_PROFILE: TerrainProfile` holds the baseline (Earth-like). `PROFILES: Record<string, TerrainProfile>` exports 7 named presets:

| Profile | Theme |
|---------|-------|
| `default` | Earth-like baseline |
| `desert` | Arid, ~70% desert |
| `ice` | Snowball, ~80% frozen |
| `forest` | Greenhouse, ~75% forest |
| `swamp` | Flat/wet |
| `mountains` | Tectonic, ~40% highland |
| `ocean` | Archipelago, ~85% water |

Each non-default profile spreads `DEFAULT_PROFILE` and overrides only theme-relevant fields. `PROFILE_WATER_RATIOS` maps each profile to its recommended `waterRatio` for the UI.

Profile-controlled fields you'll most often touch:
- `lakeMinSize` (default 4), `lakeMaxSize` (default 20), `depressionFillEpsilon` (default 1e-5) — consumed by `depressionFill.ts`. The lake sizing window is overridden per profile: `forest = [2, 80]` for dense woodland lakes, `swamp = [2, 150]` for large wetland bodies; all others inherit `[4, 20]`.
- `globalMoistureOffset` / `globalTempOffset` — additive shifts applied as the final step of `assignMoisture` / `assignTemperature`. Default 0.0 = no-op (preserves byte-identical output for the `default` profile).

The biome threshold consts (`ICE_TEMP_THRESHOLD`, `SNOW_TEMP_THRESHOLD`, `TUNDRA_TEMP_THRESHOLD`) are kept as **file-local consts** in `biomes.ts` because `getSeasonalBiome()` (a render-time function) also uses them and the profile only exists in the worker. `assignBiomes` reads from the profile instead.

## Landmass Shapes

`SHAPE_PROFILES: Record<string, Partial<TerrainProfile>>` is a parallel preset dimension orthogonal to biome profiles — 5 entries: `default` (empty no-op), `pangaea`, `continents`, `islands`, `archipelago`.

Shapes target only tectonic/shape knobs: `numContinentalMin/Max`, `numOceanicMin/Max`, `continentalGrowthMin/Max`, `seamBoostMin/Max`, `seamSpreadRings`, `elevationPower`. **They MUST stay `Partial<TerrainProfile>`** — full profiles would silently override every biome knob and collapse the two dimensions back into one.

The worker stacks them between biome and user overrides:

```
biomeProfile  →  shapeOverlay  →  user profileOverrides
```

The `default` shape is deliberately `{}` so biome profiles with baked-in shape hints (e.g. `ocean`'s 0 continental plates) keep producing byte-identical output when the user hasn't picked a shape.

## Renderer

`src/lib/renderer/renderer.ts` draws everything onto a single `<canvas>`. Layer visibility is controlled by `LayerVisibility` in `types.ts`.

### Render Order (world map)

1. Biome fill (land first, water second — water always wins shared edges; per-cell vegetation density modulation via `getVegetationDensity` + `modulateBiomeColor`)
2. Hillshading (NW light, 315° azimuth, 45° altitude; rgba overlay; toggleable via `layers.hillshading`)
3. Permafrost overlay (sub-polar land, temp 0.10–0.30, blue-gray; `layers.seasonalIce`)
4. Water depth (with ocean current tinting — warm currents → less blue/more green, cold currents → deeper blue; subtle visual)
5. Rivers (zoom-aware, see below)
6. Coastlines (noisy edges via `renderer/noisyEdges.ts` for organic look)
7. Patterned country/empire fills in political view (see below)
8. Cities + roads (when history present)
9. Highlight overlay (gold, topmost layer; for clickable entity navigation)
10. Labels

### Political View

`mapView: 'terrain' | 'political'` state in `App.tsx`. Political view applies a parchment overlay (`rgba(245, 233, 200, 0.55)`) on land and uses `drawPatternedBorders()` with a `PatternCache`:

- `politicalMode: 'countries'` — diagonal stripe pattern per country (two deterministic colors)
- `politicalMode: 'empires'` — plaid/tartan pattern per empire member; independent countries retain their diagonal stripes

Colors are generated via golden-ratio hue spacing from entity indices in `renderer/patterns.ts`. Terrain view retains the original solid kingdom fills (0.12 alpha via `KINGDOM_COLORS_TERRAIN`).

A `PatternCache` instance is created **fresh per render call** (before the 3× horizontal offset loop) and discarded afterward — `CanvasPattern` objects are tied to the rendering context. Methods `getStripe` / `getPlaid` lazily create pattern tiles on first access and reuse them within the same frame.

### Zoom-Aware Rivers

`drawRivers()` divides `ctx.lineWidth` by the `scale` threaded down from `MapCanvas` because the canvas ctx is already transformed by `transform.scale` before `render()` is called — setting `lineWidth = N` without the divide produces `N * scale` screen pixels. Culling: `visibilityCutoff = RIVER_VISIBILITY_BASE / scale²` against `river.maxFlow`.

Tuning constants live as file-local consts immediately above `drawRivers()`:
- `RIVER_VISIBILITY_BASE = 60` — raise for fewer rivers at a given zoom
- `RIVER_MIN_SCREEN_PX = 0.6`, `RIVER_MAX_SCREEN_PX = 2.4`, `RIVER_WIDTH_COEFF = 0.22` — for overall thickness

The generation-time `profile.riverFlowThreshold` remains the absolute floor. `Minimap` calls `render()` with no `scale` argument, defaulting to `scale = 1` — intentionally leaves the minimap with only trunk rivers visible.

### Other Renderer Notes

- **Mountain icons** are rendered on all land cells with elevation ≥ 0.75 regardless of biome `iconType`, at ~40% density with elevation-scaled sizing.
- **Tree icons** vary in density (10–30%), size (0.85–1.15×), and color (lighter green at dry edges, darker at wet edges) based on `getVegetationDensity`.
- The biome legend is a React overlay component (`Legend.tsx`), not drawn on canvas; controlled by `layers.legend`.
- City icons are simple SVG-path-like canvas commands.

## UI Panels

The world map UI lives in `src/components/`. The `claude_specs/world_history.md` covers history-driven panels (Timeline, Realm tab, Tech tab) — this section covers the rest.

| Component | Purpose |
|-----------|---------|
| `MapCanvas.tsx` | Zoom/pan interaction + canvas lifecycle. Exposes `navigateTo(mapX, mapY)` via `useImperativeHandle` for programmatic centering. Accepts optional `highlightCells` prop and `onInteraction` callback (fires on left-click mousedown to clear highlights). |
| `Minimap.tsx` | Draggable minimap overlay: offscreen canvas cache, viewport indicator rectangle, click-to-navigate. Visibility via `layers.minimap`. Defaults to bottom-left. |
| `Legend.tsx` | Draggable biome legend (replaces the old canvas-drawn legend). Visibility via `layers.legend`. Defaults to bottom-left. |
| `Draggable.tsx` | Reusable drag-to-reposition wrapper using Pointer Events. Drag handles identified by `data-drag-handle`. Viewport clamping keeps panels visible (≥40 px). `touch-action: none` on handles for mobile. `baseTransform` prop for combining CSS transforms. **Phase 5 additions**: `storageKey` persists drag offset to `localStorage` (JSON `{x, y}`, finite-checked, try/catch wrapped); `responsiveDock: { breakpoint, dockStyle? }` uses `window.matchMedia` to suppress dragging and dock full-width at the top below a configurable breakpoint. |
| `UnifiedOverlay.tsx` + `overlay/GenerationTab.tsx` | Generation-tab body: seed input, cell count, water ratio slider, terrain profile dropdown (7 presets — selecting a profile snaps water ratio to `PROFILE_WATER_RATIOS[name]` and shows an accent-colored badge chip; does not auto-generate), terrain/political view toggle (with conditional Countries/Empires sub-toggle), season selector (4 buttons — render-time-only, shifts polar boundaries + permafrost intensity without re-running generation), layer toggles, history toggle + sim-years slider, generate button + progress bar. The other tabs are documented in `world_history.md`. |

The UI exposes `Season` (0–3): 0 = Spring (baseline), 1 = Summer (ice retreats), 2 = Autumn (slight expansion), 3 = Winter (max expansion). Render-time-only — not stored on cells.

## Pitfalls

- **Elevation normalization is mandatory.** After FBM + island falloff, divide by the observed maximum so the highest cell reaches 1.0. Without this, the Whittaker mountain band (>0.75) is unreachable.
- **Don't postMessage the whole `Cell[]` graph after worker tweaks** — only the worker's serialized `MapData` should cross. Class instances inside `World`/`Region`/etc. won't structured-clone (see `universe_map.md`).
- **Hydraulic erosion refreshes temperature/biomes but NOT moisture/currents.** Don't add a moisture refresh — it depends on coarse geography. Do refresh biomes/temperature; they depend on per-cell elevation.
- **`accumulateFlow` topological order must follow `drainageElev`, not raw elevation.** When `fillDepressions` has run, drainage points *uphill in raw elevation* through filled basins. Sorting by raw `cell.elevation` descending processes the pour point before pit cells, stranding their flow contribution. Visible symptom: downstream rivers thin or disappear just past a filtered (too-small-to-be-a-lake) depression. Sort `order` by `drainageElev[idx]` descending when provided. Latent before `lakeMinSize` started leaving small basins as land.
- **Rivers must go through `fillDepressions` or they'll dead-end mid-land.** Worker MUST run `fillDepressions(cells, profile)` before any `generateRivers` call and thread `drainageElevation` into `generateRivers(cells, profile, drainageElev)`. Without PF+ε, closed basins have `drainage === null` and accumulated flow never propagates downstream.
- **`fillDepressions` is called twice on purpose**: once after `assignBiomes` to guide initial rivers (which drive erosion), once after `hydraulicErosion` because deposition can create new sinks the first pass never saw.
- **Don't pass cached `drainageElev` into `hydraulicErosion`.** Its per-iteration `buildDrainageMap` must use raw `cell.elevation` because deposition breaks monotonicity; a stale drainage surface would point erosion at the wrong cells.
- **`isLake` short-circuit in `assignBiomes` MUST stay AFTER the polar ICE block.** Moving it earlier prevents cold inland lakes from freezing (think Lake Baikal in winter).
- **`SHAPE_PROFILES` entries must be `Partial<TerrainProfile>`, never a full profile.** Shapes stack as a middle layer; fields they don't set must fall through to the biome layer. Never add moisture/temperature/biome-threshold fields to a shape.
- **The biome threshold consts in `biomes.ts` are intentionally file-local, not in the profile.** `getSeasonalBiome()` is a render-time function and the profile only exists in the worker. `assignBiomes` reads from the profile; render code reads from the file-local consts.
- **`drawBiomeFill` order matters**: land cells first, water cells second. Voronoi cell indices have no spatial order, so rendering in index order causes land to bleed over water at shared edges.
- **`PatternCache` is per-render, not cached across frames.** `CanvasPattern` objects are tied to the rendering context.
- **River rendering is zoom-aware.** Don't set `lineWidth` without dividing by `scale`. Generation-time `profile.riverFlowThreshold` is the absolute floor — no zooming reveals rivers that never passed threshold during generation.
- **`cell.kingdom` is the year-0 baseline.** The renderer overlays live ownership at the selected year but must NEVER mutate `cell.kingdom` — it's needed to reconstruct history from scratch.
