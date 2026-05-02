# Characters (PCs / NPCs)

This file documents the **character generation layer** — the deterministic D&D 3.5e character roller that turns simulation metadata (race / deity / alignment) into PC rosters when a city is opened in the Details tab. Read `universe_map.md` for framework conventions and `world_history.md` for the simulation-side metadata that feeds this layer.

## Two Layers

The character system is split into:

- **`src/lib/fantasy/`** — the underlying D&D 3.5e engine. Pure data + RNG-driven rollers. No simulation knowledge.
- **`src/lib/citychars.ts`** — the UI-only lazy roster roller for the Details tab. Bridges the simulation's race/deity/alignment metadata to the fantasy roller.

## fantasy/ Engine

`src/lib/fantasy/` exports `RaceType`, `Deity`, `AlignmentType`, race specs (`RACE_SPECS`), deity specs (`DEITY_SPECS`), and two character rollers:

- **`generatePcChar(level, parentAlignment, rng)`** — frozen 3-arg signature. The original unbiased roller.
- **`generatePcCharBiased(level, parentAlignment, rng, opts)`** — biased entry point added by this layer. Accepts optional `{ raceWeights?, deityWeights? }` to skew the roll toward a country's `raceBias` / a religion's `deity`.

The biased roller does NOT mutate `RACE_SPECS` / `DEITY_SPECS` — it constructs **local biased copies** inside the function and discards them at return. Calling `generatePcCharBiased(level, alignment, rng, {})` (or omitting `opts`) is byte-identical to `generatePcChar`. If you add a new bias dimension (e.g. class), follow the same local-copy pattern — never mutate the shared spec records, or any future call site that runs in parallel will silently observe a stale weight table.

## Simulation-Side Metadata

Three new fields feed the roster roll. All are populated during simulation and serialized into `HistoryData` for the UI to consume.

### `Country.raceBias: { primary: RaceType; secondary?: RaceType }`

Picked at country founding in `CountryGenerator.generate` from a PRNG sub-stream `seededPRNG(`${world.seed}_racebias_${country.id}`)`, weighted by the founding region's biome via `BIOME_RACE_WEIGHTS` (forests/temperate → human + elf + halfling, mountains/tundra → dwarf + gnome, deserts → orc + half-orc).

60% chance of a meaningful secondary race; otherwise mono-cultural.

The base race-prob snapshot lives in `Country.ts::BASE_RACE_PROB` to avoid a circular import from `fantasy/RaceType.ts`. **Keep it in sync with `RACE_SPECS[r].prob`** whenever weights change there.

### `Religion.deity: Deity` + `Religion.alignment: AlignmentType`

Bound at religion founding (Path 1) in `ReligionGenerator.generate` from a PRNG sub-stream `seededPRNG(`${world.seed}_deity_${religion.id}`)`, weighted toward deities of the founder country's `raceBias.primary` race (×3) with universal deities at ×1.5 and race-disallowed deities at 0.

The display name stays illustrate-derived ("Faith of Aldric Stormvale") and `deity` / `alignment` are separate fields shown alongside.

### `World.seed: string`

Copied from the worker's seed string by `WorldGenerator.generate(rng, seed)` so simulation generators can derive their isolated sub-streams. Threaded through `buildPhysicalWorld(cells, width, rng, rarityWeights, seed)` and `historyGenerator.generate(cells, width, rng, numSimYears, rarityWeights, seed)`.

Defaults to `''` for the sweep harness and any standalone test path — sub-stream draws are still deterministic, just keyed off the empty-string root.

## Serialization

`HistoryGenerator.ts` copies the simulation-side metadata into `HistoryData` for client-side consumption:

- `country.raceBias` → `HistoryData.countries[i].raceBias`
- `religionDetails: ReligionDetail[]` (mirrors `wonderDetails`)
- `cityReligions: Record<number, string[]>` — final-year cellIndex → religion ids sorted by adherence descending. **First id is the dominant religion.**
- `worldSeed: string` — so `lib/citychars.ts` can derive its `${seed}_chars_<cellIndex>` PRNG client-side

## citychars.ts (UI-only roster)

`src/lib/citychars.ts` is the lazy roller that turns simulation metadata into a deterministic PC roster the moment a city is opened in the Details tab.

### Roster Sizing

