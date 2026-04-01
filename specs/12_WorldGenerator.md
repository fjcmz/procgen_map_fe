# WorldGenerator

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators  
**Dependencies**: World, IdUtil

## Purpose

Generates the top-level `World` instance.

## API

- `getGeneratedType()` — Returns `World`.
- `generate(...)` — Creates one World.

## Generation Logic

1. Set `history` back-reference to the Root.
2. Set `id = world_<uuid>`.

## Generated References (on the created World)

- `continents`: `rndSize(8, 5)` — random count around 3–13
