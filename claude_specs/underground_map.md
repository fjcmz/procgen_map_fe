# Underground Map

This file documents the **underground map layer**: a per-world cavern + tunnel network that sits "beneath" the surface terrain and is shown via a toggle in the Generation tab. Read `CLAUDE.md` first for framework conventions (worker boundary, RNG sub-streams) and `world_map.md` for the surface pipeline this layer hangs off.

## Goal

For some rocky worlds, expose an **alternate map view** that depicts a planet-wide system of caverns and tunnels (Underdark-style). The view is a sibling to the surface map at the same zoom level — toggled, not nested. Geometry is render-only; the **resource layer is sim-integrated** — cavern resources land on surface regions before year-0 discovery so countries with overlapping territory can discover, trade, and fight over them.

## Where it sits in the architecture

Underground generation runs **eagerly inside `mapgen.worker.ts`** BEFORE the history pipeline so that cavern-resource attachment can happen during `buildPhysicalWorld` (after surface resources land, before the year-0 `discoveredResources` bootstrap):

```
voronoi → terrain pipeline → underground (eligibility roll + generation)   ◄── this spec
  → (if generateHistory) HistoryGenerator
        └─ buildPhysicalWorld
              └─ attachUndergroundResources (projects caverns to surface regions)
        └─ TimelineGenerator → roads
  → MapData
```

Concretely:
- The worker rolls eligibility on `${seed}_underground_present` and, on a hit, calls `generateUnderground(seed, width, height, cells)` to build the cavern/tunnel graph.
- The graph (plus the `${seed}_underground_resources` deposit roll inside `buildPhysicalWorld`) lands on `MapData.underground` and on each affected `RegionData.resources` entry (`subterranean: true` + `undergroundCellIndex`).
- All randomness routes through isolated sub-streams `${worldSeed}_underground_*` so worlds without an underground stay byte-identical to the pre-feature sweep, and the worlds that DO have one only drift the simulation in the way the integration intends (more resources → different trade / war / wealth metrics).
- Generation must NEVER mutate `cells[i].biome` / `.elevation` / `.regionId` — caverns and their projected resources remain an overlay over the surface terrain. `attachUndergroundResources` does append to `region.resources` and `region.cellResources` (the in-worker entities), which is the deliberate sim-integration coupling.

## Eligibility (which worlds have an underground)

Rolled **once** inside the worker, via a dedicated sub-stream `${seed}_underground_present`, so the boolean is deterministic per world and the roll is independent of every other worker RNG draw. The chance itself is passed in on `GenerateMapRequest.undergroundChance: number` (clamped to [0, 1]). When omitted (e.g. user generates a world directly from the landing screen without picking a body), the worker defaults to 0.45 — the same value as a generic rocky-life body.

| `bodyKind` (planet/satellite) | Subtype hint | `undergroundChance` |
|---|---|---|
| `gas-giant` | (all gas subtypes) | **0.00** — never |
| `rocky-life` | (any life biome) | 0.45 |
| `rocky-barren` — `volcanic` | lava tubes | **0.60** |
| `rocky-barren` — `lava` | partially-cooled crust | 0.55 |
| `rocky-barren` — `terrestrial` / `cratered` / `desert` / `desert_moon` / `carbon` | | 0.45 |
| `rocky-barren` — `iron` / `iron_rich` | dense crust, fewer voids | 0.40 |
| `rocky-barren` — `ice_rock` | | 0.35 |
| `rocky-barren` — `ocean` | sub-seabed only | **0.30** |
| `ice-shell` (all ice satellite subtypes) | thin brittle crust | 0.30 |

Source of truth for the table: `src/lib/underground/eligibility.ts` — pure function `undergroundChance(bodyKind, subtype): number`. Consumed by `bodyToProfile.ts`, which stamps `undergroundChance` onto `BodyGenSpec`; `App.tsx` forwards it onto the worker request. The universe handoff is therefore the single integration point.

**Bounds**: every non-zero value sits in the 0.30–0.60 band requested in the original spec. Tune freely within that band; don't introduce a value outside it without a note here.

## Generation (eager, in-worker)

