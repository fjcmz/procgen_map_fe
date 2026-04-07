# Tech Overhaul — Phase 5 (Stretch) Detail

Companion to `specs/tech_overhaul.md`. Each section here expands one
Phase 5 / "stretch" item into a self-contained design that could be
implemented independently of the others, after Phases 0–4 have landed.

These items share three rules:

- **Country-scope only.** All reads and writes go through
  `Country.knownTechs` (or the empire founder country, mirroring `Tech.ts`).
  No city-isolated logic.
- **Bounded.** Every coefficient has an explicit cap or diminishing return.
- **Observable.** Anything that changes simulation state must emit (or
  enrich) a `HistoryEvent` so the timeline panel can show it.

---

## 1. Tech Loss from Cataclysms

**Motivation.** Today, country tech levels are monotonic — they can only
ever increase. There is no antagonist. Catastrophes already kill
population, destroy wonders, and erase illustrates; they should also be
able to set knowledge back.

### Trigger

Inside `cataclysmGenerator.generate` (`Cataclysm.ts`), after the existing
strength cascade resolves, apply tech loss when:

- `cataclysm.strength` is `continental` or `global`, **and**
- the cataclysm's `type` is in `KNOWLEDGE_DESTROYING_TYPES`
  (proposed: `fire`, `war`, `plague`, `dark_age`, `magical`).

(Earthquakes, floods, famines do **not** trigger tech loss — they kill
people and crops, not libraries.)

### Effect

For each affected country (existing cataclysm propagation already
resolves this set):

```
lossChance = strength === 'global' ? 0.6 : 0.3
lossCount  = strength === 'global' ? 2   : 1
```

For up to `lossCount` rolls, with probability `lossChance`:

1. Pick a random field where `country.knownTechs.get(field).level >= 1`,
   weighted by current level (higher levels are more "fragile" because
   they depend on more infrastructure).
2. Decrement `level` by 1.
3. If the new level is 0, **remove** the field from `knownTechs`.
4. Mitigation: if the country has `government >= 2`, the loss is
   silently absorbed (institutional resilience). The roll still
   happens — it just doesn't apply. Emit a side event so this is
   visible.

### Mitigation by `biology` (overlap with Phase 1)

Phase 1 already gives `biology` a population-loss reducer for plague /
famine cataclysms. Tech-loss reduction is the `government` role, not
`biology` — keep these orthogonal.

### Event payload

Add a `techLosses` field to the existing `Cataclysm` event:

```ts
techLosses: Array<{ countryId: string; field: TechField; newLevel: number }>
```

Empty array when nothing was lost; non-empty arrays render in the
event log as
`<icon> Year YYY — Cataclysm in X destroys field knowledge (level N→N-1)`.

### Replay implications

Because tech state lives only inside the worker during simulation, no
snapshot replay logic changes. Only the serialized event payload grows.

### Files

`Cataclysm.ts`, `HistoryGenerator.ts` (event serialization),
`types.ts` (`HistoryEvent` enrichment), `Timeline.tsx` (renderer).

### Risk

Low-medium. Can dramatically slow late-game tech runaway, which is
desirable, but also makes seed variance higher. Tune `lossChance` and
the `government` mitigation threshold during the next balance pass.

---

## 2. Trade-Driven Tech Diffusion

**Motivation.** Trade currently moves resources only. Historically,
trade routes were the dominant vector for knowledge transfer between
unrelated civilizations. Coupling techs to trade also gives the
`exploration` and `government` fields a second-order role beyond their
direct effects.

### When the check fires

Inside `tradeGenerator.generate` (`Trade.ts`), after the trade is
created and resources are decremented but before the function returns,
attempt one diffusion check using the same `rng`.

### Eligibility

Identify the two countries involved:

```
countryA = country owning sourceCity.regionId
countryB = country owning targetCity.regionId
```

Diffusion is only eligible when:

- Both `countryA` and `countryB` exist (not pre-country trade between
  isolated cities).
- `countryA !== countryB` (already implied by region difference, but
  must hold at the country layer too — otherwise empire-internal trade
  would self-diffuse).
- They are **not** in the same empire (knowledge is already shared
  there via empire-founder scope in `Tech.ts:130–132`).

### Selection

Find every field where the level gap is `>= 2`:

```
gap(field) = max(0, max(A,B).level - min(A,B).level)
candidates = fields where gap(field) >= 2
```

If `candidates` is empty, return — no diffusion.

Otherwise pick one field uniformly at random from `candidates`. Let
`donor` be the higher-level country, `receiver` the lower.

### Probability

