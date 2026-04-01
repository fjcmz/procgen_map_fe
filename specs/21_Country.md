# Country / CountryGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Region, City, Tech, War, Empire, World, Year

## Purpose

Represents a political entity formed when all cities in a region are founded and contacted.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `country_<year>_<uuid>` |
| `spirit` | `Spirit` | National character |
| `governingRegion` | `String` | ID of the region this country controls |
| `foundedOn` | `int` | Year of founding |
| `atWar` | `boolean` | Whether currently at war |
| `wars` | `List<String>` | IDs of wars involving this country |
| `empires` | `List<String>` | IDs of empires this country has been part of |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |
| `region` | `Region` | Direct region reference |
| `warCountries` | `List<War>` | Active war references |
| `memberOf` | `Empire` | Empire this country belongs to (if any) |
| `knownTechs` | `Map<Tech.Field, Tech>` | Known technologies |

## Spirit Enum (Weighted)

| Spirit | Weight |
|--------|--------|
| military | 3 |
| religious | 3 |
| industrious | 3 |
| neutral | 9 |

## Generation Logic

1. Select up to 5 random candidate regions where:
   - `isCountry == false`
   - All cities in the region are `founded` and `contacted`
2. Pick one randomly.
3. Create `id = country_<year>_<uuid>`.
4. Sample `spirit` from weighted enum.
5. Bind region: set `region.isCountry = true`, `region.country = this`.
6. Merge all city tech maps by max-level-per-field (`Tech.mergeAllTechs`).
7. Assign the unified tech map to:
   - `country.knownTechs`
   - Each city in the region (shared reference)
8. Insert into `world.mapCountries`.
