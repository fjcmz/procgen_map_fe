# Extreme Map Generation — Parametric Planet Profiles

## Goal

Make the terrain generator parametric so users can select predefined "planet profiles" that produce dramatically different worlds — desert planets, ice worlds, lush jungles, mountain-scapes, ocean archipelagos, and swamp worlds — all from the same pipeline, same seed, same Voronoi mesh.

Each profile is a named preset that overrides a curated subset of the ~40 tunable constants currently hardcoded across the terrain modules. A "Default Earth" profile preserves all current values so existing behavior is unchanged.

---

## Phase 1: Plumb a `TerrainProfile` through the pipeline

**Goal**: Make every terrain function accept overrides without changing any default output.

### 1a. Define the `TerrainProfile` type

Add to `src/lib/types.ts`:

```ts
export interface TerrainProfile {
  // --- Elevation / tectonics ---
  numContinentalMin: number;        // default 3
  numContinentalMax: number;        // default 5
  numOceanicMin: number;            // default 8
  numOceanicMax: number;            // default 12
  continentalGrowthMin: number;     // default 2.0
  continentalGrowthMax: number;     // default 3.5
  seamBoostMin: number;             // default 0.08
  seamBoostMax: number;             // default 0.12
  seamSpreadRings: number;          // default 4
  convergentCCBoost: number;        // default 0.4  (continental-continental collision)
  convergentOCBoost: number;        // default 0.25 (oceanic-continental subduction)
  polarIceStart: number;            // default 0.72 (smoothstep lower bound)
  polarIceEnd: number;              // default 0.94 (smoothstep upper bound)
  polarNoiseAmplitude: number;      // default 1.2
  thermalErosionIters: number;      // default 3
  thermalErosionTalus: number;      // default 0.05

  // --- Moisture ---
  latAmplitude: number;             // default 0.28
  latPolarDamping: number;          // default 0.5
  latFrequency: number;             // default 3.0
  latBias: number;                  // default -0.02
  coastalMoistureSensitivity: number; // default 1.5
  continentalityStrength: number;   // default 0.40
  continentalityMidpoint: number;   // default 0.40
  shadowStrength: number;           // default 0.40
  mountainThreshold: number;        // default 0.55
  elevationScale: number;           // default 1.8

  // --- Temperature ---
  contStrength: number;             // default 0.15
  maritimeStrength: number;         // default 0.08
  windwardBonus: number;            // default 0.5
  lapseRate: number;                // default 0.10
  currentLandInfluence: number;     // default 0.6
  tempNoiseAmplitude: number;       // default 0.03

  // --- Biomes ---
  iceTempThreshold: number;         // default 0.15
  snowTempThreshold: number;        // default 0.10
  tundraTempThreshold: number;      // default 0.20
  tempMoistureShift: number;        // default 0.05

  // --- Ocean currents ---
  warmCurrentStrength: number;      // default 0.12
  coldCurrentStrength: number;      // default 0.10

  // --- Hydraulic erosion ---
  erosionK: number;                 // default 0.003
  erosionIterations: number;        // default 5

  // --- Global biome moisture override (Phase 3) ---
  globalMoistureOffset: number;     // default 0.0 — additive shift to every cell's moisture
  globalTempOffset: number;         // default 0.0 — additive shift to every cell's temperature
}
```

### 1b. Build a `DEFAULT_PROFILE` constant

In a new file `src/lib/terrain/profiles.ts`, export `DEFAULT_PROFILE: TerrainProfile` with every field set to the current hardcoded value. This is the single source of truth — delete the per-file `const` declarations and read from the profile instead.

### 1c. Thread the profile through every terrain function

Each terrain step already receives `cells`, `width`, `height`, etc. Add `profile: TerrainProfile` as the last parameter to:

| Function | File |
|----------|------|
| `assignElevation` | `terrain/elevation.ts` |
| `computeOceanCurrents` | `terrain/oceanCurrents.ts` |
| `assignMoisture` | `terrain/moisture.ts` |
| `assignTemperature` | `terrain/temperature.ts` |
| `assignBiomes` | `terrain/biomes.ts` |
| `hydraulicErosion` | `terrain/hydraulicErosion.ts` |

The worker (`mapgen.worker.ts`) and the sweep harness (`scripts/sweep-history.ts`) both construct the profile and pass it through. When no user override is present, they pass `DEFAULT_PROFILE`.