```
baseProb = 0.15
explorationBoost = 0.05 * receiver.knownTechs.get('exploration')?.level ?? 0
governmentBoost  = 0.05 * receiver.knownTechs.get('government')?.level ?? 0
prob = min(0.6, baseProb + explorationBoost + governmentBoost)
```

Roll `rng() < prob`. If the roll fails, return.

### Effect

```
receiverLevel = receiver.knownTechs.get(field)?.level ?? 0
newLevel      = receiverLevel + 1
```

Cap at `donor.level - 1` — diffusion can never make the receiver equal
to or surpass the donor in a single hop. Update `receiver.knownTechs`.

### Discoverer attribution

Diffused techs need a "discoverer" for the existing `Tech.discoverer`
field. Use a sentinel illustrate ID so the UI can render
`(via trade with <DonorCountry>)` instead of an illustrate name. Do
**not** consume any illustrate from `mapUsableIllustrates` — this is
the whole point of the alternative discovery path.

### Event payload

Diffusion does not need a new event type. Enrich the existing `Trade`
event:

```ts
techDiffusion?: { field: TechField; from: string; to: string; newLevel: number }
```

### Files

`Trade.ts` (the new check), `Tech.ts` (export a tiny
`recordDiffusedTech` helper so the country-scope write logic stays in
one place), `HistoryGenerator.ts`, `Timeline.tsx`.

### Risk

Medium. This is the only Phase 5 item that *increases* tech levels —
combine it with item 1 above and the system stays balanced. Without
item 1, expect a measurable rise in late-game peak tech levels.

---

## 3. Named Techs

**Motivation.** Pure flavor. The event log currently says
`Country X discovers science level 4`. Players engage more with named
discoveries than numbered ones.

### Static table

Add `src/lib/history/timeline/techNames.ts`:

```ts
export const TECH_NAMES: Record<TechField, string[]> = {
  science: [
    'Astronomy', 'Optics', 'Calculus', 'Chemistry',
    'Electromagnetism', 'Relativity', 'Quantum Theory',
  ],
  military: [
    'Bronze Forging', 'Cavalry Doctrine', 'Crossbows',
    'Gunpowder', 'Rifled Barrels', 'Mechanized Warfare',
    'Strategic Bombing',
  ],
  industry: [
    'The Wheel', 'Sailing', 'Watermills',
    'Steam Power', 'Assembly Line', 'Automation', 'Robotics',
  ],
  energy: [
    'Firekeeping', 'Charcoal', 'Coal Mining',
    'Steam Engines', 'Electricity', 'Atomic Power', 'Fusion',
  ],
  growth: [
    'Hand Tilling', 'Crop Rotation', 'Selective Breeding',
    'Steel Plows', 'Synthetic Fertilizer', 'Mechanized Farming',
    'Vertical Farming',
  ],
  exploration: [
    'Star Maps', 'Lateen Sails', 'Compass',
    'Sextant', 'Steam Vessels', 'Aeronautics', 'Long-Range Rocketry',
  ],
  biology: [
    'Herbalism', 'Anatomy', 'Vaccination',
    'Antibiotics', 'Genetics', 'Gene Editing', 'Synthetic Biology',
  ],
  art: [
    'Cave Painting', 'Frescoes', 'Perspective',
    'Printing Press', 'Photography', 'Cinema', 'Generative Art',
  ],
  government: [
    'Tribal Council', 'Codified Law', 'Bureaucracy',
    'Constitutionalism', 'Central Banking', 'Welfare State',
    'Algorithmic Governance',
  ],
};
```

### Lookup

```ts
function nameForLevel(field: TechField, level: number): string {
  const list = TECH_NAMES[field];
  if (!list) return `${field} L${level}`;
  // Levels are 1-indexed; clamp anything beyond the table to the last
  // entry plus a roman-numeral suffix.
  if (level <= list.length) return list[level - 1];
  const overflow = level - list.length;
  return `${list[list.length - 1]} ${roman(overflow + 1)}`;
}
```

### Where it surfaces

- `Tech` event payload gains `displayName: string` (computed at
  serialization time inside `HistoryGenerator.ts`, so the worker is the
  only place that imports `techNames.ts`).
- `Conquer.acquiredTechs` events use the same display names.
- Phase 2 / Phase 1 `Tech.ts` mutations are unchanged — naming is
  purely a serialization concern.

### Event log line

`<icon> Year YYY — Country X discovers Astronomy (science L4)`

### Files

`src/lib/history/timeline/techNames.ts` (new),
`HistoryGenerator.ts`, `types.ts`, `Timeline.tsx`.

