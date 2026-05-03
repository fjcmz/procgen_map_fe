/**
 * One-shot determinism check: verify the data-driven `pickSubtype` engine in
 * `lib/extensions/picker.ts` reproduces the outputs of the original hardcoded
 * pickers from `lib/universe/PlanetGenerator.ts` and `SatelliteGenerator.ts`
 * for a wide sample of (composition, life, biome, orbit, r) inputs.
 *
 * Run via:
 *   npx tsx scripts/verify-extensions-pickers.ts
 *
 * Exits 0 on success, 1 with a diff report on any mismatch. Re-derived from
 * the pre-extension code in this file so we can compare even after the
 * generators are refactored.
 */

import { DEFAULT_PACK } from '../src/lib/extensions/builtins.ts';
import { pickSubtype, pickBiome } from '../src/lib/extensions/picker.ts';

// ── Reference implementations (verbatim from the pre-extension generators) ──

type PlanetBiome = 'default' | 'desert' | 'ice' | 'forest' | 'swamp' | 'mountains' | 'ocean';

function refPickBiome(rng: () => number): PlanetBiome {
  const r = rng();
  if (r < 0.40) return 'default';
  if (r < 0.50) return 'desert';
  if (r < 0.60) return 'ice';
  if (r < 0.70) return 'forest';
  if (r < 0.80) return 'swamp';
  if (r < 0.90) return 'mountains';
  return 'ocean';
}

function refPickPlanetSubtype(
  composition: 'GAS' | 'ROCK',
  orbit: number,
  life: boolean,
  biome: PlanetBiome | undefined,
  subRng: () => number,
): string {
  if (composition === 'ROCK') {
    if (life && biome) {
      const biomeMap: Record<PlanetBiome, string> = {
        default: 'terrestrial',
        forest: 'terrestrial',
        ocean: 'ocean',
        desert: 'desert',
        swamp: 'terrestrial',
        ice: 'ice_rock',
        mountains: 'terrestrial',
      };
      return biomeMap[biome];
    }
    const r = subRng();
    if (orbit < 6) {
      if (r < 0.45) return 'lava';
      if (r < 0.75) return 'volcanic';
      if (r < 0.90) return 'iron';
      return 'desert';
    }
    if (orbit < 12) {
      if (r < 0.30) return 'desert';
      if (r < 0.50) return 'terrestrial';
      if (r < 0.65) return 'iron';
      if (r < 0.78) return 'volcanic';
      if (r < 0.88) return 'ocean';
      if (r < 0.95) return 'carbon';
      return 'ice_rock';
    }
    if (r < 0.45) return 'ice_rock';
    if (r < 0.70) return 'carbon';
    if (r < 0.85) return 'iron';
    if (r < 0.95) return 'desert';
    return 'terrestrial';
  }
  const r = subRng();
  if (orbit < 12) {
    if (r < 0.55) return 'hot_jupiter';
    if (r < 0.85) return 'jovian';
    return 'ammonia_giant';
  }
  if (orbit < 18) {
    if (r < 0.45) return 'jovian';
    if (r < 0.70) return 'ammonia_giant';
    if (r < 0.88) return 'methane_giant';
    return 'ice_giant';
  }
  const outer = ['ice_giant', 'methane_giant', 'ammonia_giant'];
  return outer[Math.floor(r * outer.length)];
}

function refPickSatelliteSubtype(
  composition: 'ICE' | 'ROCK',
  parentOrbit: number,
  life: boolean,
  biome: PlanetBiome | undefined,
  subRng: () => number,
): string {
  if (composition === 'ROCK') {
    if (life && biome === 'desert') return 'desert_moon';
    if (life) return 'terrestrial';
    const r = subRng();
    if (parentOrbit < 8) {
      if (r < 0.40) return 'volcanic';
      if (r < 0.65) return 'iron_rich';
      if (r < 0.85) return 'cratered';
      return 'desert_moon';
    }
    const rockOuter = ['cratered', 'terrestrial', 'iron_rich', 'desert_moon'];
    return rockOuter[Math.floor(r * rockOuter.length)];
  }
  const r = subRng();
  if (parentOrbit < 10) {
    if (r < 0.45) return 'water_ice';
    if (r < 0.70) return 'sulfur_ice';
    if (r < 0.90) return 'dirty_ice';
    return 'methane_ice';
  }
  const iceOuter = ['water_ice', 'methane_ice', 'nitrogen_ice', 'dirty_ice', 'sulfur_ice'];
  return iceOuter[Math.floor(r * iceOuter.length)];
}

