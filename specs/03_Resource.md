# Resource

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 2 — Physical Model Data Classes  
**Dependencies**: IdUtil

## Purpose

Represents a natural resource within a Region. Resources are consumed by trade and restored when trades end.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Unique identifier (`resource_<type>_<uuid>`) |
| `type` | `Type` | Resource type enum value |
| `original` | `int` | Original amount at generation (`roll(10,10)+20`) |
| `available` | `int` | Current available amount (starts equal to `original`) |

## Type Enum (Weighted)

### Strategic / Mineral / Fuel
| Type | Weight |
|------|--------|
| copper | 40 |
| iron | 30 |
| aluminium | 20 |
| uranium | 3 |
| oil | 20 |
| gas | 30 |
| coal | 40 |

### Agricultural
| Type | Weight |
|------|--------|
| cattle | 20 |
| wheat | 30 |
| rice | 30 |
| sheep | 20 |
| fruit | 15 |

### Luxury
| Type | Weight |
|------|--------|
| silver | 30 |
| gold | 10 |
| diamonds | 3 |
| silk | 20 |
| incense | 15 |

## Evolution

- Trade consumes `TRADE_USE = 5` from `available` on both exchanged resources.
- When a war ends a trade, the consumed amount is restored (`available += 5`).
- A resource is tradable when `available >= TRADE_MIN (10)`.

## Constants

- `TRADE_MIN = 10` — Minimum `available` to be eligible for trade.
- `TRADE_USE = 5` — Amount consumed per active trade.
