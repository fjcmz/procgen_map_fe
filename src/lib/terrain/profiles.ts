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
  polarNoiseAmplitude: 1.2,
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
};

/** Recommended water ratios per profile (not part of TerrainProfile — passed separately on GenerateRequest). */
export const PROFILE_WATER_RATIOS: Record<string, number> = {
  default: 0.40,
  desert: 0,
  ice: 0.55,
  forest: 0.30,
  swamp: 0.50,
  mountains: 0.30,
  ocean: 0.85,
};

/** Named terrain profiles. */
export const PROFILES: Record<string, TerrainProfile> = {
  default: DEFAULT_PROFILE,

  /** Dune-like arid world. No oceans, no rivers, only desert terrain. */
  desert: {
    ...DEFAULT_PROFILE,
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
    latAmplitude: 0.10,
    globalMoistureOffset: -0.05,
    riverFlowThreshold: 25,
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
    numContinentalMin: 1,
    numContinentalMax: 2,
    numOceanicMin: 14,
    numOceanicMax: 20,
    continentalGrowthMin: 1.2,
    continentalGrowthMax: 1.8,
    convergentOCBoost: 0.35,
    warmCurrentStrength: 0.16,
    latAmplitude: 0.35,
    continentalityStrength: 0.10,
  },
};
