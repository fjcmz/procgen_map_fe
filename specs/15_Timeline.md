# Timeline

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 4 — Timeline Model Core  
**Dependencies**: Year

## Purpose

Container for all simulated years. Anchors the simulation with a random start year.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `startOfTime` | `int` | Starting year (random in approx [-3000, -1001]) |
| `years` | `List<Year>` | All generated year records |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `history` | `Root` | Back-reference to the generation root |

## Generated References

- `years`: fixed size of 5000 Year nodes.
