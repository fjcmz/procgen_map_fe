# Performance Measurement & Considerations

This file documents the **performance instrumentation** (the `DEBUG_HISTORY_TIMING` toggle and the per-step `timed()` helper in `src/lib/history/timeline/timing.ts`) and the **structural performance constraints** that apply across the simulation — most importantly why the per-year history loop cannot be parallelized without breaking the byte-deterministic sweep contract.

Read `world_history.md` for the pipeline details this analysis builds on.

## Why Performance Matters Here

The world-map worker pipeline runs end-to-end on a single thread:

```
voronoi → … → biomes → buildPhysicalWorld → HistoryGenerator (5000 yrs) → roads
```

History is the dominant cost when `generateHistory = true` — a 5000-iteration sequential loop where each year's outputs are next year's inputs. At default settings (~5,000 cells), a full run takes 20–50 seconds. There is no test suite, so wall-clock regressions are easy to introduce silently.

## The Timing Module

`src/lib/history/timeline/timing.ts` exports:
- `DEBUG_HISTORY_TIMING` — `const boolean` toggle, default `false`. Tree-shaken out of production builds when false.
- `historyTiming` — singleton `TimingAccumulator` with `reset()`, `record(label, ms)`, `report()`.
- `timed(label, fn)` — wraps a function call, records its duration into the accumulator.

`TimelineGenerator.generate` calls `historyTiming.reset()` at start and `console.log(historyTiming.report())` at end. `YearGenerator.generate` wraps each step in `timed('<label>', () => { ... })`. Labels are stable across years, so the accumulator sums durations + call counts per label across all 5000 years.

### Enabling

