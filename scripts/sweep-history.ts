/**
 * Phase 4 — Tech Overhaul Balance Pass — Seed Sweep Harness
 *
 * Runs the full map-generation + history simulation pipeline across a fixed
 * set of seeds entirely in Node, without the browser worker. Replays the
 * exact sequence of calls from `src/workers/mapgen.worker.ts` so results are
 * byte-identical to a browser run at the same seed + params.
 *
 * Seeds run in parallel via Node `worker_threads` (one worker per seed up to
 * the concurrency cap). Each seed is fully independent — no cross-seed state,
 * no shared globals — so JSON output is byte-identical to the previous
 * sequential harness modulo `generatedAt` and per-seed `elapsedMs`.
 *
 * Usage:
 *   npm run sweep                                    # default: 5 seeds, 5000 years, 3000 cells
 *   npm run sweep -- --label baseline-a              # tag the output filename
 *   npm run sweep -- --seeds 3 --years 2000          # smaller run for iteration
 *   npm run sweep -- --cells 5000                    # override cell count
 *   npm run sweep -- --concurrency 1                 # force sequential execution
 *
 * Outputs:
 *   - stdout: per-seed completion lines (out-of-order) + aggregate table
 *   - scripts/results/<label>.json                   # full per-seed + aggregate report
 *
 * The harness is deterministic: re-running with the same args must produce
 * byte-identical JSON (modulo the `generatedAt` timestamp and `elapsedMs`).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import type { HistoryStats } from '../src/lib/history/HistoryGenerator.ts';
import type { TechField } from '../src/lib/history/timeline/Tech.ts';
import type { SeedResult, SweepArgs } from './sweep-worker.ts';

// ---------- CLI parsing ----------

interface ParsedArgs {
  args: SweepArgs;
  concurrency: number; // 0 = auto, resolved in main()
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: SweepArgs = {
    seeds: 5,
    years: 5000,
    cells: 3000,
    width: 1600,
    height: 1000,
    waterRatio: 0.4,
    label: 'sweep',
  };
  let concurrency = 0;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    switch (flag) {
      case '--seeds': args.seeds = Number(val); i++; break;
      case '--years': args.years = Number(val); i++; break;
      case '--cells': args.cells = Number(val); i++; break;
      case '--width': args.width = Number(val); i++; break;
      case '--height': args.height = Number(val); i++; break;
      case '--water': args.waterRatio = Number(val); i++; break;
      case '--label': args.label = String(val); i++; break;
      case '--concurrency': concurrency = Number(val); i++; break;
      default:
        if (flag.startsWith('--')) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }
  return { args, concurrency };
}

// Fixed spec-mandated seed list; truncated if --seeds < 5.
const FIXED_SEEDS = ['seed-01', 'seed-02', 'seed-03', 'seed-04', 'seed-05'] as const;

const TECH_FIELDS: TechField[] = [
  'science', 'military', 'industry', 'energy', 'growth',
  'exploration', 'biology', 'art', 'government',
];

// ---------- Worker pool ----------

function runSeedInWorker(seed: string, args: SweepArgs, workerUrl: URL): Promise<SeedResult> {
  return new Promise((resolve, reject) => {
    // Worker inherits process.execArgv from the parent by default, which
    // includes tsx's --require preflight + --import loader hooks. That's what
    // lets the worker resolve .ts files (and extensionless imports inside src/).
    const worker = new Worker(workerUrl, {
      workerData: { seed, args },
    });
    worker.once('message', (msg: { ok: true; result: SeedResult } | { ok: false; error: string }) => {
      if (msg.ok) resolve(msg.result);
      else reject(new Error(`Worker for ${seed} failed:\n${msg.error}`));
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`Worker for ${seed} exited with code ${code}`));
    });
  });
}

async function runSeedsParallel(seeds: readonly string[], args: SweepArgs, concurrency: number): Promise<SeedResult[]> {
  // Use the .mjs bootstrap as the Worker entry; it registers tsx's ESM loader
  // inside the worker thread and then dynamic-imports sweep-worker.ts.
  const workerUrl = new URL('./sweep-worker-bootstrap.mjs', import.meta.url);
  const results: SeedResult[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= seeds.length) return;
      const seed = seeds[i];
      const result = await runSeedInWorker(seed, args, workerUrl);
      // Stream completion to stdout as soon as each seed finishes. Order is
      // non-deterministic but content per seed is identical.
      process.stdout.write(
        `  [${seed}] ${(result.elapsedMs / 1000).toFixed(1)}s  ` +
        `techs=${result.stats.totalTechs} pop=${fmt(result.stats.peakPopulation)} ` +
        `countries=${result.stats.totalCountries} ended=${result.stats.worldEnded}\n`,
      );
      results.push(result);
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, seeds.length));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return results;
}

// ---------- Aggregation ----------

interface Aggregate {
  min: number;
  median: number;
  max: number;
  mean: number;
}

function aggregate(values: number[]): Aggregate {
  if (values.length === 0) return { min: 0, median: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

interface SweepReport {
  args: SweepArgs;
  generatedAt: string;
  elapsedMsTotal: number;
  perSeed: SeedResult[];
  aggregates: {
    peakPopulation: Aggregate;
    totalTechs: Aggregate;
    totalTrades: Aggregate;
    totalConquests: Aggregate;
    totalWars: Aggregate;
    totalCataclysms: Aggregate;
    totalCataclysmDeaths: Aggregate;
    totalCountries: Aggregate;
    totalEmpires: Aggregate;
    worldEndedCount: number;
    peakTechLevelByField: Record<TechField, Aggregate>;
    peakCountryTechLevelByField: Record<TechField, Aggregate>;
    medianCountryTechLevelByField: Record<TechField, Aggregate>;
    totalExpansions: Aggregate;
    totalSettlements: Aggregate;
    // Sum of tech events per century across all seeds, per field. Length
    // matches the century count of the longest run; shorter runs pad with 0.
    techEventsPerCenturyByFieldSum: Record<TechField, number[]>;
  };
}

function buildReport(args: SweepArgs, results: SeedResult[], elapsedMs: number): SweepReport {
  const peakTechLevelByField = {} as Record<TechField, Aggregate>;
  const peakCountryTechLevelByField = {} as Record<TechField, Aggregate>;
  const medianCountryTechLevelByField = {} as Record<TechField, Aggregate>;
  const techEventsPerCenturyByFieldSum = {} as Record<TechField, number[]>;

  const maxCenturies = results.reduce((max, r) => {
    const len = r.stats.techEventsPerCenturyByField.science.length;
    return len > max ? len : max;
  }, 0);

  for (const field of TECH_FIELDS) {
    peakTechLevelByField[field] = aggregate(results.map(r => r.stats.peakTechLevelByField[field]));
    peakCountryTechLevelByField[field] = aggregate(results.map(r => r.stats.peakCountryTechLevelByField[field]));
    medianCountryTechLevelByField[field] = aggregate(results.map(r => r.stats.medianCountryTechLevelByField[field]));

    const summed = new Array(maxCenturies).fill(0);
    for (const r of results) {
      const arr = r.stats.techEventsPerCenturyByField[field];
      for (let i = 0; i < arr.length; i++) summed[i] += arr[i];
    }
    techEventsPerCenturyByFieldSum[field] = summed;
  }

  return {
    args,
    generatedAt: new Date().toISOString(),
    elapsedMsTotal: elapsedMs,
    perSeed: results,
    aggregates: {
      peakPopulation: aggregate(results.map(r => r.stats.peakPopulation)),
      totalTechs: aggregate(results.map(r => r.stats.totalTechs)),
      totalTrades: aggregate(results.map(r => r.stats.totalTrades)),
      totalConquests: aggregate(results.map(r => r.stats.totalConquests)),
      totalWars: aggregate(results.map(r => r.stats.totalWars)),
      totalCataclysms: aggregate(results.map(r => r.stats.totalCataclysms)),
      totalCataclysmDeaths: aggregate(results.map(r => r.stats.totalCataclysmDeaths)),
      totalCountries: aggregate(results.map(r => r.stats.totalCountries)),
      totalEmpires: aggregate(results.map(r => r.stats.totalEmpires)),
      worldEndedCount: results.filter(r => r.stats.worldEnded).length,
      totalExpansions: aggregate(results.map(r => r.stats.totalExpansions)),
      totalSettlements: aggregate(results.map(r => r.stats.totalSettlements)),
      peakTechLevelByField,
      peakCountryTechLevelByField,
      medianCountryTechLevelByField,
      techEventsPerCenturyByFieldSum,
    },
  };
}

// ---------- stdout formatting ----------

function fmt(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function fmtAgg(a: Aggregate): string {
  return `${fmt(a.min).padStart(7)} ${fmt(a.median).padStart(7)} ${fmt(a.max).padStart(7)}`;
}

function printReport(report: SweepReport, concurrency: number): void {
  const { aggregates: agg, args, perSeed } = report;
  console.log('');
  console.log('='.repeat(72));
  console.log(`Phase 4 Sweep — label=${args.label} seeds=${perSeed.length} years=${args.years} cells=${args.cells}`);
  console.log('='.repeat(72));
  console.log(`Total elapsed: ${(report.elapsedMsTotal / 1000).toFixed(1)}s  (concurrency=${concurrency})`);
  console.log('');
  console.log('Per-seed runtimes:');
  for (const r of perSeed) {
    console.log(`  ${r.seed.padEnd(10)} ${(r.elapsedMs / 1000).toFixed(1).padStart(6)}s  ended=${r.stats.worldEnded}`);
  }
  console.log('');
  console.log('Aggregates across seeds:                   min    median     max');
  console.log(`  peakPopulation            ${fmtAgg(agg.peakPopulation)}`);
  console.log(`  totalTechs                ${fmtAgg(agg.totalTechs)}`);
  console.log(`  totalTrades               ${fmtAgg(agg.totalTrades)}`);
  console.log(`  totalConquests            ${fmtAgg(agg.totalConquests)}`);
  console.log(`  totalWars                 ${fmtAgg(agg.totalWars)}`);
  console.log(`  totalCataclysms           ${fmtAgg(agg.totalCataclysms)}`);
  console.log(`  totalCataclysmDeaths      ${fmtAgg(agg.totalCataclysmDeaths)}`);
  console.log(`  totalCountries            ${fmtAgg(agg.totalCountries)}`);
  console.log(`  totalEmpires              ${fmtAgg(agg.totalEmpires)}`);
  console.log(`  worldEnded (count)        ${String(agg.worldEndedCount).padStart(7)}/${perSeed.length}`);
  console.log('');
  console.log('Peak tech level by field (across seeds):');
  console.log('                     min    median     max');
  for (const field of TECH_FIELDS) {
    console.log(`  ${field.padEnd(12)} ${fmtAgg(agg.peakTechLevelByField[field])}`);
  }
  console.log('');
  console.log('Peak country tech level by field:');
  console.log('                     min    median     max');
  for (const field of TECH_FIELDS) {
    console.log(`  ${field.padEnd(12)} ${fmtAgg(agg.peakCountryTechLevelByField[field])}`);
  }
  console.log('');
  console.log('Median country tech level by field:');
  console.log('                     min    median     max');
  for (const field of TECH_FIELDS) {
    console.log(`  ${field.padEnd(12)} ${fmtAgg(agg.medianCountryTechLevelByField[field])}`);
  }
  console.log('');
}

// ---------- entry point ----------

async function main(): Promise<void> {
  const { args, concurrency: requestedConcurrency } = parseArgs(process.argv.slice(2));
  if (args.seeds < 1 || args.seeds > FIXED_SEEDS.length) {
    throw new Error(`--seeds must be 1..${FIXED_SEEDS.length}, got ${args.seeds}`);
  }
  const seeds = FIXED_SEEDS.slice(0, args.seeds);

  // Resolve concurrency: explicit --concurrency wins, else min(seedCount, cores).
  let concurrency = requestedConcurrency;
  if (concurrency <= 0) {
    const cores = (typeof availableParallelism === 'function' ? availableParallelism() : 4) || 4;
    concurrency = Math.min(seeds.length, cores);
  }
  concurrency = Math.max(1, Math.min(concurrency, seeds.length));

  console.log(`Phase 4 sweep starting: label=${args.label} seeds=${seeds.join(',')}`);
  console.log(`  years=${args.years}  cells=${args.cells}  dims=${args.width}x${args.height}  water=${args.waterRatio}  concurrency=${concurrency}`);

  const t0 = Date.now();
  const completed = await runSeedsParallel(seeds, args, concurrency);
  const elapsedMs = Date.now() - t0;

  // Sort completed results back into FIXED_SEEDS order so the JSON report's
  // perSeed[] is byte-identical to the previous sequential harness.
  const seedOrder = new Map(seeds.map((s, i) => [s, i]));
  const perSeed = completed.slice().sort((a, b) => (seedOrder.get(a.seed) ?? 0) - (seedOrder.get(b.seed) ?? 0));

  const report = buildReport(args, perSeed, elapsedMs);
  printReport(report, concurrency);

  // Write JSON report. Use a stable sort key order so diffs between runs are
  // minimal. The only non-deterministic fields are `generatedAt` and per-seed
  // `elapsedMs`, both of which are wall-clock by design.
  const __filename = fileURLToPath(import.meta.url);
  const scriptsDir = dirname(__filename);
  const resultsDir = join(scriptsDir, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = join(resultsDir, `${args.label}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Wrote report → scripts/results/${args.label}.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
