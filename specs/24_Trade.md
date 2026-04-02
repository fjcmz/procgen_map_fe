# Trade / TradeGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: City, Resource, Region, World, Year

## Purpose

Represents an active trade route between two cities, consuming resources from both sides.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `trade_<year>_<resource1>_<resource2>_<uuid>` |
| `started` | `int` | Year trade started |
| `ended` | `Integer` | Year trade ended (null if active) |
| `endCause` | `String` | Cause of termination |
| `city1` | `String` | ID of first city |
| `city2` | `String` | ID of second city |
| `resource1` | `Resource.Type` | Resource type from city 1's region |
| `resource2` | `Resource.Type` | Resource type from city 2's region |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |
| `tradeCity1` | `City` | Direct reference to first city |
| `tradeCity2` | `City` | Direct reference to second city |
| `material1` | `Resource` | Direct reference to resource 1 |
| `material2` | `Resource` | Direct reference to resource 2 |

## Constants

- `TRADE_MIN = 10` — Minimum `available` for a resource to be tradable.
- `TRADE_USE = 5` — Amount consumed per trade endpoint.

## Generation Logic

1. Choose source city from usable cities where:
   - `canTradeMore()` returns true
   - Source region `hasResources` is true
2. Choose target city from source city's contacts in a different region where:
   - Target region `hasResources` is true
   - Target `canTradeMore()` returns true
3. Choose one random resource from source region with `available > TRADE_MIN`.
4. Choose one random resource from target region with `available > TRADE_MIN`.
5. Create `id = trade_<year>_<resource1>_<resource2>_<uuid>`.
6. Decrease each chosen resource's `available` by `TRADE_USE (5)`.
7. Add trade ID and transient trade reference to both cities.

## Termination

- War can end cross-region trades between belligerent countries.
- When ended: `ended = war.started`, `endCause = war.id`.
- Resource availability is restored (`available += TRADE_USE` on each side).
