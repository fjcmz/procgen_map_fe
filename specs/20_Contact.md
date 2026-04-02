# Contact / ContactGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, Region, World, Year, Tech

## Purpose

Represents the first contact between two cities, enabling trade and cultural exchange.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Contact ID |
| `contactFrom` | `String` | Source city ID |
| `contactTo` | `String` | Target city ID |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Source City Selection Logic (priority order)

1. Uncontacted city in a region with multiple founded cities.
2. Uncontacted city in a single-city region.
3. Any usable city (fallback).

## Target City Selection Logic

- BFS traversal over region adjacency graph from source city's region:
  - Base depth: 1
  - If source city has `exploration` tech: depth = `tech.level + 1`
- Find the first founded, non-self, not-yet-contacted city within the BFS depth.

## Effects

- Mark both cities as `contacted = true`.
- Add symmetric links:
  - Both cities' `contacts` ID lists get each other's contact event ID.
  - Both cities' `contactCities` sets get direct references to each other.
- Remove both cities from `world.mapUncontactedCities`.
