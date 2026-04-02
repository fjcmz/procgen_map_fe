# Region

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 2 — Physical Model Data Classes  
**Dependencies**: City, Resource

## Purpose

A geographic area within a continent. Regions contain cities and resources, have a biome type, and form an adjacency graph with other regions.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `region_<uuid>` |
| `biome` | `Biome` | Biome classification |
| `resources` | `List<Resource>` | Resources in this region |
| `cities` | `List<City>` | Cities in this region |
| `neighbours` | `Set<String>` | IDs of adjacent regions |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `continent` | `Continent` | Back-reference to containing continent |
| `neighboursCount` | `int` | Target adjacency count (from `roll(2,4)-1`) |
| `isCountry` | `boolean` | Whether a country has been founded here |
| `country` | `Country` | Reference to the country (if any) |
| `hasResources` | `boolean` | Whether any resource has `available >= TRADE_MIN` |
| `neighbourRegions` | `List<Region>` | Direct references to neighbour regions |
| `potentialNeighbours` | `List<List<Region>>` | BFS layers by graph distance |

## Biome Enum (Weighted with Growth Multiplier)

| Biome | Weight | Population Growth Multiplier |
|-------|--------|------------------------------|
| temperate | 10 | 1.5 |
| arid | 10 | 1.0 |
| desert | 1 | 0.3 |
| swamp | 2 | 0.5 |
| tropical | 3 | 0.7 |
| tundra | 1 | 0.3 |

## Generated References

- `resources`: `rndSize(10, 1)` — up to ~10 resources per region
- `cities`: `rndSize(20, 1)` — up to ~20 cities per region

## Evolution

- `isCountry` and `country` are set when a `Country` is founded in this region.
- `hasResources` is recomputed each year: `true` if any resource has `available >= TRADE_MIN`.
- `potentialNeighbours` (BFS layers) is recomputed after each new region is created during generation.
