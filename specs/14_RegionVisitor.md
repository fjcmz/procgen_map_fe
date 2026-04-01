# RegionVisitor

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators/Visitors  
**Dependencies**: Region, World

## Purpose

Utility for traversing and selecting regions from the World's region map.

## API

### Public Fields

- `regionVisitor` — Singleton instance.

### Public Methods

- Iterate all regions.
- Select up to N regions matching a predicate (randomized order).
- Select one region among up to N matches.

## Behavior

- Draws from `world.mapRegions`.
- Selection randomizes candidate order before applying the predicate.
- Returns matched regions up to the requested count, or `null`/empty if none match.