**Same polygon language as the surface map.** The underground builds its own Voronoi cell graph (independent of the surface graph), and every cell is classified as `solid` / `cavern` / `tunnel`. Caverns are BFS-grown groups of polygons (the underground equivalent of a region); tunnels are single-cell-wide chains found by A*-path between cavern boundaries. The renderer paints cells polygon-by-polygon, mirroring `drawBiomeFill` on the surface side.

Module: `src/lib/underground/generator.ts`. Entry point:

```ts
generateUnderground(
  seed: string,           // world seed; module derives sub-streams internally
  width: number,          // world rect width (same as surface map)
  height: number,
  cells: Cell[],          // surface cells, read-only — used for connection-point sampling
): UndergroundMap
```

Determinism contract: same `(seed, width, height, surfaceCells)` produces a byte-identical `UndergroundMap`. The function makes **no mutations** to `surfaceCells`. Because the output ships across `postMessage`, the structure stays plain data (no `Map`/`Set`).

Pipeline (each step uses its own sub-stream so future tuning of one slice cannot perturb the others):

0. **Build the underground Voronoi graph.** `buildCellGraph(\`${seed}_underground_graph\`, surfaceCells.length, width, height)` produces an independent polygon graph sized to **match the surface map's cell count** so polygon density looks consistent across the two views. The graph layout itself is independent — the seed `${seed}_underground_graph` is isolated from the surface RNG. Each cell starts as `category: 'solid'`, `cavernId: null`. The result ships on `UndergroundMap.cells`.

1. **Large caverns** — 2–20 caverns covering ~30 % of the underground graph by cell count.
   Sub-stream: `${seed}_underground_largecaverns`.
   Poisson-disk-sample seed cells (min-distance derived from per-cavern radius); for each seed, BFS-grow a footprint of cells up to a randomised target size so the combined cell count lands near `0.30 * surfaceCells.length`. Each grown footprint becomes a `Cavern { id, kind: 'large', cellIndices, cx, cy }` record; cells flip to `category: 'cavern'` and record the cavern id.

2. **Small caverns** — 5–50 caverns of 2–12 cells each.
   Sub-stream: `${seed}_underground_smallcaverns`.
   Same BFS-grow primitive as large caverns. Poisson-disk min-distance is **world-coordinate-based** (`sqrt(width*height/25) * 0.7`) so spacing stays visually stable whether the user picks 10k or 200k cells. Cells already owned by another cavern are skipped (no overlaps).

3. **Maze clusters** — 3–10 cluster anchors plus 3–8 mini-caverns each, wired with single-cell maze passages.
   Sub-streams: `${seed}_underground_maze_top` (anchor placement, `sqrt(width*height/6) * 0.75` spacing) and `${seed}_underground_maze_<i>` (per-cluster flesh-out).
   For each cluster anchor: BFS-grow a small (2–4 cell) seed cavern, then place 3–8 additional mini-caverns nearby (each 1–3 cells), and A*-path single-cell tunnels between them. Maze-internal tunnel cells carry `cavernId = cluster.id` so the renderer paints the whole cluster cohesively.

4. **Inter-cavern tunnel graph** — single-cell-wide tunnel chains connecting every top-level cavern so the connectivity graph has exactly one component.
   Sub-stream: `${seed}_underground_tunnels`.
   Treat each large cavern, small cavern, and top-level maze cluster as a node anchored at its centroid. Build a Minimum Spanning Tree by closest-pair (mandatory edges) plus ~10–20 % extra edges over the same node set (loop edges). For each edge: A*-path through the cell graph from one cavern's boundary cell nearest the other → the other cavern's boundary cell nearest the first. Costs prefer fresh solid rock (1.0) and existing tunnels (0.4); cavern cells are blocked. Path cells flip to `category: 'tunnel'`, `cavernId: null` (so the renderer paints them with the generic tunnel colour rather than a cluster colour). A* uses an inline binary min-heap so it scales to the default 100k-cell graph.

