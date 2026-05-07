// Timing instrumentation for the history generation pipeline.
//
// All recording is gated by the DEBUG_HISTORY_TIMING flag below. When false
// (the production default), `timed()` short-circuits to a direct function call
// and `historyTiming.report()` is unreachable from the hot path, so Vite/esbuild
// tree-shakes the bookkeeping out at build time.
//
// To use during development:
//   1. Flip DEBUG_HISTORY_TIMING to true.
//   2. Run `npm run dev`, generate a history-enabled world.
//   3. Open the browser DevTools console — the timeline run prints a
//      per-step breakdown of total ms, percentage, call count, and avg μs.
//
// Determinism note: this file performs NO RNG draws and never mutates world
// state, so toggling the flag must not change the byte-deterministic sweep
// baseline. If a future change here ever calls into seeded code paths, route
// it through an isolated PRNG sub-stream per CLAUDE.md.

export const DEBUG_HISTORY_TIMING = false;

type Bucket = { total: number; calls: number };

class TimingAccumulator {
  private buckets = new Map<string, Bucket>();
  private timelineStart = 0;
  private orderCounter = 0;
  private firstSeen = new Map<string, number>();

  reset(): void {
    this.buckets.clear();
    this.firstSeen.clear();
    this.orderCounter = 0;
    this.timelineStart = performance.now();
  }

  record(label: string, durationMs: number): void {
    let b = this.buckets.get(label);
    if (!b) {
      b = { total: 0, calls: 0 };
      this.buckets.set(label, b);
      this.firstSeen.set(label, this.orderCounter++);
    }
    b.total += durationMs;
    b.calls += 1;
  }

  report(): string {
    const totalElapsed = performance.now() - this.timelineStart;
    const accountedFor = Array.from(this.buckets.values()).reduce((s, b) => s + b.total, 0);

    const lines: string[] = [];
    lines.push('=== History generation timing ===');
    lines.push(`Wall time:   ${totalElapsed.toFixed(1)} ms`);
    lines.push(
      `Accounted:   ${accountedFor.toFixed(1)} ms ` +
      `(${totalElapsed > 0 ? ((100 * accountedFor) / totalElapsed).toFixed(1) : '0.0'}%)`,
    );
    lines.push('');

    const sortedByTotal = Array.from(this.buckets.entries()).sort((a, b) => b[1].total - a[1].total);
    lines.push('-- Sorted by total time (hot paths first) --');
    lines.push(this.formatHeader());
    for (const row of sortedByTotal) lines.push(this.formatRow(row, accountedFor));
    lines.push('');

    const sortedByOrder = Array.from(this.buckets.entries()).sort(
      (a, b) => (this.firstSeen.get(a[0]) ?? 0) - (this.firstSeen.get(b[0]) ?? 0),
    );
    lines.push('-- In execution order --');
    lines.push(this.formatHeader());
    for (const row of sortedByOrder) lines.push(this.formatRow(row, accountedFor));

    return lines.join('\n');
  }

  private formatHeader(): string {
    return (
      'Label'.padEnd(22) +
      'Total (ms)'.padStart(12) +
      '% acct'.padStart(10) +
      'Calls'.padStart(10) +
      'Avg (μs)'.padStart(12)
    );
  }

  private formatRow([label, b]: [string, Bucket], accountedFor: number): string {
    const pct = accountedFor > 0 ? ((100 * b.total) / accountedFor).toFixed(1) : '0.0';
    const avgUs = b.calls > 0 ? ((b.total * 1000) / b.calls).toFixed(1) : '0.0';
    return (
      label.padEnd(22) +
      b.total.toFixed(1).padStart(12) +
      pct.padStart(9) + '%' +
      b.calls.toString().padStart(10) +
      avgUs.padStart(12)
    );
  }
}

export const historyTiming = new TimingAccumulator();

export function timed<T>(label: string, fn: () => T): T {
  if (!DEBUG_HISTORY_TIMING) return fn();
  const t0 = performance.now();
  const result = fn();
  historyTiming.record(label, performance.now() - t0);
  return result;
}
