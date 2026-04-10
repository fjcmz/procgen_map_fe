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

  /** Snowball Earth. Glaciers reach the equator, thin strips of tundra at the warmest latitudes. */
  ice: {
    ...DEFAULT_PROFILE,
    iceTempThreshold: 0.55,
    snowTempThreshold: 0.45,
    tundraTempThreshold: 0.60,
    globalTempOffset: -0.25,
    lapseRate: 0.20,
    contStrength: 0.25,
    warmCurrentStrength: 0.04,
    coldCurrentStrength: 0.16,
    polarIceStart: 0.20,
    polarIceEnd: 0.50,
    latAmplitude: 0.10,
    globalMoistureOffset: -0.05,
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
    convergentCCBoost: 0.10,
    convergentOCBoost: 0.05,
    seamBoostMin: 0.02,
    seamBoostMax: 0.04,
    latAmplitude: 0.12,
    latBias: 0.10,
    continentalityStrength: 0.10,
    globalMoistureOffset: 0.20,
    shadowStrength: 0.05,
    erosionK: 0.008,
    erosionIterations: 8,
    thermalErosionIters: 6,
    thermalErosionTalus: 0.03,
    globalTempOffset: 0.03,
  },

  /** Young, tectonically violent world. Towering ranges, deep valleys, thin atmosphere on peaks. */
  mountains: {
    ...DEFAULT_PROFILE,
    numContinentalMin: 5,
    numContinentalMax: 7,
    convergentCCBoost: 0.65,
    convergentOCBoost: 0.45,
    seamBoostMin: 0.18,
    seamBoostMax: 0.25,
    seamSpreadRings: 6,
    erosionK: 0.001,
    erosionIterations: 2,
    thermalErosionIters: 1,
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
