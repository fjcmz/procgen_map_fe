# Tech / TechGenerator

**Package**: `es.fjcmz.lib.procgen.history.timeline`  
**Phase**: 5 — Timeline Entities  
**Dependencies**: Illustrate, City, Country, Empire, World, Year

## Purpose

Represents a technological discovery made by an illustrate. Techs affect trade capacity, contact range, and population growth.

## Persistent Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | `tech_<year>_<field>_<level>_<uuid>` |
| `field` | `Field` | Technology field |
| `level` | `int` | Tech level (incremental) |
| `discoverer` | `String` | ID of the illustrate who discovered it |

## Transient Fields

| Field | Type | Description |
|-------|------|-------------|
| `year` | `Year` | Back-reference |

## Field Enum (Weighted)

| Field | Weight |
|-------|--------|
| science | 3 |
| military | 3 |
| industry | 3 |
| energy | 2 |
| growth | 2 |
| exploration | 1 |
| biology | 1 |
| art | 1 |
| government | 1 |

## Utility Methods

### `mergeAllTechs(Collection<Map<Field, Tech>>)`
- Union by field, keeping max-level tech per field.
- Used when forming countries (merging all city techs).

### `getNewTechs(originalTechs, newTechs)`
- Returns delta map: fields where the tech is absent in original or level increased in new.
- Used by Conquer to determine acquired technologies.

## Generation Logic

1. Pick a random usable illustrate. If none exists, no tech is generated.
2. Determine eligible tech fields from `illustratesToTech` multimap (static mapping from illustrate type to tech fields).
3. Set `discoverer = illustrate.id`.
4. Determine the known-tech map scope:
   - Default: city's `knownTechs`
   - If city belongs to a country: country's `knownTechs`
   - If country is in an empire: empire founder country's `knownTechs`
5. New tech `level = existingLevelInField + 1` (or 1 if field not yet known).
6. Create `id = tech_<year>_<field>_<level>_<uuid>`.
7. Insert/replace in the known-tech map.
8. Set illustrate's `greatDeed` and consume from `mapUsableIllustrates`.

## Effects on Other Systems

- **Trade capacity**: `TRADE_TECHS = {exploration, growth, industry, government}` — each known tech multiplies trade capacity by `(1 + level/10)`.
- **Contact range**: `exploration` tech increases BFS depth for contact discovery — see Phase 4 constants below for the current formula.
- **Population growth**: `growth` tech multiplies yearly carrying capacity — see Phase 4 constants below.
- **Phase 1 feedback effects**: `energy` stacks on top of `growth` (×1 + 0.05·level up to ×1.5); `military` biases war outcomes (±0.05 per level, capped ±0.4); `biology` mitigates slow-onset cataclysms (min 0.5, 0.1·level); `art` raises religion adherence drift (+0.05 → +0.07); `government` gates empire stability on conquest (15% dissolve chance if conqueror's government < loser's); `industry` weights wonder-construction eligibility (1 + 0.1·level, capped).
- **Phase 2 discovery model**: throughput `N = clamp(0..5, floor(log10(worldPop / 10_000)))`; per-country roll chance `min(1, illustrateCount / 5)`; field bias toward unknown (×2) and spirit-aligned (`SPIRIT_FIELD_BONUS`, ×1.5); soft adjacency prerequisites via `TECH_ADJACENCY`.

## Phase 4 Constants (Balance Pass)

Phase 4 of `specs/tech_overhaul.md` — a seed-sweep driven balance pass over the constants introduced in Phases 0–2. Tunings are small and bounded; the goal is to prevent the new feedback loops from snowballing, not to redesign them.

### Tuned constants (final values)

| Constant | File | Phase 0–3 value | Phase 4 value | Rationale |
|---|---|---|---|---|
| `growth` per-level carrying-capacity multiplier | `YearGenerator.ts` | `0.15` | `0.12` | `energy` stacks ×1.5 on top of `growth` since Phase 1, so `0.15` was effectively `0.225` at `energy` level 10 — a compounding snowball. `0.12` curbs the compounding while keeping peak population inside the Phase 4 ±30% quality gate vs. baseline-a. |
| `exploration` BFS depth formula | `Contact.ts` | `level + 1` | `1 + ceil(level / 2)` | The old formula let an `exploration-4` city reach 5 region-layers per year, closing the contact graph within the first few centuries and flattening the mid-game contact curve. Halving the slope keeps early exploration useful without short-circuiting diffusion. |
| Phase 2 throughput cap ceiling | `Tech.ts:_throughputCap` | `min(raw, 5)` | **unchanged** | The 5-seed sweep peaks at ~60M world population, which resolves to `floor(log10(6000)) = 3` — comfortably below the clamp ceiling. No evidence of cap pressure, so the constant is left alone. |

