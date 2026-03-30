# CLAUDE.md

This file provides context and guidelines for AI assistants working on this codebase.

## Project Overview

Procedural fantasy map generator built with React, TypeScript, and Vite. Generates Voronoi-based terrain maps with biomes, rivers, cities, kingdoms, and roads — all deterministic from a seed string.

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
voronoi → elevation → moisture → biomes → rivers → cities → roads → borders
```

Each step is a pure function in `src/lib/` that takes cells and returns updated cells or derived data.

### Key Files

| File | Responsibility |
|------|---------------|
| `src/lib/types.ts` | All shared TypeScript types — start here |
| `src/lib/voronoi.ts` | Cell generation via D3-Delaunay + Lloyd relaxation |
| `src/lib/noise.ts` | Seeded PRNG (Mulberry32) + Simplex noise + FBM helpers |
| `src/lib/renderer.ts` | Canvas 2D rendering — the largest file (~450 lines) |
| `src/components/MapCanvas.tsx` | Zoom/pan interaction and canvas lifecycle |
| `src/components/Controls.tsx` | Seed input, cell count, water ratio slider, layer toggle UI |
| `src/workers/mapgen.worker.ts` | Orchestrates the full generation pipeline, posts progress events |

### Data Model

The central type is `Cell` (defined in `types.ts`). Every generation step annotates cells with new fields:

- `elevation`, `moisture` → set by `elevation.ts` / `moisture.ts`
- `biome` → set by `biomes.ts`
- `river`, `flow` → set by `rivers.ts`
- `kingdom` → set by `borders.ts`

### Randomness

All randomness goes through the seeded `mulberry32` PRNG in `noise.ts`. Never use `Math.random()` directly — pass the seeded RNG to any function that needs randomness to ensure reproducibility.

### Generation Parameters

`GenerateRequest` (in `types.ts`) carries all user-controlled inputs to the worker:

| Parameter | Type | Description |
|-----------|------|-------------|
| `seed` | `string` | Deterministic seed string |
| `numCells` | `number` | Voronoi cell count (500–100,000) |
| `waterRatio` | `number` | Fraction of cells that are water (0–1, default 0.4) |
| `width` / `height` | `number` | Canvas dimensions |

`waterRatio` is implemented by ranking all cells by elevation and marking the lowest `waterRatio * N` as water. This guarantees the exact ratio regardless of the terrain shape, unlike a fixed elevation threshold.

### Rendering

`renderer.ts` draws everything onto a single `<canvas>` element. Layer visibility is controlled by the `LayerVisibility` type. When modifying rendering:
- Biome colors are defined in `biomes.ts` (`BIOME_INFO`)
- Coastlines use noisy edges from `noisyEdges.ts` for an organic look
- City icons are drawn as simple SVG-path-like canvas commands
- `drawBiomeFill` renders land cells first, water cells second — this ensures water always wins at shared polygon edges (Voronoi cell indices have no spatial order, so rendering in index order causes land to bleed over water)

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages at `/procgen_map_fe/`. The Vite `base` config must stay as `/procgen_map_fe/` to match this path.

## Common Pitfalls

- **Worker communication**: `mapgen.worker.ts` uses `postMessage` with typed `WorkerMessage` objects. Keep the message schema in sync with `App.tsx`'s `onmessage` handler.
- **High-DPI canvas**: `MapCanvas.tsx` scales the canvas by `devicePixelRatio`. Don't set canvas width/height via CSS — use the component's resize logic.
- **Cell count performance**: Generation above ~10,000 cells is slow. Default is 5,000. Test UI changes at low cell counts.
- **Base path**: Local `npm run dev` serves from `/`, but production uses `/procgen_map_fe/`. Avoid hardcoded absolute paths in source.
- **Elevation normalization**: After computing FBM + island-falloff elevations, `elevation.ts` divides all values by the observed maximum so the highest cell always reaches 1.0. Without this, FBM noise in practice tops out around 0.8, and the island mask compresses it further — leaving the Whittaker mountain band (elevation > 0.8) unreachable. Do not remove this normalization step.
