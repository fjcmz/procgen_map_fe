# Unified Overlay with Tabs — Phased Plan

## Goal

Consolidate the two top-right floating panels — **Generation Controls** (`src/components/Controls.tsx`) and the **Event Log** side panel inside `src/components/Timeline.tsx` — into a single draggable overlay with a tab bar. The overlay will host four tabs:

1. **Generation** — current seed, cells, water, history toggle, map view, season, layer toggles, generate button + progress.
2. **Events** — the cumulative history event log (currently the right-side panel in `Timeline.tsx`).
3. **Hierarchy** — new view: collapsible Empire → Country → City tree at the currently selected year.
4. **Tech** — the per-field tech polyline chart (currently a sub-panel inside the event log), expanded to full tab width.

**Explicitly out of scope of the merge**: the bottom Timeline playback panel (play/pause, year slider, step buttons). It stays its own draggable panel at `bottom-center` because:
- It must remain visible regardless of which tab is active.
- Its horizontal, slider-centric layout is a poor fit for a tabbed side panel.
- Users expect playback controls to be spatially separate from informational tabs.

`Legend`, `Minimap`, and `ZoomControls` are map-anchored overlays and stay where they are.

---

## Design Principles

- **No behavior regressions.** Generation, event log, and tech chart must each work identically after they move into their tab. `npm run build` must stay clean; `npm run sweep` output must be byte-identical unless Phase 4 intentionally adds snapshots.
- **Reuse, don't rewrite.** Each tab is a thin wrapper extracted from the existing components. Styles, event colors, and formatters come straight out of `Controls.tsx` / `Timeline.tsx` — do not re-invent the palette.
- **Draggable shell.** The unified overlay reuses `Draggable.tsx` with a `data-drag-handle` on the tab-bar row so users can reposition it the same way they already reposition the event log.
- **Collapsible.** The overlay keeps the existing ▴/▾ collapse affordance; when collapsed, only the header row + tab bar show (not even the active tab's body). This matches the current `Controls.tsx` collapse UX.
- **No new worker work** except in Phase 4, which adds empire snapshots to `HistoryData`. All other phases are main-thread/React only.

---

## Phase 1 — Shell + Generation Tab

Create the overlay skeleton and move the existing Controls content into it as the first tab. Event log and tech chart stay where they are; the Events/Hierarchy/Tech tabs show empty placeholders.

### Files
- **New** `src/components/UnifiedOverlay.tsx` — shell: `Draggable` wrapper, header (title + collapse button), tab bar, content switch on `activeTab`.
- **New** `src/components/overlay/GenerationTab.tsx` — moved-in Controls body (everything inside the `{!collapsed && …}` block of `Controls.tsx`).
- **Edit** `src/App.tsx` — replace the `<Controls …/>` render with `<UnifiedOverlay …/>`; pass the same props through. Delete the Controls import once nothing else references it.
- **Delete** `src/components/Controls.tsx` (only after the move is verified in the browser).

### Component API sketch

```ts
type OverlayTab = 'generation' | 'events' | 'hierarchy' | 'tech';

interface UnifiedOverlayProps {
  // Generation tab props — same shape as current ControlsProps
  seed: string; onSeedChange: (s: string) => void;
  numCells: number; onNumCellsChange: (n: number) => void;
  // … all existing Controls props …

  // Shared
  mapData: MapData | null;
  selectedYear: number;
  onYearChange: (y: number) => void;
}
```

- `activeTab` is `useState<OverlayTab>('generation')`.
- Tabs for Events/Hierarchy/Tech are rendered but disabled (grayed out in the tab bar) when `mapData?.history` is null, so users see them without being able to click empty shells.
- Overlay default position: `top: 16, right: 16` (same anchor the old Controls used).
- Overlay width: 260–300 px fixed in Phase 1. Width per tab is a Phase 5 concern.

### Acceptance checks
- [ ] Overlay appears at top-right on fresh load.
- [ ] Generation tab is selected by default, and every control (seed, cells, water, history, map view, season, layers, generate, progress bar) works identically to before.
- [ ] Overlay is draggable by its header and clamps to viewport.
- [ ] Overlay is collapsible (▴/▾) and the collapsed state hides both the tab content and the tab bar body.
- [ ] Events / Hierarchy / Tech tabs are visible but inert (placeholder `<div>Coming soon</div>`).
- [ ] `npm run build` clean.
- [ ] Old `Controls.tsx` deleted, no orphaned imports.

---

## Phase 2 — Events Tab

Move the cumulative event log from the `Timeline.tsx` side panel into the Events tab, and retire the side panel.

### Files
- **New** `src/components/overlay/EventsTab.tsx` — extracted from the `logList` render block in `Timeline.tsx` (lines ~371–397) plus the supporting `cumulativeEvents` memo, `EVENT_ICONS`, `EVENT_COLORS`.
- **Edit** `src/components/Timeline.tsx` — remove the `logOpen` state and the entire right-side `<Draggable>` block (currently ~lines 315–401). Keep the bottom playback panel untouched. Also remove the "Hide Log / Show Log" button from the bottom panel header (no longer meaningful).
- **Edit** `src/components/UnifiedOverlay.tsx` — wire the Events tab to render `EventsTab` when `activeTab === 'events'` and `mapData.history` exists. Enable the tab button when history is present.
- **Edit** `src/App.tsx` — thread `mapData` and `selectedYear` into `UnifiedOverlay`.

### Notes
- The Tech sub-panel currently lives inside the event log's `<Draggable>`. Leave it **temporarily** inside `EventsTab` in Phase 2 so the tech chart keeps rendering while Phase 3 is pending. Mark it with a `// TODO(Phase 3): move to TechTab` comment so it's easy to find.
- Preserve auto-scroll-to-bottom on year change (the `logEndRef.scrollIntoView` effect).
- Preserve the current-year highlight (`background: selectedYear === item.year ? '…22' : '…0d'`).
- Event count readout (`{cumulativeEvents.length} events`) moves into the tab header row or the overlay subtitle.

### Acceptance checks
- [ ] Event log renders inside the Events tab, identical in appearance to the old side panel.
- [ ] Scrubbing the year slider (bottom Timeline) updates the list and auto-scrolls.
- [ ] The right-side `<Draggable>` event log no longer renders anywhere.
- [ ] Tech sub-panel still renders (temporarily) inside EventsTab.
- [ ] Events tab is disabled when `mapData.history` is null; Generation tab still works in terrain-only mode.

---

## Phase 3 — Tech Tab

Promote the tech chart out of the Events tab into its own dedicated tab and scale it to full tab width.

### Files
- **New** `src/components/overlay/TechTab.tsx` — owns the canvas, `TECH_FIELD_COLORS`, `TECH_FIELD_LABELS`, and the drawing `useEffect` (currently `Timeline.tsx` lines ~131–204).
- **Edit** `src/components/overlay/EventsTab.tsx` — remove the tech sub-panel block that was parked there in Phase 2. EventsTab is now purely the event list.
- **Edit** `src/components/UnifiedOverlay.tsx` — wire TechTab when `activeTab === 'tech'` and `historyData.techTimeline` exists.

### Enhancements (in scope for this phase)
- **Dynamic width**: instead of the hardcoded 240×80, measure the tab content area via a `ref` + `ResizeObserver` and re-draw the chart when the width changes. Keep the height at ~120–160 px (more vertical real estate than the cramped sub-panel).
- **Axis labels**: add a minimal Y-axis label (peak level) and X-axis label (year 0 / year max) since the tab has room.
- **Legend layout**: keep the 9 swatches + abbreviations, but lay them out in a single row or two rows at the top of the tab rather than the tight wrap used in the sub-panel.
- **Preserve invariants** from spec stretch §5:
  - Chart is monotonic — do not dip on `TECH_LOSS` events.
  - Year cursor is drawn in the same `useEffect` as the polylines.
  - `TECH_FIELD_COLORS` stays `Record<TechField, string>` so a new field becomes a compile-time error.
  - No worker changes — read straight from `historyData.techTimeline`.

### Acceptance checks
- [ ] Tech tab renders the same 9 polylines and year cursor as the old sub-panel.
- [ ] Chart resizes responsively to the overlay width.
- [ ] EventsTab no longer contains the tech sub-panel; nothing else in the UI references it.
- [ ] Tab is disabled when `historyData.techTimeline` is undefined.
- [ ] `npm run sweep` output byte-identical (no simulation changes).

---

## Phase 4 — Hierarchy Tab

The only phase that touches data generation. Add empire-membership snapshots to `HistoryData` so the hierarchy view can reconstruct the Empire → Country → City tree at any year without re-walking thousands of events on the main thread.

### Data model additions
Research confirmed: `Country` in `types.ts` has no `empireId` field, and `HistoryGenerator.ts` only serializes EMPIRE/CONQUEST events, not empire membership. Deriving membership on the main thread would mean replaying every EMPIRE + CONQUEST event up to `selectedYear` on each scrub — too slow and fragile. Mirror the `ownershipSnapshots` pattern instead.

- **Edit** `src/lib/types.ts`:
  ```ts
  export interface EmpireSnapshotEntry {
    empireId: string;          // internal empire id (founder country id)
    name: string;              // display name (e.g. "Empire of <capital>")
    founderCountryIndex: number;  // index into HistoryData.countries
    memberCountryIndices: number[];
  }

  export interface HistoryData {
    // … existing fields …
    /** Empire membership at every 20th year, aligned with `snapshots`. */
    empireSnapshots: Record<number, EmpireSnapshotEntry[]>;
  }
  ```
- **Edit** `src/lib/history/HistoryGenerator.ts`:
  - Inside the existing decade-snapshot loop, also capture `world.mapAliveEmpires` (or the equivalent index map) and project each live empire's `memberCountryIds` into country **indices** via the existing `countryMap.idToIndex`.
  - This is an **additive** write that must not perturb any sweep metric. Guard with a single test: after wiring, run `npm run sweep -- --label hierarchy-snapshots` and diff against `baseline-a.json` — the diff should be empty modulo the new field.
  - Snapshot cadence matches `snapshots` (every 20 years) so the two can be looked up with the same `Math.floor(year / 20) * 20` formula.

### Files
- **New** `src/components/overlay/HierarchyTab.tsx` — looks up the nearest empire snapshot ≤ `selectedYear`, builds the tree, renders a collapsible list:
  ```
  ▾ Empire of Karthala (12 countries, 48 cities)
    ▾ Kingdom of Velmar (founder)
      • Velmar (capital, metropolis)
      • Aldenreach (large)
    ▸ Kingdom of Thorne
    …
  ▾ Stateless
    ▾ Free City of Ishar
      • Ishar (capital, small)
  ```
  - Empire groups are top-level. Countries not in any empire fall into a "Stateless" bucket so every live country is visible.
  - Cities under each country come from `mapData.cities` filtered by `kingdomId === country.id` and `foundedYear <= selectedYear`. (Dead-country cities can be shown grayed.)
  - Use `isAlive` at snapshot time to hide collapsed/absorbed countries, or show them with strike-through.
  - Collapsible nodes use local `useState<Set<string>>` for expanded ids.
- **Edit** `src/components/UnifiedOverlay.tsx` — wire HierarchyTab when `activeTab === 'hierarchy'`.

### Optional stretch (defer to a follow-up)
- Click a city → center the map viewport on it (needs a callback threaded through to `MapCanvasHandle.navigateTo`).
- Per-country chip showing peak tech level from `historyStats.peakCountryTechLevelByField`.
- Filter / search box at the top of the tab.

### Acceptance checks
- [ ] `HistoryData.empireSnapshots` populated; one snapshot at every 20-year tick.
- [ ] `npm run sweep` diff is empty (no behavior changes, only additive serialization). If the sweep diff shows a mismatch, something besides serialization was touched — bisect before landing.
- [ ] Hierarchy tab renders at year 0 (just-founded countries, mostly stateless) and at year 5000 (large empires) without errors.
- [ ] Scrubbing the year slider updates the tree within one frame.
- [ ] Disabled when `mapData.history` is null.

---

## Phase 5 — Polish

Only once Phases 1–4 are landing cleanly.

- **Persist active tab** across runs via `localStorage` (`overlay.activeTab`). Fall back to `'generation'`.
- **Persist overlay position** via `localStorage` (optional — depends on whether `Draggable.tsx` already does this; current reading of the file says it does not).
- **Per-tab width**: the Generation tab is cramped at 260 px, but the Tech tab benefits from more horizontal room. Let `UnifiedOverlay` read a per-tab `preferredWidth` constant and animate transitions with a short CSS transition on `width`.
- **Keyboard nav**: `Ctrl+1..4` (or similar) to switch tabs. Low priority.
- **Accessibility**: tab buttons need `role="tab"` / `aria-selected` / keyboard focus ring.
- **Delete dead code**: after Phase 3, `Timeline.tsx` should only export the bottom playback panel; rename the file to `TimelineControls.tsx` if it helps reviewers. `EVENT_ICONS` / `EVENT_COLORS` / `TECH_FIELD_*` constants should live in a single shared file (`src/components/overlay/eventStyles.ts`) now that two components consume them.
- **Responsive fallback**: on viewports < 600 px wide, dock the overlay full-width at the top and suppress dragging. Check `Draggable.tsx`'s clamp logic still holds.
- **Re-run sweep** one final time to confirm no drift: `npm run sweep -- --label overlay-final` against `baseline-a.json`.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Controls and Event Log both default to top-right, so users might miss the bottom Timeline playback panel after the merge. | Add a subtle "Show/Hide playback controls" button in the overlay header in Phase 2, wired to a `playbackVisible` state on `App.tsx`. Default visible. |
| Tech chart drawing uses canvas `setTransform` for DPR scaling; if the tab is unmounted while the canvas ref is stale, effect cleanup must not throw. | Keep the current `if (!canvas) return` early-exit pattern from `Timeline.tsx`. |
| Adding `empireSnapshots` in Phase 4 risks accidentally mutating `world.mapCountries` during serialization. | Use only read-only iteration over `mapAliveEmpires`/`mapCountries`; do not call any generator singletons. Back up with a sweep diff. |
| Removing the `logOpen` / "Show Log" button in Phase 2 changes muscle memory for existing users. | Document in the PR description; the tab bar provides the equivalent affordance (click the Events tab). |
| `Timeline.tsx` currently owns the year-scrubbing slider; the overlay needs `selectedYear` to render EventsTab and HierarchyTab. | `selectedYear` already lives in `App.tsx` state and is passed to `Timeline`. Just thread it into `UnifiedOverlay` as well — no lifting required. |
| Hardcoded `width: 220` / `width: 300` across panels will clash with per-tab widths in Phase 5. | Centralize in a `const OVERLAY_WIDTHS: Record<OverlayTab, number>` in `UnifiedOverlay.tsx` from the start (Phase 1) even if all values are initially equal. |

---

## Non-Goals

- Reworking the bottom Timeline playback panel (stays its own draggable).
- Changing the `HistoryGenerator` simulation or any Phase 5 Timeline generators — Phase 4's only touch is an **additive** serialization snapshot.
- Rewriting `Draggable.tsx`.
- Restyling the Legend or Minimap overlays.
- Theming / dark mode.
- Mobile-specific UX beyond the Phase 5 responsive fallback.

---

## Per-Phase Landing Checklist

Every phase ends with:
1. `npm run build` — clean, no new TS errors.
2. Manual smoke test: load the app, run a terrain-only generation, run a history generation, scrub the year slider.
3. For Phase 4 only: `npm run sweep -- --label overlay-phase-4` against `scripts/results/baseline-a.json` — diff must be empty outside the new `empireSnapshots` field.
4. Commit with a scoped subject: `overlay: phase N — <description>`.
5. Push to `claude/unified-overlay-tabs-hxu10`.
