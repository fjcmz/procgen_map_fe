# Cataclysm / CataclysmGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, Region, Continent, World, Illustrate, Wonder, Year

## Purpose

Represents a natural disaster that kills population, may destroy cities/wonders, and can kill illustrates.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `cataclysm_<year>_<type>_<strength>_<uuid>` |
| `type` | `Type` | Disaster type |
| `strength` | `Strength` | Scale of impact |
| `city` | `String` | ID of epicenter city |
| `killRatio` | `double` | Fraction of population killed |
| `killed` | `long` | Total casualties |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Type Enum

Each type: `(probability, killRatioRoll, canDestroyWonder)`

| Type | Probability | Kill Ratio Roll | Can Destroy Wonder |
|------|-------------|-----------------|-------------------|
| earthquake | 50 | `roll(10, 3)` | true |
| volcano | 30 | `roll(7, 5)` | true |
| tornado | 50 | `roll(8, 4)` | true |
| asteroid | 1 | `roll(20, 2)` | true |
| tsunami | 5 | `roll(15, 2)` | true |
| flood | 70 | `roll(6, 3)` | false |
| heat_wave | 80 | `roll(3, 4)` | false |
| cold_wave | 80 | `roll(3, 4)` | false |
| drought | 70 | `roll(5, 4)` | false |

## Strength Enum (Weighted)

| Strength | Weight |
|----------|--------|
| local | 100 |
| regional | 10 |
| continental | 2 |
| global | 1 |

## Generation Flow

1. Pick a random usable city as epicenter.
2. Sample `type` and `strength` from weighted enums.
3. Compute `killRatio = roll / 100`.
4. Create `id = cataclysm_<year>_<type>_<strength>_<uuid>`.

## Casualty Application (switch fall-through)

Cascading based on strength:
- **global**: apply to all usable cities worldwide, then fall through to continental
- **continental**: apply to all usable cities on epicenter's continent, then fall through to regional
- **regional**: apply to all usable cities in epicenter's region, then fall through to local
- **local**: apply to epicenter city only

Per affected city: `casualties = round(currentPopulation * killRatio)`

## City Destruction

If `casualties >= currentPopulation`:
- Set `currentPopulation = 0`
- Stamp `destroyedOn` and `detroyCause`
- Remove from `world.mapUsableCities`

## Secondary Effects

- **Illustrate death**: 50% chance to attempt killing one reachable usable illustrate.
- **Wonder destruction**: If `type.canDestroyWonder`, may destroy one reachable non-destroyed wonder.
- **World end**: If no usable cities remain after casualties, set `world.endedOn` and `world.endedBy`.
