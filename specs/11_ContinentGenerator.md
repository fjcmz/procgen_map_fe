# ContinentGenerator

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators  
**Dependencies**: Continent, IdUtil, World

## Purpose

Generates `Continent` instances within a World.

## API

- `getGeneratedType()` — Returns `Continent`.
- `generate(...)` — Creates one Continent.

## Generation Logic

1. Set `id = continent_<uuid>`.
2. Set `world` back-reference.
3. Insert into `world.mapContinents`.

## Generated References (on the created Continent)

- `regions`: `rndSize(100, 1)`
