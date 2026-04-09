# Procedural Fantasy Map Generator

A browser-based procedural fantasy map generator that creates detailed, interactive maps with terrain, rivers, roads, cities, kingdoms, and multi-century civilizational history — all from a single seed value.

## Demo

Deployed at: [https://fjcmz.github.io/procgen_map_fe/](https://fjcmz.github.io/procgen_map_fe/)

## Features

- **Seed-based generation** — reproducible maps from any seed string
- **Configurable detail** — cell count from 500 to 100,000 for fast previews or high-detail renders
- **Water ratio** — slider to control the percentage of water vs land (0–100%)
- **Tectonic plates** — 11–17 tectonic plates with controlled continental/oceanic split (3–5 large continental plates, 8–12 oceanic); continental plates grow larger via weighted expansion and cluster together to form realistic continent-sized landmasses; convergent boundaries create mountain ranges and volcanic arcs, divergent boundaries form rift valleys and mid-ocean ridges
- **Polar ice caps** — automatic polar landmass generation at high latitudes using dedicated FBM noise; smoothstep elevation blending and noise-dithered biome thresholds produce organic, jagged ice edges instead of hard horizontal lines
- **Rich terrain** — 19 biome types classified via a Whittaker diagram (elevation × moisture), including a transitional alpine meadow band; per-cell vegetation density variation modulates biome fill colors and tree icon density/size based on each cell's position within its moisture band, creating organic gradients within biome regions
- **Realistic moisture** — three-layer moisture model: latitude-based Hadley cell circulation (damped cosine curve producing equatorial wet zones and subtropical desert belts) + continentality gradient (BFS distance-from-ocean decay for dry interiors) + rain shadow behind mountain ranges (prevailing wind simulation); produces Earth-like desert bands, rainforest concentration, and continental aridity
- **Ocean currents** — simplified ocean gyre simulation: BFS flood-fill detects ocean basins, then an analytical model produces warm poleward currents along western margins (Gulf Stream, Kuroshio) and cold equatorward currents along eastern margins (California, Benguela, Humboldt); the resulting sea surface temperature anomalies feed into coastal moisture (cold currents suppress evaporation for Atacama/Namibia-like aridity) and land temperature (warm currents create milder coasts, cold currents create cooler ones); water rendering is subtly tinted by current temperature
- **Continental climate effects** — per-cell temperature computed from latitude, continentality (continental interiors more extreme, maritime cells milder), windward ocean proximity (west-coast mildness via upwind neighbor march), ocean current influence (warm/cold currents modify nearby coastal temperatures), and elevation lapse rate; drives polar biome boundaries and nudges the Whittaker biome lookup so western coasts stay milder and continental interiors shift toward more extreme biomes
- **Seasonal ice / permafrost** — render-time seasonal variation for polar regions: a four-season selector (Spring/Summer/Autumn/Winter) shifts polar ice, snow, and tundra boundaries — ice caps expand in winter and retreat in summer — while a permafrost overlay tints sub-polar land with a blue-gray wash whose intensity varies by season and depth into the cold band; toggleable via the "Seasons" layer control
- **Hillshading** — shaded relief lighting on land terrain using neighbor-based gradient estimation with a NW light source; toggleable via the "Relief" layer control
- **Hydrology** — rivers generated from drainage accumulation with flow-scaled widths; hydraulic erosion carves visible river valleys, gorges, and floodplains into the terrain using a stream power model (erosion proportional to flow and slope), with valley widening for hillshading visibility
- **History simulation** — optional multi-century timeline: cities are founded and make first contact, countries form when all regional cities are established, illustrious figures drive technology and religion, trade routes connect cities via pathfound coastal-hugging and island-hopping maritime routes, cataclysms strike, wars break out between neighbouring countries leading to conquests and empires — all simulated year by year. Tech discovery scales with civilization state: per-year throughput is log-scaled by world population (0–5 advances per year), each country with living scholars rolls independently for one tech, and field choice is biased toward unknown fields and the country's spirit (military/religious/industrious/neutral); soft adjacency prerequisites prevent fields from leapfrogging in isolation. Tech effects feed back into the simulation: `military` biases war outcomes, `government` risks empire dissolution after unstable conquests and also accelerates the spread of any religion founded in its territory, `energy` multiplies city growth, `biology` reduces famine/drought casualties, `art` accelerates religion adherence drift, and `industry` weights wonder-construction eligibility. Tuning constants are calibrated via a 5-seed sweep harness (`npm run sweep`) so multi-millennium runs stay stable without compounding snowballs — see `specs/28_Tech.md` for the Phase 4 balance pass results. The event log identifies the inventing country and figure for each tech advance, with a flavor name resolved from a static per-field table at serialization time (e.g. *"Avaloria discovers Cavalry Doctrine (military L3) (by a military leader in Tall Harbor)"*; levels past the table reuse the last entry with a Roman-numeral suffix), and reports the size of any tech transfer when one country conquers another (e.g. *"Avaloria conquers Morran (+2 techs)"*). Large knowledge-destroying cataclysms (volcanoes, asteroid strikes, tornadoes at continental or global strength) can also degrade country tech levels — fields are picked weighted by current level (high levels are more "fragile") — with `government` tech absorbing losses past level 2; both destroyed and absorbed knowledge surface as `TECH_LOSS` rows in the timeline event log per affected country. Trade routes also act as a knowledge-transfer vector: each successful inter-country trade has one chance to diffuse a tech from the higher-level partner to the lower-level partner in a randomly-chosen field where the gap is at least 2 levels, with the probability gated by the receiver's `exploration` and `government` levels (base 15%, +5% per level, capped at 60%) and the new level capped one below the donor so a single trade never closes the gap entirely; same-empire trades are skipped because empire members already share knowledge through the founder scope, and diffused techs surface as a "learns X via trade with Y" annotation on the trade event. Religion propagation has its own soft-power synergy: each religion remembers the country where it was founded, and that origin country's `art` and `government` tech levels feed back into both the yearly adherence drift (up to +0.02 from `art` and +0.03 from `government` on top of the base +0.05) and the Path 2 cross-city expansion — high-`government` religions bias toward neighbour-region candidates (weight `1 + 0.25 × level`, capped at 2) so their reach grows faster per tick; `RELIGION` events are tagged with a `propagationReason` flavor string (*"(spread boosted by art and government)"*) in the event log
- **Settlements** — capitals and cities placed using climate-aware scoring: river mouths, natural harbors, and fertile lowlands are preferred; extreme biomes (desert, tundra, ice) are penalized unless mitigated by rivers or coast access. Connected by roads via A* pathfinding
- **Kingdoms** — territory assignment with color-coded borders, driven by historical simulation
- **Physical world** — terrain is always partitioned into geographic regions (BFS-clustered Voronoi cells) and continents (connected landmasses); each region has a biome classification and natural resources (strategic, agricultural, luxury)
- **Timeline playback** — auto-plays from year 0 with play/pause, step forward/backward by 1 or 10 years, plus a draggable year slider; header shows year, world population, living/total nations, and event count
- **Event log** — cumulative log of historical events lives in the **Events tab** of the unified overlay, with year labels, event-type icons, yearly population entries, and current-year highlighting; auto-scrolls to the latest events as the year advances
- **Per-field tech chart** — a dedicated **Tech tab** in the unified overlay hosts a chart that plots the world's highest country tech level for each of the 9 tech fields over the full simulated history as nine colored polylines, with a vertical cursor that tracks the currently-selected year; the chart resizes responsively to the overlay width via a `ResizeObserver` and includes Y-axis peak-level labels and X-axis year labels, letting players see civilizational rise at a glance instead of scrolling through thousands of TECH events.
- **Terrain/Political view toggle** — switch between terrain view (biome detail) and political view (parchment overlay with bold kingdom color fills)
- **Minimap** — toggleable minimap overlay showing the full map with a viewport indicator; click to navigate; uses offscreen canvas caching for performance
- **Draggable UI panels** — the biome legend, minimap, timeline playback controls, and the unified overlay can all be repositioned by dragging their title bars; panels are clamped to stay visible within the viewport
- **Interactive viewport** — zoom/pan via mouse wheel, touch pinch, or middle-click drag
- **Layer toggles** — show/hide rivers, roads, kingdom borders, city icons, labels, biome legend, minimap, region borders, resource icons, and relief shading
- **Unified tabbed overlay** — generation parameters, the cumulative event log, a collapsible Empire → Country → City tree at the selected year, and the per-field tech chart live in the Generation, Events, Hierarchy (Realm), and Tech tabs of a single draggable, collapsible panel. The overlay collapses to a minimal title bar to free up screen space

## Tech Stack

| Category | Library/Tool |
|----------|-------------|
| UI Framework | React 18 + TypeScript |
| Build Tool | Vite 5 |
| Voronoi Diagrams | d3-delaunay |
| Noise Functions | simplex-noise |
| Deployment | GitHub Pages |

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run the Phase 4 seed sweep — runs the full history simulation across
# 5 fixed seeds in Node (no browser) and writes aggregated metrics to
# scripts/results/<label>.json. Used for tuning tech balance constants.
npm run sweep -- --label my-experiment
```

## Generation Pipeline

1. **Voronoi cells** — evenly-distributed cells via Delaunay triangulation + Lloyd relaxation
2. **Elevation** — tectonic plate simulation with controlled continental/oceanic split (3–5 large continental plates clustered for continent-sized landmasses, 8–12 oceanic plates spread evenly); size-biased growth gives continental plates ~3× more cells; continental seam elevation boost merges adjacent continental plates; convergent/divergent boundary effects + multi-octave FBM noise + polar ice cap generation; thermal erosion smoothing; elevations normalized so the highest point always reaches 1.0; sea level derived by ranking cells so the exact requested water ratio is always achieved
3. **Ocean currents** — BFS flood-fill detects connected ocean basins; an analytical gyre model computes per-cell sea surface temperature (SST) anomalies: warm poleward currents on western basin margins, cold equatorward currents on eastern margins, scaled by a latitude envelope (strongest at mid-latitudes, weak near equator and poles); feeds into moisture and temperature steps
4. **Moisture** — FBM noise base + smooth Hadley cell latitude curve (damped cosine modeling three atmospheric circulation cells per hemisphere) + coastal boost (modulated by ocean currents: cold currents suppress evaporation) → continentality gradient (BFS distance-from-ocean decay) → rain shadow (upwind mountain barrier detection with prevailing wind simulation); also produces distance-from-ocean data for the temperature step
5. **Temperature** — per-cell temperature (0–1) from latitude base + continentality modifier (continental interiors pushed to extremes, maritime cells pulled toward moderate) + windward ocean proximity (upwind march through Voronoi neighbors detects nearby ocean for west-coast mildness effect) + ocean current influence (SST anomaly of upwind ocean propagated to coastal land cells) + elevation lapse rate + noise perturbation; water cells incorporate SST anomaly directly
6. **Biomes** — Whittaker diagram classification into 19 terrain types (5 elevation bands including a transitional alpine meadow zone); polar biomes (ICE/SNOW/TUNDRA) use temperature-based thresholds with noise dithering for organic transitions; the Whittaker lookup receives a temperature-adjusted effective moisture that shifts biome boundaries at continental margins
7. **Rivers (initial)** — water flow accumulation determines river paths and per-cell `riverFlow` values
8. **Hydraulic erosion** — stream power erosion carves valleys along river paths (erosion ~ flow^0.5 × slope), with sediment deposition creating floodplains downstream and valley widening for visible cross-sections in hillshading; temperature and biomes are refreshed afterward since elevation changed; rivers are re-traced on the carved terrain for precise valley-following paths
9. **Physical world** — always runs: BFS flood-fills connected land cells to detect continents; subdivides each continent into geographic regions (~30 cells each) via multi-source BFS seeding; places 1–10 natural resources per region (weighted random type across 17 resource types); places 1–5 cities per region using climate-aware scoring (river mouths, natural harbors, biome penalties with river/coast mitigation)
10. **History** *(optional)* — if enabled, the **HistoryGenerator** orchestrates a full civilizational simulation: it first builds the physical world (step 9), then runs a 5000-year timeline via the **TimelineGenerator**. Each year, 12 event generators fire in order: cities are founded, make first contact, form countries, produce illustrious figures, discover technologies, build wonders, found religions, open trade routes, suffer cataclysms, wage wars, resolve conquests, and form empires. The first N years (user-configurable) are serialized into the UI's timeline format with ownership snapshots for fast scrubbing.
11. **Roads** *(history only)* — A* pathfinding connects history-generated cities across the terrain
12. **Trade routes** *(history only)* — active trade connections are pathfound using a dual-domain A* that traverses both land and water; maritime segments use a cost gradient based on distance from land, naturally producing routes that hug coastlines and hop between islands rather than cutting straight across open ocean. Per-city trade-route capacity scales with the `exploration`, `growth`, `industry`, and `government` tech levels (each known tech multiplies the size-based base cap by `1 + level/10`), matching the spec in `specs/04_City.md`

If history is **disabled**, steps 10–12 are skipped and the map shows terrain and physical world structure only (no kingdom simulation, roads, or timeline).

## Project Structure

```
src/
├── components/           # React UI components
│   ├── UnifiedOverlay.tsx # Tabbed draggable overlay shell (Gen/Events/Realm/Tech tabs)
│   ├── overlay/
│   │   ├── GenerationTab.tsx # Generation parameters, layer toggles, history settings
│   │   ├── EventsTab.tsx     # Cumulative event log
│   │   ├── HierarchyTab.tsx  # Collapsible Empire → Country → City tree at selected year
│   │   └── TechTab.tsx       # Per-field tech polyline chart with ResizeObserver-driven dynamic width
│   ├── Draggable.tsx     # Reusable drag-to-reposition wrapper (pointer events + viewport clamping)
│   ├── Legend.tsx        # Draggable biome legend (React overlay, replaces canvas-drawn legend)
│   ├── MapCanvas.tsx     # Zoom/pan interaction and canvas lifecycle
│   ├── Minimap.tsx       # Draggable minimap with viewport indicator and click-to-navigate
│   ├── Timeline.tsx      # Draggable bottom playback controls (year slider, play/pause, step buttons)
│   └── ZoomControls.tsx
├── lib/                  # Core generation modules
│   ├── types.ts          # All shared TypeScript type definitions
│   ├── terrain/          # Physical map generation
│   │   ├── noise.ts      # Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers
│   │   ├── voronoi.ts    # Cell generation via D3-Delaunay + Lloyd relaxation
│   │   ├── elevation.ts  # Tectonic plates (continental clustering + size-biased growth + seam boost) + FBM elevation + water ratio marking
│   │   ├── moisture.ts   # FBM moisture + Hadley cell latitude curve + continentality + rain shadow
│   │   ├── temperature.ts# Continental climate: latitude + continentality + windward proximity + lapse rate
│   │   ├── biomes.ts     # Whittaker biome classification + temperature-driven thresholds + color palette
│   │   ├── rivers.ts     # Drainage map + flow accumulation + river tracing
│   │   ├── hydraulicErosion.ts # Stream power erosion — carves river valleys + floodplains
│   │   └── index.ts
│   ├── history/          # Civilizational simulation
│   │   ├── physical/     # Physical model — data classes (Phase 2) + generators/visitors (Phase 3)
│   │   │   ├── Resource.ts          # Resource entity (17 types, weights, TRADE_MIN/USE)
│   │   │   ├── CityEntity.ts        # Rich city entity (lifecycle, size, population)
│   │   │   ├── Region.ts            # Region entity (biome, cells, neighbour graph, potentialNeighbours)
│   │   │   ├── Continent.ts         # Continent entity (groups regions)
│   │   │   ├── World.ts             # World entity (all runtime index maps)
│   │   │   ├── ResourceGenerator.ts # Generates Resource instances (weighted type + dice roll)
│   │   │   ├── CityGenerator.ts     # Generates CityEntity, inserts into world.mapCities
│   │   │   ├── RegionGenerator.ts   # Generates Region; assignNeighbours + updatePotentialNeighbours
│   │   │   ├── ContinentGenerator.ts# Generates Continent, inserts into world.mapContinents
│   │   │   ├── WorldGenerator.ts    # Generates World
│   │   │   ├── CityVisitor.ts       # Iterate/select cities from world maps (with predicate)
│   │   │   ├── RegionVisitor.ts     # Iterate/select regions from world map (with predicate)
│   │   │   └── index.ts
│   │   ├── timeline/     # Timeline model — temporal simulation layer (Phases 4–5)
│   │   │   ├── events.ts            # Re-exports all 13 event type interfaces
│   │   │   ├── Timeline.ts          # Timeline entity (5000 years, random start year)
│   │   │   ├── Year.ts              # Year entity (population + 12 event collections)
│   │   │   ├── TimelineGenerator.ts # Generates Timeline with 5000 Year records
│   │   │   ├── YearGenerator.ts     # Year preprocessing + calls all Phase 5 generators
│   │   │   ├── Foundation.ts        # City founding event + generator
│   │   │   ├── Contact.ts           # First-contact between cities + generator
│   │   │   ├── Country.ts           # Country formation event + generator (Spirit enum)
│   │   │   ├── Illustrate.ts        # Illustrious figure event + generator (6 types)
│   │   │   ├── Religion.ts          # Religion founding/expansion + generator
│   │   │   ├── Trade.ts             # Trade route event + generator
│   │   │   ├── Wonder.ts            # Wonder construction event + generator
│   │   │   ├── Cataclysm.ts         # Natural disaster event + generator (9 types, 4 strengths)
│   │   │   ├── War.ts               # War event + generator (4 reasons, trade disruption)
│   │   │   ├── Tech.ts              # Technology discovery + generator (9 fields, merge utils)
│   │   │   ├── Conquer.ts           # Conquest outcome + generator (tech assimilation)
│   │   │   ├── Empire.ts            # Empire formation + generator
│   │   │   ├── Merge.ts             # Merge placeholder (future use)
│   │   │   ├── techNames.ts         # Flavor names for tech levels (spec stretch §3)
│   │   │   └── index.ts
│   │   ├── HistoryGenerator.ts # Phase 6 orchestrator: physical world + timeline → HistoryData
│   │   ├── history.ts    # buildPhysicalWorld() + legacy simulation + getOwnershipAtYear
│   │   ├── borders.ts    # BFS flood-fill kingdom borders from capitals
│   │   ├── cities.ts     # City placement with spacing constraints
│   │   ├── roads.ts      # A* road pathfinding between cities
│   │   └── index.ts
│   └── renderer/         # Canvas drawing logic
│       ├── renderer.ts   # All rendering layers: biomes, borders, icons
│       ├── noisyEdges.ts # Recursive midpoint displacement for organic coastlines
│       └── index.ts
└── workers/
    └── mapgen.worker.ts  # Web Worker — orchestrates the full generation pipeline

scripts/
├── sweep-history.ts     # Phase 4 seed sweep harness — runs the full pipeline
│                        # across 5 fixed seeds in Node via tsx, captures extended
│                        # HistoryStats, writes scripts/results/<label>.json
└── results/             # Per-tuning-round reports (baseline-a.json, tuning-1.json, …)
```

## Architecture Notes

- Map generation runs in a **Web Worker** to keep the UI responsive; progress events drive the loading bar.
- The **Mulberry32 PRNG** ensures fully deterministic output from any seed string — including history events.
- Canvas is rendered at native pixel density to avoid blurriness on high-DPI displays.
- Cities and kingdoms are **only generated when history is enabled** — they are outputs of the history simulation, not independent pipeline steps.
- The **HistoryGenerator** (Phase 6) is the top-level orchestrator: it calls `buildPhysicalWorld` then `TimelineGenerator`, and serializes the rich simulation state into the flat `HistoryData` format the renderer and timeline UI consume.
- **Seasonal rendering** is a pure render-time concept — the generation pipeline is unchanged. `getSeasonalBiome()` applies per-season temperature threshold offsets with spatial-hash dither to shift polar biome boundaries organically. `getPermafrostAlpha()` returns a blue-gray overlay intensity for sub-polar land cells. Season defaults to Spring (0), which produces no visual change.
- The Timeline reconstructs cell ownership at any year using decade snapshots + sparse annual deltas, avoiding full replay on every drag. It starts at year 0 and can auto-play forward, step by 1 or 10 years, or be scrubbed via slider. A cumulative event log in the **Events tab** of the unified overlay shows all events up to the selected year, with icons for 15 event types (foundations, contacts, countries, illustrates, wonders, religions, trades, cataclysms, wars, techs, conquests, empires, and legacy types).
