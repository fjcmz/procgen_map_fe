/**
 * Deterministic color-pair generation and Canvas pattern creation
 * for country (diagonal stripes) and empire (plaid) fills.
 */

/** Golden-ratio hue spacing for deterministic, well-distributed hues. */
const GOLDEN_ANGLE = 137.508;

/**
 * Generate a two-color pair for a given entity index.
 * Uses golden-ratio hue spacing so adjacent indices are visually distinct.
 */
export function generateColorPair(
  index: number,
  alpha: number,
): [string, string] {
  const hue = (index * GOLDEN_ANGLE) % 360;
  const c1 = `hsla(${hue}, 55%, 45%, ${alpha})`;
  const c2 = `hsla(${hue}, 55%, 72%, ${alpha})`;
  return [c1, c2];
}

/**
 * Return an opaque stroke color for border edges, derived from the entity index.
 */
export function strokeColorForIndex(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue}, 50%, 35%)`;
}

// ── Stripe pattern (diagonal, for countries) ────────────────────────

const DEFAULT_TILE = 16;
const STRIPE_WIDTH = 4;

/**
 * Create a repeating diagonal-stripe CanvasPattern.
 * Stripe direction is top-left → bottom-right.
 */
export function createStripePattern(
  ctx: CanvasRenderingContext2D,
  index: number,
  alpha: number,
  tileSize: number = DEFAULT_TILE,
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

const PLAID_BAND = 4;

/**
 * Create a repeating plaid (tartan-like) CanvasPattern.
 * Horizontal and vertical bands overlap to form a cross-hatch grid.
 */
export function createPlaidPattern(
  ctx: CanvasRenderingContext2D,
  index: number,
  alpha: number,
  tileSize: number = DEFAULT_TILE,
): CanvasPattern {
  const [c1, c2] = generateColorPair(index, alpha);
  const off = new OffscreenCanvas(tileSize, tileSize);
  const octx = off.getContext('2d')!;

  // Fill background with color 1
  octx.fillStyle = c1;
  octx.fillRect(0, 0, tileSize, tileSize);

  // Horizontal bands in color 2
  octx.fillStyle = c2;
  for (let y = 0; y < tileSize; y += PLAID_BAND * 2) {
    octx.fillRect(0, y, tileSize, PLAID_BAND);
  }

  // Vertical bands in color 2 with lighter blend (use globalAlpha for overlap)
  octx.globalAlpha = 0.6;
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
