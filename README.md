# Procedural Fantasy Map Generator

A browser-based procedural fantasy map generator that creates detailed, interactive maps with terrain, rivers, roads, cities, kingdoms, and multi-century civilizational history — all from a single seed value.

## Demo

Deployed at: [https://fjcmz.github.io/procgen_map_fe/](https://fjcmz.github.io/procgen_map_fe/)

## Features

- **Seed-based generation** — reproducible maps from any seed string
- **Configurable detail** — cell count from 500 to 100,000 for fast previews or high-detail renders
- **Water ratio** — slider to control the percentage of water vs land (0–100%)
- **Rich terrain** — 18 biome types classified via a Whittaker diagram (elevation × moisture)
- **Hydrology** — rivers generated from drainage accumulation with flow-scaled widths
- **History simulation** — optional multi-century timeline: countries form, go to war, conquer territory, and collapse; cities and kingdoms are derived from this simulation
- **Settlements** — capitals and cities placed on suitable terrain (coast, rivers, flat land), connected by roads via A* pathfinding
- **Kingdoms** — territory assignment with color-coded borders, driven by historical simulation
- **Physical world** — terrain is always partitioned into geographic regions (BFS-clustered Voronoi cells) and continents (connected landmasses); each region has a biome classification and natural resources (strategic, agricultural, luxury)
- **Timeline scrubber** — interactive year slider to replay how kingdoms rose and fell
- **Interactive viewport** — zoom/pan via mouse wheel, touch pinch, or middle-click drag
- **Layer toggles** — show/hide rivers, roads, kingdom borders, city icons, labels, biome legend, region borders, and resource icons
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
2. **Elevation** — multi-octave FBM noise with radial island falloff; elevations normalized so the highest point always reaches 1.0; sea level derived by ranking cells so the exact requested water ratio is always achieved
3. **Moisture** — separate FBM noise layer with coastal humidity boost
4. **Biomes** — Whittaker diagram classification into 18 terrain types
5. **Rivers** — water flow accumulation determines river paths and widths
6. **Physical world** — always runs: BFS flood-fills connected land cells to detect continents; subdivides each continent into geographic regions (~30 cells each) via multi-source BFS seeding; places 1–10 natural resources per region (weighted random type across 17 resource types); places 1–5 cities per region on highest-scoring terrain cells
7. **History** *(optional)* — if enabled, simulates N years of civilizational history: places capitals/cities on suitable terrain, BFS-assigns initial kingdoms, then runs a year-by-year event loop (wars, conquests, merges, collapses); cities and kingdom borders are derived entirely from this step
8. **Roads** *(history only)* — A* pathfinding connects history-generated cities across the terrain

If history is **disabled**, steps 7–8 are skipped and the map shows terrain and physical world structure only (no kingdom simulation, roads, or timeline).

## Project Structure

```
src/
├── components/           # React UI components
│   ├── Controls.tsx      # Generation parameters, layer toggles, history settings
│   ├── MapCanvas.tsx     # Zoom/pan interaction and canvas lifecycle
│   ├── Timeline.tsx      # Year scrubber and event log (shown when history enabled)
│   └── ZoomControls.tsx
├── lib/                  # Core generation modules
│   ├── types.ts          # All shared TypeScript type definitions
│   ├── terrain/          # Physical map generation
│   │   ├── noise.ts      # Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers
│   │   ├── voronoi.ts    # Cell generation via D3-Delaunay + Lloyd relaxation
│   │   ├── elevation.ts  # FBM elevation + island falloff + water ratio marking
│   │   ├── moisture.ts   # FBM moisture assignment
│   │   ├── biomes.ts     # Whittaker biome classification + color palette
│   │   ├── rivers.ts     # Drainage map + flow accumulation + river tracing
│   │   └── index.ts
│   ├── history/          # Civilizational simulation
│   │   ├── physical/     # Phase 2: Physical model data classes
│   │   │   ├── Resource.ts    # Resource entity (17 types, weights, TRADE_MIN/USE)
│   │   │   ├── CityEntity.ts  # Rich city entity (lifecycle, size, population)
│   │   │   ├── Region.ts      # Region entity (biome, cells, neighbours, resources)
│   │   │   ├── Continent.ts   # Continent entity (groups regions)
│   │   │   ├── World.ts       # World entity (all runtime index maps)
│   │   │   └── index.ts
│   │   ├── history.ts    # buildPhysicalWorld() + year-by-year simulation + getOwnershipAtYear
│   │   ├── borders.ts    # BFS flood-fill kingdom borders from capitals
│   │   ├── cities.ts     # City placement with spacing constraints
│   │   ├── roads.ts      # A* road pathfinding between cities
│   │   └── index.ts
│   └── renderer/         # Canvas drawing logic
│       ├── renderer.ts   # All rendering layers: biomes, borders, icons, legend
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
- The Timeline scrubber reconstructs cell ownership at any year using decade snapshots + sparse annual deltas, avoiding full replay on every drag.
