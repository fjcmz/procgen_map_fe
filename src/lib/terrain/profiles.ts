import type { TerrainProfile } from '../types';

/**
 * Default Earth-like terrain profile.
 * Every field matches the original hardcoded constant values so that
 * generating with this profile produces byte-identical output.
 */
export const DEFAULT_PROFILE: TerrainProfile = {
  // --- Elevation / tectonics ---
  numContinentalMin: 3,
  numContinentalMax: 5,
  numOceanicMin: 8,
  numOceanicMax: 12,
  continentalGrowthMin: 2.0,
  continentalGrowthMax: 3.5,
  seamBoostMin: 0.08,
  seamBoostMax: 0.12,
  seamSpreadRings: 4,
  convergentCCBoost: 0.4,
  convergentOCBoost: 0.25,
  polarIceStart: 0.72,
  polarIceEnd: 0.94,
  polarNoiseAmplitude: 0.6,
  polarBlendWeight: 0.5,
  thermalErosionIters: 3,
  thermalErosionTalus: 0.05,

  // --- Moisture ---
  latAmplitude: 0.28,
  latPolarDamping: 0.5,
  latFrequency: 3.0,
  latBias: -0.02,
  coastalMoistureSensitivity: 1.5,
  continentalityStrength: 0.40,
  continentalityMidpoint: 0.40,
  shadowStrength: 0.40,
  mountainThreshold: 0.55,
  elevationScale: 1.8,

  // --- Temperature ---
  contStrength: 0.15,
  maritimeStrength: 0.08,
  windwardBonus: 0.5,
  lapseRate: 0.10,
  currentLandInfluence: 0.6,
  tempNoiseAmplitude: 0.03,

  // --- Biomes ---
  iceTempThreshold: 0.15,
  snowTempThreshold: 0.10,
  tundraTempThreshold: 0.20,
  tempMoistureShift: 0.05,

  // --- Ocean currents ---
  warmCurrentStrength: 0.12,
  coldCurrentStrength: 0.10,

  // --- Hydraulic erosion ---
  erosionK: 0.003,
  erosionIterations: 5,

  // --- Global modifiers (applied in Phase 3) ---
  globalMoistureOffset: 0.0,
  globalTempOffset: 0.0,

  // --- River control ---
  suppressRivers: false,
  riverFlowThreshold: 4,

  // --- Elevation shaping ---
  elevationPower: 1.0,

  // --- Biome overrides ---
  marshOverride: false,

  // --- Continental shelf / shallow sea ---
  shelfWidth: 3,
  shelfStrength: 0.6,
  shallowSeaThreshold: 0.1,

  // --- Depression fill / lakes ---
  lakeMaxSize: 20,
  lakeMinSize: 4,
  depressionFillEpsilon: 1e-5,
};

/** Recommended water ratios per profile (not part of TerrainProfile — passed separately on GenerateRequest). */
export const PROFILE_WATER_RATIOS: Record<string, number> = {
  default: 0.40,
  desert: 0,
  ice: 0.55,
  forest: 0.30,
  swamp: 0.50,
  mountains: 0.30,
  ocean: 0.98,
};

