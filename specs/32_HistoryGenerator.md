# HistoryGenerator

**Package**: `es.fjcmz.lib.procgen.history`  
**Phase**: 6 — Orchestration  
**Dependencies**: All model classes and generators

## Purpose

Entry point for the entire history generation pipeline. Registers all generables and generators, seeds randomness, generates the full Root, and emits output artifacts.

## API

### Public Static Fields
- `GSON` — Gson instance for JSON serialization.

### Public Static Methods
- `main(...)` — Application entry point.

### Private Static Fields
- Output path and file constants.

### Private Static Methods
- Artifact emitters (JSON, CSV, Graphviz).
- Graph emitters (regional adjacency, city contacts).
- Connected-group helpers.
- Histogram builders.
- Statistics helpers.

### Private Static Nested Classes
- `ConnectedCities` — Represents a connected component in the city contact graph.
- `Histogram` — Collects and formats histogram data.

## Execution Flow

1. **Register all generables**: All history model classes (World, Continent, Region, Resource, City, Timeline, Year, Foundation, Contact, Country, Illustrate, Wonder, Religion, Trade, Cataclysm, War, Tech, Conquer, Empire, Merge).
2. **Register all generators**: Corresponding generator for each generable.
3. **Seed randomizer**: `Randomizer` seeded from `System.currentTimeMillis()` (commented option for deterministic seed `1337`).
4. **Generate Root**: Produces one full `Root` containing the physical world and timeline.
5. **Emit output artifacts**:
   - Flattened generated references (JSON).
   - Per-entity dumps.
   - Timing statistics.
   - Histograms for: population over time, entity counts, tech levels, resources over time.
   - Graphviz graph of regional adjacency.
   - Graphviz graph of city contacts.
   - Connected components of the city contact graph.
