# Illustrate / IllustrateGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, World, Year

## Purpose

Represents an illustrious figure (scientist, artist, military leader, etc.) born in a city. Illustrates are consumed by Religion and Tech generators to produce great deeds.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `illustrate_<year>_<type>_<uuid>` |
| `type` | `Type` | Category of the illustrate |
| `city` | `String` | ID of origin city |
| `yearsActive` | `int` | Duration of active life |
| `greatDeed` | `String` | Description of achievement (set when consumed) |
| `diedOn` | `Integer` | Year of death (null if alive) |
| `deathCause` | `String` | Cause of death |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |
| `originCity` | `City` | Direct city reference |

## Type Enum (Weighted with Active Duration)

| Type | Weight | Years Active Roll |
|------|--------|-------------------|
| religion | 2 | `roll(5, 10)` |
| science | 3 | `roll(5, 6)` |
| philosophy | 2 | `roll(5, 12)` |
| industry | 5 | `roll(5, 6)` |
| military | 5 | `roll(5, 8)` |
| art | 3 | `roll(5, 10)` |

## Generation Constraints

- Eligible city: founded by current year AND size in `{large, metropolis, megalopolis}`.

## Effects

- Creates illustrate and adds to city's `illustrates` list.
- Adds to `world.mapIllustrates` and `world.mapUsableIllustrates`.

## Lifecycle

### Natural Death (`YearGenerator.killIllustrates`)
- Dies when `birthYear + yearsActive <= currentYear`.
- Removed from `world.mapUsableIllustrates`.

### War Death (`YearGenerator.killIllustrates`)
- 15% chance while an active war affects the origin city's country.
- Limited by a random `toKill` budget per year.

### Cataclysm Death (`CataclysmGenerator`)
- 50% chance to attempt killing one reachable usable illustrate.

### Consumption
- Used by `ReligionGenerator` or `TechGenerator`: `greatDeed` is set and illustrate is removed from `mapUsableIllustrates`.
