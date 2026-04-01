# CityGenerator

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators  
**Dependencies**: City, IdUtil, World

## Purpose

Generates `City` instances within a Region.

## API

- `getGeneratedType()` — Returns `City`.
- `generate(...)` — Creates one City.

## Generation Logic

1. Set `region` back-reference.
2. Set `id = city_<uuid>`.
3. Set `founded = false`.
4. Sample `size` from weighted `City.Size` enum.
5. Set `initialPopulation = size.initialPop(...)` using the size's roll.
6. Set `currentPopulation = initialPopulation`.
7. Insert into `world.mapCities`.