### 1d. Extend `GenerateRequest`

```ts
export interface GenerateRequest {
  // ... existing fields ...
  profileName?: string;             // e.g. 'desert', 'ice', 'forest', 'default'
  profileOverrides?: Partial<TerrainProfile>; // fine-tuning on top of a named preset
}
```

The worker resolves the final profile as:
```ts
const base = PROFILES[request.profileName ?? 'default'];
const profile = { ...base, ...(request.profileOverrides ?? {}) };
```

### 1e. Acceptance criteria

- `npm run build` passes.
- Generating with `profileName: 'default'` (or omitting it) produces **byte-identical** output to current code for any seed. Verify with `npm run sweep`.
- No UI changes yet — this phase is pure plumbing.

---

## Phase 2: Define the preset profiles

All profiles live in `src/lib/terrain/profiles.ts` as a `Record<string, TerrainProfile>` export called `PROFILES`.

### Profile: `default` (Earth-like)

All values identical to current hardcoded constants. The baseline.

### Profile: `desert`

A Dune-like arid world. Vast sand seas, rare oases near coasts, scorching interiors.

| Parameter | Default | Desert | Rationale |
|-----------|---------|--------|-----------|
| `waterRatio` (on request) | 0.40 | **0.15** | Minimal oceans, maximum land |
| `latAmplitude` | 0.28 | **0.40** | Stronger Hadley cells widen the subtropical dry belt |
| `latBias` | -0.02 | **-0.12** | Global drying shift — even "wet" bands become semi-arid |
| `continentalityStrength` | 0.40 | **0.65** | Aggressive interior drying |
| `continentalityMidpoint` | 0.40 | **0.25** | Drying kicks in closer to coast |
| `shadowStrength` | 0.40 | **0.60** | Severe rain shadows behind every ridge |
| `coastalMoistureSensitivity` | 1.5 | **2.5** | Cold currents kill even coastal moisture |
| `coldCurrentStrength` | 0.10 | **0.15** | Colder eastern-margin currents |
| `globalMoistureOffset` | 0.0 | **-0.10** | Flat moisture penalty everywhere |
| `tempMoistureShift` | 0.05 | **0.10** | Heat drains effective moisture harder in Whittaker lookup |
| `polarIceStart` | 0.72 | **0.85** | Polar ice pushed to extreme latitudes — even poles are dry |
| `polarIceEnd` | 0.94 | **0.98** | Narrow polar cap |
| `globalTempOffset` | 0.0 | **0.05** | Slightly warmer globally |

**Expected result**: ~70% desert/scorched/bare biomes. Narrow green strips along western coasts with warm currents. Interior is wall-to-wall sand.

### Profile: `ice`

A snowball Earth. Glaciers reach the equator, thin strips of tundra at the warmest latitudes.

| Parameter | Default | Ice | Rationale |
|-----------|---------|-----|-----------|
| `waterRatio` (on request) | 0.40 | **0.55** | More ocean, but much of it freezes |
| `iceTempThreshold` | 0.15 | **0.55** | Water freezes at much higher temperatures |
| `snowTempThreshold` | 0.10 | **0.45** | Land snow line reaches midlatitudes |
| `tundraTempThreshold` | 0.20 | **0.60** | Tundra covers almost everything not frozen |
| `globalTempOffset` | 0.0 | **-0.25** | Massive global cooling |
| `lapseRate` | 0.10 | **0.20** | Mountains freeze aggressively |
| `contStrength` | 0.15 | **0.25** | Continental interiors even colder |
| `warmCurrentStrength` | 0.12 | **0.04** | Weak warm currents — no Gulf Stream rescue |
| `coldCurrentStrength` | 0.10 | **0.16** | Strong cold currents cool everything |
| `polarIceStart` | 0.72 | **0.20** | Ice caps extend to 20% from equator |
| `polarIceEnd` | 0.94 | **0.50** | Gradual freeze across half the map |
| `latAmplitude` | 0.28 | **0.10** | Flatten Hadley cells — no wet equatorial rescue |
| `globalMoistureOffset` | 0.0 | **-0.05** | Slightly drier (cold air holds less water) |

**Expected result**: ~80% ice/snow/tundra. Thin equatorial band of taiga/grassland. Frozen oceans everywhere outside a narrow equatorial strip.

### Profile: `forest`

