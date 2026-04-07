# Tech Overhaul — Phased Approach

A discovery- and impact-oriented audit of how technology currently flows through
the simulation, followed by a phased plan to make tech matter.

## 1. Current State Inventory

### 1.1 Discovery Path

Tech discovery is implemented in `src/lib/history/timeline/Tech.ts` and is
called by `YearGenerator` (Phase 5, slot 10 of 12). The generator runs in a
loop **`rndSize(5, 1)` times per year** (1 to 5 invocations; see
`YearGenerator.ts:227`), short-circuiting when it can't produce a tech, so the
practical throughput is 0–5 techs/year worldwide.

```
YearGenerator.generate()
  └─ for i in 0..rndSize(5, 1):
        techGenerator.generate(rng, year, world)
          ├─ pick 1 random illustrate from world.mapUsableIllustrates
          ├─ map illustrate.type → eligible TechField[]   (ILLUSTRATE_TO_TECH)
          ├─ pick 1 random eligible field
          ├─ resolve scope: empire-founder country > country > origin city
          ├─ level = existingLevelInScope + 1
          ├─ scope.knownTechs.set(field, tech)
          └─ consume illustrate (delete from mapUsableIllustrates, set greatDeed)
```

Properties of the current path:

- **Throughput cap**: 0–5 techs / year for the entire world (drops to 0 once
  `mapUsableIllustrates` is empty).
- **Source**: any usable illustrate, regardless of city size, country status, or
  spirit. Selection is uniform random.
- **Field choice**: uniform random within the illustrate-type-eligible subset
  (the `TECH_FIELD_WEIGHTS` table is only consulted in the dead `pickTechField`
  fallback path, which is never reached because every `IllustrateType` already
  maps to ≥1 field).
- **Level model**: monotonic per-field counter. There is no cost, no decay, no
  diminishing returns, no prerequisite chain.
- **Scope ladder**: tech is recorded at the highest container that exists
  (empire founder country → country → city). This means city-only tech only
  exists for cities that have not yet joined a country. Once a country forms,
  `Country.create` calls `mergeAllTechs(cityTechMaps)` and re-points every
  member city's `knownTechs` at the unified country map (Country.ts:89–96).
- **Conquest transfer**: `Conquer` does `mergeAllTechs([conqueror, conquered])`
  and reports the delta as `acquiredTechs` on the event (Conquer.ts:69–74).
- **Persistence**: `Tech` instances live only in the worker. Nothing about
  individual techs (field/level/discoverer/year) crosses the `postMessage`
  boundary. The UI cannot display the tech tree at all.

### 1.2 The Nine Fields

`TechField` (Tech.ts:12):

| Field | Eligible illustrate types | Declared weight | Sim impact today |
|---|---|---|---|
| science | science | 3 | none |
| military | military | 3 | none |
| industry | industry, science _(wait)_ | 3 | declared in TRADE_TECHS, **not actually applied** |
| energy | science, industry | 2 | none |
| growth | industry | 2 | **carrying-capacity multiplier** in YearGenerator |
| exploration | philosophy | 1 | **Contact BFS depth** + declared in TRADE_TECHS (not applied) |
| biology | science | 1 | none |
| art | philosophy, religion, art | 1 | none |
| government | philosophy, religion | 1 | declared in TRADE_TECHS, **not applied** |

(Reverse mapping from `ILLUSTRATE_TO_TECH` in Tech.ts:24–31. Note: `military`
is the only field reachable by exactly one illustrate type, and `art` is the
only field reachable by three.)

### 1.3 Concrete Effects on Civilization (Today)

There are exactly **two** working effects, plus one declared-but-broken effect:

1. **`growth` → city carrying capacity** — `YearGenerator.ts:50–51`
   ```ts
   let capacity = REGION_BIOME_CAPACITY[region.biome];
   const growthTech = city.knownTechs.get('growth');
   if (growthTech) capacity *= (1 + growthTech.level * 0.15);
   ```
   Logistic growth therefore saturates higher in cities that hold a `growth`
   tech. +15% per level, unbounded.

