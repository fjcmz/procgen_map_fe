# Procedural Fantasy Map Generator

A browser-based procedural fantasy map generator that creates detailed, interactive maps with terrain, rivers, roads, cities, and kingdoms — all from a single seed value.

## Demo

Deployed at: [https://fjcmz.github.io/procgen_map_fe/](https://fjcmz.github.io/procgen_map_fe/)

## Features

- **Seed-based generation** — reproducible maps from any seed string
- **Configurable detail** — cell count from 500 to 100,000 for fast previews or high-detail renders
- **Water ratio** — slider to control the percentage of water vs land (0–100%)
- **Rich terrain** — 18 biome types classified via a Whittaker diagram (elevation × moisture)
- **Hydrology** — rivers generated from drainage accumulation with flow-scaled widths
- **Settlements** — cities and capitals placed on suitable terrain, connected by roads via A* pathfinding
- **Kingdoms** — territory assignment with color-coded borders
- **Interactive viewport** — zoom/pan via mouse wheel, touch pinch, or middle-click drag
- **Layer toggles** — show/hide rivers, roads, kingdom borders, city icons, labels, and the biome legend
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
6. **Cities** — capitals and settlements placed on habitable terrain
7. **Roads** — A* pathfinding connects cities across the terrain
8. **Borders** — kingdom territories assigned and rendered with color overlays

## Project Structure

```
src/
├── components/       # React UI components (Controls, MapCanvas, ZoomControls)
├── lib/              # Core generation modules
│   ├── voronoi.ts    # Cell generation
│   ├── elevation.ts  # Terrain height
│   ├── moisture.ts   # Water availability
│   ├── biomes.ts     # Terrain classification
│   ├── rivers.ts     # River generation
│   ├── cities.ts     # Settlement placement
│   ├── roads.ts      # Road pathfinding
│   ├── borders.ts    # Kingdom territories
│   ├── renderer.ts   # Canvas rendering
│   ├── noise.ts      # Seeded noise utilities
│   ├── noisyEdges.ts # Organic coastline generation
│   └── types.ts      # TypeScript type definitions
└── workers/
    └── mapgen.worker.ts  # Web Worker for background generation
```

## Architecture Notes

- Map generation runs in a **Web Worker** to keep the UI responsive; progress events drive the loading bar.
- The **Mulberry32 PRNG** ensures fully deterministic output from any seed string.
- Canvas is rendered at native pixel density to avoid blurriness on high-DPI displays.
