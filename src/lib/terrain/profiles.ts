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
};

/** Named terrain profiles. Phase 2 will add desert, ice, forest, etc. */
export const PROFILES: Record<string, TerrainProfile> = {
  default: DEFAULT_PROFILE,
};