/** Named terrain profiles. */
export const PROFILES: Record<string, TerrainProfile> = {
  default: DEFAULT_PROFILE,

  /** Dune-like arid world. No oceans, no rivers, only desert terrain. */
  desert: {
    ...DEFAULT_PROFILE,
    // --- Tectonic drama: visible ridges, mesas, and mountain spines ---
    // Doubles continental plate density to create a denser web of seams.
    numContinentalMin: 6,
    numContinentalMax: 9,
    continentalGrowthMin: 2.5,
    continentalGrowthMax: 4.0,
    // Pronounced continental-continental seam ridges, spread across more rings
    // to form long linear ranges instead of isolated pillars.
    seamBoostMin: 0.15,
    seamBoostMax: 0.22,
    seamSpreadRings: 7,
    // Stronger collision-driven mountain building.
    convergentCCBoost: 0.55,
    convergentOCBoost: 0.35,
    // Sharpen the post-normalized elevation curve so more cells reach the
    // hardcoded highland/alpine/mountain bands in biomes.ts.
    elevationPower: 0.85,
    // Reduce erosion to preserve carved seams while still leaving
    // wind-smoothed contours appropriate for a desert.
    erosionK: 0.0015,
    erosionIterations: 3,
    thermalErosionIters: 2,
    // Moisture-reduction overrides (kept for non-zero waterRatio overrides)
    latAmplitude: 0.40,
    latBias: -0.12,
    continentalityStrength: 0.65,
    continentalityMidpoint: 0.25,
    shadowStrength: 0.60,
    coastalMoistureSensitivity: 2.5,
    coldCurrentStrength: 0.15,
    tempMoistureShift: 0.10,
    // Force all moisture to 0 — only dry column of Whittaker table
    globalMoistureOffset: -1.0,
    // Hot world — no polar biomes
    globalTempOffset: 0.15,
    iceTempThreshold: 0,
    snowTempThreshold: 0,
    tundraTempThreshold: 0,
    polarIceStart: 0.99,
    polarIceEnd: 1.0,
    // No rivers
    suppressRivers: true,
  },

  /** Snowball Earth. Nearly all water frozen, land covered in snow and ice. */
  ice: {
    ...DEFAULT_PROFILE,
    iceTempThreshold: 0.80,
    snowTempThreshold: 0.70,
    tundraTempThreshold: 0.85,
    globalTempOffset: -0.45,
    lapseRate: 0.20,
    contStrength: 0.05,
    maritimeStrength: 0.02,
    warmCurrentStrength: 0.04,
    coldCurrentStrength: 0.16,
    polarIceStart: 0.20,
    polarIceEnd: 0.50,
    polarBlendWeight: 0.7,
    latAmplitude: 0.10,
    globalMoistureOffset: -0.05,
    riverFlowThreshold: 25,
    // Frozen world → narrower shelf
    shelfWidth: 2,
  },

  /** Lush greenhouse world. Dense forests from pole to pole, heavy rainfall, no deserts. */
  forest: {
    ...DEFAULT_PROFILE,
    latAmplitude: 0.15,
    latBias: 0.08,
    continentalityStrength: 0.15,
    shadowStrength: 0.10,
    coastalMoistureSensitivity: 0.3,
    globalMoistureOffset: 0.15,
    tempMoistureShift: 0.01,
    warmCurrentStrength: 0.18,
    coldCurrentStrength: 0.04,
    globalTempOffset: 0.05,
    polarIceStart: 0.88,
    // Lush world → more and larger woodland lakes
    lakeMinSize: 2,
    lakeMaxSize: 80,
  },

  /** Humid, flat, waterlogged world. Marshes, mangroves, and shallow seas. */
  swamp: {
    ...DEFAULT_PROFILE,
    // Aggressive tectonic flattening — minimal mountain-building forces
    convergentCCBoost: 0.04,
    convergentOCBoost: 0.02,
    seamBoostMin: 0.01,
    seamBoostMax: 0.02,
    seamSpreadRings: 2,
    // Power curve to flatten elevation distribution
    elevationPower: 2.5,
    // High moisture everywhere
    latAmplitude: 0.10,
    latBias: 0.12,
    continentalityStrength: 0.08,
    globalMoistureOffset: 0.25,
    shadowStrength: 0.03,
    // More erosion to further flatten
    erosionK: 0.010,
    erosionIterations: 10,
    thermalErosionIters: 8,
    thermalErosionTalus: 0.02,
    // Warm, humid climate
    globalTempOffset: 0.05,
    // Enable marsh biome assignment
    marshOverride: true,
    // Wettest profile → allow large wetland lake bodies
    lakeMinSize: 2,
    lakeMaxSize: 150,
  },

  /** Young, tectonically violent world. Towering ranges, deep valleys, thin atmosphere on peaks. */
  mountains: {
    ...DEFAULT_PROFILE,
    // More plates -> more convergent boundaries -> many more candidate ranges
    numContinentalMin: 8,
    numContinentalMax: 11,
    numOceanicMin: 10,
    numOceanicMax: 14,
    // Let the extra continental plates actually claim territory
    continentalGrowthMin: 2.5,
    continentalGrowthMax: 4.0,
    // Aggressive convergent boundary boost (mountain building)
    convergentCCBoost: 0.70,
    convergentOCBoost: 0.50,
    // Wider seam spread -> longer, more linear ranges instead of isolated peaks
    seamBoostMin: 0.18,
    seamBoostMax: 0.28,
    seamSpreadRings: 9,
    // Sharpen post-normalization distribution: pre-power 0.67 -> post 0.75,
    // effectively widening the mountain biome band without touching biomes.ts.
    elevationPower: 0.75,
    // Preserve peaks
    erosionK: 0.001,
    erosionIterations: 2,
    thermalErosionIters: 1,
    // Climate response to tall terrain
    shadowStrength: 0.55,
    lapseRate: 0.15,
    continentalityStrength: 0.50,
  },

  /** Water world with scattered volcanic island chains. */
  ocean: {
    ...DEFAULT_PROFILE,
    // No continental plates — land emerges only from oceanic convergence + noise peaks
    numContinentalMin: 0,
    numContinentalMax: 0,
    // Many oceanic plates → dense boundary network → many scattered volcanic arcs
    numOceanicMin: 20,
    numOceanicMax: 28,
    // Stronger volcanic arcs at oceanic plate convergence
    convergentOCBoost: 0.45,
    // Dampen polar ice caps so they don't eat the entire land budget at 98% water
    polarNoiseAmplitude: 0.35,
    // Push polar elevation boost poleward — fewer polar islands, more temperate ones
    polarIceStart: 0.85,
    // Existing climate/current flavor — preserved
    warmCurrentStrength: 0.16,
    latAmplitude: 0.35,
    continentalityStrength: 0.10,
    // Ocean world thermal corrections — tiny islands should not exhibit continental
    // climate extremes; water world has higher thermal inertia overall
    globalTempOffset: 0.15,
    contStrength: 0.03,
    lapseRate: 0.04,
    // Restrict frozen biomes to extreme poles — water world stays warm
    iceTempThreshold: 0.08,
    snowTempThreshold: 0.05,
    tundraTempThreshold: 0.10,
    // Archipelago → wider shelf around islands, slightly higher shallow sea threshold
    shelfWidth: 5,
    shallowSeaThreshold: 0.12,
  },
};