A lush greenhouse world. Dense forests from pole to pole, heavy rainfall, no deserts.

| Parameter | Default | Forest | Rationale |
|-----------|---------|--------|-----------|
| `waterRatio` (on request) | 0.40 | **0.30** | More exposed land for forests to grow on |
| `latAmplitude` | 0.28 | **0.15** | Flatter Hadley cells — no subtropical dry belt |
| `latBias` | -0.02 | **+0.08** | Global wetting bias |
| `continentalityStrength` | 0.40 | **0.15** | Minimal interior drying — monsoon moisture reaches everywhere |
| `shadowStrength` | 0.40 | **0.10** | Weak rain shadows |
| `coastalMoistureSensitivity` | 1.5 | **0.3** | Cold currents barely suppress moisture |
| `globalMoistureOffset` | 0.0 | **+0.15** | Flat moisture boost everywhere |
| `tempMoistureShift` | 0.05 | **0.01** | Heat barely affects effective moisture |
| `warmCurrentStrength` | 0.12 | **0.18** | Strong warm currents heat coasts |
| `coldCurrentStrength` | 0.10 | **0.04** | Weak cold currents |
| `globalTempOffset` | 0.0 | **+0.05** | Mild greenhouse warming |
| `polarIceStart` | 0.72 | **0.88** | Ice pushed to extreme poles |

**Expected result**: ~75% forest (tropical rain forest at low latitudes, temperate deciduous/rain forest at midlatitudes, taiga at high latitudes). Minimal desert/bare. Lush green world.

### Profile: `swamp`

A humid, flat, waterlogged world. Marshes, mangroves, and shallow seas.

| Parameter | Default | Swamp | Rationale |
|-----------|---------|-------|-----------|
| `waterRatio` (on request) | 0.40 | **0.50** | Half water, half soggy land |
| `convergentCCBoost` | 0.40 | **0.10** | Suppress mountain building — flat terrain |
| `convergentOCBoost` | 0.25 | **0.05** | Minimal subduction uplift |
| `seamBoostMin` | 0.08 | **0.02** | Low continental seams |
| `seamBoostMax` | 0.12 | **0.04** | Flat plate boundaries |
| `latAmplitude` | 0.28 | **0.12** | No dry belts |
| `latBias` | -0.02 | **+0.10** | Heavy global wetting |
| `continentalityStrength` | 0.40 | **0.10** | Moisture reaches everywhere on flat terrain |
| `globalMoistureOffset` | 0.0 | **+0.20** | Maximum wetness |
| `shadowStrength` | 0.40 | **0.05** | No rain shadows (no mountains to cast them) |
| `erosionK` | 0.003 | **0.008** | Aggressive erosion flattens any ridges |
| `erosionIterations` | 5 | **8** | More erosion passes |
| `thermalErosionIters` | 3 | **6** | Extra smoothing |
| `thermalErosionTalus` | 0.05 | **0.03** | Lower max slope tolerance |
| `globalTempOffset` | 0.0 | **+0.03** | Warm and humid |

**Expected result**: Flat, wet terrain. Grassland/marsh transitions everywhere. Shallow coastlines. Very few mountains. Rivers everywhere with wide floodplains.

### Profile: `mountains`

A young, tectonically violent world. Towering ranges, deep valleys, thin atmosphere on peaks.

| Parameter | Default | Mountains | Rationale |
|-----------|---------|-----------|-----------|
| `waterRatio` (on request) | 0.40 | **0.30** | Less ocean, more rugged land |
| `numContinentalMin` | 3 | **5** | More continental plates = more collision fronts |
| `numContinentalMax` | 5 | **7** | Upper bound raised |
| `convergentCCBoost` | 0.40 | **0.65** | Massive continental collision uplift |
| `convergentOCBoost` | 0.25 | **0.45** | Strong subduction volcanism |
| `seamBoostMin` | 0.08 | **0.18** | High continental seam ridges |
| `seamBoostMax` | 0.12 | **0.25** | Himalaya-scale ranges |
| `seamSpreadRings` | 4 | **6** | Broader mountain belts |
| `erosionK` | 0.003 | **0.001** | Weak erosion — peaks stay sharp |
| `erosionIterations` | 5 | **2** | Fewer passes |
| `thermalErosionIters` | 3 | **1** | Minimal smoothing |
| `shadowStrength` | 0.40 | **0.55** | Severe rain shadows in deep valleys |
| `lapseRate` | 0.10 | **0.15** | Steeper lapse rate, freezing peaks |
| `continentalityStrength` | 0.40 | **0.50** | Dry high-altitude basins |

