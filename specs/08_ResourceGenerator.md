# ResourceGenerator

**Package**: `es.fjcmz.lib.procgen.history.physical`  
**Phase**: 3 — Physical Model Generators  
**Dependencies**: Resource, IdUtil

## Purpose

Generates `Resource` instances within a Region.

## API

- `getGeneratedType()` — Returns `Resource`.
- `generate(...)` — Creates one Resource.

## Generation Logic

1. Sample `type` from weighted `Resource.Type` enum.
2. Set `id = resource_<type>_<uuid>`.
3. Set `original = roll(10, 10) + 20` (range: 30–120).
4. Set `available = original`.