### Unchanged (verified healthy)

- `military` bias ±0.05 per level (capped ±0.4) — conquest outcomes stayed within ±3.4% of baseline across tuning rounds.
- `biology` mitigation `min(0.5, 0.1 × level)` — cataclysm deaths tracked population roughly proportionally, no runaway.
- `art` adherence drift `+0.05 → +0.07` — religion propagation is not measured by the sweep harness; out of scope for Phase 4.
- `government` empire-dissolution chance 15% — empire count stayed flat (23 median) across all rounds.
- `industry` wonder weight `1 + 0.1 × level` (capped at level 10) — wonder counts are driven by city-size eligibility, not tech level, so the multiplier has low leverage and was left alone.
- Per-country roll chance `min(1, illustrateCount / 5)` — total tech count stayed flat across rounds, indicating the formula is already well-balanced.
- `TECH_ADJACENCY` and `SPIRIT_FIELD_BONUS` tables — the field-level distribution shifts observed during tuning (growth/exploration/military rose 5–14% in tuning-1) stayed inside ±25% gates, so the prerequisite and alignment graphs are left alone.

### Measurement methodology

The sweep harness `scripts/sweep-history.ts` replays the browser worker pipeline across a fixed seed list entirely in Node via `tsx`, so each run is byte-deterministic.

```bash
npm run sweep                            # 5 seeds, 5000 years, 3000 cells (defaults)
npm run sweep -- --label baseline-a      # tag the output filename
npm run sweep -- --seeds 3 --years 2000  # smaller run for fast iteration
```

**Default settings**: 5 fixed seeds (`seed-01`…`seed-05`), 5000 simulated years, 3000 Voronoi cells, 1600×1000 canvas, 40% water ratio. Matches the default `GenerateRequest` the UI sends the worker.

**Captured metrics** (via `HistoryStats`, extended in Phase 4):
- `peakPopulation` — highest `worldPopulation` across all years
- `totalTechs` / `totalTrades` / `totalConquests` / `totalWars` / `totalCataclysms` / `totalCataclysmDeaths` / `totalCountries` / `totalEmpires` — sums across the timeline
- `peakTechLevelByField` — max tech level reached globally per field
- `peakCountryTechLevelByField` / `medianCountryTechLevelByField` — final-year per-country tech distribution per field, walked via `getCountryTechLevel` so empire-member countries resolve through the empire-founder scope
- `techEventsPerCenturyByField` — tech events bucketed by 100-year window per field, used to detect late-game snowballs
- `worldEnded` count — how many of the 5 seeds ended via global cataclysm; must match baseline after tuning

Reports are written to `scripts/results/<label>.json` containing per-seed `HistoryStats` plus min/median/max aggregates. The harness prints a compact summary table to stdout.

### Quality gates (Phase 4 stop condition)

A tuning round lands when **all** of the following hold vs. `scripts/results/baseline-a.json`:

1. `peakTechLevelByField` for every field within **±25%**
2. `medianCountryTechLevelByField` for every field within **±25%**
3. `totalWars`, `totalTrades`, `totalConquests` each within **±30%**
4. `peakPopulation` within **±30%** (loosest gate — the `growth` tuning directly moves it)
5. No per-century entry in `techEventsPerCenturyByField` exceeds **2×** the baseline curve's value for the same century
6. `worldEnded` count across the 5 seeds is **unchanged** vs. baseline

Stop after at most 3 tuning rounds regardless. Phase 4 is explicitly scoped as "small tweaks" in the overhaul plan; further iteration is deferred to a future PR.

### Tuning history

| Round | Change | peakPop delta | Techs delta | Gate status |
|---|---|---|---|---|
| `baseline-a.json` | current code (Phases 0–3 merged) | — | — | baseline |
| `tuning-1.json` | `growth 0.15 → 0.10`, `exploration level+1 → 1+ceil(level/2)` | −32.2% | 0% | ❌ peakPop outside ±30% |
| `tuning-2.json` | `growth 0.10 → 0.12` (exploration unchanged from round 1) | **−14.7%** | 0% | ✅ all gates pass |

Landing point: `tuning-2` — growth = 0.12, exploration = `1 + ceil(level/2)`.
