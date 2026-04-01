# CityVisitor

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators/Visitors  
**Dependencies**: City, World

## Purpose

Utility for traversing and selecting cities from the World's city maps.

## API

### Public Fields

- `cityVisitor` — Singleton instance.

### Public Methods

- Iterate all cities.
- Iterate usable cities.
- Random selection with predicate — samples without replacement over the candidate list until a match is found or candidates exhausted.

## Behavior

- Selection methods draw from the appropriate map (`mapCities`, `mapUsableCities`).
- Random selection shuffles or iterates randomly over candidates, testing each against the given predicate.
- Returns `null` or empty if no candidate matches.