Roster size scales with city tier:

| Tier | Roster |
|------|--------|
| small | 3 |
| medium | 6 |
| large | 12 |
| metropolis | 24 |
| megalopolis | 48 |

### Dominant Bias

"Dominant bias" — race + deity locked to the country/dominant religion — scales the **opposite** way:

| Tier | Dominant bias |
|------|---------------|
| small | 1.00 |
| medium | 0.70 |
| large | 0.50 |
| metropolis | 0.30 |
| megalopolis | 0.15 |

So small towns are racially/religiously homogeneous; megalopolises are cosmopolitan.

### Roll Mechanism

The roster is rolled **on demand** inside `DetailsTab.tsx::CityDetails` via a `useMemo` keyed on `(charactersOpen, city, country, cityReligionDetails, history.worldSeed)`. Ruined cities and worlds with no `worldSeed` short-circuit to an empty array.

PRNG: `seededPRNG(`${worldSeed}_chars_${cellIndex}`)`. Independent of every other PRNG sub-stream. **Same `(worldSeed, cellIndex)` pair always returns the same roster** — this is the contract Details-tab code relies on for stable rosters across re-mounts.

The tooltip on each row carries HP, abilities, age, height/weight, and starting wealth so the table itself stays narrow inside the 280 px overlay.

## Pitfalls

- **Sweep stability is preserved by design.** Race bias and deity binding draws go to ISOLATED PRNG sub-streams (`_racebias_<countryId>`, `_deity_<religionId>`). They do not perturb the main timeline RNG, and neither field enters `HistoryStats`. `npm run sweep` must remain byte-identical against `scripts/results/baseline-a.json` after any change to `Country.ts`'s `pickRaceBias`, `Religion.ts`'s `pickDeity`, or the `BIOME_RACE_WEIGHTS` table. **A non-zero diff means a sub-stream draw accidentally leaked into the main `rng` parameter — fix the leak rather than rebaseline.**
- **No simulation feedback in v1.** `Country.raceBias` and `Religion.deity / alignment` are purely decorative. They are NOT consumed by `WarGenerator` / `ConquerGenerator` / `TradeGenerator` / `ReligionGenerator.Path 2` / etc. Future work could (e.g. wars more likely between alignment-incompatible deities, trade easier between same-race countries) but doing so would require a sweep rebase.
- **Do NOT import `lib/citychars.ts` from the worker** (`src/workers/mapgen.worker.ts`) or from `src/lib/history/`. The roller is render-side only — it depends on render-layer types (`City`, `Country`, `ReligionDetail`) and rolls fresh PRNGs on demand. Importing from the worker would defeat the lazy-on-open design and balloon the postMessage payload.
- **Do NOT import `fantasy/Deity.ts` `DEITY_SPECS` into mutation sites.** The same naming-vs-mutation discipline as `techNames.ts` (see `world_history.md`) applies: `lib/fantasy/Deity.ts` `DEITY_SPECS` is referenced by `Religion.ts` (sim, picks the deity), `HistoryGenerator.ts` (serialize, reads display name), and `lib/citychars.ts` (UI, picks character deities). No other mutation sites should touch it.
- **`generatePcCharBiased` does not mutate shared specs.** It constructs local biased copies inside the function and discards them at return. Calling it with `{}` or no opts is byte-identical to `generatePcChar`. If you add a new bias dimension (e.g. class), follow the same local-copy pattern. Mutating `RACE_SPECS` / `DEITY_SPECS` would silently corrupt parallel call sites.
- **`citychars.ts` PRNG keying** — uses `seededPRNG(`${worldSeed}_chars_${cellIndex}`)`. Independent of every other sub-stream. Don't change the key format without updating all Details-tab call sites; downstream code relies on stable rosters across re-mounts.
- **Keep `Country.ts::BASE_RACE_PROB` in sync with `RACE_SPECS[r].prob`.** The duplication exists to avoid a circular import from `fantasy/RaceType.ts`. Drift between the two would cause race bias picks to silently diverge from race spec assumptions.
- **`World.seed` defaults to `''` for sweep / test paths.** Sub-stream draws are still deterministic, just keyed off the empty-string root. Any new sub-stream that depends on `World.seed` must tolerate the empty-string root (which it does naturally — `seededPRNG('_racebias_X')` is a valid input).