5. **Surface connection points** — 4–20 entrances mapping a cavern cell (in the underground graph) to a land cell (in the surface graph).
   Sub-stream: `${seed}_underground_connections`.
   Each connection is `{ cavernId, surfaceCellIndex, undergroundCellIndex, xy }`:
   - Pick the cavern via weighted random over **top-level** caverns (large/small/maze-anchor), with weights proportional to member-cell count.
   - Pick a random member cell of that cavern as `undergroundCellIndex`.
   - Find the nearest land surface cell (not `isWater`, not `isLake`) and record its index as `surfaceCellIndex`. `xy` is that surface cell's centroid.
   Mini-caverns inside maze clusters are excluded from entrance placement so entrances don't cluster unrealistically.

Output:

```ts
interface UndergroundMap {
  seed: string;            // `${worldSeed}_underground`, stamped for cache keying
  width: number;
  height: number;
  cells: UndergroundCell[];
  caverns: Cavern[];       // every large/small/maze cavern (mini-caverns nested via id naming)
  connections: UndergroundConnection[];
}

type UndergroundCellCategory = 'solid' | 'cavern' | 'tunnel';
type CavernKind = 'large' | 'small' | 'maze';

interface UndergroundCell {
  index: number;
  x: number;
  y: number;
  vertices: [number, number][];
  wrapVertices?: [number, number][];   // seam-straddling cells, mirrors Cell.wrapVertices
  neighbors: number[];
  category: UndergroundCellCategory;
  /** Cavern this cell belongs to. Solid cells: always null. Cavern cells:
   *  the owning cavern. Tunnel cells: null for inter-cavern tunnels;
   *  a maze cluster id for tunnels internal to that cluster. */
  cavernId: string | null;
}

interface Cavern {
  id: string;              // "lg_0", "sm_12", "mz_3" (top-level) or "mz_3_2" (cluster mini-cavern)
  kind: CavernKind;
  cellIndices: number[];   // indices into UndergroundMap.cells
  cx: number;              // centroid (for tunnel-path endpoints + entrance placement)
  cy: number;
}

interface UndergroundConnection {
  cavernId: string;
  surfaceCellIndex: number;     // index into MapData.cells (the surface graph)
  undergroundCellIndex: number; // index into UndergroundMap.cells
  xy: { x: number; y: number }; // surface-coordinate position of the entrance icon
}
```

Cell-id convention: top-level caverns use a 2-token id (`lg_0`, `sm_12`, `mz_3`); maze cluster mini-caverns are 3 tokens (`mz_3_2`). The inter-cavern tunnel pass treats only 2-token caverns as graph nodes, so maze cluster internals are routed locally and entrance sampling skips mini-caverns.

`UndergroundMap` is plain data (no `Map`/`Set`) so it can cross the worker boundary via `postMessage` without a serializer. There is no class layer for underground entities — the generation is one-shot and there's no per-year simulation to mutate them.

## Rendering

Module: `src/lib/underground/renderer.ts`. Entry point:

```ts
drawUnderground(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  width: number,
  height: number,
): void
```

Render order:
1. Solid dark-stone background fills the whole canvas (covers any sliver gaps between cell polygons).
2. Pass 1 — fill every cell polygon with a colour determined by `(category, cavern.kind)`:
   - `solid` → dark stone
   - `cavern` (`kind: 'large'`) → lighter stone
   - `cavern` (`kind: 'small'`) → mid stone
   - `cavern` (`kind: 'maze'`) → maze cavern shade
   - `tunnel` (`cavernId === null`) → passage colour
   - `tunnel` (`cavernId !== null`) → maze-passage colour (paints maze cluster cohesively)
   Each cell's `wrapVertices` (if present) is drawn as a second polygon so the east-west seam stays seamless.
