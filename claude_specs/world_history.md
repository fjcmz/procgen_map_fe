# World History (Civilizational Simulation)

This file documents the **history simulation** — the optional 5000-year civilizational pipeline that layers cities, countries, religions, wars, technology, and empires on top of the physical world. Read `universe_map.md` for the framework conventions and `world_map.md` for the terrain layer this builds on.

History is **opt-in** via `GenerateRequest.generateHistory`. When disabled, the pipeline ends after `buildPhysicalWorld` — no kingdom simulation, no roads, no timeline data.

## Pipeline Overview

```
buildPhysicalWorld  →  TimelineGenerator (5000 years via YearGenerator)  →  serialize → HistoryData
       ↓                          ↓
  World + Continents     12 Phase 5 generators per year:
  + Regions + Resources  Foundation → Contact → Country → Illustrate → Religion
  + Cities                → Trade → Wonder → Cataclysm → War → Tech → Conquer → Empire
                                    ↓
                              roads (A* between cities)
```

The orchestrator is `HistoryGenerator` (Phase 6) in `src/lib/history/HistoryGenerator.ts`. The worker calls `historyGenerator.generate()` when `generateHistory = true`. The old `generateHistory()` function in `history.ts` is preserved for backward compatibility but the worker uses Phase 6.

## Physical World (always runs)

`buildPhysicalWorld(cells, width, rng, rarityWeights, seed)` in `history/history.ts` runs unconditionally before history. It uses Phase 3 generator classes internally:

1. **Continents**: BFS flood-fill on connected land cells; groups ≥10 cells form a `Continent` (via `continentGenerator`).
2. **Regions**: each continent subdivided into ~30-cell clusters via multi-source BFS seeding. Each gets a `RegionBiome` derived from its dominant Voronoi biome (via `regionGenerator`). Geographic adjacency wired with `regionGenerator.assignNeighbours` (symmetric cell-geometry adjacency); `regionGenerator.updatePotentialNeighbours` computes BFS-layered `potentialNeighbours` (distance graph).
3. **Resources**: 1–10 `Resource` entities per region, weighted-random type (17 types: strategic/agricultural/luxury) via `resourceGenerator`. Each rolls `10d10+20` for `original`. Trade constants `TRADE_MIN=10`, `TRADE_USE=5`.
4. **Cities**: 1–5 `CityEntity` objects per region placed on highest-scoring terrain cells via climate-aware `scoreCellForCity`, via `cityGenerator`. Names from `generateCityName()` in `nameGenerator.ts` (syllable combinator, 1000+ unique names with `Set<string>` dedup, 2–3 syllables, optional fantasy suffixes).

`scoreCellForCity` boosts:
- River cells (tiered by flow: >4 / 15 / 40)
- River mouths (coast + river)
- Natural harbors (coastal cells with ≥4 land neighbors)

And penalizes extreme biomes (tundra -5, desert -4, bare/scorched -3, temperate desert/marsh -2) with mitigation from rivers (-2) and coast (-1) so harsh-biome cities still appear near water features.

The `World`/`Continent`/`Region`/`CityEntity`/`Resource` class instances live **only inside the worker** (Map/Set are not structured-clone safe). The worker serializes them into plain `RegionData[]` / `ContinentData[]` for `MapData`. `CityEntity` (rich simulation entity) is distinct from the lightweight render-type `City` in `types.ts`.

## Timeline Model

`Timeline` and `Year` (in `history/timeline/`) form the temporal simulation layer (Phase 4). `TimelineGenerator` creates a `Timeline` anchored at a random start year (`[-3000, -1001]`) and generates 5000 `Year` records via `YearGenerator`.

Each `Year` holds 12 typed event collections populated by Phase 5 generators: `foundations`, `contacts`, `countries`, `illustrates`, `wonders`, `religions`, `trades`, `cataclysms`, `wars`, `techs`, `conquers`, `empires`.

### YearGenerator: 9 preprocessing steps

