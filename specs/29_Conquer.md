# Conquer / ConquerGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: War, Country, Tech, Empire, World, Year

## Purpose

Represents the outcome of a war — one country conquers another, assimilating technologies and potentially affecting empires.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `conquer_<year>_<uuid>` |
| `war` | `String` | ID of the war that produced this conquest |
| `conqueror` | `String` | ID of the winning country |
| `conquered` | `String` | ID of the losing country |
| `acquired` | `Map<String, Object>` | Acquired assets (e.g., `acquired["techs"]` = list of tech IDs) |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |
| `inWar` | `War` | Direct war reference |
| `conquerorCountry` | `Country` | Direct reference to winning country |
| `conqueredCountry` | `Country` | Direct reference to losing country |

## Generation Logic

1. Find one finishing war where `war.started + war.lasts == currentYear`.
2. Randomly select winner between aggressor and defender.
3. Create `id = conquer_<year>_<uuid>`.
4. Remove finished war from `world.mapAliveWars`.

## Effects

### Both Countries
- Set `atWar = false` on both countries.

### Tech Assimilation
1. Merge conqueror and conquered tech maps using `Tech.mergeAllTechs` (keep max-level per field).
2. Compute acquired delta using `Tech.getNewTechs`.
3. Store acquired tech IDs under `acquired["techs"]`.

### Empire Implications

**If conquered belonged to an empire:**
- Remove conquered from that empire's members/countries/reach.
- If empire drops to one member: dissolve empire (stamp `destroyedOn`, `conqueredBy` = conqueror).

**If conqueror belongs to an empire:**
- Add conquered into that empire:
  - Update empire's `countries`, `reach`, `members`
  - Set conquered's `memberOf` pointer to the empire
