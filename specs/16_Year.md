# Year

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 4 — Timeline Model Core  
**Dependencies**: All timeline entity types

## Purpose

Represents a single simulated year. Holds all events and entities generated during that year.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `int` | Absolute year number |
| `worldPopulation` | `long` | Total population of usable cities (measured before growth) |
| `foundations` | `List<Foundation>` | Cities founded this year |
| `contacts` | `List<Contact>` | Contacts established this year |
| `countries` | `List<Country>` | Countries founded this year |
| `illustrates` | `List<Illustrate>` | Illustrious figures born this year |
| `wonders` | `List<Wonder>` | Wonders built this year |
| `religions` | `List<Religion>` | Religions founded/expanded this year |
| `trades` | `List<Trade>` | Trades started this year |
| `cataclysms` | `List<Cataclysm>` | Cataclysms this year |
| `wars` | `List<War>` | Wars started this year |
| `techs` | `List<Tech>` | Technologies discovered this year |
| `conquers` | `List<Conquer>` | Conquests this year |
| `empires` | `List<Empire>` | Empires founded this year |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `timeline` | `Timeline` | Back-reference |

## Generation Order and Size Functions

Events are generated in this order within each year:

| Order | Entity | Size Function |
|-------|--------|---------------|
| 1 | foundations | `random [0, max(2, toFound/300)-1]` where `toFound = totalCities - usableCities` |
| 2 | contacts | `rndSize(30, 2)` |
| 3 | countries | `rndSize(10, 0)` |
| 4 | illustrates | `random [0, max(2, usableCities/500)-1]` |
| 5 | wonders | `random [0, max(2, usableCities/500)-1]` |
| 6 | religions | Often zero (two consecutive boolean checks), else up to `max(2, withoutReligion/1000)` scaled by random double |
| 7 | trades | `TRADES_ROLL = roll(6, 10)` |
| 8 | cataclysms | `rndSize(6, -3)` |
| 9 | wars | `random [0, max(2, countries/50)-1]` |
| 10 | techs | `rndSize(5, 1)` |
| 11 | conquers | `rndSize(4, 1)` |
| 12 | empires | Exactly `conquers.size()` when conquers exist, else 0 |