1. Abort if `world.endedBy` is set.
2. Compute absolute year from `timeline.startOfTime + years.length`.
3. Sum `worldPopulation` from usable cities (before growth).
4. Grow each usable city's population using `REGION_BIOME_GROWTH` biome multipliers. Phase 1 tech effects: `energy` multiplies `growth`'s effective level (carrying capacity, capped energy ≤10 → max ×1.5). **Phase 4 tuning**: per-level coefficient `0.15 → 0.12` (offsets the energy ×1.5 stacking).
5. Kill/retire illustrates (natural death when `birthYear + yearsActive <= currentYear`; 15% war-related death chance if origin city's country is at war).
6. **Propagate religions** (per-(city × religion) drift, see Religion section below).
7. End expired wars (`started + lasts < currentYear`); clear `atWar` flags.
8. Reassert `atWar` flags for active wars.
9. Recompute `region.hasResources` via `updateHasResources()`.

### YearGenerator: 12 Phase 5 generators (in order)

`Foundation → Contact → Country → Illustrate → Religion → Trade → Wonder → Cataclysm → War → Tech → Conquer → Empire`

Each Phase 5 file in `src/lib/history/timeline/` exports an entity interface + a generator singleton. Each generator produces 0 or 1 event per year and may mutate world state.

## Phase 5 Generators

### Foundation
`foundationGenerator`: founds a dormant city, adds to `mapUsableCities` / `mapUncontactedCities`.

### Contact
`contactGenerator`: first-contact between two cities via BFS over region adjacency; adds symmetric contact links. **Phase 4 tuning**: BFS depth formula `level + 1 → 1 + Math.ceil(level / 2)` to curb one-shot global contact at `exploration-4+` (the old formula closed the contact graph within the first few centuries).

### Country
`countryGenerator`: forms when all cities in a region are founded + contacted. `Spirit` enum (military / religious / industrious / neutral); merges city techs. Picks `raceBias: { primary, secondary? }` at founding from a sub-stream `${seed}_racebias_${countryId}` weighted by founding region's biome (via `BIOME_RACE_WEIGHTS`). 60% chance of meaningful secondary race; otherwise mono-cultural. See `characters.md` for details.

### Illustrate
`illustrateGenerator`: illustrious figure born in large+ cities; 6 types (religion / science / philosophy / industry / military / art) with weighted selection and variable active lifespan.

### Religion
`religionGenerator`: two paths.
- **Path 1 (found new)**: requires religious illustrate in a city with no religions. Snapshots `Religion.originCountry: string | null` from `foundingCity.regionId → region.countryId` and **never updates on conquest** — religion always remembers its *original* civilization. Picks `deity: Deity` and `alignment: AlignmentType` from sub-stream `${seed}_deity_${religionId}` weighted by founder country's `raceBias.primary` (×3) with universal deities at ×1.5 and race-disallowed at 0. See `characters.md`.
- **Path 2 (expand existing)**: candidate selection weights neighbour-region candidates by `min(2, 1 + 0.25 × originCountry.government)` via `getCountryTechLevel`, while same-region candidates keep weight 1, so high-`government` religions bias outward. At `government = 0` a fast path falls back to uniform selection with identical RNG usage to pre-§4 code (preserving seed reproducibility).

### Trade
`tradeGenerator`: trade route between contacted cities in different regions with available resources; consumes `TRADE_USE` from each resource. **Spec stretch §2** (trade-driven tech diffusion): after the trade is built, calls `_tryTechDiffusion` — resolves both source/target countries, skips when same empire (`memberOf.foundedBy` matches), iterates the union of known fields for any with `gap >= 2`, picks one uniformly, rolls `min(0.6, 0.15 + 0.05 × receiverExploration + 0.05 × receiverGovernment)`, and on success calls `recordDiffusedTech` from `Tech.ts` with `newLevel = min(receiverLvl + 1, donorLvl - 1)` then stamps `trade.techDiffusion = {field, donorCountryId, receiverCountryId, newLevel}` for the serializer. Diffused techs are **NOT** pushed into `year.techs` — they enrich the existing TRADE event instead of emitting a duplicate TECH event.

### Wonder
`wonderGenerator`: wonder built in large/metropolis/megalopolis cities; eligible cities are weighted by `industry` tech (`1 + 0.1 × level`, capped at level 10) so industrious civilizations build more wonders; can be destroyed by cataclysms.

**Per-city production limits**:
- Cooldown of `max(10, 100 − floor(growthLevel / 2))` years after a city's most recent wonder (any wonder, standing or destroyed).
- Max standing wonders per city = `max(1, floor(governmentLevel / 5))` — destroyed wonders do not count toward this cap.

Both checks use `getCityTechLevel` (empire-founder scope ladder).

Exports `getStandingWonderTierSum(world, city)` and `getCountryStandingWonderTierSum(world, countryId)` consumed by `YearGenerator.ts` (growth/religion bonuses), `Tech.ts` (discovery chance), `CityEntity.ts` (trade capacity), and `Conquer.ts` (military defense bonus).

### Cataclysm
`cataclysmGenerator`: 9 disaster types with cascading strength (local → regional → continental → global); kills population, may destroy cities/wonders/illustrates; can end the world.

Phase 1 tech mitigation: `biology` mitigates kill ratio for slow-onset disasters (`drought`, `heat_wave`, `cold_wave`, `flood`) by `min(0.5, 0.1 × level)` per affected city.

**Spec stretch §1** (knowledge regression): continental/global cataclysms of type `volcano`/`asteroid`/`tornado` (the `KNOWLEDGE_DESTROYING` set, mapped onto the spec's `fire`/`war`/`plague`/`dark_age`/`magical` categories) also degrade tech in affected countries — 1 roll at 30% (continental) or 2 rolls at 60% (global) per country, picking a field weighted by current level (high levels are more "fragile" because they depend on more infrastructure), decrementing by 1 (and removing the entry if it hits 0); `government >= 2` silently absorbs the loss (the roll/pick is still recorded).

Lost and absorbed entries surface as per-country `TECH_LOSS` `HistoryEvent`s in `HistoryGenerator`. Tech-loss writes go through `getCountryEffectiveTechs` so empire members decrement the founder's shared map (correct: an empire shares its knowledge).

### War
`warGenerator`: conflict between neighbouring countries not in the same empire; weighted reason enum; disrupts cross-region trades. Both belligerents must be at peace — checks `!c.atWar` on aggressor (line 56) AND `candidate.atWar` on defender in the selection loop. This prevents simultaneous multi-front wars.

### Tech
`techGenerator`: technology discovered by an illustrate; 9 tech fields; `mergeAllTechs` (union by max level) and `getNewTechs` (delta).

Exports tech-scope helpers `getCityTechLevel` / `getCountryTechLevel` (and underlying `getCityEffectiveTechs` / `getCountryEffectiveTechs`) that mirror the `_createTech` scope ladder: **empire founder → country → city**.

**Phase 2 throughput**: `techGenerator.generateForYear` is called **exactly once per year** by step 10. It owns the entire per-year flow:
- Throughput cap: `N = clamp(0..5, floor(log10(worldPop / 10_000)))`
- Per-country rolls in shuffled order with chance `min(1, illustrateCount / 5)`
- Field choice biased by unknown-bonus (×2) and spirit alignment (`SPIRIT_FIELD_BONUS`, ×1.5)
- Gated by soft adjacency prerequisites (`TECH_ADJACENCY` — bidirectional graph, level N+1 needs an adjacent field at ≥ N)
- Cities without a country fall through to `_pickStatelessTech`, the legacy science-weighted single-roll (`1 + 0.25 × min(level, 8)`, capped at 3.0) used as a single-tech tail when slots remain

A one-shot symmetry assertion on `TECH_ADJACENCY` runs at module load (mirrors the worker's Phase 0 trade-cap monotonicity check).

**Phase 4 (balance pass)**: throughput formula and adjacency / spirit tables were verified unchanged by the seed sweep. The `_throughputCap` clamp ceiling of 5 stays in place.

**Spec stretch §2** also exports `recordDiffusedTech` and `TRADE_DIFFUSION_DISCOVERER` so trade-driven tech-diffusion writes go through the same empire-founder scope ladder as `_createTech` (the helper writes through `getCountryEffectiveTechs`).

**Spec stretch §3** (named techs): static `TECH_NAMES` table lives in `timeline/techNames.ts` (9 fields × ~7 level names each) + `nameForLevel(field, level)` helper + internal `roman()` overflow helper. Imported **only** by `HistoryGenerator.ts` at serialization time — flavor metadata, not simulation state. Levels beyond the table reuse the last entry with a Roman-numeral suffix (e.g. `Vertical Farming II` for `growth` level 8). **Never** import from `Tech.ts` / `Cataclysm.ts` / `Trade.ts` or any mutation site.

`TRADE_TECHS` controls trade capacity multiplier `(1 + level/10)`. The field list is hardcoded in two places — `TRADE_TECH_FIELDS` in `physical/CityEntity.ts` (consumed by `effectiveTradeCap()`) and `TRADE_TECHS` in `timeline/Tech.ts` — to avoid a `physical → timeline` circular import. **If you change one, change the other.** A dev-only monotonicity assertion in `mapgen.worker.ts` guards against regressions.

### Conquer
`conquerGenerator`: outcome of a finishing war; winner assimilates loser's tech; updates empire membership.

**Phase 1 effects**:
- `military` tech biases the winner roll by `±0.05` per level differential (capped at ±0.4)
- `government` tech gates empire stability: government tech levels are captured **before** the tech merge (post-merge would be dead code since the conqueror has `max(conqueror, conquered)` after merge), then when a conqueror with weaker pre-merge `government` than the loser absorbs a country, there's a 15% chance the conqueror's empire fully dissolves (`_dissolveEmpire` releases all members)

`_handleEmpireEffects` performs **full dissolution** when an empire shrinks to ≤1 member: clears `memberOf` on remaining members, empties `empire.members` / `countries` / `reach`, sets `destroyedOn` / `conqueredBy`. Matches the cleanup pattern in `Ruin.ts _dissolveCountry` (lines 217-225) and `_dissolveEmpire` (lines 128-137 in Conquer.ts).

The `atWar` flag is only cleared after conquest if the country has no other alive wars remaining.

**Phase 3 observability**: stores a resolved `acquiredTechList: {field, level}[]` snapshot alongside `acquired['techs']`, which `HistoryGenerator` reads to surface a `(+N techs)` suffix and a structured `acquiredTechs` field on the serialized CONQUEST event.

**Wonders_bonuses §5** (military defense): defender's standing wonder tier sum (via `getCountryStandingWonderTierSum`) subtracts `0.02` per tier from the military bias before clamping, so fortified defenders are harder to conquer; the combined (military + wonder) bias stays clamped at `±0.4` to preserve the `[0.1, 0.9]` roll range.

**Empire wonder stability**: computes `getEmpireStandingWonderCount` to reduce the 15% government-tech dissolution probability by 2% per standing wonder across all empire member countries (including expansion regions), floored at 0%. At 8+ empire-wide standing wonders, dissolution from this path is impossible. Wonder count is read **after** `_handleEmpireEffects` (so the just-conquered country's wonders count toward stability) but **before** region transfers; wonder state is unaffected by either.

### Empire
`empireGenerator`: multi-country entity formed when a non-empire conqueror wins; tracks member countries and territorial reach.

### Merge
Merge placeholder interface — reserved for future peaceful country merging.

## CityEntity (Phase 2)

`physical/CityEntity.ts` is the rich simulation entity tracking full lifecycle state:
- `founded`, `contacted`, size enum, population rolls
- `canTradeMore()` + `effectiveTradeCap()` applying the `TRADE_TECHS (1 + level/10)` multiplier per spec
- `contactCities` set, `knownTechs` map

Dynamic city size thresholds (`CITY_SIZE_THRESHOLDS`):
- medium ≥ 10,000
- large ≥ 100,000
- metropolis ≥ 1,000,000
- megalopolis ≥ 10,000,000

Reduced by ~0.5% per combined `government` + `industry` tech level — high-tech civilizations cluster into bigger cities sooner.

Distinct from render-type `City` in `types.ts`.

## HistoryGenerator (Phase 6 Orchestration)

`history/HistoryGenerator.ts` is the top-level entry point. It:

1. Calls `buildPhysicalWorld` to create the `World` with continents, regions, resources, cities.
2. Calls `TimelineGenerator.generate()` to run 5000 years of simulation.
3. Builds a `CountryIndexMap` mapping internal string IDs → numeric indices for ownership arrays. Generates unique country display names via `generateCountryName()` (50 roots × 24 nation-style suffixes) and empire display names via `generateEmpireName()` (54 title templates, cached per empire so the name persists across snapshot years).
4. Serializes timeline years into `HistoryYear[]` with `HistoryEvent` objects for each of the 12 Phase 5 event types.
5. Computes cell-level ownership snapshots from the region-based country model (countries own regions; conquests transfer region ownership).
6. Converts founded `CityEntity` objects into render-type `City[]`.
7. Generates roads via A* between founded cities (`history/roads.ts`). Trade routes use a dual land/water cost via `tradeRouteAStar` (`computeDistanceFromLand` BFS for offshore awareness).
8. Produces `HistoryStats` for optional introspection.

### Empire Snapshots (overlay Phase 4)

`empireSnapshots` are captured **every 20 years + final year** via a chronological replay of `yearObj.conquers` and `yearObj.empires` that mirrors `Conquer._handleEmpireEffects` inside the main year loop, plus a pre-indexed `dissolvedByAbsYear: Map<number, Set<string>>` built from each `Empire.destroyedOn` to catch the invisible 15% `government`-tech dissolution path from `ConquerGenerator`.

Walk for each year:
1. Apply `yearObj.conquers` — remove conquered from current empire (dissolve at ≤1), add to conqueror's empire
2. Apply `yearObj.empires` as fresh entries with `{founder, triggering-conquer.conquered}`
3. Consult `dissolvedByAbsYear` for invisible dissolutions

Read-only over `world.mapCountries` / `world.mapRegions` to resolve founder display names; **never mutates any `World` field**, which is what keeps `npm run sweep` (which hashes `HistoryStats` not `empireSnapshots`) byte-identical.

When adding new member-transition logic to `ConquerGenerator`, mirror it in the replay block or the Hierarchy tab will silently diverge from reality.

### TechTimeline (spec stretch §5)

`techTimeline?: { byField: Record<TechField, Uint8Array> }` — per-field running-max tech level indexed by year offset (0..numYears-1). Computed inline with the `peakTechLevelByField` walk in `HistoryGenerator.generate()` — **NOT a second pass** over `timeline.years`.

Each array has length `yearsToSerialize` (matches `numYears`). Writes inside the main loop are guarded with `if (yi < yearsToSerialize)` so truncated runs don't silently drop tail data. After the write loop, a cheap forward-fill pass propagates each year's max forward through quiet years so the polylines stay flat instead of dropping to zero.

**Monotonic by design**: `TECH_LOSS` events do **NOT** dip the curves (the chart shows "highest peak ever attained", not "current global level"). Payload is ~9 × numYears bytes (45 KB at default 5000-year runs) — safe across `postMessage` as `Uint8Array` is structured-clone safe.

### HistoryStats (forwarded, not recomputed)

Phase 3 base: peak population, totals per event type, plus `totalTechs` and `peakTechLevelByField`.

Phase 4 additions: `totalTrades`, `totalConquests`, `totalCataclysmDeaths`, `techEventsPerCenturyByField` (tech events bucketed by 100-year window per field), `peakCountryTechLevelByField`, `medianCountryTechLevelByField`. Drives the sweep harness — but available on every run at zero extra cost.

Spec stretch §1: `totalTechLosses` and `totalTechLossesAbsorbed` for cataclysm-driven knowledge regression tracking.

Spec stretch §2: `totalTechDiffusions`.

The worker forwards `historyGenerator.generate()` `stats` field straight through as `MapData.historyStats`. Read from `mapData.historyStats` instead of re-walking `historyData.years` on the main thread.

### HistoryEvent (Phase 3 enrichments)

All optional fields:

- `discovererType` — illustrate type for TECH events (`'science' | 'military' | 'philosophy' | 'industry' | 'religion' | 'art'`)
- `countryName` — resolved country display name for TECH and CONQUEST events
- `acquiredTechs` — `{field, level, displayName?}[]` delta the conqueror gained, populated on CONQUEST events only when non-empty (spec stretch §3 adds `displayName`)
- TECH event descriptions formatted by `buildTechDescription()` in `HistoryGenerator.ts` as `"{Country} discovers {displayName} ({field} L{level}) (by a {illustrateType} in {city})"` with graceful fallbacks for stateless / displayName-less techs
- CONQUEST descriptions append `(+N techs)` when delta is non-empty
- `lostTechs` / `absorbedTechs` (spec stretch §1) — `TECH_LOSS`-only structured payloads. `lostTechs: {field, newLevel}[]` (post-decrement; `newLevel === 0` means the field was removed); `absorbedTechs: {field, level}[]` for rolls that `government >= 2` silently absorbed. One `TECH_LOSS` event per affected country per cataclysm.
- `displayName` (spec stretch §3) — TECH-only flavor name resolved at serialization time via `nameForLevel(field, level)` from `timeline/techNames.ts`. Purely cosmetic, never affects simulation state.
- `propagationReason` (spec stretch §4) — RELIGION-only optional enum `'art' | 'government' | 'both'` (`'none'` is omitted entirely). Computed at serialization time from the religion's `originCountry` current tech state via `getCountryTechLevel`. When present, the event description gets a trailing `(spread boosted by art/government/art and government)` suffix. Read-side only.

### Ownership Reconstruction

`getOwnerAtYear(history, year, cellIndex)` finds the nearest decade snapshot ≤ target year, then replays `ownershipDeltas` forward to the exact year. **Must apply deltas in strict year order** — out-of-order application produces incorrect borders. Snapshots keyed by decade (0, 10, 20…); always start from `Math.floor(year / 10) * 10`.

`computeOwnership()` in `HistoryGenerator.ts` seeds ownership and `regionOwner` from **both** `world.mapCountries` and `world.mapDeadCountries`. Dead countries (dissolved when all cities become ruins via `ruinifyCity`) still have a valid `governingRegion` string, and historical conquests referencing them must transfer their regions. The conquest replay lookup also checks both maps (`mapCountries ?? mapDeadCountries`). `buildCountryIndexMap` already indexes dead countries, so `idToIndex` lookups succeed for both.

## Render-Time Concerns

When `historyData` is present, kingdom borders/fills use `getOwnerAtYear(history, selectedYear, cellIndex)` instead of `cell.kingdom`. City/road/border layers are hidden entirely when no history data exists.

### Overlay Tabs (Events / Realm / Tech)

`UnifiedOverlay.tsx` hosts 4 tabs: Generation (always populated, see `world_map.md`), Events, Hierarchy (displayed as **"Realm"** in the tab bar), and Tech. Events and Realm populate once `mapData.history` exists; Tech additionally requires `historyData.techTimeline`.

| Tab | File | Body |
|-----|------|------|
| Events | `overlay/EventsTab.tsx` | Cumulative event list (year labels, event-type icons via `EVENT_ICONS`, colored left borders via `EVENT_COLORS`). Current-year highlight `${color}22` / `${color}0d`. Auto-scroll-to-bottom via `logEndRef.scrollIntoView({ block: 'nearest' })`. Mini-header with running event count + current year. Root wrapper `maxHeight: calc(100vh - 180px)`; inner list `overflowY: auto`. Accepts optional `onNavigate` callback; event rows with `locationCellIndex` are clickable. |
| Realm | `overlay/HierarchyTab.tsx` | Collapsible Empire → Country → City tree at the selected year. Reads `historyData.empireSnapshots` via nearest-snapshot lookup (`Math.floor(selectedYear / 20) * 20`, walking backward if the key is missing for truncated runs; final year uses `historyData.numYears`). Groups every live country into an empire bucket or "Stateless" bucket. Empires sort by member-count desc then name, founder country first inside. Cities from `mapData.cities` filtered by `kingdomId === country.id && foundedYear <= selectedYear`, capital prefixed with `★`. Dead countries render with `textDecoration: line-through` and dimmed color. Collapsible state in local `useState<Set<string>>`: empire nodes default-expanded via `'emp:collapsed:<id>'` negation key, country nodes + Stateless bucket default-collapsed via `'cty:<idx>'` / `'stateless'` positive keys. 280 px default width. Each city/country/empire row has a locate button (◎). |
| Tech | `overlay/TechTab.tsx` | Per-field tech polyline chart (9 fields, monotonic running-max series, year cursor). Owns the canvas + draw `useEffect`; imports `TECH_FIELD_COLORS` and `TECH_FIELD_LABELS` from `overlay/eventStyles.ts`. Uses `ResizeObserver` on the container div to redraw at full tab width. Height fixed 140 px with left/bottom padding for Y-axis peak-level labels and X-axis year labels (`Y0` / `Y{numYears-1}`). Draw order in single effect: background → axis frame → polylines → axis labels → year cursor (cursor stays on top). 360 px wide by default. |

Shared overlay constants (`EVENT_ICONS`, `EVENT_COLORS`, `TECH_FIELD_COLORS`, `TECH_FIELD_LABELS`) live in `overlay/eventStyles.ts`. The `Record<TechField, string>` type on the tech maps enforces exhaustiveness against the `TechField` union — adding a new field is a compile-time error here AND in `HistoryGenerator.ts`'s `TECH_FIELDS` constant (line 771).

### Timeline Panel

`Timeline.tsx`: bottom playback panel (play/pause, step ±1/±10, year slider, population/nation stats). Single draggable panel centered at the bottom of the viewport, rendered only when `mapData.history` exists. Exports `formatPopulation` for `EventsTab` to share. Year changes update `selectedYear` state in `App.tsx`, which triggers re-render of canvas + EventsTab. Play restarts from 0 if at the end. Dragging slider or pressing step buttons pauses auto-play.

The right-side event log + tech sub-panel that used to live here moved to `overlay/EventsTab.tsx` + `overlay/TechTab.tsx`. The file name stays as `Timeline.tsx` (not renamed to `TimelineControls.tsx`).

### Entity Navigation

`App.tsx → UnifiedOverlay → HierarchyTab/EventsTab`: clicking a locate button (◎) in the Realm tab or a locatable event row in the Events tab calls `handleEntityNavigate(cellIndices, centerCellIndex)` in `App.tsx`, which centers the viewport via `mapCanvasRef.current.navigateTo()` and sets `highlightCells` state. Highlight rendered as gold overlay (layer 9 in `renderer.ts`, `drawHighlight()`). Clicking the map canvas clears the highlight via `onInteraction` callback. The `ownershipAtYear: Int16Array` is computed once in `App.tsx` via `useMemo` and shared by both renderer and HierarchyTab.

## Pitfalls

- **`buildPhysicalWorld` always runs.** `MapData.regions` and `MapData.continents` are populated for every generation. Don't gate region/resource rendering on `mapData.history`.
- **History is the cities/kingdoms source when enabled.** Don't call `placeCities` or `drawKingdomBorders` from the worker when `generateHistory` is true — `HistoryGenerator` owns that responsibility.
- **HistoryGenerator is the orchestrator, not `generateHistory()`.** When history is enabled, the worker calls `historyGenerator.generate()` (Phase 6). The old `generateHistory()` from `history.ts` is preserved but unused by the worker.
- **Don't postMessage class instances.** `World`, `Region`, `Continent`, `CityEntity`, `Timeline`, `Year`, and Phase 5 entities all use `Map`/`Set`. Serialize to plain data inside the worker.
- **Phase 1 tech effects use the scope helpers.** `science`, `military`, `energy`, `biology`, `art`, `government`, and `industry` all read tech levels via `getCityTechLevel` / `getCountryTechLevel`, which mirror the **empire-founder → country → city** scope ladder. Do NOT read `country.knownTechs.get(...)` directly in new code — empire-member countries will silently miss the founder fallback.
- **Tech-loss + tech-diffusion writes go through `getCountryEffectiveTechs`.** Spec stretch §1 cataclysm tech-loss (`Cataclysm.ts`) and spec stretch §2 trade diffusion (via `recordDiffusedTech` in `Tech.ts`) both write through the helper so empire members mutate the founder's shared `Map<TechField, Tech>`. Bypassing the helper makes the founder silently drift from members.
- **Named techs are serialization-only.** `techNames.ts` is imported **exclusively** inside `HistoryGenerator.ts`. Never import from `Tech.ts` / `Cataclysm.ts` / `Trade.ts` or any mutation site. Routing flavor through the mutation layer would couple balance changes to text edits. A non-zero sweep diff after touching `techNames.ts` means a mutation site was accidentally modified.
- **Religion drift is per-(city × religion).** Spec stretch §4 splits the step 6 drift so each religion in a city can pick up its own `government` bonus from its own `originCountry`. The `art` bonus is city-scoped (+0.02 when the hosting city has `art` at country scope); the `government` bonus is religion-scoped (+0.01 per level, cap +0.03 at level 3+). `originCountry` is *snapshotted at founding* — a religion founded in country A that later conquers the whole continent still reads A's government level. Null `originCountry` means both effects silently no-op.
- **Don't resolve `originCountry` dynamically.** Don't read founding city's *current* `regionId → countryId` — that would steal the bonus on conquest.
- **Religion Path 2 outward-expansion** uses the same snapshotted `originCountry`. At `government = 0` a fast path preserves uniform selection and identical RNG usage to pre-§4 code.
- **Phase 4 tuning constants — re-run the sweep before landing.** When adjusting `growth` (YearGenerator.ts), `exploration` BFS depth (Contact.ts), or the `Tech._throughputCap` formula, run `npm run sweep -- --label <experiment>` and diff against `scripts/results/baseline-a.json`. Phase 4 quality gates: ±25% on peak/median per-field tech levels, ±30% on totalWars/totalTrades/totalConquests, ±30% on peakPopulation. Current Phase 4 landing point: `growth = 0.12`, `exploration depth = 1 + ceil(level/2)`, throughput unchanged.
- **TechTimeline is monotonic and computed inline.** Spec stretch §5: `HistoryGenerator.ts` populates `techTimeline.byField[f][yi]` in the **same** loop that updates `peakTechLevelByField` / `techEventsPerCenturyByField`. Do NOT add a second walk. Inside-loop write guard `if (yi < yearsToSerialize)` is required — out-of-bounds `Uint8Array` writes are silently dropped, losing tail data on truncated runs. Do NOT dip the curves on `TECH_LOSS` events. The chart is read-side only — touching it must not affect sweep output.
- **Conquest government dissolution reads pre-merge tech levels.** `ConquerGenerator` captures both countries' government tech levels **before** `mergeAllTechs`. After the merge, the conqueror has `max(conqueror, conquered)` per field, so reading post-merge would make the check dead code.
- **Empire wonder stability** read happens **after** `_handleEmpireEffects` (so just-conquered country's wonders count toward stability) but **before** region transfers.
- **`_handleEmpireEffects` must do full dissolution.** When an empire shrinks to ≤1 member, clear `memberOf` on all remaining members, empty `empire.members` / `countries` / `reach`, set `destroyedOn` / `conqueredBy`. Leaving any of these stale creates "zombie empires" where the remaining member has `memberOf` pointing to a destroyed empire, which blocks `EmpireGenerator` from creating new empires, prevents valid wars via the same-empire check in `War.ts`, and corrupts the tech scope ladder in `getCountryEffectiveTechs`.
- **`computeOwnership` must include dead countries.** Seed ownership and `regionOwner` from both `world.mapCountries` and `world.mapDeadCountries`. Dead countries still have a valid `governingRegion` string, and historical conquests referencing them must transfer their regions.
- **War defender must not be at war.** Both belligerents must be at peace to enter a new war.
- **Empire snapshots are a replay, not a live read.** `HistoryGenerator.ts` reconstructs empire membership chronologically by mirroring `Conquer._handleEmpireEffects` inside the main year loop, plus the pre-indexed `dissolvedByAbsYear` map. Do NOT read `CountryEvent.memberOf` or `Empire.countries` at serialization time — those reflect **final** simulation state, not year-i state. The replay must never mutate any `World` field. When adding new member-transition logic to `ConquerGenerator`, mirror it in the replay block.
- **Sweep harness lives in `scripts/sweep-history.ts`.** Single-file Node CLI, browser-free. If the terrain or history pipeline grows a new step, mirror it in both `mapgen.worker.ts` and `sweep-history.ts` (same order, same arguments) or future sweeps will silently drift.
- **Phase 1 coefficients apply only to the stateless tail.** They were originally tuned for the old `rndSize(5, 1)` loop; under Phase 2 the per-country path uses the throughput cap formula instead. Don't re-tune Phase 1 coefficients without checking which path consumes them.
