# Universe Map (Galaxies / Systems / Stars / Planets / Satellites)

This file documents the **universe package** under `src/lib/universe/` — the outermost generation layer that produces a galaxy → solar system → star/planet → satellite hierarchy. The user picks "Universe generation" on the landing screen, drills into a system, picks a habitable rock planet or moon, and clicks "Generate World" to hand off to the world-map flow (`world_map.md`) with the chosen body's seed + biome locked in.

Read `CLAUDE.md` first for the framework conventions (worker boundary, RNG sub-streams, sweep stability) — the universe pipeline follows the same playbook as the world-map / world-history pipelines but lives in its own worker (`universegen.worker.ts`).

## Entity Hierarchy

```
Universe
└── Galaxy[]                  (1 if N ≤ 100; ceil(N/100) chunks otherwise)
    └── SolarSystem[]
        ├── Star[]            (1–3 per system, MATTER or ANTIMATTER)
        └── Planet[]          (orbit-ordered; ROCK inner, GAS outer)
            └── Satellite[]   (0..15, ICE or ROCK)
```

The universe entity instances live **only inside `universegen.worker.ts`** — they carry `Map<string, …>` indexes (`mapSolarSystems`, `mapStars`, `mapPlanets`, `mapSatellites`, `mapGalaxies`) that aren't structured-clone safe. The worker flattens them into plain `UniverseData` before `postMessage` (same pattern as `World` → `RegionData[]`/`ContinentData[]`). See `CLAUDE.md`'s "Worker / Main-Thread Boundary" section.

## Files

