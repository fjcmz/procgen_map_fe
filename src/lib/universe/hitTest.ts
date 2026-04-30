import type { HitCircle } from './renderer';

/**
 * Pick the topmost circle whose disk contains the click point. Iterates
 * back-to-front so later-drawn entities (drawn on top) win ties — same
 * convention as the reference repo's HitTester.
 */
export function pickHit(circles: HitCircle[], px: number, py: number): HitCircle | null {
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    const dx = c.x - px;
    const dy = c.y - py;
    if (dx * dx + dy * dy <= c.r * c.r) return c;
  }
  return null;
}
