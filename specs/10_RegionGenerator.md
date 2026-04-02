# RegionGenerator

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators  
**Dependencies**: Region, IdUtil, World, Continent

## Purpose

Generates `Region` instances, assigns biomes, and builds the adjacency graph.

## API

- `getGeneratedType()` — Returns `Region`.
- `generate(...)` — Creates one Region and wires up adjacency.

### Private Helper Methods

- `assignNeighbours(...)` — Assigns adjacency links to up to `min(2, neighboursCount)` existing regions that still have adjacency capacity.
- `updatePotentialNeighbours(...)` — Recomputes BFS-layered `potentialNeighbours` for **all** regions after each new region is created.

## Generation Logic

1. Set `id = region_<uuid>`.
2. Set `continent` back-reference.
3. Sample `biome` from weighted `Biome` enum.
4. Set `neighboursCount = roll(2, 4) - 1` (range: 1–7).
5. Call `assignNeighbours(...)`:
   - Find up to `min(2, neighboursCount)` existing regions that still have capacity (i.e., current neighbour count < their `neighboursCount`).
   - Create symmetric adjacency: add each other's ID to `neighbours` set.
   - Add direct references to both `neighbourRegions` lists.
6. Add to `world.mapRegions`.
7. Call `updatePotentialNeighbours(...)` for all regions — recomputes BFS layers.

## Generated References (on the created Region)

- `resources`: `rndSize(10, 1)`
- `cities`: `rndSize(20, 1)`
