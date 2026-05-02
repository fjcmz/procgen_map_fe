# Universe Renderer — Architecture & Performance Notes

## Scenes

The universe view has three scenes dispatched by `src/lib/universe/renderer.ts`:

| Scene | Entry point | Description |
|-------|-------------|-------------|
| Galaxy | `drawGalaxyScene` | All solar systems in a 2-arm logarithmic spiral, slowly rotating |
| System | `drawSystemScene` | Stars at center + orbiting planets + satellites |
| Planet | `drawPlanetScene` | Single planet close-up with satellite orbits |

Scene transitions fade through a black overlay (`TRANSITION_DUR = 0.55 s`). The
active scene is stored in `UniverseSceneState` inside `UniverseCanvas`.

---

## Galaxy Scene

### Spiral layout

`galaxySpiralPositions(count, cx, cy, spread)` places systems on a 2-arm
logarithmic spiral. Key parameters:

- `a = 8` — inner radius (spiral starts here)
- `angleStep = 0.42` — angular step per system along each arm
- `b = min(0.18, 2.42 / (maxK * angleStep))` — adaptive tightness so the outer
  arm stays within ~45% of `spread` regardless of system count
- Per-system deterministic jitter from the index breaks visible arm regularity

The function is **pure** — same inputs always produce the same positions.

### Rotation animation

Each frame `drawGalaxySpiral` applies a full-galaxy rotation:

```
angle = timeSec * GALAXY_SPIN_SPEED   (0.018 rad/s ≈ 5.8 min per revolution)
px = cx + (raw.x - cx) * cosG - (raw.y - cy) * sinG
py = cy + (raw.x - cx) * sinG + (raw.y - cy) * cosG
```

The rotation is inlined per-iteration rather than `.map()`-ing the whole array,
so no `positions[]` allocation happens per frame.

### Spiral layout cache

`getOrBuildLayout(systems, cx, cy, spread)` caches `rawPositions` and
`maxStarRadii / minR / maxR` in a module-level `Map<string, SpiralLayout>`:

- **Key**: `"${count}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}|${systems[0]?.id}"`
- **Cap**: `SPIRAL_CACHE_MAX = 10` entries, FIFO eviction
- `galaxySpiralPositions` (calls `Math.exp` per system) and the star-radius
  scan only run once per unique galaxy layout, not once per animation frame
- The cache key is stable across frames for a fixed window size and galaxy
  identity; it naturally invalidates on window resize (cx/cy/spread change)
  or when a new universe is generated (different `systems[0].id`)

### Frustum culling

`UniverseCanvas` computes `ViewBounds` each frame from the current transform:

```ts
const viewBounds: ViewBounds = {
  x0: -tx / scale,
  y0: -ty / scale,
  x1: (vw - tx) / scale,
  y1: (vh - ty) / scale,
};
```

This is passed through `drawGalaxyScene` → `drawGalaxySpiral`. Each system is
checked with `circleIntersectsViewBounds(px, py, sizePx * 1.5, viewBounds)`:

- **If outside**: skipped entirely — no draw call, no hit circle push
- **If inside**: hit circle pushed + `drawCircle` called

At the default identity transform `{scale:1, tx:0, ty:0}` the bounds equal the
canvas dimensions and nothing is culled. Culling only activates when the user
zooms or pans.

In the multi-galaxy view, galaxy glyphs are also culled when their bounding
circle falls entirely outside `ViewBounds`.

### Star rendering

Each system renders as a single solid `drawCircle` call (one `beginPath` +
`arc` + `fill`). Size is `scaleMap(maxStarRadius, minR, maxR, 4, 14, 'sqrt') * cameraScale / viewScale`.

**There is no glow.** `drawGlow` (`ctx.createRadialGradient` per system per
frame) was removed. `starFill(star)` returns a plain `string` color computed
from star composition and brightness.

### Galaxy glyph (low LOD)

At low zoom the full spiral is replaced by a 20-dot compressed glyph
(`GLYPH_DOT_COUNT = 20`) that rotates at the same speed. The transition is a
smoothstep cross-fade:

- `LOD_BLEND_START = 50 px` on-screen galaxy radius → glyph only
- `LOD_BLEND_END = 110 px` on-screen galaxy radius → spiral only
- Between: both layers drawn with complementary `globalAlpha`

---

## System Scene

- Single star: drawn at canvas center as a solid circle
- Multi-star binary: stars orbit a tight cluster (`STAR_ORBIT_SPEED = 0.08 rad/s`)
- Planets: Kepler ω ∝ r⁻¹·⁵ with seeded phase (`PLANET_K = 0.5`), sized by
  `scaleMap` in `[PLANET_MIN_PX=1, PLANET_MAX_PX=6]`
- Satellites: orbit the planet at fixed ring spacing (`SAT_BASE_ORBIT = 90`,
  `SAT_ORBIT_STEP = 44`) with Kepler speeds (`SAT_K = 0.8`)

---

## Background star field

`createStarField(vw, vh)` seeds an LCG with `STAR_FIELD_SEED = 42` (independent
of universe contents) and places 900 background stars. The field is identical
across all universe seeds. Recreated on window resize.

---

## Zoom / pan

`UniverseCanvas` holds a `ViewTransform { scale, tx, ty }` in a ref. Zoom is
applied around the cursor via `zoomAround`:

```ts
newScale = clamp(MIN_SCALE, MAX_SCALE, scale * factor)
tx = cursorX - (cursorX - tx) / scale * newScale
ty = cursorY - (cursorY - ty) / scale * newScale
```

| Constant | Value | Notes |
|----------|-------|-------|
| `MIN_SCALE` | 0.15 | Full universe overview |
| `MAX_SCALE` | 2000 | Deep zoom into individual systems |

Before calling `drawGalaxyScene` the canvas transform is set:
`ctx.setTransform(scale, 0, 0, scale, tx, ty)`. The renderer draws in
content-space coordinates; `ViewBounds` translates the screen viewport back
into that space for culling.

Hit circles are returned in content-space by the renderer and mapped to
screen-space by `transformHit` before pointer-event comparison.

---

## UI defaults

| Constant | Value | Location |
|----------|-------|----------|
| `SYSTEM_OPTIONS` | `[500, 1000, 5000, 10000]` | `UniverseOverlay.tsx` |
| System count slider max | 10000 | `UniverseOverlay.tsx` |
| `DEFAULT_SOLAR_SYSTEMS` | 500 | `UniverseScreen.tsx` |

---

## Performance invariants

- **Do NOT call `galaxySpiralPositions` outside `getOrBuildLayout`** — it does
  `Math.exp` per system and must be cached.
- **Do NOT allocate a `positions[]` array per frame** — inline the rotation in
  the draw loop as currently done.
- **Do NOT push hit circles before the cull check** — offscreen systems produce
  no screen-visible targets; accumulating their hit circles wastes memory and GC
  budget at high system counts.
- **Do NOT add `ctx.createRadialGradient` back** per visible system — at high
  system counts this is the dominant per-frame GPU state cost. If a glow effect
  is ever reintroduced, gate it behind a zoom-level threshold and batch it.
