# War / WarGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Country, Region, Trade, Empire, World, Year

## Purpose

Represents an armed conflict between two neighbouring countries.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `war_<year>_<reason>_<lasts>_<uuid>` |
| `reason` | `Reason` | Cause of war |
| `started` | `int` | Year war started |
| `aggressor` | `String` | ID of aggressor country |
| `defender` | `String` | ID of defender country |
| `lasts` | `int` | Duration in years (`roll(2, 5)`) |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Reason Enum (Weighted)

| Reason | Weight |
|--------|--------|
| expansion | 20 |
| religion | 10 |
| resources | 20 |
| vengance | 2 |

## Generation Flow

1. Choose aggressor from countries where `atWar == false`.
2. Choose defender among neighbouring regions that:
   - Are countries (`region.isCountry`)
   - Are not in the same empire as the aggressor
3. Create `id = war_<year>_<reason>_<lasts>_<uuid>`, where `lasts = roll(2, 5)`.
4. Mark both countries `atWar = true`.
5. Register war in both countries' `wars` lists.
6. Add to `world.mapWars` and `world.mapAliveWars`.

## Trade Disruption

After war creation, attempt to terminate cross-region trades between the two belligerent regions:
- For each candidate trade between the two regions:
  - Random probability threshold: `[8, 17]` percent
  - If trade is ended:
    - Set `trade.ended = war.started`
    - Set `trade.endCause = war.id`
    - Restore resource availability: `resource.available += TRADE_USE (5)` on each side

## War Ending (`YearGenerator.endWars`)

- Wars are removed from `world.mapAliveWars` when `started + lasts < currentYear`.
- Both countries' `atWar` flags are cleared.
- Active wars reassert `atWar = true` each year for involved countries.
