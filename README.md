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
- **Rich terrain** — 19 biome types classified via a Whittaker diagram (elevation × moisture), including a transitional alpine meadow band
- **Realistic moisture** — three-layer moisture model: latitude-based Hadley cell circulation (damped cosine curve producing equatorial wet zones and subtropical desert belts) + continentality gradient (BFS distance-from-ocean decay for dry interiors) + rain shadow behind mountain ranges (prevailing wind simulation); produces Earth-like desert bands, rainforest concentration, and continental aridity
- **Hillshading** — shaded relief lighting on land terrain using neighbor-based gradient estimation with a NW light source; toggleable via the "Relief" layer control
- **Hydrology** — rivers generated from drainage accumulation with flow-scaled widths
- **History simulation** — optional multi-century timeline: cities are founded and make first contact, countries form when all regional cities are established, illustrious figures drive technology and religion, trade routes connect cities via pathfound coastal-hugging and island-hopping maritime routes, cataclysms strike, wars break out between neighbouring countries leading to conquests and empires — all simulated year by year
- **Settlements** — capitals and cities placed using climate-aware scoring: river mouths, natural harbors, and fertile lowlands are preferred; extreme biomes (desert, tundra, ice) are penalized unless mitigated by rivers or coast access. Connected by roads via A* pathfinding
- **Kingdoms** — territory assignment with color-coded borders, driven by historical simulation
- **Physical world** — terrain is always partitioned into geographic regions (BFS-clustered Voronoi cells) and continents (connected landmasses); each region has a biome classification and natural resources (strategic, agricultural, luxury)
- **Timeline playback** — auto-plays from year 0 with play/pause, step forward/backward by 1 or 10 years, plus a draggable year slider; header shows year, world population, living/total nations, and event count
- **Event log panel** — right-side panel showing a cumulative log of all historical events up to the selected year, with year labels, event-type icons, yearly population entries, and current-year highlighting; collapsible to header-only
- **Terrain/Political view toggle** — switch between terrain view (biome detail) and political view (parchment overlay with bold kingdom color fills)
- **Minimap** — toggleable minimap overlay showing the full map with a viewport indicator; click to navigate; uses offscreen canvas caching for performance
- **Draggable UI panels** — the biome legend, minimap, timeline controls, and event log can all be repositioned by dragging their title bars; panels are clamped to stay visible within the viewport
- **Interactive viewport** — zoom/pan via mouse wheel, touch pinch, or middle-click drag
- **Layer toggles** — show/hide rivers, roads, kingdom borders, city icons, labels, biome legend, minimap, region borders, resource icons, and relief shading
- **Collapsible controls** — the generation parameters panel can be collapsed to a minimal title bar to free up screen space

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
```

## Generation Pipeline

1. **Voronoi cells** — evenly-distributed cells via Delaunay triangulation + Lloyd relaxation
2. **Elevation** — tectonic plate simulation with controlled continental/oceanic split (3–5 large continental plates clustered for continent-sized landmasses, 8–12 oceanic plates spread evenly); size-biased growth gives continental plates ~3× more cells; continental seam elevation boost merges adjacent continental plates; convergent/divergent boundary effects + multi-octave FBM noise + polar ice cap generation; thermal erosion smoothing; elevations normalized so the highest point always reaches 1.0; sea level derived by ranking cells so the exact requested water ratio is always achieved
3. **Moisture** — FBM noise base + smooth Hadley cell latitude curve (damped cosine modeling three atmospheric circulation cells per hemisphere) + coastal boost → continentality gradient (BFS distance-from-ocean decay) → rain shadow (upwind mountain barrier detection with prevailing wind simulation)
4. **Biomes** — Whittaker diagram classification into 19 terrain types (5 elevation bands including a transitional alpine meadow zone); polar biomes (ICE/SNOW/TUNDRA) use noise-dithered thresholds for organic transitions
5. **Rivers** — water flow accumulation determines river paths and widths
6. **Physical world** — always runs: BFS flood-fills connected land cells to detect continents; subdivides each continent into geographic regions (~30 cells each) via multi-source BFS seeding; places 1–10 natural resources per region (weighted random type across 17 resource types); places 1–5 cities per region using climate-aware scoring (river mouths, natural harbors, biome penalties with river/coast mitigation)
7. **History** *(optional)* — if enabled, the **HistoryGenerator** orchestrates a full civilizational simulation: it first builds the physical world (step 6), then runs a 5000-year timeline via the **TimelineGenerator**. Each year, 12 event generators fire in order: cities are founded, make first contact, form countries, produce illustrious figures, discover technologies, build wonders, found religions, open trade routes, suffer cataclysms, wage wars, resolve conquests, and form empires. The first N years (user-configurable) are serialized into the UI's timeline format with ownership snapshots for fast scrubbing.
8. **Roads** *(history only)* — A* pathfinding connects history-generated cities across the terrain
9. **Trade routes** *(history only)* — active trade connections are pathfound using a dual-domain A* that traverses both land and water; maritime segments use a cost gradient based on distance from land, naturally producing routes that hug coastlines and hop between islands rather than cutting straight across open ocean

If history is **disabled**, steps 7–8 are skipped and the map shows terrain and physical world structure only (no kingdom simulation, roads, or timeline).

## Project Structure

```
src/
├── components/           # React UI components
│   ├── Controls.tsx      # Generation parameters, layer toggles, history settings
│   ├── Draggable.tsx     # Reusable drag-to-reposition wrapper (pointer events + viewport clamping)
│   ├── Legend.tsx        # Draggable biome legend (React overlay, replaces canvas-drawn legend)
│   ├── MapCanvas.tsx     # Zoom/pan interaction and canvas lifecycle
│   ├── Minimap.tsx       # Draggable minimap with viewport indicator and click-to-navigate
│   ├── Timeline.tsx      # Draggable playback controls + draggable/collapsible event log side panel
│   └── ZoomControls.tsx
├── lib/                  # Core generation modules
│   ├── types.ts          # All shared TypeScript type definitions
│   ├── terrain/          # Physical map generation
│   │   ├── noise.ts      # Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers
│   │   ├── voronoi.ts    # Cell generation via D3-Delaunay + Lloyd relaxation
│   │   ├── elevation.ts  # Tectonic plates (continental clustering + size-biased growth + seam boost) + FBM elevation + water ratio marking
│   │   ├── moisture.ts   # FBM moisture + Hadley cell latitude curve + continentality + rain shadow
│   │   ├── biomes.ts     # Whittaker biome classification + color palette
│   │   ├── rivers.ts     # Drainage map + flow accumulation + river tracing
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
```

## Architecture Notes

- Map generation runs in a **Web Worker** to keep the UI responsive; progress events drive the loading bar.
- The **Mulberry32 PRNG** ensures fully deterministic output from any seed string — including history events.
- Canvas is rendered at native pixel density to avoid blurriness on high-DPI displays.
- Cities and kingdoms are **only generated when history is enabled** — they are outputs of the history simulation, not independent pipeline steps.
- The **HistoryGenerator** (Phase 6) is the top-level orchestrator: it calls `buildPhysicalWorld` then `TimelineGenerator`, and serializes the rich simulation state into the flat `HistoryData` format the renderer and timeline UI consume.
- The Timeline reconstructs cell ownership at any year using decade snapshots + sparse annual deltas, avoiding full replay on every drag. It starts at year 0 and can auto-play forward, step by 1 or 10 years, or be scrubbed via slider. A cumulative event log in a side panel shows all events up to the selected year, with icons for 15 event types (foundations, contacts, countries, illustrates, wonders, religions, trades, cataclysms, wars, techs, conquests, empires, and legacy types).
