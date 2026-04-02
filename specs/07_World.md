# World

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 2 — Physical Model Data Classes  
**Dependencies**: Continent, Region, City, Country, Illustrate, Wonder, Religion, War

## Purpose

Top-level physical entity. Contains all continents and maintains runtime index maps for fast lookup of all simulation entities.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `world_<uuid>` |
| `continents` | `List<Continent>` | All continents |
| `endedOn` | `int` | Year the world ended (0 if still alive) |
| `endedBy` | `String` | Cause of world end (null if still alive) |

## Transient Runtime Indexes

### Back Reference
| Field | Type |
|-------|------|
| `history` | `Root` |

### Geography Indexes
| Field | Type | Description |
|-------|------|-------------|
| `mapContinents` | `Map<String, Continent>` | All continents by ID |
| `mapRegions` | `Map<String, Region>` | All regions by ID |

### Civilization Indexes
| Field | Type | Description |
|-------|------|-------------|
| `mapCountries` | `Map<String, Country>` | All countries by ID |
| `mapCities` | `Map<String, City>` | All cities by ID |
| `mapUsableCities` | `Map<String, City>` | Founded, non-destroyed cities |
| `mapUncontactedCities` | `Map<String, City>` | Founded but not yet contacted |

### Cultural/Event Indexes
| Field | Type | Description |
|-------|------|-------------|
| `mapIllustrates` | `Map<String, Illustrate>` | All illustrates |
| `mapUsableIllustrates` | `Map<String, Illustrate>` | Active illustrates not yet consumed |
| `mapWonders` | `Map<String, Wonder>` | All wonders |
| `mapUsableWonders` | `Map<String, Wonder>` | Non-destroyed wonders |
| `mapReligions` | `Map<String, Religion>` | All religions |
| `mapWars` | `Map<String, War>` | All wars |
| `mapAliveWars` | `Map<String, War>` | Currently active wars |

## Generated References

- `continents`: `rndSize(8, 5)` — approximately 3–13 continents

## Evolution

- `endedOn` / `endedBy` are set when a cataclysm removes all usable cities.
- Index maps are continuously mutated by yearly event generators.
