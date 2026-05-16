/**
 * Fixed civilisation colour palette. Each new civ is assigned the next
 * unused entry indexed by `civilisations.length` at founding time — no
 * RNG draw. Keeps colours visually distinct across the universe (24 hand-
 * tuned hues spaced around the colour wheel) and stable across re-runs.
 *
 * The palette wraps modulo length; in the rare case a universe spawns more
 * civilisations than there are slots, later civs reuse earlier hues.
 */
export const CIV_COLORS: readonly string[] = [
  '#ff5050', '#ff8a3c', '#ffcc28', '#a8d83a',
  '#3ad864', '#28d0a8', '#3acce0', '#3a8aff',
  '#6450ff', '#a04aff', '#e040c8', '#ff4a8a',
  '#c87850', '#a89868', '#8a8a3a', '#5aa850',
  '#3a8a78', '#508aa8', '#5868c8', '#7a58a8',
  '#a85878', '#bf6a5a', '#7a6a3a', '#586878',
] as const;

export function civColorAt(index: number): string {
  return CIV_COLORS[((index % CIV_COLORS.length) + CIV_COLORS.length) % CIV_COLORS.length];
}
