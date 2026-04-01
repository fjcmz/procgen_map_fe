# Empire / EmpireGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Conquer, Country, Year

## Purpose

Represents a multi-country political entity formed when a conqueror (not already in an empire) conquers another country.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `empire_<year>_<uuid>` |
| `foundedOn` | `int` | Year of founding |
| `foundedBy` | `String` | ID of founder country |
| `destroyedOn` | `Integer` | Year of destruction (null if active) |
| `conqueredBy` | `String` | ID of country that destroyed this empire |
| `countries` | `Set<String>` | IDs of member countries |
| `reach` | `Set<String>` | IDs of regions/territories controlled |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |
| `founder` | `Country` | Direct reference to founder country |
| `members` | `Set<Country>` | Direct references to member countries |

## Generation Logic

**Trigger**: A conquer event in the current year where the conqueror is not already in an empire.

1. Create `id = empire_<year>_<uuid>`.
2. Set `founder` = conqueror country.
3. Initialize with conqueror + conquered as:
   - `members` (transient set)
   - `countries` (persistent ID set)
   - `reach` (persistent region/territory set)
4. Add empire ID to both countries' `empires` lists.
5. Set both countries' `memberOf` to the new empire.

## Destruction

- Triggered by `ConquerGenerator` when a member is conquered and the empire drops to one member.
- Sets `destroyedOn` and `conqueredBy`.