// ── Verification harness ──────────────────────────────────────────────────

const planetRules = DEFAULT_PACK.universe!.planet!.rollRules!;
const satRules = DEFAULT_PACK.universe!.satellite!.rollRules!;
const planetBiomeWeights = DEFAULT_PACK.universe!.planet!.biomeWeights!;

const fails: string[] = [];

function assertEq(label: string, ref: string, got: string) {
  if (ref !== got) fails.push(`${label}: ref=${ref} got=${got}`);
}

// Cover a fine-grained r grid to exercise every threshold edge.
// Range is `[0, 1)` because mulberry32 (the project's PRNG) never returns 1.0;
// excluding r=1 also avoids `outer[Math.floor(1 * len)] === undefined` in the
// reference impl, which is unreachable at runtime but distorts the test.
const rGrid: number[] = [];
for (let i = 0; i < 100; i++) rGrid.push(i / 100);
// Add boundary epsilons to catch off-by-one threshold bugs.
rGrid.push(0.001, 0.4499, 0.45, 0.4501, 0.7499, 0.75, 0.7501, 0.8999, 0.90, 0.9001, 0.9999);

// Biome roll
for (const r of rGrid) {
  const ref = refPickBiome(() => r);
  const got = pickBiome(planetBiomeWeights, () => r, 'default');
  assertEq(`pickBiome r=${r}`, ref, got);
}

// Planet rolls — sweep composition × life × biome × orbit × r
const biomes: (PlanetBiome | undefined)[] = ['default', 'desert', 'ice', 'forest', 'swamp', 'mountains', 'ocean', undefined];
const orbits = [0, 3, 5.99, 6, 8, 11.99, 12, 15, 17.99, 18, 25];
for (const comp of ['ROCK', 'GAS'] as const) {
  for (const life of [true, false]) {
    for (const biome of biomes) {
      for (const orbit of orbits) {
        for (const r of rGrid) {
          const ref = refPickPlanetSubtype(comp, orbit, life, biome, () => r);
          const got = pickSubtype(
            planetRules,
            { composition: comp, life, biome, orbit },
            () => r,
            'terrestrial',
          );
          assertEq(`planet comp=${comp} life=${life} biome=${biome} orbit=${orbit} r=${r}`, ref, got);
        }
      }
    }
  }
}

// Satellite rolls
const parentOrbits = [0, 5, 7.99, 8, 9, 9.99, 10, 12, 20];
for (const comp of ['ROCK', 'ICE'] as const) {
  for (const life of [true, false]) {
    for (const biome of biomes) {
      for (const po of parentOrbits) {
        for (const r of rGrid) {
          const ref = refPickSatelliteSubtype(comp, po, life, biome, () => r);
          const got = pickSubtype(
            satRules,
            { composition: comp, life, biome, parentOrbit: po },
            () => r,
            'terrestrial',
          );
          assertEq(`sat comp=${comp} life=${life} biome=${biome} po=${po} r=${r}`, ref, got);
        }
      }
    }
  }
}

if (fails.length > 0) {
  console.error(`FAIL: ${fails.length} mismatches`);
  for (const f of fails.slice(0, 30)) console.error('  ' + f);
  if (fails.length > 30) console.error(`  ...and ${fails.length - 30} more`);
  process.exit(1);
} else {
  console.log('OK — data-driven pickers reproduce reference outputs across all sampled inputs.');
}