### Risk

Zero. Cosmetic. The only thing to watch is event-log payload size,
which grows by a few bytes per `Tech` event.

---

## 4. Religion ↔ Government Synergy

**Motivation.** `government` is currently a stability lever for
empires (Phase 1). It should also have a soft-power role: a
high-`government` country whose state religion exists should propagate
that religion faster, modeling organized clergy + civil registry.

### Where it plugs in

`YearGenerator.ts` step 6 already handles religion propagation
(adherence drift `+0.05` per year, capped at `0.9`). Phase 1 already
gives `art` a `+0.07` bonus instead of `+0.05`. This item stacks:

```
drift = 0.05
if (city.country has art tech)        drift += 0.02   // Phase 1
if (originCountry.knownTechs.government)
  drift += 0.01 * min(3, government.level)            // Phase 5 cap @ 0.03
```

`originCountry` is the country whose city hosts the religion's founding
event (already tracked on `Religion`).

### Cross-religion expansion

When a religion expands from city A to neighbour city B (the existing
"Path 2" branch in `religionGenerator`), the candidate selection picks
a random unconverted neighbour. With this synergy, weight neighbour
selection by `1 + 0.25 * originCountry.government.level` so high-
`government` religions also reach further per tick. Cap multiplier at 2.

### Event payload

No new events — the existing `Religion` event is sufficient. Optionally
add a `propagationReason: 'art' | 'government' | 'both' | 'none'`
hint for the event log to render flavor text.

### Files

`YearGenerator.ts` (step 6), `Religion.ts` (Path 2 weighting),
`HistoryGenerator.ts` (optional reason field).

### Risk

Low. Bounded multiplier; affects only religious adherence and
expansion, both of which are already late-game flavor systems.

---

## 5. Per-Field UI Chart

**Motivation.** With Phases 0–4 in place, tech finally matters and is
finally observable per event. The next step is showing the *trajectory*
of each field over time so players can see civilizational rise and
fall at a glance.

### Data source

Phase 3 already adds `peakTechLevelByField` to `HistoryStats`. This
item upgrades that to a *time series*:

```ts
interface TechTimeline {
  // index = year offset from history start (0..numYears-1)
  // value = global max level for that field at that year
  byField: Record<TechField, Uint8Array>;
}
```

Computed once at the end of `HistoryGenerator.generate()` by
replaying tech events year-by-year and taking the running max per
field across all countries. `Uint8Array` because levels rarely exceed
~30 in practice and never realistically exceed 255.

### Where it ships

Add `techTimeline?: TechTimeline` to `HistoryData`. It is roughly
`9 * numYears` bytes — at the default 5000-year run that's 45 KB,
small enough to ship across `postMessage`.

### UI

Inside the existing `Timeline.tsx` event log side panel, add a
collapsible "Tech" sub-panel with one tiny inline `<canvas>` (e.g.
`240 × 80 px`). On render:

1. Draw 9 colored polylines (one per field) using `techTimeline.byField`.
2. Use the same color palette as the event-log icons so the chart is
   self-keying.
3. Draw a vertical cursor at `selectedYear` (already available in
   `App.tsx` state).
4. Update on `selectedYear` change — only the cursor needs to redraw,
   not the polylines.

No new draggable panel; this lives inside the existing event-log panel
to avoid yet another floating window.

### Hover (optional)

If hover-over-canvas time becomes available, surface
`field: level` for the hovered year in a 1-line tooltip below the
chart. Skip if it adds non-trivial complexity.

### Files

`HistoryGenerator.ts`, `types.ts` (`TechTimeline`, `HistoryData`),
`Timeline.tsx` (sub-panel + canvas drawing). No renderer changes —
this is React canvas, not the main map renderer.

### Risk

Low. Pure read-side. Only watch out for `techTimeline` payload size if
`numYears` is ever raised beyond the current 5000 cap.

---

## 6. Suggested Landing Order Within Phase 5

These five items are independent, but a sensible order is:

1. **Named techs (item 3)** — zero risk, immediately improves the
   event log and makes everything else more readable.
2. **Tech loss (item 1)** — adds the antagonist before adding new
   discovery sources, so the simulation doesn't briefly become unstable.
3. **Trade diffusion (item 2)** — adds the new discovery source.
4. **Religion ↔ government (item 4)** — small, isolated, can land
   anywhere after Phase 1.
5. **Tech chart (item 5)** — last, because it depends on all the above
   data being in the serialized event stream.

After all five land, do a second balance pass (a mini Phase 4) and
update `specs/28_Tech.md` with the final coefficients.
