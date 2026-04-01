# Religion / ReligionGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Illustrate, City, Region, World, Year

## Purpose

Represents a religion. Can be founded by a religious illustrate or expanded to new cities.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `religion_<year>_<uuid>` |
| `founder` | `String` | ID of the founding Illustrate |
| `foundedOn` | `int` | Year of founding |
| `foundingCity` | `String` | ID of the city where founded |
| `members` | `int` | Total adherents (recomputed yearly) |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Generation Paths

### Path 1: Found New Religion
**Condition**: There is a usable `Illustrate` of type `religion` whose origin city has no religions.

1. Create `id = religion_<year>_<uuid>`.
2. Set `founder` = illustrate ID, `foundingCity` from illustrate's origin city.
3. Set illustrate's `greatDeed` and consume it from `mapUsableIllustrates`.
4. Initialize founding city's adherence with random `[0.10, 0.49]`.
5. Add religion to `world.mapReligions`.

### Path 2: Expand Existing Religion
**Condition**: No eligible founding illustrate available.

1. Pick a random city with at least one religion.
2. Pick one of its religions.
3. Pick a target city without that religion in the same or neighbouring region.
4. Seed target city's adherence with random `[0.01, 0.09]`.

## Ongoing Dynamics (`YearGenerator.propagateReligions`)

- **Single-religion cities**: adherence drifts +0.05 toward dominance until reaching 0.9.
- **Multi-religion cities**: if total adherence < 0.9, a random existing religion gains +0.05.
- **Member recount**: each year, `members = sum(cityPopulation * adherenceFraction)` across all usable cities.
