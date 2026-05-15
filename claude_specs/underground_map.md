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

Module: `src/lib/underground/generator.ts`. Entry point:

```ts
generateUnderground(
  seed: string,           // world seed; module derives sub-streams internally
  width: number,          // world rect width (same as surface map)
  height: number,
  cells: Cell[],          // surface cells, read-only — used for connection-point sampling
): UndergroundMap
```

Determinism contract: same `(seed, width, height, cells)` produces a byte-identical `UndergroundMap`. The function makes **no mutations** to `cells`. Because the output ships across `postMessage`, the structure stays plain data (no `Map`/`Set`).

Pipeline (each step uses its own sub-stream so future tuning of one slice cannot perturb the others):

1. **Large caverns** — 2–20 blobs covering ~30 % of total world area combined.
   Sub-stream: `${seed}_underground_largecaverns`.
   Algorithm sketch: Poisson-disk pick centres; each cavern is a metaball / blob with radius drawn so cumulative area lands in [0.27, 0.33] of `width*height`. Stored as `{ cx, cy, polygonPoints }` (cached polyline, not regenerated at draw time).

2. **Small caverns** — 5–50 smaller blobs.
   Sub-stream: `${seed}_underground_smallcaverns`.
   Same primitive as large caverns, with smaller radius and tighter Poisson-disk spacing. Caverns are allowed to abut large caverns but not fully overlap them.

3. **Maze clusters** — 3–10 dungeon-like clusters of tightly-packed mini-caverns + interconnecting passages.
   Sub-stream: `${seed}_underground_maze_<i>` (per cluster).
   Algorithm sketch: pick a cluster bounding region, place 4–12 mini-caverns inside it on a jittered grid, then connect them with a randomised-DFS / Prim maze. Each cluster stored as `{ bbox, miniCaverns[], mazeEdges[] }`.

4. **Tunnel graph** — narrow tunnels connecting every cavern + maze cluster so the connectivity graph has exactly one component.
   Sub-stream: `${seed}_underground_tunnels`.
   Algorithm sketch:
   - Treat large caverns, small caverns, and maze clusters as graph nodes (anchored at their centroid).
   - Build a Delaunay triangulation of node centroids.
   - Take a Minimum Spanning Tree over the triangulation as the **mandatory** edges (guarantees no isolated cavern).
   - Add ~10–20 % extra edges from the triangulation's non-MST set to introduce loops (more interesting traversal).
   - Each edge is rendered as a Bezier or noise-perturbed polyline so tunnels don't look ruler-straight. Stored as `path: {x:number,y:number}[]`.

5. **Surface connection points** — 4–20 points where the underground meets the surface map.
   Sub-stream: `${seed}_underground_connections`.
   Each connection is `{ cavernId, surfaceCellIndex, xy: {x,y} }`:
   - Pick the cavern via weighted random (bias toward large caverns).
   - Find a surface cell whose centroid lies within the cavern polygon and which is **land** (not `isWater`, not `isLake`).
   - If none exists for a given cavern, fall back to the nearest land cell to the cavern centre.

Output:

```ts
interface UndergroundMap {
  seed: string;            // `${worldSeed}_underground`, stamped for cache keying
  width: number;
  height: number;
  largeCaverns: Cavern[];
  smallCaverns: Cavern[];
  mazeClusters: MazeCluster[];
  tunnels: Tunnel[];       // every cavern & cluster reachable via these edges
  connections: UndergroundConnection[];
}

interface Cavern {
  id: string;              // e.g. "lg_0", "sm_12"
  cx: number; cy: number;
  polygon: { x: number; y: number }[];   // closed, CCW
  areaApprox: number;
}

interface MazeCluster {
  id: string;              // e.g. "mz_3"
  bbox: { x: number; y: number; w: number; h: number };
  miniCaverns: Cavern[];
  edges: { from: string; to: string; path: { x: number; y: number }[] }[];
}

interface Tunnel {
  from: string;             // cavern or maze-cluster id
  to: string;
  path: { x: number; y: number }[];   // polyline
  mandatory: boolean;       // true for MST edges, false for added loops
}

interface UndergroundConnection {
  cavernId: string;         // id of the cavern/cluster the entrance leads into
  surfaceCellIndex: number; // index into `MapData.cells` of the surface tile
  xy: { x: number; y: number };  // entrance position in world coords
}
```

`UndergroundMap` is plain data (no `Map`/`Set`) so it can cross the worker boundary via `postMessage` without a serializer. There is no class layer for underground entities — the generation is one-shot and there's no per-year simulation to mutate them.

## Rendering

Module: `src/lib/underground/renderer.ts` (proposed). Entry point:

```ts
drawUnderground(
  ctx: CanvasRenderingContext2D,
  underground: UndergroundMap,
  layers: UndergroundLayerVisibility,
): void
```

Render order:
1. Solid dark-stone background fills the whole canvas.
2. Large caverns (filled lighter-stone polygons, soft edges).
3. Small caverns (filled, slightly darker than large).
4. Maze clusters (tight grid fill, dungeon-room style hatching).
5. Tunnels (1–3 px polylines; mandatory edges slightly thicker than loop edges).
6. Connection-point icons (stairs / chasm glyph) at each connection's `xy`.
7. (Optional) overlay the world seed + counts in a corner debug HUD.

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
| `${seed}_underground_largecaverns` | Large cavern centres + polygons |
| `${seed}_underground_smallcaverns` | Small cavern centres + polygons |
| `${seed}_underground_maze_<i>` | Per-cluster maze layout |
| `${seed}_underground_tunnels` | Tunnel graph (Delaunay → MST + loops) |
| `${seed}_underground_connections` | Surface connection-point picks |

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
