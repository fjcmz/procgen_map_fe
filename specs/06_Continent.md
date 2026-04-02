# Continent

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 2 — Physical Model Data Classes  
**Dependencies**: Region

## Purpose

Groups regions into a continental landmass.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `continent_<uuid>` |
| `regions` | `List<Region>` | Regions within this continent |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `world` | `World` | Back-reference to the containing World |

## Generated References

- `regions`: `rndSize(100, 1)` — up to ~100 regions per continent
