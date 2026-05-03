# Extensions

Data-driven extensibility for the universe and world-map layers. A user can drop in a JSON pack to add new planet subtypes, satellite subtypes, terrain profiles, or landmass shapes without writing code.

The complete pack format types live in [`src/lib/extensions/types.ts`](../src/lib/extensions/types.ts); built-in defaults are encoded in [`src/lib/extensions/builtins.ts`](../src/lib/extensions/builtins.ts) using the same schema. An example pack lives at [`examples/example-pack.json`](../examples/example-pack.json).

## Architecture

```
                         ┌──────────────────────┐
                         │  Built-in DEFAULT_PACK │
                         │  (lib/extensions/      │
                         │     builtins.ts)       │
                         └─────────┬────────────┘
                                   │
        File upload ─►  loader.ts  │  ┌─ subscribe ─► UI dropdowns
        localStorage ──►   ▼       ▼  │
              ──► validate.ts ──► registry.ts ──► main thread
                                   │              ├─ resolveTerrainProfile()
                                   │              ├─ getUniverseCatalogue()
                                   │              └─ getWorldCatalogue()
                                   │                       │
                                   │                       ▼
                                   │            postMessage({ profileSnapshot,
                                   │                         subtypeCatalogue })
                                   │                       │
                                   │                       ▼
                                   └────────────────►  workers (stateless)
```

The **registry singleton** in [`registry.ts`](../src/lib/extensions/registry.ts) holds the active set of packs (always seeded from `DEFAULT_PACK` plus any user-loaded packs). Packs compose left-to-right in load order; the `mode` flag controls whether each pack `extend`s or `replace`s the catalogue for its declared sections.

Workers stay **stateless** — the main thread resolves the catalogue once per generation request and ships it inside the postMessage payload (`profileSnapshot` for the world-map worker, `subtypeCatalogue` for the universe worker). This avoids any cross-thread mutation of registries.

## Pack Format (`procgen-pack/v1`)

```jsonc
{
  "$schema": "procgen-pack/v1",
  "id": "my-pack",
  "name": "My Custom Pack",
  "version": "1.0.0",
  "mode": "extend",                        // "extend" | "replace"
  "description": "Optional human description",

  "universe": {
    "planet": {
      "subtypes": [                        // visual + composition
        { "id": "blood_rock", "composition": "ROCK",
          "palette": { "base": "#7a1e1e", "accent": "#c44545", "shadow": "#2a0808" }}
      ],
      "rollRules": [...],                  // see Roll Rules below
      "biomeMap": { "forest": "blood_rock" },
      "biomeWeights": [...]                // pickBiome distribution
    },
    "satellite": { /* same shape */ },
    "biomePalettes": {                     // life-bearing rock body palettes
      "default": { "base": "...", "accent": "...", "shadow": "..." }
    }
  },

  "world": {
    "terrainProfiles": {                   // full TerrainProfile (every field required)
      "hellworld": { /* 42 numeric fields */ }
    },
    "terrainShapes": {                     // Partial<TerrainProfile> overlays
      "shattered": { "numContinentalMin": 0, "numOceanicMax": 30 }
    },
    "profileWaterRatios": { "hellworld": 0.05 },
    "biomeToProfile": { "hellworld": "hellworld" },
    "profileLabels": { "hellworld": "Hellworld" },
    "shapeLabels": { "shattered": "Shattered Isles" },
    "profileBadgeColors": { "hellworld": "#c83a18" }
  }
}
```

### Roll Rules

A roll rule fires on the first match in document order. Each rule consumes **0 or 1** rng() draws — same as the original hardcoded pickers, so adding rules with `until: 0` thresholds doesn't perturb the seed.

| `pick.kind` | rng calls | Selection |
|-------------|-----------|-----------|
| `fixed`     | 0 | Always returns `pick.subtype` |
| `thresholds`| 1 | Walks ascending `until` thresholds, returns the first whose `r < until` |
| `uniform`   | 1 | `subtypes[Math.floor(r * len)]` |

Match clause fields (all optional, all must hold for the rule to fire):
- `composition` — string equality (`"ROCK"` | `"GAS"` | `"ICE"` | a custom value)
- `life` — boolean equality
- `biome` — string equality (rule fails if the body has no biome)
- `orbitMin` / `orbitMax` — half-open `[min, max)` on planet orbit
- `parentOrbitMin` / `parentOrbitMax` — same for satellite parent orbit

### Determinism

The data-driven engine is verified to reproduce the original hardcoded pickers byte-identically against ~190 000 sampled `(composition, life, biome, orbit, r)` combinations. The check lives in [`scripts/verify-extensions-pickers.ts`](../scripts/verify-extensions-pickers.ts) and runs via `npx tsx`.

**Sub-stream contract** — preserved verbatim from the pre-extension generators:
- `${seed}_planetsubtype_${planet.id}` — planet subtype roll
- `${seed}_satsubtype_${satellite.id}` — satellite subtype roll
- Biome rolls use the **main universe rng** (same as before)

A pack that adds a subtype with `weight > 0` in an existing band **will** shift outputs for any seed that lands in that band — this is by design. A pack with all-zero weights is "decoration only" and round-trips existing seeds.

## Adding a Pack

1. Author a JSON file matching the schema above. See `examples/example-pack.json`.
2. Open the **Packs** tab in the overlay (Alt+7).
3. Click **Load JSON Pack…** and pick the file. Validation errors are reported inline.
4. Loaded packs persist in `localStorage` (`procgen.extensions.packs`) and reload on next boot.

## Sweep Harness

The sweep harness (`scripts/sweep-history.ts`) does NOT load extension packs — it always uses `DEFAULT_PROFILE` directly. This keeps `scripts/results/baseline-a.json` byte-stable even after loaded user packs change main-thread state.

## Pitfalls

- **Workers stay stateless.** Don't import `extensionRegistry` from inside a worker — the registry on the main thread is never observable from the worker. Use the snapshot fields on the request message (`profileSnapshot`, `subtypeCatalogue`).
- **`replace` mode drops built-ins for that section only.** `mode: "replace"` with only `world.terrainProfiles` set still keeps the built-in universe catalogue. Be explicit if you want a total conversion.
- **Validation rejects unknown `TerrainProfile` keys.** If you add a new tunable to `TerrainProfile`, packs need to be re-saved — old packs without the field will fail validation when loaded against the newer schema.
- **No sub-stream isolation in `pickBiome`.** Biome rolls share the main universe rng. Adding biomes with `until > 0` shifts every subsequent seed draw. If you need a clean extension, give new biomes a 0-weight slot or use `replace`.
- **The data-driven types are `string` at runtime.** `PlanetSubtype` / `SatelliteSubtype` / `PlanetBiome` are runtime aliases for `string` so packs can add new values. TypeScript no longer narrows them — exhaustiveness checks have to be done at runtime against the registry.
