# Underground Map

This file documents the **underground map layer**: a per-world cavern + tunnel network that sits "beneath" the surface terrain and is shown via a toggle in the Generation tab. Read `CLAUDE.md` first for framework conventions (worker boundary, RNG sub-streams) and `world_map.md` for the surface pipeline this layer hangs off.

## Goal

For some rocky worlds, expose an **alternate map view** that depicts a planet-wide system of caverns and tunnels (Underdark-style). The view is a sibling to the surface map at the same zoom level — toggled, not nested — and is **render-only**: it does not feed into history, cities, kingdoms, resources, characters, or any other simulation layer.

## Where it sits in the architecture

Underground generation runs **eagerly inside `mapgen.worker.ts`** after the rest of the world map (and optional history) is complete:

```
voronoi → terrain pipeline → buildPhysicalWorld
  → (if generateHistory) HistoryGenerator → roads
  → underground (eligibility roll + generation)   ◄── this spec
```

Concretely:
- The worker computes the cavern/tunnel graph for every world for which `seededPRNG('${seed}_underground_present')() < req.undergroundChance`, and ships the resulting `UndergroundMap` on `MapData`.
- All randomness routes through isolated sub-streams `${worldSeed}_underground_*` so the world-history sweep stays byte-identical (`scripts/results/baseline-a.json`).
- Generation must NEVER mutate `cells[i]` — caverns are an overlay on top of read-only surface terrain.
- The view itself is render-only: no history, no kingdoms, no resources, no characters touch it.

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
   Poisson-disk-sample seed cells; for each seed, BFS-grow a footprint of cells up to a randomised target size so the combined cell count lands near `0.30 * UNDERGROUND_CELL_COUNT`. Each grown footprint becomes a `Cavern { id, kind: 'large', cellIndices, cx, cy }` record; cells flip to `category: 'cavern'` and record the cavern id.

2. **Small caverns** — 5–50 caverns of 2–12 cells each.
   Sub-stream: `${seed}_underground_smallcaverns`.
   Same BFS-grow primitive as large caverns, with smaller target sizes and tighter Poisson-disk spacing. Cells already owned by another cavern are skipped (no overlaps).

3. **Maze clusters** — 3–10 cluster anchors plus 3–8 mini-caverns each, wired with single-cell maze passages.
   Sub-streams: `${seed}_underground_maze_top` (anchor placement), `${seed}_underground_maze_<i>` (per-cluster flesh-out).
   For each cluster anchor: BFS-grow a small (2–4 cell) seed cavern, then place 3–8 additional mini-caverns nearby (each 1–3 cells), and A*-path single-cell tunnels between them. Maze-internal tunnel cells carry `cavernId = cluster.id` so the renderer paints the whole cluster cohesively.

4. **Inter-cavern tunnel graph** — single-cell-wide tunnel chains connecting every top-level cavern so the connectivity graph has exactly one component.
   Sub-stream: `${seed}_underground_tunnels`.
   Treat each large cavern, small cavern, and top-level maze cluster as a node anchored at its centroid. Build a Minimum Spanning Tree by closest-pair (mandatory edges) plus ~10–20 % extra edges over the same node set (loop edges). For each edge: A*-path through the cell graph from one cavern's boundary cell nearest the other → the other cavern's boundary cell nearest the first. Costs prefer fresh solid rock (1.0) and existing tunnels (0.4); cavern cells are blocked. Path cells flip to `category: 'tunnel'`, `cavernId: null` (so the renderer paints them with the generic tunnel colour rather than a cluster colour).

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

All sub-streams are consumed locally; their draws never leak back into the world-map or universe RNG.

## File layout

```
src/lib/underground/
├── index.ts              # barrel — public API
├── types.ts              # UndergroundMap, Cavern, Tunnel, MazeCluster, UndergroundConnection
├── eligibility.ts        # undergroundChance(bodyKind, subtype)
├── generator.ts          # generateUnderground(seed, width, height, cells)
├── renderer.ts           # drawUnderground(ctx, underground, layers, transform)
```

## Verification

- **Type-check**: `npm run build`.
- **Sweep**: `npm run sweep -- --label underground-feature`. Diff against `scripts/results/baseline-a.json` — **must be a zero-diff** because (a) the sweep harness emits only `HistoryStats`, which has no underground fields, and (b) underground generation routes through isolated sub-streams that don't perturb history rolls. A non-zero diff means a sub-stream draw leaked.
- **Visual check**: in `npm run dev`, generate enough worlds to see at least one with `hasUnderground=true`, flip the toggle, walk a few cavern-to-cavern paths visually, confirm every cavern is reachable (the renderer should add a debug "isolated cavern" warning if the graph ever has more than one component).

## Pitfalls

- **Sub-stream isolation is the entire correctness contract for the sweep.** Every random draw in the underground module must use one of the listed sub-streams — never the main `rng` parameter from a calling site, never `Math.random()`. If `npm run sweep` shows a non-zero diff after underground-only changes, a draw leaked.
- **No history coupling.** The underground layer does not place cities, regions, resources, kingdoms, characters, or anything that participates in the timeline simulation. If a future requirement wants e.g. "drow city in this cavern", that lives in the history layer, takes the `UndergroundMap` as **input**, and requires its own design + spec update.
- **Surface cells are read-only.** `generateUnderground` may not mutate `cells[i]`. Cavern footprints don't change biome, elevation, or `regionId`. The renderer paints over the surface canvas in underground mode, but the underlying `cells` array is untouched.
- **Gas giants have no underground.** The worker's gas-band branch returns before the underground step, so `hasUnderground` is `undefined` on gas worlds. UI must treat `undefined === false` (no toggle).
- **Connection-point land check matters.** A connection placed on a water/lake cell would render as an undersea staircase — confusing. Always filter eligible surface cells to land before sampling.
- **`undergroundChance` clamps to [0, 1] in the worker.** Don't trust the request value — clamping is cheap and protects against UI bugs that pass NaN / out-of-range.
