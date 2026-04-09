/**
 * Deterministic color-pair generation and Canvas pattern creation
 * for country (diagonal stripes) and empire (plaid) fills.
 */

/** Golden-ratio hue spacing for deterministic, well-distributed hues. */
const GOLDEN_ANGLE = 137.508;

/**
 * Generate a two-color pair for a given entity index.
 * Uses golden-ratio hue spacing; the two colors sit 40° apart in hue
 * and differ in lightness so they're easy to tell apart within one stripe.
 */
export function generateColorPair(
  index: number,
  alpha: number,
): [string, string] {
  const hue1 = (index * GOLDEN_ANGLE) % 360;
  const hue2 = (hue1 + 40) % 360;
  const c1 = `hsla(${hue1}, 65%, 42%, ${alpha})`;
  const c2 = `hsla(${hue2}, 50%, 70%, ${alpha})`;
  return [c1, c2];
}

/**
 * Return an opaque stroke color for border edges, derived from the entity index.
 */
export function strokeColorForIndex(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue}, 60%, 30%)`;
}

// ── Stripe pattern (diagonal, for countries) ────────────────────────

const STRIPE_TILE = 24;
const STRIPE_WIDTH = 7;

/**
 * Create a repeating diagonal-stripe CanvasPattern.
 * Stripe direction is top-left → bottom-right.
 */
export function createStripePattern(
  ctx: CanvasRenderingContext2D,
  index: number,
  alpha: number,
  tileSize: number = STRIPE_TILE,
): CanvasPattern {
  const [c1, c2] = generateColorPair(index, alpha);
  const off = new OffscreenCanvas(tileSize, tileSize);
  const octx = off.getContext('2d')!;

  // Fill background with color 1
  octx.fillStyle = c1;
  octx.fillRect(0, 0, tileSize, tileSize);

  // Draw diagonal stripes in color 2.
  // We draw lines from top-left to bottom-right, repeating across the tile
  // with enough overshoot to cover corners.
  octx.strokeStyle = c2;
  octx.lineWidth = STRIPE_WIDTH;
  for (let offset = -tileSize; offset < tileSize * 2; offset += STRIPE_WIDTH * 2) {
    octx.beginPath();
    octx.moveTo(offset, 0);
    octx.lineTo(offset + tileSize, tileSize);
    octx.stroke();
  }

  return ctx.createPattern(off, 'repeat')!;
}

// ── Plaid pattern (for empires) ─────────────────────────────────────

const PLAID_TILE = 24;
const PLAID_BAND = 6;

/**
 * Create a repeating plaid (tartan-like) CanvasPattern.
 * Color 1 runs as horizontal bands, color 2 as vertical bands,
 * producing a distinctive cross-hatch grid.
 */
export function createPlaidPattern(
  ctx: CanvasRenderingContext2D,
  index: number,
  alpha: number,
  tileSize: number = PLAID_TILE,
): CanvasPattern {
  const [c1, c2] = generateColorPair(index, alpha);
  const off = new OffscreenCanvas(tileSize, tileSize);
  const octx = off.getContext('2d')!;

  // Light neutral background so the two band colors pop
  const bgHue = (index * GOLDEN_ANGLE) % 360;
  octx.fillStyle = `hsla(${bgHue}, 20%, 85%, ${alpha})`;
  octx.fillRect(0, 0, tileSize, tileSize);

  // Horizontal bands in color 1
  octx.fillStyle = c1;
  for (let y = 0; y < tileSize; y += PLAID_BAND * 2) {
    octx.fillRect(0, y, tileSize, PLAID_BAND);
  }

  // Vertical bands in color 2 (semi-transparent so overlaps create a third tone)
  octx.globalAlpha = 0.7;
  octx.fillStyle = c2;
  for (let x = 0; x < tileSize; x += PLAID_BAND * 2) {
    octx.fillRect(x, 0, PLAID_BAND, tileSize);
  }
  octx.globalAlpha = 1;

  return ctx.createPattern(off, 'repeat')!;
}

// ── Pattern cache ───────────────────────────────────────────────────

/**
 * Per-render cache for CanvasPattern objects.
 * Create one at the start of a render call; it is discarded afterwards.
 */
export class PatternCache {
  private cache = new Map<string, CanvasPattern>();

  getStripe(
    ctx: CanvasRenderingContext2D,
    index: number,
    alpha: number,
  ): CanvasPattern {
    const key = `s-${index}`;
    let p = this.cache.get(key);
    if (!p) {
      p = createStripePattern(ctx, index, alpha);
      this.cache.set(key, p);
    }
    return p;
  }

  getPlaid(
    ctx: CanvasRenderingContext2D,
    index: number,
    alpha: number,
  ): CanvasPattern {
    const key = `p-${index}`;
    let p = this.cache.get(key);
    if (!p) {
      p = createPlaidPattern(ctx, index, alpha);
      this.cache.set(key, p);
    }
    return p;
  }

  clear(): void {
    this.cache.clear();
  }
}
