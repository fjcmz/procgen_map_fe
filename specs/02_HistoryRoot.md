# HistoryRoot

**Package**: `es.fjcmz.lib.procgen.history`  
**Phase**: 1 — Utilities and Infrastructure  
**Dependencies**: World, Timeline (referenced by type)

## Purpose

Defines the root of the generation graph with exactly two child references: one `World` and one `Timeline`.

## API

### Public Static Fields

- `INSTANCE` — Singleton instance of `HistoryRoot`.
- `WORLD_REF` — Reference descriptor for `World` (cardinality = 1).
- `TIMELINE_REF` — Reference descriptor for `Timeline` (cardinality = 1).

### Public Methods

- `references()` — Returns `[WORLD_REF, TIMELINE_REF]` in that order.

### Private Fields/Methods

None.

## Behavior

- `references()` always returns exactly two entries in fixed order: world first, timeline second.
- Each reference has cardinality 1 (exactly one World, exactly one Timeline generated).
- This class serves as the entry point for the generation framework to discover what top-level entities to create.
