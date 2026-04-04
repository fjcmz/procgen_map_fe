# Realism Improvements — Phased Recommendations

Assessment based on 15 screenshots taken with seed `map_xxxxl`, 100k cells, 65% water ratio, covering the full 5000-year timeline.

**Overall realism score: 6.5 / 10**

---

## Phase 1: High-Impact Climate & Biome Fixes

These changes would produce the single biggest visual improvement toward Earth-like geography. They address the root cause of the "wall of green" problem — moisture distribution is too uniform, so the Whittaker biome table collapses into a narrow band of outputs.

### 1.1 Rain Shadow Effect
**File**: `src/lib/terrain/moisture.ts`
**Problem**: Moisture is assigned via pure FBM noise, ignoring terrain. On Earth, mountain ranges block prevailing winds, creating arid zones on the leeward side (Atacama behind the Andes, Gobi behind the Himalayas, Great Basin behind the Rockies).
**Approach**:
- Define a prevailing wind direction per latitude band (e.g., easterly trades near equator, westerlies at mid-latitudes).
- After computing base moisture from noise, walk each cell's wind-facing direction uphill. If a high-elevation cell is upwind, reduce moisture proportionally to the elevation barrier.
- This naturally produces deserts in continental interiors and behind mountain chains.

### 1.2 Continentality Gradient
**File**: `src/lib/terrain/moisture.ts`
**Problem**: Cells far from the coast are just as wet as coastal cells. On Earth, distance from the ocean is one of the strongest predictors of aridity (Sahara, Central Asian steppes, Australian outback).
**Approach**:
- BFS from all coastal cells to compute a "distance from ocean" value per land cell.
- Multiply moisture by a decay factor based on this distance (e.g., `moisture *= 1.0 - 0.4 * clamp(distFromCoast / maxDist, 0, 1)`).
- This creates dry interiors and wet coastlines — a fundamental Earth-like pattern.

### 1.3 Latitude-Dependent Moisture Baseline
**File**: `src/lib/terrain/moisture.ts`
**Problem**: The latitude-biome relationship is limited to polar ice/tundra thresholds. On Earth, the Hadley cell circulation creates a dry belt at ~20–30° latitude (where all major deserts sit) and a wet belt at the equator and ~50–60°.
**Approach**:
- Modulate base moisture by latitude using a simplified atmospheric circulation curve:
  - High moisture at equator (ITCZ convergence)
  - Low moisture at ~25° N/S (subtropical high pressure — desert belt)
  - Moderate moisture at ~45–60° (westerlies)
  - Low moisture at poles (cold air holds little water)
- This one change would produce Sahara-like desert bands and tropical rainforest belts.

---

## Phase 2: Continental Shape & Terrain Legibility

These changes improve the large-scale structure of the map — making continents look like continents and mountains look like mountains.

### 2.1 Larger Continental Cores
**File**: `src/lib/terrain/elevation.ts`
**Problem**: At 65% water, land fragments into many medium-sized islands. Earth has a few massive continental cores (Eurasia, Africa, Americas) plus scattered islands. The current plate simulation treats continental vs. oceanic as a per-plate coin flip with ~35–50% continental.
**Approach**:
- Reduce the number of continental plates but increase their size. For example, use 3–5 continental plates and 8–12 oceanic plates instead of the current random split.
- Add a "continental clustering" pass: if two continental plates are adjacent, merge their base elevations upward slightly so they tend to form a single large landmass.
- Consider a size-biased plate generation where a few plates get disproportionately more cells (power-law distribution rather than uniform BFS).

### 2.2 Mountain Range Visibility
**Files**: `src/lib/renderer/renderer.ts`, `src/lib/terrain/biomes.ts`
**Problem**: Mountain ranges are the most prominent inland feature on real maps but are nearly invisible in the screenshots. The snow/bare/tundra biome bands are too narrow, and there's no shaded relief.
**Approach**:
- **Hillshading**: Add a shaded relief pass that darkens cells facing away from a virtual light source and brightens cells facing toward it. This is the standard technique in cartography (see Natural Earth raster data for reference). Apply it as a multiply/overlay blend on top of biome fill.
- **Widen mountain biome bands**: Currently the mountain band is elevation > 0.8. Consider lowering it to 0.7 or adding a "highland" transitional biome (alpine meadow) between 0.65–0.8.
- **Mountain icons**: The `iconType: 'mountain'` exists in the biome table but may not be rendering prominently enough at this scale. Consider larger or more frequent mountain peak icons along convergent plate boundaries.

