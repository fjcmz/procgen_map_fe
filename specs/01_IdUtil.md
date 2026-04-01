# IdUtil

**Package**: `es.fjcmz.lib.procgen.history`  
**Phase**: 1 — Utilities and Infrastructure  
**Dependencies**: None

## Purpose

Utility class for constructing string identifiers by joining parts with a separator.

## API

### Public Static Methods

- `id(Object... parts)` — Joins all parts with `_` separator. Returns `null` if parts are null or empty.
- `idCustom(String separator, Object... parts)` — Joins all parts with custom separator. Returns `null` if parts are null or empty.

### Private Static Fields

- `joiner` — Internal joiner instance (default separator `_`).

## Behavior

- Each part is converted to its string representation.
- Parts are joined by the separator (default `_` for `id()`, custom for `idCustom()`).
- If the `parts` array is `null` or has zero length, return `null`.

## Usage Examples

```
id("city", uuid)          → "city_<uuid>"
id("war", year, reason)   → "war_<year>_<reason>"
idCustom("-", "a", "b")   → "a-b"
id()                      → null
id(null)                  → null (empty varargs)
```
