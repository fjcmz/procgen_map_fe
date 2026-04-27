// Port of es.fjcmz.lib.procgen.model.ProbEnum from procgen-sample.
// Pick a value from a closed string-literal union, weighted by per-value `prob`,
// optionally biased by an adjust array indexed by the union's declared order.

export interface ProbEntry {
  prob: number;
}

// Pick weighted by spec[v].prob across the keys of spec.
// Returns the picked key. Falls back to the first key when all weights are 0.
export function probPick<K extends string>(
  spec: Record<K, ProbEntry>,
  keys: readonly K[],
  rng: () => number,
): K {
  let total = 0;
  for (const k of keys) {
    const w = Math.max(0, spec[k].prob);
    total += w;
  }
  if (total <= 0) return keys[0];
  let r = rng() * total;
  for (const k of keys) {
    const w = Math.max(0, spec[k].prob);
    if (r < w) return k;
    r -= w;
  }
  return keys[keys.length - 1];
}

// Same as probPick, but multiplies each weight by (1 + adjust[ordinal]).
// Adjust values are clamped so a weight never goes negative; the array must be
// the same length and order as `keys`.
export function probPickAdjusted<K extends string>(
  spec: Record<K, ProbEntry>,
  keys: readonly K[],
  adjust: readonly number[],
  rng: () => number,
): K {
  let total = 0;
  const weights: number[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const base = Math.max(0, spec[keys[i]].prob);
    const a = adjust[i] ?? 0;
    const w = Math.max(0, base * (1 + a));
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return keys[0];
  let r = rng() * total;
  for (let i = 0; i < keys.length; i++) {
    if (r < weights[i]) return keys[i];
    r -= weights[i];
  }
  return keys[keys.length - 1];
}

// Pick a uniformly random element from a non-empty list.
export function pickRandom<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}