**Expected result**: ~40% highland/alpine/mountain biomes. Deep rain-shadow deserts between ranges. Green valleys. Dramatic elevation variation. Lots of rivers fed by mountain snowmelt.

### Profile: `ocean` (Archipelago)

A water world with scattered volcanic island chains.

| Parameter | Default | Ocean | Rationale |
|-----------|---------|-------|-----------|
| `waterRatio` (on request) | 0.40 | **0.85** | Vast oceans dominate |
| `numContinentalMin` | 3 | **1** | Minimal continental plates |
| `numContinentalMax` | 5 | **2** | At most 2 small landmasses |
| `numOceanicMin` | 8 | **14** | Many oceanic plates |
| `numOceanicMax` | 12 | **20** | Lots of small basins |
| `continentalGrowthMin` | 2.0 | **1.2** | Continental plates grow slowly |
| `continentalGrowthMax` | 3.5 | **1.8** | Small landmasses |
| `convergentOCBoost` | 0.25 | **0.35** | Volcanic island arcs at oceanic convergences |
| `warmCurrentStrength` | 0.12 | **0.16** | Strong warm currents between islands |
| `latAmplitude` | 0.28 | **0.35** | Pronounced tropical moisture bands |
| `continentalityStrength` | 0.40 | **0.10** | Islands are never far from ocean |

**Expected result**: ~85% water. Scattered island chains, especially near convergent oceanic boundaries. Tropical islands, some volcanic peaks. Maritime climate everywhere on land.

---

## Phase 3: Add `globalMoistureOffset` and `globalTempOffset` support

These two parameters don't map to any existing constant — they are new additive shifts applied after the existing computations.

### 3a. `globalMoistureOffset`

In `assignMoisture`, after all existing moisture computation (FBM + Hadley + coastal + continentality + rain shadow), add:

```ts
cell.moisture = Math.max(0, Math.min(1, cell.moisture + profile.globalMoistureOffset));
```

This is the simplest and most powerful knob. A positive offset makes the whole world wetter; negative makes it drier. Applied last so it doesn't interact with the rain shadow or continentality formulas.

### 3b. `globalTempOffset`

In `assignTemperature`, after all existing temperature computation (latitude + continentality + windward + lapse rate + noise), add:

```ts
cell.temperature = Math.max(0, Math.min(1, cell.temperature + profile.globalTempOffset));
```

A negative offset simulates ice-age cooling; positive simulates greenhouse warming. Interacts naturally with the biome thresholds (ice, snow, tundra are temperature-gated).

### 3c. Acceptance criteria

- `globalMoistureOffset: 0` and `globalTempOffset: 0` produce identical output to Phase 1.
- Extreme values (+0.3 / -0.3) visibly shift the biome distribution without crashing or producing degenerate maps.

---

## Phase 4: UI — profile selector in the Generation tab

### 4a. Profile dropdown

Add a `<select>` control to `GenerationTab.tsx` between the water ratio slider and the history toggle. Options:

| Label | `profileName` |
|-------|---------------|
| Default (Earth-like) | `default` |
| Desert Planet | `desert` |
| Ice World | `ice` |
| Forest Planet | `forest` |
| Swamp World | `swamp` |
| Mountain World | `mountains` |
| Ocean World | `ocean` |

Selecting a profile:
1. Sets `profileName` on the next `GenerateRequest`.
2. Overrides `waterRatio` with the profile's recommended value (shown in the slider, which updates reactively but remains editable).
3. Does NOT auto-generate. The user clicks "Generate" as usual.

### 4b. Water ratio coupling

