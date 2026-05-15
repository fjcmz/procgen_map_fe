/**
 * Per-seed worker for the sweep harness.
 *
 * Each worker_threads instance runs `runSeed(seed, args)` once and posts the
 * resulting SeedResult back to the main thread. The body of runSeed must mirror
 * `src/workers/mapgen.worker.ts` exactly so output stays byte-identical to a
 * browser run at the same seed + params.
 */

import { parentPort, workerData } from 'node:worker_threads';

import {
  buildCellGraph,
  createNoiseSamplers3D,
  seededPRNG,
  assignElevation,
  computeOceanCurrents,
  assignMoisture,
  assignTemperature,
  assignBiomes,
  generateRivers,
  hydraulicErosion,
  fillDepressions,
  DEFAULT_PROFILE,
} from '../src/lib/terrain/index.ts';
import { historyGenerator } from '../src/lib/history/HistoryGenerator.ts';
import type { HistoryStats } from '../src/lib/history/HistoryGenerator.ts';
import {
  DEFAULT_UNDERGROUND_CHANCE,
  generateUnderground,
} from '../src/lib/underground/index.ts';
import type { UndergroundMap } from '../src/lib/underground/index.ts';

export interface SweepArgs {
  seeds: number;
  years: number;
  cells: number;
  width: number;
  height: number;
  waterRatio: number;
  label: string;
}

export interface SeedResult {
  seed: string;
  stats: HistoryStats;
  elapsedMs: number;
}

export function runSeed(seed: string, args: SweepArgs): SeedResult {
  const t0 = Date.now();

  // Mirror mapgen.worker.ts exactly. The sweep uses DEFAULT_PROFILE with no
  // biome or shape overlay so runs against baseline-a.json stay byte-identical.
  // If this harness ever accepts a --profile or --shape CLI flag, mirror the
  // worker's three-way merge: PROFILES[profileName] → SHAPE_PROFILES[shapeName]
  // → user overrides (see src/workers/mapgen.worker.ts).
  const profile = DEFAULT_PROFILE;
  const { cells } = buildCellGraph(seed, args.cells, args.width, args.height);
  const noise = createNoiseSamplers3D(seed);
  assignElevation(cells, args.width, args.height, noise, args.waterRatio, seed, profile);
  const { sstAnomaly } = computeOceanCurrents(cells, args.width, args.height, profile);
  const distFromOcean = assignMoisture(cells, args.width, args.height, noise, sstAnomaly, profile);
  assignTemperature(cells, args.width, args.height, distFromOcean, noise, sstAnomaly, profile);
  assignBiomes(cells, args.width, args.height, noise, profile);
  if (!profile.suppressRivers) {
    // Mirror the worker's depression-fill + retrace sequence exactly.
    const { drainageElevation: drainageElev1 } = fillDepressions(cells, profile);
    generateRivers(cells, profile, drainageElev1);
    hydraulicErosion(cells, profile);
    const { drainageElevation: drainageElev2 } = fillDepressions(cells, profile);
    generateRivers(cells, profile, drainageElev2);
  }
  assignTemperature(cells, args.width, args.height, distFromOcean, noise, sstAnomaly, profile);
  assignBiomes(cells, args.width, args.height, noise, profile);

  // Underground map — mirrors `maybeBuildUnderground` in `src/workers/mapgen.worker.ts`.
  // Eligibility rolled on an isolated sub-stream so seeds that miss leave the
  // sweep byte-identical to the pre-underground-resource baseline. Eligible
  // seeds bring underground cavern + resource generation into the sweep,
  // because cavern resources land on regions before year-0 discovery and
  // affect trade / war / wealth metrics from then on.
  let underground: UndergroundMap | undefined;
  const ugChance = DEFAULT_UNDERGROUND_CHANCE;
  if (ugChance > 0) {
    const presentRng = seededPRNG(`${seed}_underground_present`);
    if (presentRng() < ugChance) {
      underground = generateUnderground(seed, args.width, args.height, cells);
    }
  }

  // Worker uses `seed + '_history'` for the history RNG (see mapgen.worker.ts:127).
  const rng = seededPRNG(seed + '_history');
  // Pass `seed` so isolated PRNG sub-streams (race bias, deity binding) match
  // the worker exactly. Race bias and deity decisions don't enter HistoryStats,
  // so this trailing arg is byte-equivalent to the old call when the sweep
  // baseline was generated — the sub-stream draws don't perturb the main RNG.
  const result = historyGenerator.generate(cells, args.width, rng, args.years, undefined, seed, undefined, underground);

  return {
    seed,
    stats: result.stats,
    elapsedMs: Date.now() - t0,
  };
}

// Worker entry point: only run when spawned via `new Worker(...)`. When this
// file is imported from the main thread (e.g. for type-only imports) parentPort
// is null and we no-op.
if (parentPort) {
  const { seed, args } = workerData as { seed: string; args: SweepArgs };
  try {
    const result = runSeed(seed, args);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
}