/**
 * Landmass shape overlays — a parallel preset dimension orthogonal to biome profiles.
 *
 * Applied as a `Partial<TerrainProfile>` patch over the biome profile in the worker's
 * merge step: `biomeProfile → shapeOverlay → user profileOverrides`. Entries MUST
 * remain partial (never a full profile) so fields the shape doesn't set fall through
 * to the biome layer. `default` is an empty overlay so a biome profile's baked-in
 * shape hints (e.g. the `ocean` biome's 0 continental plates) keep working byte-
 * identically when the user hasn't picked a shape.
 */
export const SHAPE_PROFILES: Record<string, Partial<TerrainProfile>> = {
  default: {},

  /** One welded supercontinent: a single continental plate with aggressive seam spread. */
  pangaea: {
    numContinentalMin: 1,
    numContinentalMax: 1,
    numOceanicMin: 8,
    numOceanicMax: 10,
    continentalGrowthMin: 3.5,
    continentalGrowthMax: 4.5,
    seamBoostMin: 0.18,
    seamBoostMax: 0.25,
    seamSpreadRings: 8,
    elevationPower: 0.85,
  },

  /** Several distinct landmasses — explicit form of the default behavior. */
  continents: {
    numContinentalMin: 3,
    numContinentalMax: 5,
    numOceanicMin: 8,
    numOceanicMax: 12,
    continentalGrowthMin: 2.0,
    continentalGrowthMax: 3.5,
    seamBoostMin: 0.08,
    seamBoostMax: 0.12,
    seamSpreadRings: 4,
  },

  /** Many small landmasses: no continental plates, lots of oceanic arcs, flattened elevation. */
  islands: {
    numContinentalMin: 0,
    numContinentalMax: 0,
    numOceanicMin: 20,
    numOceanicMax: 26,
    seamBoostMin: 0,
    seamBoostMax: 0,
    seamSpreadRings: 0,
    elevationPower: 1.6,
  },

  /** A few starved continents ringed by island chains. */
  archipelago: {
    numContinentalMin: 2,
    numContinentalMax: 3,
    numOceanicMin: 16,
    numOceanicMax: 22,
    continentalGrowthMin: 1.3,
    continentalGrowthMax: 1.8,
    seamBoostMin: 0.02,
    seamBoostMax: 0.04,
    seamSpreadRings: 1,
    elevationPower: 1.35,
  },
};
