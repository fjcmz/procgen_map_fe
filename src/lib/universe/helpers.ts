/**
 * Mirrors the `ReferenceSizeConfig.RandomSizeConfig.rndSize(max, min)` helper from
 * the upstream Java framework: returns a uniform integer in `[min, min + max)`,
 * clamped at 0. Used to drive child-count rolls (e.g. solar systems per universe,
 * stars per system, satellites per planet).
 */
export function rndSize(rng: () => number, max: number, min: number): number {
  return Math.max(0, Math.floor(rng() * max) + min);
}
