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
| `Galaxy.ts` | Runtime galaxy entity. Carries `solarSystems: SolarSystem[]` reference list + baked layout fields (`cx`, `cy`, `radius`, `spread`, `shape: 'spiral' | 'oval'`). No `Map`/`Set` of its own but lives next to entities that have them, so it stays inside the worker too |
| `SolarSystem.ts` | System entity: composition (`'ROCK' \| 'GAS'`), `kind: SystemKind` (taxonomic archetype — see "System Kinds" below), star list, planet list, parent universe id |
| `Star.ts` | Star entity: composition (`'MATTER' \| 'ANTIMATTER'`), `subtype: StarSubtype` (per-body type tag), radius, brightness, parent system id |
| `SystemKind.ts` | `SystemKind` taxonomy: 10 planetary kinds + 6 standalone (planetless) kinds. Exports `PlanetaryStarKind`, `StandaloneBodyKind`, `StarSubtype` unions and `isStandaloneKind` |
| `SystemKindInfo.ts` | `SYSTEM_KIND_INFO` metadata table — per-kind display name, description, weight, star count range, radius/brightness ranges, renderer palette, optional naming prefix. Exports `pickSystemKind` (weighted roll) and `STAR_SUBTYPE_HUE` (per-body palette table used by the renderer) |
| `Planet.ts` | Planet entity: composition (`'ROCK' \| 'GAS'`), 13 fine-grained subtypes (`PlanetSubtype` = `RockPlanetSubtype` ∪ `GasPlanetSubtype`), radius, orbit, life flag, optional `lifeLevel: LifeLevel` + `biome: PlanetBiome` (both only when life is present), satellites, parent system id. Exports the `PLANET_SUBTYPE_COMPOSITION` enforcement table — every subtype belongs to exactly one composition |
| `Satellite.ts` | Satellite entity: composition (`'ICE' \| 'ROCK'`), 10 fine-grained subtypes (`SatelliteSubtype` = `IceSatelliteSubtype` ∪ `RockSatelliteSubtype`), radius, life flag, optional `lifeLevel: LifeLevel` + biome (only when life is present), parent planet id. Exports the `SATELLITE_SUBTYPE_COMPOSITION` enforcement table |
| `UniverseGenerator.ts` | Top-level orchestrator + galaxy grouping. Generates `numSolarSystems` solar systems (defaulting to `rndSize(rng, 5, 1)` when no override is supplied), then chunks them into galaxies (≤100 → 1 galaxy; >100 → `ceil(N/100)` chunks), names them, assigns each a morphology shape (`spiral` or `oval`) via an isolated sub-stream, lays them out via `layoutGalaxies`, and names the universe (single galaxy → reuse galaxy name; multi-galaxy → `generateUniverseName`) |
| `SolarSystemGenerator.ts` | Per-system generator: rolls composition (50/50 ROCK/GAS), then rolls `SystemKind` on an isolated sub-stream (`${seed}_systemkind_${id}`) via `pickSystemKind`. Star count comes from `SYSTEM_KIND_INFO[kind].starCount` (binary forces 2, standalone forces 1). Sets the system's name from the **primary star** (no separate RNG draw); planet generation runs only when `!isStandaloneKind(kind)` (gated by the standalone vs planetary distinction) |
| `StarGenerator.ts` | Per-star: rolls radius / brightness using the `SYSTEM_KIND_INFO[subtype].radiusRange` + `brightnessRange` (same number of `rng()` draws as the legacy version), composition (50/50). `star.subtype` is set from the system kind (or, for `binary_star`, from a precomputed pair on the kind sub-stream). Names via `generateStarName(seed, id, used, kind)` — kind drives the optional catalog prefix override |
| `PlanetGenerator.ts` | Per-planet: rolls radius (1 000–31 000), orbit (monotonic in insertion index — read **before** push), composition driven by orbit (`rockProbability`: <10 → 100% rock, >20 → 100% gas, linear in between), life flag (10%), biome (only ROCK + life, 7 weighted profiles), subtype via isolated sub-stream `${seed}_planetsubtype_${planet.id}`, then `rndSize(rng, 15, -5)` satellites |
| `SatelliteGenerator.ts` | Per-satellite: rolls radius (relative to parent planet), composition (50/50 ICE/ROCK), life (10%), biome (ROCK + life only), subtype via isolated sub-stream `${seed}_satsubtype_${satellite.id}` (parent-orbit aware: inner → volcanic/iron_rich/sulfur_ice; outer → cratered/methane_ice) |
| `UniverseHistoryGenerator.ts` | Optional `numSteps`-step timeline simulation (each step = 1 million years). For every habitable body, rolls the existing 0.005%/step spawn chance for life on `${seed}_universe_life_${bodyId}` and the 0.07%/step advancement chance on `${seed}_lifeevolution_${bodyId}`. Emits `LIFE_APPEARED` (always unicellular) + `LIFE_ADVANCED` events and mutates the body's `life` / `lifeLevel` / `biome` / `subtype` so the serializer downstream sees end-of-time values |
| `habitability.ts` | Habitable-zone gate (orbit ∈ [6, 14], ROCK composition) + `getLifeLevelAtStep(bodyId, staticLevel, step, history)` lookup that walks `lifeAdvancesByBody[bodyId]` to return the body's biosphere stage at any step |
| `galaxyLayout.ts` | Random rejection-sampling layout for multi-galaxy universes. Bakes per-galaxy `cx`, `cy`, `radius`, `spread` in **normalized world units** so the renderer can apply a single viewport-fit factor at draw time. Enforces a minimum centre-to-centre distance of `MIN_CENTER_DIST = 10` world units; container radius scales as `10 × √N` so density stays roughly constant as galaxy count grows. RNG goes through `${universeSeed}_galaxy_layout` — isolated from physics streams. Also exports `computeLayoutExtent(galaxies)` for the renderer's viewport fit |
| `universeNameGenerator.ts` | Procedural names for every tier: `generateGalaxyName`, `generateUniverseName`, `generateStarName`, `generatePlanetName`, `generateSatelliteName`. Two layers per name: **scientific** (catalog-style: NGC, HD, HIP, GJ, KOI, Roman numerals) + **human** (proper names with a tier-distinct phonetic feel). Each entity gets an isolated PRNG sub-stream `${universe.seed}_<tier>name_<entityId>` — name generation never perturbs physics RNG. Per-tier dedup via the `usedNames: Set<string>` that callers pass in (lives on `Universe`) |
| `helpers.ts` | `rndSize(rng, max, min)` — uniform integer in `[min, min + max)`, clamped at 0. Mirrors the `ReferenceSizeConfig.RandomSizeConfig.rndSize(max, min)` helper from the upstream Java framework. Used everywhere in this package for child-count rolls |
| `renderer.ts` | Canvas-2D renderer with three drill-down scenes (galaxy / system / planet). Ports `OrbitalMechanics.angularVelocity` (Kepler's 3rd law, ω ∝ r⁻¹·⁵), `StarField` (seeded LCG background), `ScaleMapper` (linear/sqrt/log domain → pixel mapping for fair size perception across orders of magnitude) verbatim from `github.com/fjcmz/procen_universe_viz`. Also contains `galaxySpiralPositions` (2-arm log-spiral with central cluster) and `galaxyOvalPositions` (elliptical, linear density falloff). **Background star field uses an INDEPENDENT LCG seed (`STAR_FIELD_SEED = 42`)** so the backdrop is identical regardless of universe contents — same as the reference repo |
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

## System Kinds

Every `SolarSystem` carries a `kind: SystemKind` rolled on an isolated sub-stream `${universe.seed}_systemkind_${solarSystem.id}` so kind rolls never perturb the main physics RNG for the *kind decision itself*. (Standalone kinds still skip planet generation, which shifts the main RNG's downstream draws — universe seeds may therefore land on a different set of bodies than before this feature shipped. The universe pipeline is not covered by the sweep harness, so this is acceptable.)

**Planetary kinds (10)** — host planets:

```
main_sequence, red_dwarf, blue_giant, red_giant, white_dwarf, brown_dwarf,
neutron_star, pulsar, binary_star, stellar_black_hole
```

`binary_star` is the only kind with `starCount === 2`; both component subtypes are rolled on the kind sub-stream so the main RNG draws stay identical to single-star kinds. Other planetary kinds use `[1, n]` ranges (most are `[1, 1]` for compact remnants).

**Standalone kinds (6)** — no planets, single central body:

```
supermassive_black_hole, white_hole, magnetar, quark_star, boson_star, quasar
```

`isStandaloneKind(kind)` returns true for these six. The `SolarSystemGenerator` skips the entire planet-generation loop when this returns true. The "Generate World" affordance in the popup is structurally unreachable for standalone systems because it only renders on planet/satellite popups, which don't exist for them.

Each `Star.subtype` equals the system kind (for binaries, each star gets one of the regular planetary subtypes — main_sequence, red_dwarf, white_dwarf, etc.). The renderer's `starFill` branches on `Star.subtype` first (with antimatter overriding everything for backwards visual compatibility); exotic subtypes (`stellar_black_hole`, `supermassive_black_hole`, `pulsar`, `white_hole`, `magnetar`, `quasar`, `quark_star`, `boson_star`) use dedicated `drawStarBody` helpers in `renderer.ts` instead of the cached glow-canvas + solid-core path.

Catalog prefixes (`SYSTEM_KIND_INFO[kind].namingPrefix`) override the random HD/HIP/GJ/KOI catalog roll for exotic kinds — pulsars become `PSR-XXXX`, supermassive black holes `SMBH-XXXX`, magnetars `MGT-XXXX`, etc. The prefix override draws from the same `${seed}_starname_${star.id}` sub-stream as the rest of star naming, so kinds without a prefix produce byte-identical names to before.

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

Galaxy generation is placed **after** all physics generation in `UniverseGenerator.generate` so naming/layout/shape RNG never perturbs any physics RNG calls.

Each galaxy is assigned a **morphology shape** (`'spiral'` or `'oval'`) determined by an isolated sub-stream `seededPRNG(`${seed}_galaxy_shape_${i}`)()` — 50/50 probability. The shape is stored on `Galaxy.shape` and serialized into `GalaxyData.shape`. It is the only generator-time decision that affects visual layout rather than physics.

## Galaxy Layout (`galaxyLayout.ts`)

For multi-galaxy universes, `layoutGalaxies(galaxies, universeSeed)` positions galaxies in 2D world units with a random appearance and minimum centre-to-centre separation of `MIN_CENTER_DIST = 10` world units.

Algorithm:
1. Per-galaxy `spread = sqrt(groupSize / 100)` — a half-full galaxy reads as ~0.7× the diameter of a full one.
2. `radius = 0.45 × spread` — sized to contain a spiral galaxy's outermost arm (baked into `galaxySpiralPositions`: `b = 2.42 / (maxK × angleStep)`, outer arm reaches ~0.45 × spread). Oval galaxies use `maxR = spread × 0.3` so they sit comfortably inside the same bounding circle.
3. **Random placement** via rejection sampling inside a disc of radius `max(10, 10 × √N)`. For each new galaxy up to `PLACEMENT_ATTEMPTS = 800` random positions are tried; a position is accepted only if it is ≥ 10 world units from every already-placed galaxy. This produces an irregular, non-patterned layout (replacing the earlier sunflower/phyllotaxis spiral). The `√N` scaling keeps average nearest-neighbour spacing roughly constant (~15–30 world units) as galaxy count grows.
4. **Fallback**: if all attempts fail, the galaxy is placed just outside the cluster boundary at a random angle so the minimum separation guarantee is always met.
5. **Recenter** so centroid is `(0, 0)`.

All RNG goes through `${universeSeed}_galaxy_layout` — isolated from physics streams.

`computeLayoutExtent(galaxies)` returns the maximum extent from origin (`max(|center| + radius)`), used by the renderer to compute the viewport fit factor. Accepts a structural type so both runtime `Galaxy` and serialized `GalaxyData` work.

## Galaxy Shapes

Each galaxy has a `shape: 'spiral' | 'oval'` field baked at generation time. The renderer dispatches to a different layout function based on this field.

### Spiral (`galaxySpiralPositions`)

- **Central cluster (~15%)**: systems placed with sin-based pseudo-random angle and CDF-biased radius (`r/R = 1 − √(1−u)`) in a small nucleus. Radius cap is ~80% of the first arm step's radial distance.
- **Two arms (~85%)**: 2-arm logarithmic spiral (`r = a·eᵇθ · spread/200`, `a = 8`, adaptive `b = min(0.18, 2.42 / (maxK·angleStep))`). Systems alternate between arms every other index. Jitter is applied **perpendicular to the arm tangent** only (arm width ≈ 6% of radius, with a small absolute floor for innermost points), plus a tiny along-arm angle wobble (`0.012 rad`). This keeps the two arms tight and visually distinct.

### Oval (`galaxyOvalPositions`)

- All systems distributed inside an ellipse using **independent** sin-based pseudo-random values for angle (`sin(i·127.1 + 311.7)`) and radius (`sin(i·269.5 + 183.3)`). Independent sources avoid the spiral-arm artefacts produced by sequential quasi-random sequences (e.g. the golden angle).
- Radius uses the same CDF inverse (`r/R = 1 − √(1−u)`) so density falls off linearly from centre to edge.
- Per-galaxy ellipse aspect ratio in `[1.4, 2.2]` derived from `hashId(galaxyId) & 0xfff` — each oval galaxy has a distinct shape.
- `maxR = spread × 0.3`.

### Layout cache (`getOrBuildLayout`)

`rawPositions` and star-radius stats are cached in `spiralLayoutCache` (cap `SPIRAL_CACHE_MAX = 10`, FIFO eviction). Cache key: `"${shape}|${galaxyId}|${count}|${cx}|${cy}|${spread}"`. The shape and galaxyId are included because oval positions depend on aspect-ratio derived from the galaxy id, and the two layout functions produce different point clouds for the same `(count, cx, cy, spread)`.

Both layout functions are only ever called through `getOrBuildLayout` — bypassing the cache reintroduces O(N) `Math.sin`/`Math.exp` calls per frame.

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

## Universe History (life evolution)

The universe pipeline can optionally run a per-body timeline simulation after generation, gated by `UniverseGenerateRequest.generateHistory`. Each step represents 1 million years and the default range is 1–5000 steps. The simulation is owned by `UniverseHistoryGenerator.ts` and produces a `UniverseHistoryData` attached to the serialized payload as `UniverseData.history`.

**Five-stage life ladder** (`LifeLevel` in `types.ts`):

```
unicellular → vegetation → small_animals → large_animals → intelligent_animals
```

Life always starts at `unicellular`. Each subsequent stage requires a successful 0.07%/step roll (`LIFE_ADVANCE_CHANCE_PER_STEP`).

**Two PRNG sub-streams per body** — kept separate so adding the evolution layer didn't shift the earlier spawn timings:

| Sub-stream | Purpose |
|------------|---------|
| `${seed}_universe_life_${bodyId}` | First-appearance roll (0.005%/step) **and** the biome / subtype pick on success |
| `${seed}_lifeevolution_${bodyId}` | Per-step advancement roll (0.07%) once life exists and the body is below `intelligent_animals` |

**Events** — `UniverseHistoryEvent` is a discriminated union:

- `LIFE_APPEARED { step, bodyKind, bodyId, level: 'unicellular' }` — first appearance.
- `LIFE_ADVANCED { step, bodyKind, bodyId, fromLevel, toLevel }` — one tier up the ladder.

Events are recorded per body in chronological order, then sorted globally by step (stable sort preserves planet-before-its-moons grouping on ties).

**Per-body progression** — `UniverseHistoryData.lifeAdvancesByBody[bodyId]` is the ordered list of `(step, level)` entries (first entry is always the unicellular spawn, at most 5 entries total). `getLifeLevelAtStep` does a linear walk to find the latest level ≤ `step`.

**Static (no-history) mode** — when `generateHistory: false`, `PlanetGenerator` / `SatelliteGenerator` still roll the 10% life flag. On success they seed the body with `lifeLevel = 'intelligent_animals'` so the world-history hand-off (gated on intelligent animals) remains reachable without enabling the timeline.

**Renderer marker** — bodies that have reached `intelligent_animals` get **two concentric green rings** drawn around them by `drawIntelligentLifeRings` in `renderer.ts`. The marker is applied in both `drawSystemScene` (orbit-view planet disks) and `drawPlanetScene` (hero planet + its satellite disks). The renderer accepts a `liveLifeLevels: Map<string, LifeLevel>` lookup built once per (history, step) change in `UniverseScreen` — null/undefined falls back to the body's static `lifeLevel`.

## Civilisation Expansion (Mode A)

Once a body crosses to `intelligent_animals`, the universe-history simulation can spawn a **civilisation** rooted on that body. Civilisations then attempt yearly expansion across the universe via three mechanics: **outposts** on lifeless bodies, **colonies** on habitable bodies that don't yet carry intelligent life, and **terraforming** of lifeless rock/ice bodies. Mode A: civs are lightweight aggregates (no tech state, no inter-civ politics).

**Files**:

| File | Purpose |
|------|---------|
| `CivilisationGenerator.ts` | Founding gate + per-civ expansion loop + terraform completion. Holds the per-step `CivContext` mutated by `UniverseHistoryGenerator` |
| `civNames.ts` | Per-flavor name pools (`hardSF`, `spaceOpera`, `fantasy`); flavor is rolled per civ so each universe is heterogeneous |
| `civColors.ts` | Fixed 24-entry palette; civs are coloured by `civilisations.length` at founding time — no RNG draw |
| `expansion.ts` | Reach algorithm + target-selection: held-galaxy systems plus wormhole-partner-galaxy systems, weighted inverse-distance with in-galaxy bias 1.0 / cross-galaxy 0.4 |

**Loop refactor in `UniverseHistoryGenerator`**: outer loop is now per-step, inner passes are (1) per-body life rolls, (2) civ-founding, (3) per-civ expansion, (4) terraform completion. Each habitable body's PRNG sub-streams are cached so the per-body life-roll draw order is unchanged — seeds with zero civ activity stay byte-identical to the pre-feature output.

**Five new sub-streams**:

| Sub-stream | Purpose |
|------------|---------|
| `${seed}_civorigin_${bodyId}` | Per-step founding gate (0.5%/step) once a body is at `intelligent_animals` |
| `${seed}_civflavor_${civId}` | Pick hardSF / spaceOpera / fantasy |
| `${seed}_civname_${civId}` | Name draw (3 templates per flavor) |
| `${seed}_civexpand_${civId}` | Per-step expansion attempt (1%/step) + bucket roll + target weighting |
| `${seed}_terraform_${bodyId}` | Completion-step jitter (±5) + post-flip biome pick |

**Bucket weights** (in `CivilisationGenerator.ts`):

- `outpost` 0.5 — any lifeless body, any composition (gas giants count — atmospheric extraction)
- `colonise` 0.3 — habitable-zone body without intelligent life, no civ origin, no current occupier
- `terraform` 0.2 — lifeless ROCK or ICE body; gas giants excluded (no surface). Duration 20 steps ±5. Body flips at `completeStep` to `'unicellular'` with a habitable biome + ROCK composition, then climbs the regular life ladder via its existing `_lifeevolution_<id>` stream.

**Five new events** in the discriminated `UniverseHistoryEvent` union: `CIV_FOUNDED`, `OUTPOST_ESTABLISHED`, `COLONY_FOUNDED`, `TERRAFORM_STARTED`, `TERRAFORM_COMPLETED`. The events tab in `UniverseOverlay` renders each with its own icon + flavor copy.

**Three new fields on `UniverseHistoryData`** — all crossed over `postMessage`:

- `civilisations: CivilisationData[]` — `{ id, name, flavor, originBodyId, originBodyKind, foundedStep, color }`
- `occupancyByBody: Record<string, BodyOccupancyEntry[]>` — chronological per body; the popup's status row picks the latest entry at the selected step
- `terraforms: TerraformResult[]` — each record preserves the pre-terraform biome / subtype / composition so scrubbing back before completion can render the body's original visual via `getBodyStateAtStep`

**World-map hand-off**: `App.tsx`'s `handleGenerateWorldFromPlanet` / `..FromSatellite` now read body state via `getBodyStateAtStep` (in `habitability.ts`) before invoking `planetToGenSpec` / `satelliteToGenSpec`. At post-terraform steps, the world-map worker sees the new habitable biome + composition; at pre-completion steps it sees the original lifeless state.

**Safety cap** `MAX_CIVS_PER_UNIVERSE = 50` prevents pathological saturation in 10k-system universes. Civs that hit the cap simply don't roll the founding gate; remaining sub-stream draws still happen so byte-stability for the SAME seed is preserved across re-runs.

## Hand-off to World Map

The user can drill `galaxy → system → planet` (or `satellite`) in the universe canvas. The popup's "Generate World" button is enabled for every planet / satellite, but **civilizational history only unlocks when the body's life level at the selected timeline step is `'intelligent_animals'`** (gated by `planetToGenSpec` / `satelliteToGenSpec` in `bodyToProfile.ts` via `disableHistory: !intelligent`). Bodies with primitive life (unicellular / vegetation / small / large animals) still generate a terrain map with the biome palette intact — just without the 5000-year history sim.

When the user clicks "Generate World", `App.tsx`'s `handleGenerateWorldFromPlanet` / `handleGenerateWorldFromSatellite` callbacks:

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
| `renderer.ts` | Three scenes (galaxy / system / planet), Kepler-driven orbital animation, scale mapping, hit-test circles. Reference-repo helpers ported verbatim. See **Renderer internals** below |
| `hitTest.ts` | Pick topmost circle under cursor (back-to-front iteration) |
| `LandingScreen.tsx` | Choose between "Planet generation" (world-map flow) and "Universe generation" (universe flow) |
| `UniverseScreen.tsx` | Top-level screen that owns the worker lifecycle + canvas state. `DEFAULT_SOLAR_SYSTEMS = 500` (lowest preset button) |
| `UniverseCanvas.tsx` | Canvas component; manages scene state (`'galaxy' \| 'system' \| 'planet'`), zoom/pan (`MIN_SCALE = 0.15`, `MAX_SCALE = 2000`), drill-down navigation, reset on new data. Computes `ViewBounds` each frame from `{scale, tx, ty}` and passes it to `drawGalaxyScene` for frustum culling. Hit circles from the renderer are mapped back to screen space via `transformHit` |
| `UniverseOverlay.tsx` | Tabbed overlay (Generation + Tree); persists position to `localStorage` (`universe.overlay.position`) and active tab to `universe.activeTab`; mirrors the world-map `UnifiedOverlay.tsx` UX. Solar-system count presets: `SYSTEM_OPTIONS = [500, 1000, 5000, 10000]`; slider max = 10 000 |
| `UniverseTreeTab.tsx` | Hierarchical browser of the generated universe (Galaxy → System → Star/Planet → Satellite). Single-galaxy universes hide the galaxy level by spec |
| `UniverseEntityPopup.tsx` | Detail popup for a clicked entity. Shows physics fields and (for habitable rock planets / moons) a "Generate World" button that triggers the hand-off |

### Renderer internals (`renderer.ts`)

**Galaxy scene — `drawGalaxySpiral`**

Dispatches to `galaxySpiralPositions` or `galaxyOvalPositions` based on `galaxy.shape` (via `getOrBuildLayout`), then applies a full-galaxy rigid-body rotation at `GALAXY_SPIN_SPEED = 0.018 rad/s` (≈ 5.8 min per revolution). Each in-view system renders as a cached glow stamp (`ctx.drawImage`) + a solid core circle (`drawCircle`). `starFill` returns `{ core, glowInner, glowOuter }`.

The function takes `shape` and `galaxyId` parameters alongside the existing geometry arguments. All three `drawGalaxyScene` code paths (legacy single-galaxy, focus mode, multi-galaxy) pass these through.

**Star glow cache — `getOrBuildGlowCanvas`**

Each unique star color gets a 64×64 `HTMLCanvasElement` with the radial gradient pre-rendered once (`createRadialGradient` called once per color, not per frame). Subsequent frames stamp it via `ctx.drawImage` — a cheap GPU blit. The cache is a module-level `Map<string, HTMLCanvasElement>` keyed by `glowInner` color. Outer glow radius = `sizePx * GLOW_OUTER_MULT` (`1.1` — half the original `2.2`).

**Galaxy layout cache — `getOrBuildLayout`**

`rawPositions` (computed by `galaxySpiralPositions` or `galaxyOvalPositions`) and `maxStarRadii / minR / maxR` are cached in a module-level `Map<string, GalaxyLayout>` (cap `SPIRAL_CACHE_MAX = 10`, FIFO eviction) keyed by `"${shape}|${galaxyId}|${count}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}"`. The rotation is inlined per-iteration in the draw loop rather than `.map()`-ing an intermediate `positions[]` array.

**O(1) system lookup — `systemById`**

Focus mode and multi-galaxy mode previously rebuilt the per-galaxy `systems` array each frame using `data.solarSystems.find(s => s.id === id)` — O(N) per lookup, O(N²) overall at large counts. `drawGalaxyScene` now builds `Map<string, SolarSystemData>` once per call from `data.solarSystems` and uses `systemById.get(id)` (O(1)) for all galaxy system lookups.

**Per-system cull pipeline in `drawGalaxySpiral`**

For each system, work is gated behind three checks in cheapest-first order:

1. **Distance pre-cull** (no trig): `dx² + dy²` of the raw (pre-rotation) position vs `maxViewDistSq`. Rotation is a rigid-body transform so distance from centre is invariant — systems too far away are skipped before any trig runs.
2. **Inline rotation**: `px = cx + dx*cosG - dy*sinG` — only computed for systems that pass step 1.
3. **Viewport bounds check**: `circleIntersectsViewBounds(px, py, cullMargin, viewBounds)` using a conservative `maxSizePx = 14 * cameraScale / viewScale` margin (upper bound of `scaleMap`'s output range).

`scaleMap` (which calls `Math.sqrt`) and all draw calls are deferred until after step 3. Hit circles are only pushed for systems that pass all three checks.

**Frustum culling — `ViewBounds`**

`UniverseCanvas` derives `ViewBounds` (content-space AABB) from the current `{scale, tx, ty}` transform:

```
x0 = -tx / scale,  x1 = (vw - tx) / scale
y0 = -ty / scale,  y1 = (vh - ty) / scale
```

This is passed through `drawGalaxyScene` → `drawGalaxySpiral`. Galaxy glyphs in the multi-galaxy view are also culled when their bounding circle falls outside `ViewBounds`. At the identity transform `{scale:1, tx:0, ty:0}` bounds equal the canvas dimensions and nothing is culled.

**Multi-galaxy LOD**

Galaxy glyphs (20 low-res spiral dots + outline ring) cross-fade with the full embedded spiral: `LOD_BLEND_START = 50 px` on-screen radius → glyph only; `LOD_BLEND_END = 110 px` → full spiral; smoothstep blend in between.

**System scene**

Single star: solid circle at canvas center. Multi-star binary: stars orbit a tight cluster at `STAR_ORBIT_SPEED = 0.08 rad/s`. Planets follow Kepler ω ∝ r⁻¹·⁵ (`PLANET_K = 0.5`). Satellites orbit the planet at fixed ring spacing (`SAT_BASE_ORBIT = 90`, `SAT_ORBIT_STEP = 44`, `SAT_K = 0.8`).

## Pitfalls

- **Universe class instances stay inside `universegen.worker.ts`.** `Universe`, `Galaxy`, `SolarSystem`, `Star`, `Planet`, `Satellite` use `Map<string, …>` indexes which are NOT structured-clone safe. Same pitfall as the `World` model — flatten to `UniverseData` / `GalaxyData` / etc. before `postMessage`.
- **Subtype rolls MUST use isolated sub-streams.** `${universe.seed}_planetsubtype_${planet.id}` and `${universe.seed}_satsubtype_${satellite.id}` keep subtype additions from perturbing existing seeds. **Do NOT roll subtypes off the main `rng` parameter** — adding a subtype would shift every subsequent entity's draws.
- **System kind is rolled on `${universe.seed}_systemkind_${solarSystem.id}` (isolated).** For `binary_star`, both component subtypes are also rolled from this same sub-stream so the main RNG draws stay identical across kinds. The only deliberate exception: standalone kinds skip the entire planet-generation block, which changes which `rng()` draws subsequent systems consume. Universe seeds may therefore land on a different set of bodies than before this feature shipped — the universe pipeline is not sweep-locked, so this is acceptable.
- **Standalone kinds have no planets.** `isStandaloneKind(kind)` is the gate. The "Generate World" affordance lives on planet/satellite popups only, so it is structurally unreachable for standalone systems. Don't add a separate guard at the system level — keep the empty-planets invariant the single source of truth.
- **Naming RNG is also isolated** (`${universe.seed}_<tier>name_<entityId>`). Same rule: never let name generation read from the main physics RNG. Generators in this package generate the entity's physics fields first, then the names — the order matters because the entity id (which is rolled from the main RNG) is part of the name sub-stream key.
- **`Star` / `Planet` / `Satellite` IDs come from `IdUtil.id` with a `rngHex(rng)` payload.** That `rngHex` call DOES draw from the main RNG (3 hex draws per id). This is intentional — the id is part of the entity's "physics" identity and seed-stable across runs of the same universe.
- **`Planet.orbit` is monotonic in insertion index** — `PlanetGenerator` reads `solarSystem.planets.length` BEFORE pushing the new planet so `orbit` increases through the planet list. Same convention for `moonIndex` in `SatelliteGenerator`. **Do NOT reorder these reads** — orbit values would scramble and the renderer's spiral / orbit animations would break.
- **Galaxy layout RNG is isolated** (`${universeSeed}_galaxy_layout`). Layout changes never perturb system / star / planet generation. If you tune layout constants (`MIN_CENTER_DIST`, `PLACEMENT_ATTEMPTS`), only the layout output shifts; physics output stays byte-identical.
- **Single-galaxy universes (N ≤ 100) reuse the galaxy's name as the universe name.** This preserves existing UI labels ("↑ Galaxy", breadcrumb "Galaxy") that were written before galaxy grouping landed. If you change the universe-naming branch, mirror that decision in `UniverseTreeTab.tsx` (which hides the galaxy level when `N === 1`).
- **The background star field uses an INDEPENDENT LCG seed (`STAR_FIELD_SEED = 42`)** in `renderer.ts`. This is **deliberate** — the backdrop is identical across universes for visual continuity (same as the reference repo). Do NOT thread `universe.seed` into it; the star field is decorative chrome, not part of the universe's seeded content.
- **Planet / satellite biomes are only assigned when `composition === 'ROCK' && life`.** Other planets / moons have `biome === undefined`. The hand-off code in `App.tsx` falls back to `'default'` for the world-map profile when biome is undefined — keep that fallback if you ever extend biome assignment.
- **`lifeLevel` is present iff `life === true`.** Both fields are serialized; keep them in lockstep. The world-history hand-off is gated on `lifeLevel === 'intelligent_animals'` (in `bodyToProfile.ts`), NOT on `life` alone — primitive life biomes render terrain but skip civilizations.
- **Life evolution rolls use TWO isolated sub-streams per body.** `${seed}_universe_life_${bodyId}` is the legacy spawn roll (also feeds biome + subtype on success); `${seed}_lifeevolution_${bodyId}` is the new advancement roll. Keep them separate — collapsing them would shift spawn timings for every pre-existing seed. If you add a third life-related roll, give it its own sub-stream too.
- **Civ expansion rolls use FIVE more isolated sub-streams per civ / per body.** `${seed}_civorigin_${bodyId}` is the founding gate; `${seed}_civflavor_${civId}` / `${seed}_civname_${civId}` / `${seed}_civexpand_${civId}` are per-civ; `${seed}_terraform_${bodyId}` is per terraforming operation. Seeds that never reach `intelligent_animals` consume zero draws on any of these — pre-feature output stays byte-identical. If you add a new civ-driven behaviour, route it through its own sub-stream or be a no-op when no civ exists.
- **Terraform completion mutates the runtime `Planet` / `Satellite` instance.** At `completeStep`, `composition` flips to `'ROCK'`, `subtype` to the new ROCK subtype, `biome` to the picked habitable biome, `life = true`, `lifeLevel = 'unicellular'`. The pre-terraform fields are preserved on the `TerraformResult` record so the popup + world-map hand-off can render the body at any step via `getBodyStateAtStep`. Do NOT mutate body fields anywhere else — the runtime entity is the single source of truth for end-of-time state.
- **Universe-history loop is per-step outer, per-body inner.** This is a reversal from the pre-civ version (per-body outer, per-step inner). Each body's life-roll PRNG sub-streams are cached so cross-body interleaving doesn't perturb per-body draw order. If you add another per-step pass, keep it inside the step loop and use new sub-streams; don't restructure to a per-body outer loop because civ behaviour needs to read "what's claimed at step T" from the shared occupancy index.
- **Static (no-history) life rolls always seed `lifeLevel = 'intelligent_animals'`.** Don't change this without updating the world-history gate — static-mode universes assume "any life-bearing body is generatable." If you want static mode to expose primitive biospheres, gate the popup differently or give static life a weighted level roll.
- **Hand-off seed format is part of the determinism contract.** `${universe.seed}_${planet.id}` (or `..._${satellite.id}`) is what the user lands on. Changing this format would break "the same universe seed always gives the same world for a given planet". Treat it like a stable interface.
- **`numSolarSystems` defaults to `rndSize(rng, 5, 1)` (1–5 systems)** for non-worker call sites and tests. The worker always passes the user's slider value. The default exists so any future test path or REPL session works without wiring an option.
- **Do NOT call `galaxySpiralPositions` or `galaxyOvalPositions` outside `getOrBuildLayout`.** Both call `Math.exp` / `Math.sin` per system — at 10 000 systems this is significant. `getOrBuildLayout` caches the result; bypassing it reintroduces an O(N) cost every animation frame.
- **Do NOT allocate a `positions[]` array per frame.** The rotation is intentionally inlined in the draw loop (`px = cx + dx*cosG - dy*sinG`) to avoid a 10 000-object allocation + GC hit every tick. Keep it that way.
- **Do NOT push hit circles before the cull check.** Offscreen systems cannot be clicked; accumulating hit circles for them wastes memory and GC budget at large system counts. The hit push must stay after the viewport bounds check (step 3 of the cull pipeline).
- **Do NOT call `ctx.createRadialGradient` per visible system per frame.** The glow is rendered via `ctx.drawImage` from a pre-built offscreen canvas cached in `glowCanvasCache`. Adding a new per-frame `createRadialGradient` call would reintroduce the GPU state cost that made large universes slow. New glow variants must go through `getOrBuildGlowCanvas`.
- **Do NOT use `data.solarSystems.find()` inside the per-galaxy or per-frame draw loop.** That is O(N) per lookup; at 10k systems it becomes O(N²) per frame. Use the `systemById` Map built once per `drawGalaxyScene` call.
- **`npm run sweep` does NOT run the universe pipeline.** The sweep harness (`scripts/sweep-history.ts`) is purely world-map / world-history. Universe-package changes can never produce a non-zero sweep diff. Conversely, a universe-package change that accidentally touches `src/lib/terrain/` or `src/lib/history/` WILL show up in the sweep — treat any non-zero diff after a universe-only change as evidence of an unintended cross-layer edit.
- **Universe package has no test suite of its own.** Verify changes by `npm run build` (catches type errors, including the `PLANET_SUBTYPE_COMPOSITION` / `SATELLITE_SUBTYPE_COMPOSITION` exhaustiveness checks that fire when a subtype is added to one table but not the other) and visual inspection in `npm run dev` → "Universe generation" on the landing screen.
