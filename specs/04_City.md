# City

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 2 — Physical Model Data Classes  
**Dependencies**: Resource, Tech (for trade capacity calculation)

## Purpose

Represents a settlement within a Region. Cities are the primary actors in the simulation — they trade, grow, worship, produce illustrates, and suffer cataclysms.

## Persistent Fields

### Core Identity/State
| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `city_<uuid>` |
| `founded` | `boolean` | Whether this city has been founded in the timeline |
| `contacted` | `boolean` | Whether this city has made contact with another |
| `foundedOn` | `int` | Year of foundation |
| `destroyedOn` | `int` | Year of destruction (0 if alive) |
| `detroyCause` | `String` | Cause of destruction (typo is canonical) |

### Demography
| Field | Type | Description |
|-------|------|-------------|
| `size` | `Size` | City size category |
| `initialPopulation` | `long` | Population at founding |
| `currentPopulation` | `long` | Current population |

### Relationships/Events (stored as IDs)
| Field | Type | Description |
|-------|------|-------------|
| `contacts` | `List<String>` | IDs of Contact events involving this city |
| `trades` | `List<String>` | IDs of active Trade events |
| `illustrates` | `List<String>` | IDs of Illustrate entities born here |
| `wonders` | `List<String>` | IDs of Wonders in this city |
| `religions` | `Map<String, Float>` | Religion ID → local adherence fraction |
| `cataclysms` | `List<String>` | IDs of Cataclysm events affecting this city |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `region` | `Region` | Back-reference to containing region |
| `foundation` | `Foundation` | Back-reference to foundation event |
| `contactCities` | `Set<City>` | Direct references to contacted cities |
| `tradeCities` | `Set<Trade>` | Active trade references |
| `knownTechs` | `Map<Tech.Field, Tech>` | Known technologies by field |

## Size Enum

Each size: `(probabilityWeight, initialPopRoll, maxPopRoll, perYearRoll)`

| Size | Weight | Initial Pop | Max Pop | Per Year Growth |
|------|--------|-------------|---------|-----------------|
| small | 100 | `roll(2,10)+90` | `roll(10,1000)+20000` | `roll(1,20)+1` |
| medium | 40 | `roll(5,10)+200` | `roll(100,1000)+350000` | `roll(15,20)+10` |
| large | 15 | `roll(40,10)+400` | `roll(600,1000)+700000` | `roll(45,20)+20` |
| metropolis | 5 | `roll(100,10)+1000` | `roll(2000,1000)+3000000` | `roll(160,20)+30` |
| megalopolis | 1 | `roll(1000,10)+5000` | `roll(4000,1000)+8000000` | `roll(400,20)+50` |

## Dynamic Size Thresholds (`computeCitySize`)

City size is recomputed each year from population and tech levels. The base population thresholds are:

| Size | Min Population |
|------|---------------|
| medium | 10,000 |
| large | 100,000 |
| metropolis | 1,000,000 |
| megalopolis | 10,000,000 |

Cities below 10,000 population are classified as `small`. The `government` and `industry` tech levels reduce thresholds by ~0.5% per combined level via `techFactor = 1 / (1 + 0.005 * (govLevel + industryLevel))`.

## Trade Capacity (`canTradeMore()`)

### Base Max Concurrent Trades by Size
- small: 10, medium: 15, large: 20, metropolis: 30, megalopolis: 50

### Tech Multipliers
For each tech field in `TRADE_TECHS = {exploration, growth, industry, government}`:
- If the city knows a tech in that field: `capacity *= (1 + tech.level / 10)`

### Result
`canTradeMore()` returns `true` iff `trades.size() < round(adjustedCapacity)`

## Evolution

- **Founded** by `FoundationGenerator`: moves to usable/uncontacted maps.
- **Contacted** by `ContactGenerator`: symmetric contact links established.
- **Population growth**: increases yearly by biome growth multiplier and growth-tech multiplier.
- **Population loss**: decreased by cataclysms; if casualties >= population, city is destroyed.
- **Religious composition**: propagates and strengthens yearly.
- **Trade list**: changes via `TradeGenerator` (new trades) and `WarGenerator` (ended trades).