Each profile has a recommended `waterRatio`. When the user switches profiles, the water ratio slider snaps to the recommendation. The user can still drag it to override. The override is passed as-is (it's already a top-level `GenerateRequest` field, not part of the profile).

### 4c. Profile badge

When a non-default profile is active, show a small badge/chip below the seed input: e.g. `[Desert Planet]` in the profile's accent color. This is a reminder of which preset is influencing generation.

### 4d. Acceptance criteria

- Profile selector renders and is functional.
- Switching profiles updates the water ratio slider.
- Generating with each profile produces a visually distinct map.
- "Default (Earth-like)" produces identical output to current behavior.

---

## Phase 5: Sweep validation and balance tuning

### 5a. Extend the sweep harness

Add a `--profile <name>` flag to `scripts/sweep-history.ts`. When set, it applies the named profile before running the pipeline. This allows sweeping each extreme profile across the 5 fixed seeds.

### 5b. Establish baselines

Run `npm run sweep -- --label baseline-default` (current behavior), then run each profile:

```bash
npm run sweep -- --profile desert   --label baseline-desert
npm run sweep -- --profile ice      --label baseline-ice
npm run sweep -- --profile forest   --label baseline-forest
npm run sweep -- --profile swamp    --label baseline-swamp
npm run sweep -- --profile mountains --label baseline-mountains
npm run sweep -- --profile ocean    --label baseline-ocean
```

### 5c. Quality gates per profile

Each profile should produce maps that are visually recognizable as their intended theme across all 5 seeds. Specific gates:

| Profile | Primary biome coverage target | Forbidden degeneracy |
|---------|-------------------------------|---------------------|
| desert | >50% desert/scorched/bare | No seed produces >30% forest |
| ice | >60% ice/snow/tundra | No seed produces >20% non-frozen land |
| forest | >60% forest biomes (all types) | No seed produces >15% desert |
| swamp | >50% grassland/marsh + low avg elevation | No seed has avg elevation > 0.35 |
| mountains | >30% highland/alpine/mountain | No seed has avg elevation < 0.45 |
| ocean | >80% water cells | No seed has >25% land |

### 5d. Tuning loop

If a profile fails its quality gate on any seed, adjust its parameters and re-sweep. The sweep is deterministic, so the tuning loop is: tweak constant, re-sweep, diff JSON, repeat.

### 5e. History interaction

Extreme profiles will affect history simulation because city placement depends on biome scoring, and resource/population growth depends on `RegionBiome`. This is expected and desirable — a desert planet should have fewer cities, slower growth, and more resource scarcity. No history-side changes are needed; the terrain profile naturally propagates.

---

## Phase 6 (stretch): Advanced fine-tuning UI

### 6a. "Custom" profile with sliders

Add a `custom` profile option that unlocks an expandable panel of sliders for key parameters (a curated subset, not all ~40):

| Slider | Range | Maps to |
|--------|-------|---------|
| Aridity | 0–100 | `latBias`, `continentalityStrength`, `globalMoistureOffset` |
| Global Temperature | 0–100 | `globalTempOffset`, `iceTempThreshold`, `snowTempThreshold` |
| Mountain Height | 0–100 | `convergentCCBoost`, `convergentOCBoost`, `seamBoostMax` |
| Erosion | 0–100 | `erosionK`, `erosionIterations`, `thermalErosionIters` |
| Ocean Current Strength | 0–100 | `warmCurrentStrength`, `coldCurrentStrength` |
| Polar Ice Extent | 0–100 | `polarIceStart`, `polarIceEnd` |

Each slider maps its 0–100 range to a sensible interpolation across the underlying parameters. This gives power users direct control without exposing raw float values.

### 6b. Profile import/export

Allow exporting a custom profile as a JSON blob (copy to clipboard), and importing one (paste into a text field). This lets users share profiles.

---

## Implementation order summary

| Phase | Scope | Risk | Estimated files touched |
|-------|-------|------|------------------------|
| 1 | Type + plumbing | Low — no behavior change | `types.ts`, all `terrain/*.ts`, `profiles.ts` (new), `mapgen.worker.ts`, `sweep-history.ts` |
| 2 | Profile definitions | Low — data only | `profiles.ts` |
| 3 | Global offsets | Low — two lines of code | `moisture.ts`, `temperature.ts` |
| 4 | UI selector | Medium — UI wiring | `GenerationTab.tsx`, `App.tsx`, `UnifiedOverlay.tsx` |
| 5 | Sweep validation | Low — tooling only | `sweep-history.ts`, `profiles.ts` (tuning) |
| 6 | Custom sliders (stretch) | Medium — new UI surface | `GenerationTab.tsx`, `profiles.ts` |

Phases 1–3 can be implemented and verified with `npm run build` + `npm run sweep` before touching any UI code. Phase 4 is the first user-visible change. Phase 5 is validation. Phase 6 is optional polish.