### 2.3 Fix Ocean Horizontal Banding
**File**: `src/lib/renderer/renderer.ts` or `src/lib/terrain/elevation.ts`
**Problem**: Visible horizontal lines appear across the ocean, especially in the southern hemisphere. These are likely artifacts from the cylindrical noise wrapping or from the latitude-based biome thresholds creating sharp transitions.
**Approach**:
- Check if the banding comes from `noisyEdges.ts` or from the ocean depth rendering.
- If it's from the polar/latitude thresholds, smooth the transitions with a wider blend zone.
- If it's from cylindrical noise seams, add a feathering zone at the wrap boundary.

---

## Phase 3: Civilization & Trade Realism

These changes improve the history simulation and how civilization overlays appear on the map.

### 3.1 Coastal/Island-Hopping Trade Routes
**Files**: `src/lib/history/roads.ts`, renderer
**Problem**: Maritime trade routes are rendered as straight yellow lines across open ocean. Real historical trade followed coastlines, island chains, and navigable straits (Silk Road sea routes, Phoenician coastal routes, Polynesian island-hopping).
**Approach**:
- For maritime trade, use A* pathfinding over water cells with a cost function that penalizes distance from land. This produces routes that naturally hug coastlines and hop between islands.
- Alternatively, for long-distance ocean crossings, render the lines as gentle arcs (great-circle style) rather than straight lines to suggest curved sailing routes.

### 3.2 Climate-Aware City Placement
**File**: `src/lib/history/physical/CityGenerator.ts`
**Problem**: Cities appear wherever terrain scoring is high, but real cities cluster along rivers, natural harbors, and fertile lowlands. Desert interiors and dense jungles are historically sparse.
**Approach**:
- Boost the placement score for cells adjacent to rivers (river valley civilizations — Nile, Tigris/Euphrates, Indus, Yellow River).
- Boost coastal cells with sheltered geometry (natural harbors).
- Penalize extreme biomes (desert, dense jungle, tundra) unless they have a river or strategic resource.

### 3.3 Continental Climate Effects
**File**: `src/lib/terrain/biomes.ts`
**Problem**: The latitude-biome mapping uses fixed global thresholds. On Earth, continents at the same latitude have wildly different climates due to ocean currents and continental position (London vs. Labrador at 51°N, Tokyo vs. Azores at 35°N).
**Approach**:
- After computing moisture and elevation, add a "maritime vs. continental" modifier: cells near large ocean bodies get moderated temperatures (milder winters, cooler summers), while interior cells get extreme temperatures.
- This would shift the biome assignment at the margins — making western coasts of continents milder and eastern interiors more extreme, matching Earth's patterns.

---

## Phase 4: Polish & Advanced Features

Lower-priority improvements that add depth once the fundamentals are solid.

### 4.1 Ocean Currents & Sea Temperature
Simulate simplified ocean gyres (clockwise in northern hemisphere, counter-clockwise in southern). Warm currents along western coasts would create milder climates; cold currents along eastern coasts would create fog and aridity (California, Namibia, Peru).

### 4.2 Erosion-Carved River Valleys
Currently rivers are traced over existing terrain. Real rivers erode valleys over time. A hydraulic erosion pass would carve visible valleys and create more realistic terrain profiles — floodplains, deltas, gorges.

### 4.3 Vegetation Density Variation
Within a single biome type, vary the tree density/color based on moisture and elevation sub-gradients. A "temperate deciduous forest" biome near its dry edge should look more open and yellow-green, while near its wet edge it should be dense and dark green.

### 4.4 Seasonal Ice / Permafrost
The polar ice boundary is static. Adding a seasonal visual variation (wider ice in "winter" snapshots) would add dynamism, and permafrost zones in sub-polar land would create more biome variety.

---

## Summary Priority Matrix

| Recommendation | Impact | Effort | Priority |
|---|---|---|---|
| 1.1 Rain shadow | Very High | Medium | **P0** |
| 1.2 Continentality gradient | Very High | Low | **P0** |
| 1.3 Latitude moisture curve | High | Low | **P0** |
| 2.1 Larger continental cores | High | Medium | **P1** |
| 2.2 Mountain visibility | High | Medium | **P1** |
| 2.3 Fix ocean banding | Medium | Low | **P1** |
| 3.1 Coastal trade routes | Medium | Medium | **P2** |
| 3.2 Climate-aware cities | Medium | Low | **P2** |
| 3.3 Continental climate | Medium | Medium | **P2** |
| 4.1 Ocean currents | Low | High | **P3** |
| 4.2 Hydraulic erosion | Low | High | **P3** |
| 4.3 Vegetation variation | Low | Medium | **P3** |
| 4.4 Seasonal ice | Low | Medium | **P3** |

Phases 1 alone (rain shadow + continentality + latitude curve) would likely move the realism score from **6.5/10 to 8/10** by fixing the biome diversity problem, which is the single most visible gap compared to real-world geography.