2. **`exploration` → Contact BFS depth** — `Contact.ts:67–72`
   ```ts
   let depth = 1;
   const explorationTech = sourceCity.knownTechs.get('exploration');
   if (explorationTech) depth = explorationTech.level + 1;
   ```
   Cities with `exploration` reach further over the region adjacency graph
   when establishing new first-contacts.

3. **`TRADE_TECHS = {exploration, growth, industry, government}` → trade
   capacity** — **declared but not implemented**. `CityEntity.canTradeMore()`
   only checks `trades.length < CITY_SIZE_TRADE_CAP[size]`
   (`CityEntity.ts:79–81`). The spec (`specs/04_City.md` and
   `specs/28_Tech.md`) says trade capacity should multiply by `(1 + level/10)`
   per known TRADE_TECH; the runtime ignores this entirely.

Indirect effects (tech as a payload, not as a force):

- **Country formation** unifies all member-city tech maps into one shared map.
- **Conquer** unions tech and emits `acquiredTechs` for the event log.
- **Tech discovery consumes the discoverer**. This is the only way an
  illustrate is removed from `mapUsableIllustrates` outside death/cataclysm.

### 1.4 What This Means

- 7 of 9 fields (`science`, `military`, `energy`, `biology`, `art`,
  `government`, plus the broken half of `industry`) are **purely cosmetic**:
  they exist as event-log flavor and as trade-able / inheritable tokens, but
  they have zero closed-loop influence on the simulation.
- The two real effects (`growth`, `exploration`) form a **positive feedback
  with no antagonist**: more growth → bigger cities → more illustrates → more
  techs → more growth. There is no friction, no maintenance cost, no rivalry
  pressure that punishes a tech-poor civilization or rewards a tech-rich one
  beyond population and contact reach.
- War, religion, wonders, and cataclysms never read tech levels.
- Trade — explicitly designed around `TRADE_TECHS` — silently ignores them.
- The UI and event log have no visibility into the tech tree at all, so even
  the cosmetic value is dim.

---

## 2. Goals of the Overhaul

1. **Every declared field should have at least one closed-loop simulation
   effect** — no orphan fields.
2. **The two existing effects should be rebalanced** so that the
   growth/exploration loop is not the only path that matters.
3. **Discovery should be richer**: it should depend on civilization state
   (population, contact graph, prior tech), not only on illustrate availability.
4. **Tech should be observable** in the timeline UI (per-country tech levels,
   discovery events with field+level, conquest tech transfers).
5. **Spec ↔ implementation drift should be eliminated** — particularly the
   broken `TRADE_TECHS` capacity multiplier.

Non-goals (for now):

- A full tech tree with prerequisites, eras, or named inventions.
- Player-facing tech research controls.
- Per-field UI panels or research charts.

---

## 3. Phased Plan

Each phase is independently shippable, has a clear scope, and lists the files
it touches. Phases are ordered so that earlier phases unblock later ones and so
that risky balance changes (Phase 4) come after observability (Phase 3).

### Phase 0 — Fix the Drift (small, no balance risk)

**Goal**: Make the implementation match the spec for `TRADE_TECHS`. Pure bug
fix; no new mechanics.

- `CityEntity.canTradeMore()` reads `knownTechs` for each field in
  `TRADE_TECHS` and multiplies the base cap by `(1 + level/10)`, then rounds.
- Add a unit-style sanity check in the worker (or a dev-only assertion) that
  the post-multiplier cap is monotonic non-decreasing as tech levels rise.
- Update `specs/04_City.md` and `specs/28_Tech.md` only if the formulas change.

**Files**: `src/lib/history/physical/CityEntity.ts`,
`src/lib/history/timeline/Tech.ts` (export a small helper if cleaner).

**Risk**: low. Existing seeds that already produced cities with high
`TRADE_TECHS` will silently get more concurrent trades, slightly increasing
trade-event density.

---

### Phase 1 — Make Every Field Do Something

**Goal**: Give each of the 7 currently-orphan fields one minimal,
well-localized effect. Keep formulas conservative; the point is to close the
feedback loop, not to rebalance the simulation.