| File | Responsibility |
|------|---------------|
| `types.ts` | Plain structured-clone-safe shapes that cross the worker boundary — `UniverseData`, `GalaxyData`, `SolarSystemData`, `StarData`, `PlanetData`, `SatelliteData`, `UniverseGenerateRequest`, `UniverseWorkerMessage`. **Start here when looking up a serialized field** |
| `Universe.ts` | Top-level entity. Owns the per-tier `usedNames: Set<string>` dedup sets, the runtime indexes (`mapSolarSystems`/`mapStars`/`mapPlanets`/`mapSatellites`/`mapGalaxies`), and the captured worker `seed: string` so generators can derive isolated PRNG sub-streams via `seededPRNG(`${seed}_<purpose>_<id>`)`. Mirrors `World.seed` (see `world_history.md`). Empty-string seed is supported (sub-stream draws are still deterministic) |
| `Galaxy.ts` | Runtime galaxy entity. Carries `solarSystems: SolarSystem[]` reference list + baked layout fields (`cx`, `cy`, `radius`, `spread`). No `Map`/`Set` of its own but lives next to entities that have them, so it stays inside the worker too |
| `SolarSystem.ts` | System entity: composition (`'ROCK' \| 'GAS'`), star list, planet list, parent universe id |
| `Star.ts` | Star entity: composition (`'MATTER' \| 'ANTIMATTER'`), radius, brightness, parent system id |
| `Planet.ts` | Planet entity: composition (`'ROCK' \| 'GAS'`), 13 fine-grained subtypes (`PlanetSubtype` = `RockPlanetSubtype` ∪ `GasPlanetSubtype`), radius, orbit, life flag, optional `biome: PlanetBiome` (only for ROCK + life), satellites, parent system id. Exports the `PLANET_SUBTYPE_COMPOSITION` enforcement table — every subtype belongs to exactly one composition |
| `Satellite.ts` | Satellite entity: composition (`'ICE' \| 'ROCK'`), 10 fine-grained subtypes (`SatelliteSubtype` = `IceSatelliteSubtype` ∪ `RockSatelliteSubtype`), radius, life flag, optional biome (only for ROCK + life), parent planet id. Exports the `SATELLITE_SUBTYPE_COMPOSITION` enforcement table |
| `UniverseGenerator.ts` | Top-level orchestrator + galaxy grouping. Generates `numSolarSystems` solar systems (defaulting to `rndSize(rng, 5, 1)` when no override is supplied), then chunks them into galaxies (≤100 → 1 galaxy; >100 → `ceil(N/100)` chunks), names them, lays them out via `layoutGalaxies`, and names the universe (single galaxy → reuse galaxy name; multi-galaxy → `generateUniverseName`) |
| `SolarSystemGenerator.ts` | Per-system generator: rolls composition (50/50 ROCK/GAS), generates `rndSize(rng, 3, 1)` stars, sets the system's name from the **primary star** (no separate RNG draw), then generates `stars.length * 2 + floor(rng() * 15)` planets |
| `StarGenerator.ts` | Per-star: rolls radius (400 000–900 000), brightness (100–999), composition (50/50). Names via `generateStarName` (isolated sub-stream) |
| `PlanetGenerator.ts` | Per-planet: rolls radius (1 000–31 000), orbit (monotonic in insertion index — read **before** push), composition driven by orbit (`rockProbability`: <10 → 100% rock, >20 → 100% gas, linear in between), life flag (10%), biome (only ROCK + life, 7 weighted profiles), subtype via isolated sub-stream `${seed}_planetsubtype_${planet.id}`, then `rndSize(rng, 15, -5)` satellites |
| `SatelliteGenerator.ts` | Per-satellite: rolls radius (relative to parent planet), composition (50/50 ICE/ROCK), life (10%), biome (ROCK + life only), subtype via isolated sub-stream `${seed}_satsubtype_${satellite.id}` (parent-orbit aware: inner → volcanic/iron_rich/sulfur_ice; outer → cratered/methane_ice) |
| `galaxyLayout.ts` | Sunflower-disc + relaxation layout for multi-galaxy universes. Bakes per-galaxy `cx`, `cy`, `radius`, `spread` in **normalized world units** so the renderer can apply a single viewport-fit factor at draw time. RNG goes through `${universeSeed}_galaxy_layout` — isolated from physics streams. Also exports `computeLayoutExtent(galaxies)` for the renderer's viewport fit |
| `universeNameGenerator.ts` | Procedural names for every tier: `generateGalaxyName`, `generateUniverseName`, `generateStarName`, `generatePlanetName`, `generateSatelliteName`. Two layers per name: **scientific** (catalog-style: NGC, HD, HIP, GJ, KOI, Roman numerals) + **human** (proper names with a tier-distinct phonetic feel). Each entity gets an isolated PRNG sub-stream `${universe.seed}_<tier>name_<entityId>` — name generation never perturbs physics RNG. Per-tier dedup via the `usedNames: Set<string>` that callers pass in (lives on `Universe`) |
| `helpers.ts` | `rndSize(rng, max, min)` — uniform integer in `[min, min + max)`, clamped at 0. Mirrors the `ReferenceSizeConfig.RandomSizeConfig.rndSize(max, min)` helper from the upstream Java framework. Used everywhere in this package for child-count rolls |
| `renderer.ts` | Canvas-2D renderer with three drill-down scenes (galaxy / system / planet). Ports `galaxySpiralPositions` (2-arm logarithmic spiral system layout), `OrbitalMechanics.angularVelocity` (Kepler's 3rd law, ω ∝ r⁻¹·⁵), `StarField` (seeded LCG background), `ScaleMapper` (linear/sqrt/log domain → pixel mapping for fair size perception across orders of magnitude) verbatim from `github.com/fjcmz/procen_universe_viz`. **Background star field uses an INDEPENDENT LCG seed (`STAR_FIELD_SEED = 42`)** so the backdrop is identical regardless of universe contents — same as the reference repo |
| `hitTest.ts` | `pickHit(circles, px, py)` — picks the topmost circle whose disk contains the click point. Iterates back-to-front so later-drawn entities win ties (same convention as the reference repo's HitTester) |
| `index.ts` | Public barrel: re-exports every entity class, every generator singleton (`universeGenerator`, `solarSystemGenerator`, `starGenerator`, `planetGenerator`, `satelliteGenerator`), every type, and `rndSize` |

## Worker (`universegen.worker.ts`)

Sister of `mapgen.worker.ts`. Receives `UniverseGenerateRequest { seed, numSolarSystems }`, posts `PROGRESS` events through generation, calls `serializeUniverse(universe)` to flatten into structured-clone-safe `UniverseData`, then posts `DONE`. The progress callback in `UniverseGenerateOptions` maps `[0, 1]` generator progress onto `[15, 85]` of the bar and throttles to whole-percent steps to avoid `postMessage` spam on large counts.

The worker seeds the main RNG with `seededPRNG(seed + '_universe')` — using a `_universe` suffix on the user seed keeps the universe pipeline's draws isolated from the world-map pipeline's draws (which seed with the bare user seed). This is the same isolation discipline used by every other sub-stream in the codebase.

## Composition vs Subtype

Both `Planet` and `Satellite` carry a coarse `composition` AND a fine-grained `subtype`. The subtype enforces a single composition via the lookup tables `PLANET_SUBTYPE_COMPOSITION` and `SATELLITE_SUBTYPE_COMPOSITION` — every subtype belongs to exactly one composition; mismatches are forbidden.

Subtype rolls run on **isolated sub-streams** keyed on `(universe.seed, entity.id)`:
- `${universe.seed}_planetsubtype_${planet.id}` (in `PlanetGenerator.ts`)
- `${universe.seed}_satsubtype_${satellite.id}` (in `SatelliteGenerator.ts`)

This means **adding new subtypes does not perturb existing seeds** — a new subtype landing in `pickPlanetSubtype` only changes the output for runs that draw under the new probability bucket; every other entity in the universe stays byte-identical. Same convention as the world-map terrain profiles' "additive shifts default to 0.0 = no-op" rule (see `world_map.md`).

### Planet subtypes (13)

```
ROCK: terrestrial, desert, volcanic, lava, iron, carbon, ocean, ice_rock
GAS:  jovian, hot_jupiter, ice_giant, methane_giant, ammonia_giant
```

Roll bias (in `pickPlanetSubtype`):
- ROCK + life + biome → biome-driven map (`forest`/`default`/`swamp`/`mountains` → `terrestrial`, `ocean` → `ocean`, `desert` → `desert`, `ice` → `ice_rock`) so a "forest" world looks lush rather than getting a random subtype underneath
- ROCK + no life: orbit-banded rolls — orbit < 6 → lava-favored; orbit < 12 → desert/volcanic/iron heavy; orbit ≥ 12 → carbon / ice_rock heavy
- GAS: orbit < 12 → hot_jupiter dominant; orbit < 18 → jovian / ammonia_giant; orbit ≥ 18 → outer trio (ice_giant / methane_giant / ammonia_giant) uniform

### Satellite subtypes (10)

```
ICE:  water_ice, methane_ice, sulfur_ice, nitrogen_ice, dirty_ice
ROCK: terrestrial, cratered, volcanic, iron_rich, desert_moon
```

Roll bias (in `pickSatelliteSubtype`, parent-orbit aware):
- ROCK + life + biome === 'desert' → `desert_moon`; ROCK + life otherwise → `terrestrial`
- ROCK + no life: parentOrbit < 8 → volcanic / iron_rich / cratered (Io-like tidal heating); else uniform over `cratered, terrestrial, iron_rich, desert_moon`
- ICE: parentOrbit < 10 → water_ice / sulfur_ice / dirty_ice (inner ice sublimates / sulfur-coats); else uniform over the 5-element ice subtype set

## Galaxy Grouping

`UniverseGenerator` chunks systems into galaxies based on `MAX_SYSTEMS_PER_GALAXY = 100`:

- **N ≤ 100** — single galaxy `gal_0` wraps every system. The UI hides the galaxy level entirely and the renderer falls back to legacy single-spiral rendering (byte-identical to pre-grouping). Universe display name is reused from the single galaxy's name so existing labels ("↑ Galaxy", breadcrumb "Galaxy") still make sense.
- **N > 100** — split into `numGalaxies = ceil(N / 100)` equal sequential chunks, `groupSize = ceil(N / numGalaxies)`. Group sizes differ by at most 1.

Galaxy generation is placed **after** all physics generation in `UniverseGenerator.generate` so naming/layout RNG never perturbs any physics RNG calls.

## Galaxy Layout (`galaxyLayout.ts`)

For multi-galaxy universes, `layoutGalaxies(galaxies, universeSeed)` positions galaxies in 2D world units so pairwise nearest-neighbor center-to-center distance falls in `[5×, 10×]` of the average galaxy diameter.

Algorithm:
1. Per-galaxy `spread = sqrt(groupSize / 100)` — a half-full galaxy reads as ~0.7× the diameter of a full one.
2. `radius = 0.45 × spread` — matches the cap baked into `galaxySpiralPositions` (`b = 2.42 / (maxK × angleStep)`, outer arm reaches 0.45 × spread).
3. **Initial positions**: golden-angle sunflower disc with `r = target × √(i/π)` so nearest-neighbor distance starts close to the target separation (6× avgDiameter, mid-band of `[5, 10]`).
4. **Relaxation pass**: push pairs apart if `dist < 5×avgDiameter`. Capped at 40 iterations; the sunflower seed already satisfies the bound for typical N so the loop usually exits on iter 0.
5. **Recenter** so centroid is `(0, 0)`.

All RNG goes through `${universeSeed}_galaxy_layout` — isolated from physics streams.

`computeLayoutExtent(galaxies)` returns the maximum extent from origin (`max(|center| + radius)`), used by the renderer to compute the viewport fit factor. Accepts a structural type so both runtime `Galaxy` and serialized `GalaxyData` work.

## Naming

Every entity carries two names: `humanName` (proper / distinctive) and `scientificName` (catalog-style). Generators in `universeNameGenerator.ts`:

| Tier | Scientific | Human |
|------|-----------|-------|
| Galaxy | `NGC-XXXX` | 3-syllable composition (Andromeda / Velarion / Orysseia feel) |
| Universe | reuses galaxy name when N=1; otherwise galaxy phonetic + suffix `Cluster / Expanse / Reach / Local Group / Vault / Sea / Veil` | same |
| Star | `HD #####` / `HIP #####` / `GJ ###` / `KOI-###.##` mix | distinctive proper names |
| Planet | `<primaryStar.scientific> <RomanNumeral>` (e.g. `HD 12345 III`) | distinctive proper names |
| Satellite | `<planet.scientific>-<RomanLowercase>` | distinctive proper names |

Each entity gets an isolated PRNG sub-stream `${universe.seed}_<tier>name_<entityId>`. **Names never perturb physics RNG** — they are generated immediately after the entity's physics fields are rolled, but on a separate stream.

Per-tier dedup uses `Set<string>` instances on the `Universe` (`usedStarNames`, `usedPlanetNames`, `usedSatelliteNames`) — generators retry on collision until they find an unused name.

## Hand-off to World Map

The user can drill `galaxy → system → planet` (or `satellite`) in the universe canvas. When they click "Generate World" on a habitable rock body in `UniverseEntityPopup`, `App.tsx`'s `handleGenerateWorldFromPlanet` / `handleGenerateWorldFromSatellite` callbacks:

1. Tear down any existing world worker / `mapData` / params.
2. Compute the world seed: `${universe.seed}_${planet.id}` (or `..._${satellite.id}`) — an isolated PRNG sub-stream, same convention as `_racebias_<id>` / `_chars_<cellIndex>` (`characters.md`).
3. Pull the chosen body's `biome` (defaulting to `'default'`) and snap the world generator's params to a matching biome profile (`PROFILE_WATER_RATIOS[biome]`, `setProfileName(biome)`, `setShapeName('default')`, `setResourceRarityMode('natural')`, `setGenerateHistory(false)`) — the user still has to press "Generate Map", but the form is pre-populated.
4. Set `numCells = cellCountForPlanetRadius(planet.radius)` so bigger worlds get more cells.
5. Capture `worldOrigin: { universeSeed, systemId, systemName, planetId, planetName }` so the back button works.
6. Set `universeReturnTo = { systemId, planetId }` so when the user clicks "← Back to system" the universe canvas can navigate straight back to the planet they came from.
7. Switch screens.

This is the only piece of glue between the universe pipeline and the world-map pipeline. The two pipelines never share RNG state otherwise — the world-map worker seeds with the bare planet/satellite seed, while the universe worker seeded with `${userSeed}_universe`.

## Renderer + UI

| File | Purpose |
|------|---------|
| `renderer.ts` | Three scenes (galaxy / system / planet), Kepler-driven orbital animation, scale mapping, hit-test circles. Reference-repo helpers ported verbatim. Galaxy-scene draws solid star cores (no per-system glow) for performance; system / planet scenes still glow because they only ever render 1–3 stars at a time. `galaxySpiralPositions(count, spread)` returns local-frame coords cached as a `Float64Array` — callers add `cx, cy` and apply the spin rotation inline so the per-frame draw loop allocates nothing |
| `hitTest.ts` | Pick topmost circle under cursor (back-to-front iteration) |
| `LandingScreen.tsx` | Choose between "Planet generation" (world-map flow) and "Universe generation" (universe flow) |
| `UniverseScreen.tsx` | Top-level screen that owns the worker lifecycle + canvas state |
| `UniverseCanvas.tsx` | Canvas component; manages scene state (`'galaxy' \| 'system' \| 'planet'`), zoom/pan, drill-down navigation, and reset on new universe data |
| `UniverseOverlay.tsx` | Tabbed overlay (Generation + Tree); persists position to `localStorage` (`universe.overlay.position`) and active tab to `universe.activeTab`; mirrors the world-map `UnifiedOverlay.tsx` UX |
| `UniverseTreeTab.tsx` | Hierarchical browser of the generated universe (Galaxy → System → Star/Planet → Satellite). Single-galaxy universes hide the galaxy level by spec |
| `UniverseEntityPopup.tsx` | Detail popup for a clicked entity. Shows physics fields and (for habitable rock planets / moons) a "Generate World" button that triggers the hand-off |

## Pitfalls

- **Universe class instances stay inside `universegen.worker.ts`.** `Universe`, `Galaxy`, `SolarSystem`, `Star`, `Planet`, `Satellite` use `Map<string, …>` indexes which are NOT structured-clone safe. Same pitfall as the `World` model — flatten to `UniverseData` / `GalaxyData` / etc. before `postMessage`.
- **Subtype rolls MUST use isolated sub-streams.** `${universe.seed}_planetsubtype_${planet.id}` and `${universe.seed}_satsubtype_${satellite.id}` keep subtype additions from perturbing existing seeds. **Do NOT roll subtypes off the main `rng` parameter** — adding a subtype would shift every subsequent entity's draws.
- **Naming RNG is also isolated** (`${universe.seed}_<tier>name_<entityId>`). Same rule: never let name generation read from the main physics RNG. Generators in this package generate the entity's physics fields first, then the names — the order matters because the entity id (which is rolled from the main RNG) is part of the name sub-stream key.
- **`Star` / `Planet` / `Satellite` IDs come from `IdUtil.id` with a `rngHex(rng)` payload.** That `rngHex` call DOES draw from the main RNG (3 hex draws per id). This is intentional — the id is part of the entity's "physics" identity and seed-stable across runs of the same universe.
- **`Planet.orbit` is monotonic in insertion index** — `PlanetGenerator` reads `solarSystem.planets.length` BEFORE pushing the new planet so `orbit` increases through the planet list. Same convention for `moonIndex` in `SatelliteGenerator`. **Do NOT reorder these reads** — orbit values would scramble and the renderer's spiral / orbit animations would break.
- **Galaxy layout RNG is isolated** (`${universeSeed}_galaxy_layout`). Layout changes never perturb system / star / planet generation. If you tune layout constants (`TARGET_SEPARATION_MULT`, `MIN_SEPARATION_MULT`, `RELAX_ITERS`), only the layout output shifts; physics output stays byte-identical.
- **Single-galaxy universes (N ≤ 100) reuse the galaxy's name as the universe name.** This preserves existing UI labels ("↑ Galaxy", breadcrumb "Galaxy") that were written before galaxy grouping landed. If you change the universe-naming branch, mirror that decision in `UniverseTreeTab.tsx` (which hides the galaxy level when `N === 1`).
- **The background star field uses an INDEPENDENT LCG seed (`STAR_FIELD_SEED = 42`)** in `renderer.ts`. This is **deliberate** — the backdrop is identical across universes for visual continuity (same as the reference repo). Do NOT thread `universe.seed` into it; the star field is decorative chrome, not part of the universe's seeded content.
- **Planet / satellite biomes are only assigned when `composition === 'ROCK' && life`.** Other planets / moons have `biome === undefined`. The hand-off code in `App.tsx` falls back to `'default'` for the world-map profile when biome is undefined — keep that fallback if you ever extend biome assignment.
- **Hand-off seed format is part of the determinism contract.** `${universe.seed}_${planet.id}` (or `..._${satellite.id}`) is what the user lands on. Changing this format would break "the same universe seed always gives the same world for a given planet". Treat it like a stable interface.
- **`numSolarSystems` defaults to `rndSize(rng, 5, 1)` (1–5 systems)** for non-worker call sites and tests. The worker always passes the user's slider value. The default exists so any future test path or REPL session works without wiring an option.
- **`npm run sweep` does NOT run the universe pipeline.** The sweep harness (`scripts/sweep-history.ts`) is purely world-map / world-history. Universe-package changes can never produce a non-zero sweep diff. Conversely, a universe-package change that accidentally touches `src/lib/terrain/` or `src/lib/history/` WILL show up in the sweep — treat any non-zero diff after a universe-only change as evidence of an unintended cross-layer edit.
- **Universe package has no test suite of its own.** Verify changes by `npm run build` (catches type errors, including the `PLANET_SUBTYPE_COMPOSITION` / `SATELLITE_SUBTYPE_COMPOSITION` exhaustiveness checks that fire when a subtype is added to one table but not the other) and visual inspection in `npm run dev` → "Universe generation" on the landing screen.
