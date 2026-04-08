/**
 * Phase 4 — Tech Overhaul Balance Pass — Seed Sweep Harness
 *
 * Runs the full map-generation + history simulation pipeline across a fixed
 * set of seeds entirely in Node, without the browser worker. Replays the
 * exact sequence of calls from `src/workers/mapgen.worker.ts` so results are
 * byte-identical to a browser run at the same seed + params.
 *
 * Usage:
 *   npm run sweep                                    # default: 5 seeds, 5000 years, 3000 cells
 *   npm run sweep -- --label baseline-a              # tag the output filename
 *   npm run sweep -- --seeds 3 --years 2000          # smaller run for iteration
 *   npm run sweep -- --cells 5000                    # override cell count
 *
 * Outputs:
 *   - stdout: compact aggregate table (min / median / max across seeds)
 *   - scripts/results/<label>.json                   # full per-seed + aggregate report
 *
 * The harness is deterministic: re-running with the same args must produce
 * byte-identical JSON (modulo the `generatedAt` timestamp and `elapsedMs`).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
} from '../src/lib/terrain/index.ts';
import { historyGenerator } from '../src/lib/history/HistoryGenerator.ts';
import type { HistoryStats } from '../src/lib/history/HistoryGenerator.ts';
import type { TechField } from '../src/lib/history/timeline/Tech.ts';

// ---------- CLI parsing ----------

interface CliArgs {
  seeds: number;
  years: number;
  cells: number;
  width: number;
  height: number;
  waterRatio: number;
  label: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    seeds: 5,
    years: 5000,
    cells: 3000,
    width: 1600,
    height: 1000,
    waterRatio: 0.4,
    label: 'sweep',
  };
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
      default:
        if (flag.startsWith('--')) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }
  return args;
}

// Fixed spec-mandated seed list; truncated if --seeds < 5.
const FIXED_SEEDS = ['seed-01', 'seed-02', 'seed-03', 'seed-04', 'seed-05'] as const;

const TECH_FIELDS: TechField[] = [
  'science', 'military', 'industry', 'energy', 'growth',
  'exploration', 'biology', 'art', 'government',
];

// ---------- Single-seed run ----------

interface SeedResult {
  seed: string;
  stats: HistoryStats;
  elapsedMs: number;
}

function runSeed(seed: string, args: CliArgs): SeedResult {
  const t0 = Date.now();

  // Mirror mapgen.worker.ts:42–73 exactly.
  const { cells } = buildCellGraph(seed, args.cells, args.width, args.height);
  const noise = createNoiseSamplers3D(seed);
  assignElevation(cells, args.width, args.height, noise, args.waterRatio, seed);
  const { sstAnomaly } = computeOceanCurrents(cells, args.width, args.height);
  const distFromOcean = assignMoisture(cells, args.width, args.height, noise, sstAnomaly);
  assignTemperature(cells, args.width, args.height, distFromOcean, noise, sstAnomaly);
  assignBiomes(cells, args.width, args.height, noise);
  generateRivers(cells);
  hydraulicErosion(cells);
  generateRivers(cells);
  assignTemperature(cells, args.width, args.height, distFromOcean, noise, sstAnomaly);
  assignBiomes(cells, args.width, args.height, noise);

  // Worker uses `seed + '_history'` for the history RNG (see mapgen.worker.ts:84).
  const rng = seededPRNG(seed + '_history');
  const result = historyGenerator.generate(cells, args.width, rng, args.years);

  return {
    seed,
    stats: result.stats,
    elapsedMs: Date.now() - t0,
  };
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
  args: CliArgs;
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
    // Sum of tech events per century across all seeds, per field. Length
    // matches the century count of the longest run; shorter runs pad with 0.
    techEventsPerCenturyByFieldSum: Record<TechField, number[]>;
  };
}

function buildReport(args: CliArgs, results: SeedResult[], elapsedMs: number): SweepReport {
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

function printReport(report: SweepReport): void {
  const { aggregates: agg, args, perSeed } = report;
  console.log('');
  console.log('='.repeat(72));
  console.log(`Phase 4 Sweep — label=${args.label} seeds=${perSeed.length} years=${args.years} cells=${args.cells}`);
  console.log('='.repeat(72));
  console.log(`Total elapsed: ${(report.elapsedMsTotal / 1000).toFixed(1)}s`);
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.seeds < 1 || args.seeds > FIXED_SEEDS.length) {
    throw new Error(`--seeds must be 1..${FIXED_SEEDS.length}, got ${args.seeds}`);
  }
  const seeds = FIXED_SEEDS.slice(0, args.seeds);

  console.log(`Phase 4 sweep starting: label=${args.label} seeds=${seeds.join(',')}`);
  console.log(`  years=${args.years}  cells=${args.cells}  dims=${args.width}x${args.height}  water=${args.waterRatio}`);

  const t0 = Date.now();
  const perSeed: SeedResult[] = [];
  for (const seed of seeds) {
    process.stdout.write(`  [${seed}] running... `);
    const result = runSeed(seed, args);
    process.stdout.write(`${(result.elapsedMs / 1000).toFixed(1)}s  `);
    process.stdout.write(`techs=${result.stats.totalTechs} pop=${fmt(result.stats.peakPopulation)} `);
    process.stdout.write(`countries=${result.stats.totalCountries} ended=${result.stats.worldEnded}\n`);
    perSeed.push(result);
  }
  const elapsedMs = Date.now() - t0;

  const report = buildReport(args, perSeed, elapsedMs);
  printReport(report);

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

main();
