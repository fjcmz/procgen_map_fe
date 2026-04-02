# Wonder / WonderGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, World, Year

## Purpose

Represents a wonder of the world built in a city. Wonders can be destroyed by cataclysms.

## Fields

Persistent fields include: `id`, city reference, construction year, and destruction state.

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Generation Constraints

- Eligible city predicate: **all large/metropolis cities qualify regardless of resource richness**, while `megalopolis` additionally requires `>1` high-original resources (due to `&&` binding tighter than `||` in the original code — this is a known quirk, see spec section 6).

## Effects

- Added to city's `wonders` list.
- Added to `world.mapWonders` and `world.mapUsableWonders`.

## Destruction

- Cataclysms with `canDestroyWonder = true` may destroy one reachable non-destroyed wonder.
- Destroyed wonders are removed from `world.mapUsableWonders`.
