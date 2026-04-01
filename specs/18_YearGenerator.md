# YearGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 4 — Timeline Model Core  
**Dependencies**: Year, World, Timeline, all timeline entity generators

## Purpose

Generates a `Year` entity and performs all per-year preprocessing before sub-entity generation.

## API

- `getGeneratedType()` — Returns `Year`.
- `generate(...)` — Creates one Year with preprocessing.

## Pre-processing Steps (in order, before sub-entity generation)

1. **Abort check**: If `world.endedBy != null`, skip generation entirely.
2. **Compute year**: `year = timeline.startOfTime + timeline.years.size()`.
3. **World population**: Sum `currentPopulation` of all usable cities. Store as `worldPopulation`.
4. **Increase populations**: For each usable city, grow population based on biome growth multiplier and growth-tech multiplier.
5. **Kill/retire illustrates**: Natural death when `birthYear + yearsActive <= currentYear`. War-related death at 15% chance while active war affects origin country, limited by a random `toKill` budget.
6. **Propagate religions**: 
   - Single-religion cities: adherence drifts +0.05 toward dominance until 0.9.
   - If total adherence < 0.9, a random existing religion gains +0.05.
   - Recompute religion member counts as sum of `cityPopulation * adherenceFraction` across usable cities.
7. **End wars**: Remove alive wars where `started + lasts < year`. Clear `atWar` flags.
8. **Reassert war flags**: Active wars set `atWar = true` for involved countries.
9. **Recompute resources**: Set `region.hasResources` to true if any resource has `available >= TRADE_MIN`.

## Post-preprocessing

After preprocessing, Year sub-entities are generated in the order defined in the Year spec (foundations, contacts, countries, ..., empires).
