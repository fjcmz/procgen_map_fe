# Foundation / FoundationGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, World, Year

## Purpose

Represents the founding of a city, transitioning it from dormant to active in the simulation.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `foundation_<year>_<uuid>` |
| `founded` | `String` | ID of the founded city |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Generation Logic

1. If all cities already founded (`mapCities.size() == mapUsableCities.size()`), produce no foundation.
2. Otherwise, choose a random unfounded city from `mapCities` (where `city.founded == false`).
3. Create `id = foundation_<year>_<uuid>`.
4. Mark city as `founded = true`, stamp `foundedOn = year`.
5. Set city's `foundation` back-reference.
6. Add city to `world.mapUsableCities`.
7. Add city to `world.mapUncontactedCities`.