1. Flip `DEBUG_HISTORY_TIMING` to `true` in `src/lib/history/timeline/timing.ts`.
2. Run `npm run dev` and generate a history-enabled world (timing prints to the worker's DevTools console) **or** `npm run sweep` (prints to the Node console).
3. Each timeline run prints two breakdown tables: sorted by total time (hot paths first) and in execution order.
4. Flip back to `false` before committing.

### Determinism Contract

`timed()` only calls `performance.now()` and records into a non-RNG accumulator. It never draws from the seeded PRNG, so toggling the flag must produce **byte-identical** sweep output. Verified: with `DEBUG_HISTORY_TIMING=true`, `npm run sweep` matches the off-flag output exactly (excluding wall-clock `elapsedMs` fields).

If a future probe ever needs to draw randomness (e.g. statistical sampling of state), route it through an isolated PRNG sub-stream per the CLAUDE.md sub-stream isolation rule. Otherwise the sweep baseline shifts.

### Adding a New Probe

```ts
import { timed } from './timing';

timed('my-step', () => {
  // step body
});
```

If the body uses parameters narrowed by an outer `if`, capture them into locals first (TS doesn't carry narrowing through closures):

```ts
if (cells && usedCityNames) {
  const cellsLocal = cells;
  const namesLocal = usedCityNames;
  timed('my-step', () => {
    // use cellsLocal, namesLocal — `cells` would type as Cell[] | undefined here
  });
}
```

### Output Format

```
=== History generation timing ===
Wall time:   22178.0 ms
Accounted:   22073.3 ms (99.5%)

-- Sorted by total time (hot paths first) --
Label                   Total (ms)    % acct     Calls    Avg (μs)
expansion-cells             7060.1     32.0%      5000      1412.0
wonder                      6443.4     29.2%      5000      1288.7
city-settlements            4006.5     18.2%      5000       801.3
...
```

The `Accounted` percentage measures coverage — large gaps mean significant uninstrumented code paths.

## Current Hot Paths (May 2026 baseline)

From a 5000-yr sweep on default settings, the top time sinks are:

| Rank | Label | Share | What it does |
|------|-------|-------|--------------|
| 1 | `expansion-cells` | ~32% | Step 4c — rebuilds `claimedCells` + `regionCellSet` + multi-source BFS every year for every usable city |
| 2 | `wonder` | ~25% | Phase 5 wonder generation; `getStandingWonderTierSum` walks the wonder map |
| 3 | `city-settlements` | ~19% | Step 4d — `citySettlementGenerator.generate` |
| 4 | `expand` | ~7% | Step 3b territorial expansion across regions |
| 5 | `growth` | ~6% | Steps 3–4b — population sum + logistic growth + size recompute |
| ≤2% each | every other Phase 5 generator | trivial | foundation/contact/country/war/conquer/empire/illustrate/religion/trade/cataclysm/tech/ruin |

**Implication**: optimizing the named Phase 5 generators (foundation, contact, country, war, conquer, empire, …) yields almost nothing. The wins are in the per-cell territory bookkeeping (`expansion-cells` recomputes `regionCellSet` per city per year — a clear caching opportunity) and `wonderGenerator.generate` / `getStandingWonderTierSum`.

## Why Per-Year Parallelization is Blocked

Three structural blockers:

1. **Single shared RNG stream is the determinism contract.** `scripts/sweep-history.ts` creates one RNG via `seededPRNG(seed + '_history')` and threads it through every year and every Phase 5 generator. Year ordering *is* RNG ordering. Parallelizing years would re-sequence draws and break `scripts/results/baseline-a.json`.

2. **Cascading cross-year state dependencies.** Foundation populates `mapUsableCities`; Contact reads `mapUncontactedCities`; Country reads city contact status; Tech reads country membership; Conquer reads tech levels and dissolves empires; Empire reads conquer outcomes. A late-game empire dissolution retroactively changes Tech's empire-founder scope ladder for the next year — year N+1 cannot start until year N is fully complete.

3. **Mutable shared `World` state.** ~15 `Map<string, …>` indexes (`mapCountries`, `mapCities`, `mapUsableCities`, `mapUncontactedCities`, `mapIllustrates`, `mapUsableIllustrates`, `mapWonders`, `mapUsableWonders`, `mapReligions`, `mapWars`, `mapAliveWars`, `mapDeadCountries`, …) mutated every year. Concurrent year execution requires either deep-cloning `World` per year (~50 MB × 5000 yrs of memory) or strict locking that serializes anyway.

**Within-year parallelism between independent Phase 5 generators** is theoretically possible (~2–3× ceiling) but would require a `World`-state rewrite onto `SharedArrayBuffer` + typed-array indexes and a new sweep baseline. Not viable for the current code.

**Bottom line**: the simulation is fundamentally sequential by design. Speedup paths are serial-code optimization (caching, memoization, algorithmic improvements on hot paths), UI-level changes (lower default `numSimYears`, progressive rendering), or selective rewrites of the World-state model.

## Performance Considerations Across Layers

| Layer | Current state | If you change something hot |
|-------|--------------|----------------------------|
| **History** | Instrumented via `timed()`. Hot paths above. | Re-run the sweep with the flag on, diff before/after. Optimization that changes RNG order is incorrect. |
| **Terrain** (`src/lib/terrain/`) | Uninstrumented. ~5,000 cells default; up to 100,000 supported but slow. Sequential pipeline of ~10 steps. | If profiling needed, extend the existing timing module or add a parallel one — same `timed()` pattern. Erosion + Voronoi are the typical bottlenecks at high cell counts. |
| **Universe** (`src/lib/universe/`) | Uninstrumented. Generation usually <1s even at 10,000 systems. Render hot path is `UniverseCanvas` zoom/pan; per-color glow canvas cache + frustum culling already exist. | Profile in DevTools Performance panel; the canvas renderer benefits more from culling refinements than algorithmic changes to generation. |
| **City map V2** (`src/lib/citymap/`) | Uninstrumented. Lazy, sub-second per city. | Per CLAUDE.md, never reached by sweep — sweep diff must stay zero after city-map-only changes. |
| **Characters** (`src/lib/citychars.ts`) | Uninstrumented. Lazy, milliseconds per roster. | Same — render-only. |

## Other Performance Levers (No Code Changes)

- **Lower `numSimYears`** for dev iteration (UI slider exposes 50–5000). The bulk of a full run is years 3000–5000 where city/empire counts are largest.
- **Lower `numCells`** to ~2,000 for terrain-only iteration; history cost scales roughly with `numCells × numSimYears`.
- **Parallelize the sweep across seeds** — `scripts/sweep-history.ts` runs 5 seeds sequentially; a worker-pool variant would give ~5× wall-clock speedup for the sweep specifically (not for in-browser single-map gen). Out of scope for the current harness.

## Pitfalls

- **Don't draw randomness inside `timed()` callbacks.** If a probe ever needs sampling, isolate via a sub-stream.
- **Don't commit with `DEBUG_HISTORY_TIMING = true`.** Production builds should not log timing.
- **Don't add probes inside hot inner loops.** `timed()` overhead is ~2 μs per call; instrumenting per-cell or per-iteration code distorts measurements. Probe at the step boundary.
- **Re-run the sweep after any optimization to a hot path.** Any non-zero diff against `scripts/results/baseline-a.json` (excluding `elapsedMs` fields) means RNG order changed and the optimization is incorrect.
- **`Accounted` percentage well below 99%** means there's significant uninstrumented code in the timeline. Add probes around the gap before drawing conclusions about hot paths.
- **TS narrowing doesn't reach into closures.** When wrapping a block guarded by an `if (cells && usedCityNames)` check, capture the narrowed values into local consts before passing to `timed()`.