| Field | Proposed minimal effect | Where it plugs in |
|---|---|---|
| `science` | Reduces illustrate "wasted" risk: when picking an illustrate for tech, prefer the country with highest `science` level (weighted, not hard). Models scientific institutions attracting talent. | `Tech.ts` selection step |
| `military` | War outcome bias: in `War`/`Conquer` resolution, the side with higher `military` gets a small win-probability bonus (e.g. `+0.05 per level diff`, capped). | `War.ts`, `Conquer.ts` |
| `energy` | Multiplies `growth` effective level by `(1 + 0.05 * energyLevel)` when computing carrying capacity. Models energy as a force-multiplier on production. | `YearGenerator.ts` |
| `biology` | Reduces population loss from `Cataclysm` events tagged as plague/famine by `min(0.5, 0.1 * level)`. | `Cataclysm.ts` |
| `art` | Religion propagation bonus: when an `art`-holding country's religion expands, adherence drift step is `+0.07` instead of `+0.05`. Soft-power lever. | `YearGenerator.ts` step 6 |
| `government` | Empire stability: when a `Conquer` resolves, if winner has higher `government` than loser, empire membership transfers cleanly; otherwise add a small chance the empire fragments. | `Conquer.ts`, `Empire.ts` |
| `industry` | (Already covered by Phase 0 trade-cap fix.) Additionally: wonder cost — `Wonder.ts` weights eligible cities by `1 + 0.1 * industryLevel`. | `Wonder.ts` |

Constraints:

- Every effect reads from the **country-scope** tech map (or empire founder
  if applicable), never from a city in isolation. This keeps the data flow
  consistent with how `Country.create` already unifies city techs.
- Every effect must be **bounded** — pick an explicit cap or diminishing
  return. No unbounded multipliers.

**Files**: every Phase 5 generator listed above + `Tech.ts` for selection.

**Risk**: medium. Several balance levers move at once; expect Phase 5 events
to skew. Mitigate by keeping per-level coefficients small and revisiting in
Phase 4.

---

### Phase 2 — Discovery That Cares About Civilization

**Goal**: Replace "1 random illustrate / year" with a model that links
discovery rate and field bias to civilization state.

Mechanics:

1. **Throughput** — instead of exactly 1 tech/year, allow 0–N techs per year
   where `N = floor(log10(worldPopulation / 10_000))`, capped (e.g. ≤ 5).
   Early game stays scarce; populated mid-game accelerates.
2. **Per-country pool** — each country with ≥1 illustrate may roll for tech
   independently (instead of one global roll). The chance is
   `min(1, illustrateCount / 5)`. Cities without a country (still in the
   foundation/contact phase) keep the legacy single-illustrate path.
3. **Field bias** — when picking a field for an illustrate's eligible set,
   weight toward fields the country **does not yet know** (encourage breadth)
   and slightly toward fields aligned with the country `Spirit`
   (military spirit → +military, religious → +art/government,
   industrious → +industry/energy/growth, neutral → unbiased).
4. **Soft prerequisites** — `level N+1` in any field requires `level N` in at
   least one *adjacent* field. Adjacency table:
   ```
   science  ↔ biology, energy
   industry ↔ energy, growth
   military ↔ industry, government
   art      ↔ government, religion-flag
   exploration ↔ government
   ```
   This is not a hard tree; it just means level-2+ cannot leapfrog isolated
   fields. Country.knownTechs is the lookup scope.
5. **Discovery event** — `Tech` event already exists; enrich its serialized
   form with `{ countryId, field, level, discovererName }` so the UI can show
   it (Phase 3).

**Files**: `Tech.ts`, `TechGenerator`, `YearGenerator.ts` (call the generator
in a loop), `HistoryGenerator.ts` (serialization fields).

**Risk**: medium-high. Per-country rolls + log-population throughput will
materially increase total tech-events. Validate against a few seeds at the
default 5000-year run length before merging.

---

### Phase 3 — Observability (UI + Event Log)

**Goal**: Surface tech in the existing timeline UI without redesigning panels.

- **Event log entries**: `Tech` events render as
  `<icon> Year YYY — Country X discovers field level N (by IllustrateName)`.
  Already partially supported by `Timeline.tsx`; needs the icon + serialized
  fields from Phase 2 step 5.