3. Pass 2 — thin polygon outlines on non-solid cells only (helps read the polygon structure at high zoom; solid↔solid edges blend into the background and don't need a stroke).
4. Pass 3 — connection-point pips at each connection's underground cell centroid.

The **surface map** also gains an optional overlay: when `underground` is generated and the user enables "show connection points", paint a small glyph at each connection's surface cell centroid. This makes the two views correlate. The overlay is off by default and lives behind a `layers.undergroundConnections` flag in `LayerVisibility`.

History overlays (kingdoms, roads, tech, religion, country borders, etc.) are **not** drawn on the underground view — the underground layer is render-only and has no kingdoms.

## UI integration

- **Generation tab**: add a "View" toggle (segmented control: `Surface | Underground`) visible only when `mapData.hasUnderground === true`. Default: `Surface`.
- The toggle is **pure UI state** held in `App.tsx` — flipping it tells `MapCanvas` to switch its draw path. The `UndergroundMap` itself is already on `mapData.underground`, so the toggle is render-cheap.
- Minimap, Legend, Timeline, and history overlays are hidden / disabled while the underground view is active.
- **Layers list**: a new `undergroundConnections` flag (default false) toggles the small entrance-glyph overlay on the **surface** map at each connection point's surface cell. Visible regardless of whether the underground view is active.

## Worker-side touchpoints

`mapgen.worker.ts` integrates the underground generator as a final post-history step:

1. After history + roads (or after `buildPhysicalWorld` if history is off), roll eligibility:
   ```ts
   const chance = Math.max(0, Math.min(1, req.undergroundChance ?? 0.45));
   const presentRng = seededPRNG(`${seed}_underground_present`);
   const hasUnderground = chance > 0 && presentRng() < chance;
   ```
2. If `hasUnderground === true`, generate the `UndergroundMap`:
   ```ts
   const underground = generateUnderground(seed, width, height, cells);
   ```
3. Stamp `{ hasUnderground, underground }` onto the emitted `MapData`.

Gas-giant worlds short-circuit earlier (the gas-band branch returns before reaching this step) so we never roll underground for them.

`BodyGenSpec` (in `src/lib/universe/bodyToProfile.ts`) gains an `undergroundChance: number` field, populated via `undergroundChance(bodyKind, subtype)`. `App.tsx` forwards `spec.undergroundChance` onto the worker request. Direct world-map landings (no body context) default to 0.45.

## `MapData` additions

```ts
interface MapData {
  // … existing fields …

  /** Set by the worker; true if this world has an underground map.
   *  When false (or undefined), the Generation-tab toggle stays hidden. */
  hasUnderground?: boolean;
  /** Eager underground graph — present iff hasUnderground === true. */
  underground?: UndergroundMap;
}
```

`UndergroundMap` is plain data (no `Map`/`Set`) so the structured clone in `postMessage` handles it natively.

## Seed sub-streams (add to CLAUDE.md table)

| Sub-stream | Purpose |
|---|---|
| `${seed}_underground_present` | Worker-side eligibility gate (one boolean per world) |
| `${seed}_underground_graph` | Voronoi cell graph for the underground (passed to `buildCellGraph`) |
| `${seed}_underground_largecaverns` | Large cavern seeds + BFS-grow |
| `${seed}_underground_smallcaverns` | Small cavern seeds + BFS-grow |
| `${seed}_underground_maze_top` | Maze cluster anchor placement |
| `${seed}_underground_maze_<i>` | Per-cluster mini-cavern placement + internal passages |
| `${seed}_underground_tunnels` | Inter-cavern A* tunnel graph (MST + loops) |
| `${seed}_underground_connections` | Surface↔underground entrance picks |
| `${seed}_underground_resources` | Cavern deposit rolls in `attachUndergroundResources` (sim-integrated layer) |

All sub-streams are consumed locally; their draws never leak back into the world-map or universe RNG. Seeds that fail the `_present` roll never consume any other underground stream, so the sweep stays byte-identical on those seeds.

## Resources (sim-integrated)

Underground resources mirror the surface resource pipeline but run on the cavern graph and attach to **surface** regions via projection. The single shared catalog (`src/lib/history/physical/ResourceCatalog.ts`) holds both surface and underground specs, distinguished by three new `HabitatSpec` fields:

- `requiresUnderground: true` — spec ONLY spawns in caverns (e.g. `cave_fungi`, `mithril`). Surface scoring rejects it.
- `allowsUnderground: true` — spec spawns in both biomes. Used on iron, copper, coal, gold, silver, platinum, marble, granite, limestone, obsidian, diamonds, rubies, sapphires so familiar deposits exist below ground too.
- `cavernKinds: ['large' | 'small' | 'maze'][]` — optional whitelist filter. Crystal galleries favour large caverns; fungi pockets favour small/maze.

Four new `ResourceCategory` entries cover the underground-thematic specs:

| Category | Tech field | common | uncommon | rare | veryRare | Members |
|---|---|---|---|---|---|---|
| `subterranean_flora` | industry | 2 | 5 | 15 | 30 | cave_fungi, cave_lichen, glowcaps, deep_moss, phosphorescent_algae |
| `subterranean_fauna` | industry | 2 | 5 | 15 | 30 | cavefish, bat_guano, glowworms |
| `subterranean_mineral` | industry | 3 | 8 | 20 | 35 | rocksalt, gypsum, sulfur, nitre, geodes, crystal_formations |
| `mythic_metals` | industry | 20 | 25 | 30 | 45 | mithril (rare), adamantine (veryRare), starsteel (veryRare) |

All underground entries gate on `industry`, not `exploration`, so the lowest level is `industry 2` and `isCommonUnlockedAtZero` never returns true for them. Countries cannot trade cave deposits until they invest in mining tech, which is the design intent.

### Placement algorithm

Inside `buildPhysicalWorld`, after the per-region surface resource loop and after orphan absorption (Step 6), `attachUndergroundResources` walks every cavern:

1. Roll target count by cavern kind: `large = 2 + floor(rng()*4)`, `small = 1 + floor(rng()*2)`, `maze = 1 + floor(rng()*3)`. Sub-stream: `${seed}_underground_resources`.
2. Score each cavern cell uniformly (no biome/climate inputs). Eligible specs satisfy `requiresUnderground || allowsUnderground`; `cavernKinds` (when present) filters by `cavern.kind`. Weighted-pick from the resulting pool.
3. Construct `Resource(undergroundCellIndex, type, rng, abundance, subterranean: true, undergroundCellIndex)`. RNG budget per cavern is `1 + count * 14`, with 14-call burns when count exceeds available cells or eligible specs (mirroring the surface generator).
4. For each placed deposit, find the nearest surface-cell centroid via linear scan over `cells`. If the projected surface cell has no `regionId` (open ocean / unowned land), drop the deposit silently — the deposit still consumed RNG so the per-cavern budget is deterministic. Otherwise re-key `cellIndex` to the projected surface cell and push the resource onto `region.resources` + `region.cellResources` for that region.
5. Mirror the attachment into `regionData[regionId].resources` with `subterranean: true` and the original `undergroundCellIndex` preserved (so the renderer can paint icons on the underground canvas).

### Render-only resource overlay

`drawUndergroundResourceOverlay(ctx, regions, underground)` in `src/lib/underground/renderer.ts` walks every `regions[].resources` array, filters `subterranean === true && undergroundCellIndex !== undefined`, looks up the underground cell's `(x, y)`, and draws the legacy 3-category icon (strategic / agricultural / luxury) reused from `src/lib/renderer/renderer.ts`. The overlay is wired into `MapCanvas.tsx` under the `worldView === 'underground'` branch and runs inside the same three-offset wrap loop as `drawUnderground` for east-west seam continuity.

### DetailsTab marker

`ResourceAggregate` gains a `subterranean: boolean` field, OR-ed across aggregated deposits of the same type. `ResourceList` displays a `▼` glyph before the resource name when any contributing deposit is underground. Tech-gating is unchanged: the existing `requiredTechField` / `requiredTechLevel` round-trip on `RegionResourceData` correctly locks underground resources until the country's `industry` tech reaches the gate.

### Sweep impact

Sweep seeds that fail the `${seed}_underground_present` roll consume zero additional RNG and stay byte-identical to the pre-feature baseline. Seeds that pass produce underground resources that drift trade / war / population / country counts in `HistoryStats` because resources feed those simulations. The sweep harness in `scripts/sweep-worker.ts` mirrors the worker order: roll `_underground_present`, generate the cavern graph, pass `underground` into `historyGenerator.generate`. Rebase `scripts/results/baseline-a.json` whenever the resource catalog or placement algorithm changes.

## File layout

```
src/lib/underground/
├── index.ts              # barrel — public API
├── types.ts              # UndergroundMap, UndergroundCell, Cavern, UndergroundConnection
├── eligibility.ts        # undergroundChance(bodyKind, subtype) + DEFAULT_UNDERGROUND_CHANCE
├── generator.ts          # generateUnderground(seed, width, height, surfaceCells)
└── renderer.ts           # drawUnderground / drawConnectionOverlay
```

## Verification

- **Type-check**: `npm run build`.
- **Sweep**: `npm run sweep -- --label underground-feature`. Diff against `scripts/results/baseline-a.json` — **must be a zero-diff** because (a) the sweep harness emits only `HistoryStats`, which has no underground fields, and (b) underground generation routes through isolated sub-streams that don't perturb history rolls. A non-zero diff means a sub-stream draw leaked.
- **Visual check**: in `npm run dev`, generate enough worlds to see at least one with `hasUnderground=true`, flip the toggle, walk a few cavern-to-cavern paths visually, confirm every cavern is reachable (the renderer should add a debug "isolated cavern" warning if the graph ever has more than one component).

## Pitfalls

- **Sub-stream isolation is the entire correctness contract for the sweep.** Every random draw in the underground module must use one of the listed sub-streams — never the main `rng` parameter from a calling site, never `Math.random()`. If `npm run sweep` shows a non-zero diff after underground-only changes, a draw leaked.
- **The sweep harness MUST mirror underground generation.** `scripts/sweep-worker.ts` rolls `${seed}_underground_present`, generates the cavern graph, and passes the `UndergroundMap` into `historyGenerator.generate`. Underground resources land on surface regions and feed trade / war / wealth metrics — so a sweep that skipped the underground would diverge from in-browser runs. When the resource catalog or placement algorithm changes, rebase `scripts/results/baseline-a.json` in the same commit.
- **Geometry is render-only; resources are sim-integrated.** Caverns, tunnels, and connections never participate in the simulation — no cities, no kingdoms, no characters live there. The sim-coupling is exclusively through `attachUndergroundResources`: cavern resources project onto surface regions and ride the existing tech-discovery / trade machinery from there. If a future requirement wants e.g. "drow city in this cavern", that's a separate feature that needs its own design + spec update.
- **Surface cells are read-only.** `generateUnderground` may not mutate `cells[i]`. Cavern footprints don't change biome, elevation, or `regionId`. The renderer paints over the surface canvas in underground mode, but the underlying `cells` array is untouched.
- **Underground cell count = surface cell count.** `buildCellGraph` is called with `surfaceCells.length`, not a fixed constant. Don't reintroduce a fixed `UNDERGROUND_CELL_COUNT` — the user-facing contract is that polygon density matches across the two views. The graph LAYOUT remains independent (own `${seed}_underground_graph` sub-stream).
- **World-geometry-based Poisson spacing for small caverns + maze clusters.** Don't switch back to `Math.sqrt(cells.length)`-style heuristics — those scale wrong and cause clumping/sparseness as the user changes cell count. Use `sqrt(width*height/N) * factor` so spacing stays world-stable.
- **Gas giants have no underground.** The worker's gas-band branch returns before the underground step, so `hasUnderground` is `undefined` on gas worlds. UI must treat `undefined === false` (no toggle).
- **Connection-point land check matters.** A connection placed on a water/lake cell would render as an undersea staircase — confusing. Always filter eligible surface cells to land before sampling.
- **`undergroundChance` clamps to [0, 1] in the worker.** Don't trust the request value — clamping is cheap and protects against UI bugs that pass NaN / out-of-range.
- **History-only path preserves underground via App-side merge.** When the user clicks "Generate History" on an existing terrain map, the worker's `GENERATE_HISTORY` response doesn't carry `underground`/`hasUnderground`. `App.tsx`'s DONE handler merges them from the previous `mapData` — don't drop that merge or the toggle vanishes after the second click.
- **Top-level vs mini-cavern id convention.** Top-level caverns use a 2-token id (`lg_0`, `sm_12`, `mz_3`); maze cluster mini-caverns use 3 tokens (`mz_3_2`). The inter-cavern tunnel pass and entrance-sampling step both use this token-count check to filter for top-level caverns. If the id format changes, those filters need to change too.
