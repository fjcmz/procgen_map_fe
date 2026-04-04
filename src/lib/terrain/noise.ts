import { createNoise2D, createNoise3D } from 'simplex-noise';
import type { NoiseFunction2D, NoiseFunction3D } from 'simplex-noise';

/** Seeded pseudo-random number generator (mulberry32). */
export function seededPRNG(seed: string): () => number {
  let h = 0x12345678;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x9e3779b9);
    h += (h << 6) | (h >>> 26);
  }
  let s = h >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseSampler {
  elevation: NoiseFunction2D;
  moisture: NoiseFunction2D;
}

export function createNoiseSamplers(seed: string): NoiseSampler {
  const rng1 = seededPRNG(seed + '_elev');
  const rng2 = seededPRNG(seed + '_moist');
  return {
    elevation: createNoise2D(rng1),
    moisture: createNoise2D(rng2),
  };
}

/** Fractional Brownian Motion — sum of noise octaves. Returns 0..1. */
export function fbm(
  noise: NoiseFunction2D,
  nx: number,
  ny: number,
  octaves = 4
): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(nx * frequency, ny * frequency) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return (value / max + 1) / 2; // normalize to 0..1
}

export interface NoiseSampler3D {
  elevation: NoiseFunction3D;
  moisture: NoiseFunction3D;
  continent: NoiseFunction3D;
}

export function createNoiseSamplers3D(seed: string): NoiseSampler3D {
  const rng1 = seededPRNG(seed + '_elev');
  const rng2 = seededPRNG(seed + '_moist');
  const rng3 = seededPRNG(seed + '_continent');
  return {
    elevation: createNoise3D(rng1),
    moisture: createNoise3D(rng2),
    continent: createNoise3D(rng3),
  };
}

/**
 * Cylindrical FBM — noise that wraps seamlessly in x (east-west).
 * Maps x to a circle in 3D space: (cos(θ), sin(θ), y), then samples 3D noise.
 * Returns 0..1.
 */
export function fbmCylindrical(
  noise: NoiseFunction3D,
  x: number,
  y: number,
  width: number,
  height: number,
  octaves = 4,
  baseFreq = 1
): number {
  const theta = (2 * Math.PI * x) / width;
  // R chosen so the circumference in noise-space ≈ 1.5 (matching the old 2D scale)
  const R = 1.5 / (2 * Math.PI);
  const cx = Math.cos(theta) * R;
  const cz = Math.sin(theta) * R;
  const ny = ((y / height) * 2 - 1) * 1.5;

  let value = 0;
  let amplitude = 0.5;
  let frequency = baseFreq;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(cx * frequency, ny * frequency, cz * frequency) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return (value / max + 1) / 2;
}