- **HistoryStats**: extend with `peakTechLevelByField: Record<TechField, number>`
  and `totalTechs: number`. Cheap to compute during serialization.
- **Country tooltip** (optional): when hovering a country in political view,
  show its top-3 tech fields. This requires `HistoryData` to carry a
  per-snapshot `countryTechs` map (or recompute by replaying tech events up
  to the selected year — same pattern as `getOwnerAtYear`).
- **Conquer events** already carry `acquiredTechs`; render them when the
  delta is non-empty.

**Files**: `HistoryGenerator.ts`, `types.ts` (`HistoryEvent` enrichments,
`HistoryStats`), `src/components/Timeline.tsx`,
`src/lib/renderer/renderer.ts` (only if tooltip lands).

**Risk**: low. Pure read-side. Worker→UI message size grows by O(techEvents).

---

### Phase 4 — Balance Pass

**Goal**: Tune the constants introduced in Phases 0–2 against measured
outputs. Not a code-design phase; a numbers phase.

- Pick 5 fixed seeds, run history at default settings, record:
  - tech-events per century, by field
  - peak/median country tech levels at year 5000
  - trade events / war events / conquer events / cataclysm deaths
- Compare against a "baseline" capture taken **before** Phase 0 lands.
- Adjust:
  - `growth` per-level coefficient (currently 0.15 — likely too strong once
    `energy` stacks on top of it in Phase 1).
  - `exploration` BFS depth — consider `1 + ceil(level/2)` instead of
    `level + 1` to stop one-shot global contact.
  - Phase 2 throughput formula constants.
- Document the chosen constants in `specs/28_Tech.md`.

**Files**: small tweaks across the same generators; one new (or expanded)
spec section.

**Risk**: this is the phase where we discover unintended snowballs. Keep
changes small and re-run the seed sweep.

---

### Phase 5 — Stretch / Optional

Things worth listing but explicitly **not** committed to:

- **Tech loss**: cataclysms of `cascading >= continental` strength wipe one
  random field level from affected countries. Adds an antagonist to the
  current monotonic-growth model.
- **Trade-driven diffusion**: a `Trade` between countries with a tech-level
  gap of ≥2 in any field may transfer level-1 of that field to the
  lower-tier partner (small probability). Makes trade routes carriers of
  knowledge, not just resources.
- **Named techs**: a small static table of flavor names per (field, level)
  bucket, surfaced in the event log. Cheap content win once Phase 3 lands.
- **Religion ↔ government synergy**: religions whose origin country has
  high `government` propagate faster.
- **Per-field UI chart**: a small line chart of "max tech level per field
  over time" inside the existing event log panel.

---

## 4. Summary Table — Field × Phase

| Field | Today | Phase 0 | Phase 1 | Phase 2 | Phase 5 (opt) |
|---|---|---|---|---|---|
| science     | — | — | illustrate selection bias | breadth bias | — |
| military    | — | — | war/conquer odds | spirit-aligned bias | — |
| industry    | broken trade-cap | **fixed** | wonder eligibility | adjacency unlock | — |
| energy      | — | — | multiplies `growth` | adjacent to science/industry | — |
| growth      | carrying capacity | unchanged | scaled by `energy` | rebalanced (Phase 4) | trade diffusion |
| exploration | contact BFS | broken trade-cap **fixed** | unchanged | rebalanced (Phase 4) | — |
| biology     | — | — | cataclysm mitigation | adjacent to science | — |
| art         | — | — | religion propagation | spirit-aligned bias | named techs |
| government  | broken trade-cap | **fixed** | empire stability on conquest | spirit-aligned bias | religion synergy |

---

## 5. Recommended Order to Land

1. **Phase 0** in its own PR — pure bug fix, low risk.
2. **Phase 3** next, against the Phase 0 baseline — gives us measurement
   surface for everything that follows.
3. **Phase 1** — split into field-by-field commits if review is heavy.
4. **Phase 2** — single PR; this is the big behavior change.
5. **Phase 4** — repeated small PRs as seed-sweeps reveal issues.
6. **Phase 5** items only when there's a specific player-experience reason.
