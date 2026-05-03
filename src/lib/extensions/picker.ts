import type { PackedRollRule } from './types';

/**
 * Context the picker uses to evaluate a rule's match clause.
 * `orbit` is the parent star orbit for planets; `parentOrbit` is the parent
 * planet's orbit for satellites (always undefined for planets and vice versa).
 */
export interface PickerContext {
  composition: string;
  life?: boolean;
  biome?: string;
  orbit?: number;
  parentOrbit?: number;
}

function matches(rule: PackedRollRule, ctx: PickerContext): boolean {
  const m = rule.match;
  if (m.composition !== undefined && m.composition !== ctx.composition) return false;
  if (m.life !== undefined && m.life !== ctx.life) return false;
  if (m.biome !== undefined && m.biome !== ctx.biome) return false;
  if (m.orbitMin !== undefined && (ctx.orbit === undefined || ctx.orbit < m.orbitMin)) return false;
  if (m.orbitMax !== undefined && (ctx.orbit === undefined || ctx.orbit >= m.orbitMax)) return false;
  if (m.parentOrbitMin !== undefined && (ctx.parentOrbit === undefined || ctx.parentOrbit < m.parentOrbitMin)) return false;
  if (m.parentOrbitMax !== undefined && (ctx.parentOrbit === undefined || ctx.parentOrbit >= m.parentOrbitMax)) return false;
  return true;
}

/**
 * Apply the rule list to a context. Returns the picked subtype id, or
 * `fallback` if no rule matched.
 *
 * Determinism contract: each invocation calls `rng()` zero times if the
 * matched rule's pick is `fixed`, or exactly once otherwise. Callers MUST NOT
 * pre-draw from `rng` before calling this — the rng() call inside the
 * threshold/uniform branch must be the first draw against the sub-stream.
 */
export function pickSubtype(
  rules: ReadonlyArray<PackedRollRule>,
  ctx: PickerContext,
  rng: () => number,
  fallback: string,
): string {
  for (const rule of rules) {
    if (!matches(rule, ctx)) continue;
    return applyPick(rule, rng, fallback);
  }
  return fallback;
}

function applyPick(rule: PackedRollRule, rng: () => number, fallback: string): string {
  const pick = rule.pick;
  if (pick.kind === 'fixed') return pick.subtype;
  const r = rng();
  if (pick.kind === 'thresholds') {
    for (const t of pick.thresholds) if (r < t.until) return t.subtype;
    return pick.thresholds[pick.thresholds.length - 1]?.subtype ?? fallback;
  }
  // uniform
  return pick.subtypes[Math.floor(r * pick.subtypes.length)] ?? fallback;
}

/**
 * Pick a biome from a weight table. Uses one rng() draw — same convention as
 * `pickSubtype` so callers can swap freely. Returns `fallback` if the table
 * is empty.
 */
export function pickBiome(
  weights: ReadonlyArray<{ until: number; biome: string }>,
  rng: () => number,
  fallback: string,
): string {
  if (weights.length === 0) return fallback;
  const r = rng();
  for (const w of weights) if (r < w.until) return w.biome;
  return weights[weights.length - 1].biome;
}
