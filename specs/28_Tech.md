# Tech / TechGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Illustrate, City, Country, Empire, World, Year

## Purpose

Represents a technological discovery made by an illustrate. Techs affect trade capacity, contact range, and population growth.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `tech_<year>_<field>_<level>_<uuid>` |
| `field` | `Field` | Technology field |
| `level` | `int` | Tech level (incremental) |
| `discoverer` | `String` | ID of the illustrate who discovered it |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Field Enum (Weighted)

| Field | Weight |
|-------|--------|
| science | 3 |
| military | 3 |
| industry | 3 |
| energy | 2 |
| growth | 2 |
| exploration | 1 |
| biology | 1 |
| art | 1 |
| government | 1 |

## Utility Methods

### `mergeAllTechs(Collection<Map<Field, Tech>>)`
- Union by field, keeping max-level tech per field.
- Used when forming countries (merging all city techs).

### `getNewTechs(originalTechs, newTechs)`
- Returns delta map: fields where the tech is absent in original or level increased in new.
- Used by Conquer to determine acquired technologies.

## Generation Logic

1. Pick a random usable illustrate. If none exists, no tech is generated.
2. Determine eligible tech fields from `illustratesToTech` multimap (static mapping from illustrate type to tech fields).
3. Set `discoverer = illustrate.id`.
4. Determine the known-tech map scope:
   - Default: city's `knownTechs`
   - If city belongs to a country: country's `knownTechs`
   - If country is in an empire: empire founder country's `knownTechs`
5. New tech `level = existingLevelInField + 1` (or 1 if field not yet known).
6. Create `id = tech_<year>_<field>_<level>_<uuid>`.
7. Insert/replace in the known-tech map.
8. Set illustrate's `greatDeed` and consume from `mapUsableIllustrates`.

## Effects on Other Systems

- **Trade capacity**: `TRADE_TECHS = {exploration, growth, industry, government}` — each known tech multiplies trade capacity by `(1 + level/10)`.
- **Contact range**: `exploration` tech increases BFS depth for contact discovery.
- **Population growth**: `growth` tech multiplies yearly population increase.
