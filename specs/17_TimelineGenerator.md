# TimelineGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 4 — Timeline Model Core  
**Dependencies**: Timeline, IdUtil

## Purpose

Generates the `Timeline` entity with a random start year.

## API

- `getGeneratedType()` — Returns `Timeline`.
- `generate(...)` — Creates one Timeline.

## Generation Logic

1. Set `history` back-reference.
2. Set `startOfTime = random.nextInt(2000) - 3000` (range: [-3000, -1001]).
3. Generate fixed 5000 `Year` nodes via constant-size reference.
