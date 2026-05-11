import type {
  UniverseData,
  GalaxyData,
  SolarSystemData,
  StarData,
  PlanetData,
  SatelliteData,
} from './types';
import type { PlanetSubtype, PlanetBiome } from './Planet';
import type { SatelliteSubtype } from './Satellite';
import { computeLayoutExtent } from './galaxyLayout';
import { buildOrGetSectorMesh, drawGalaxySectors } from './galaxySectors';
import type { SectorData } from './types';
import type { StarSubtype } from './SystemKind';
import { STAR_SUBTYPE_HUE } from './SystemKindInfo';

/**
 * Universe canvas-2D renderer. Three scenes (galaxy / system / planet),
 * mirroring the drill-down UX of github.com/fjcmz/procen_universe_viz.
 *
 * Helpers ported from the reference repo:
 * - galaxySpiralPositions: 2-arm logarithmic spiral system layout
 * - OrbitalMechanics.angularVelocity: Kepler's 3rd law, ω ∝ r^-1.5
 * - StarField: seeded LCG background star field
 * - ScaleMapper: linear/sqrt/log domain → pixel mapping for fair size
 *   perception across orders of magnitude
 *
 * The user-supplied seed drives generation only; the background star field
 * uses an INDEPENDENT LCG seed (`STAR_FIELD_SEED = 42`) so the backdrop is
 * identical regardless of universe contents — same as the reference repo.
 */

// ── Background star field constants ───────────────────────────────────────
const STAR_FIELD_COUNT = 500;
const STAR_FIELD_SEED = 42;

// ── Orbital animation speeds ───────────────────────────────────────────────
const GALAXY_SPIN_SPEED = 0.018;  // rad/s — full rotation ≈ 5.8 min
// k constants for orbitalAngularVelocity — tuned so the range of orbit/index
// values used by each body type yields visible periods (seconds, not hours):
//   planet.orbit is in ~[0, 20] → innermost ≈ 13 s, outermost ≈ 2–8 min
//   satellite index (1+i)  in [1…]  → innermost ≈  8 s, each outer ring slower
//   star rank (1 = innermost/smallest) → rank 1 ≈ 8 s, each outer rank slower
const PLANET_K = 0.5;
const SAT_K    = 0.8;
const STAR_K   = 0.8;  // multi-star orbit: innermost ≈ 8 s, larger orbits slower

const PLANET_MIN_PX = 1;
const PLANET_MAX_PX = 6;
const STAR_MIN_PX = 5;
const STAR_MAX_PX = 16;
// Absolute generation bounds for star radius (StarGenerator: [400, 900]).
// Used for size mapping so visual disk size is proportional to actual radius
// regardless of which other stars share the system.
const STAR_RADIUS_MIN = 400;
const STAR_RADIUS_MAX = 900;
const SAT_MIN_PX = 2;
const SAT_MAX_PX = 10;

const SAT_BASE_ORBIT = 90;
const SAT_ORBIT_STEP = 90;
const PLANET_ORBIT_SCALE = 5;

// ── FNV-1a hash for deterministic per-galaxy variability ─────────────────
// Produces a uint32 from a string id so the same galaxy always gets the
// same jitter / rotation offset, independent of generation order.
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ── Tiny seeded LCG used only for the static background star field ─────
export function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

// ── ScaleMapper ───────────────────────────────────────────────────────────
export type ScaleMode = 'linear' | 'sqrt' | 'log';

export function scaleMap(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
  mode: ScaleMode = 'linear',
): number {
  if (domainMax <= domainMin) return rangeMin;
  let t: number;
  switch (mode) {
    case 'sqrt': {
      const v = Math.max(0, value - domainMin);
      const span = domainMax - domainMin;
      t = Math.sqrt(v) / Math.sqrt(span);
      break;
    }
    case 'log': {
      const v = Math.max(1, value);
      const lo = Math.max(1, domainMin);
      const hi = Math.max(lo + 1, domainMax);
      t = (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
      break;
    }
    default:
      t = (value - domainMin) / (domainMax - domainMin);
  }
  t = Math.max(0, Math.min(1, t));
  return rangeMin + t * (rangeMax - rangeMin);
}

// ── Orbital mechanics (Kepler ω ∝ r^-1.5) ─────────────────────────────────
export function orbitalAngularVelocity(orbitRadius: number, k: number = 1.2): number {
  // Guard against r=0; tiny orbits would otherwise spin at infinity.
  const r = Math.max(0.5, orbitRadius);
  return k * Math.pow(r, -1.5);
}

/**
 * Deterministic per-body phase offset in [0, 2π). Hash a string id with FNV-1a
 * so the planet/satellite always starts at the same angle when re-entering
 * a scene — coherent across re-renders without needing a global RNG.
 */
function phaseFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

/**
 * Deterministic per-body speed factor in [0, 1). Uses a different FNV-1a IV
 * from phaseFromId so phase and speed are uncorrelated.
 */
function speedFromId(id: string): number {
  let h = 0xdeadbeef;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Deterministic orbit eccentricity raw value [0, 1) for a body id. */
function eccentricityFromId(id: string): number {
  let h = 0x0f00ba12;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Deterministic orbit tilt (major-axis rotation) in [0, π) for a body id. */
function orbitTiltFromId(id: string): number {
  let h = 0xc0ffee00;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x100000000) * Math.PI;
}

// ── Galaxy layout functions ───────────────────────────────────────────────

/**
 * 2-arm logarithmic spiral with a ~15% central cluster. The central systems
 * are packed in a small nucleus around the galaxy core; the remaining 85% are
 * distributed across two outward-spiralling arms.
 *
 * Arm scatter is applied perpendicular to the spiral tangent so the two arms
 * stay narrow and visually distinct — radial and XY jitter is kept very small.
 */
export function galaxySpiralPositions(
  count: number,
  cx: number,
  cy: number,
  spread: number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const centralCount = Math.round(count * 0.15);
  const armCount = count - centralCount;

  const arms = 2;
  const armOffset = Math.PI;
  const a = 8;
  const maxK = Math.max(1, Math.floor(armCount / 2));
  // Cap each arm at 2 full revolutions regardless of system count: same stars
  // in a shorter arc → visually denser and less winding than before.
  const angleStep = Math.min(0.42, (Math.PI * 4) / maxK);
  const b = Math.min(0.18, 2.42 / (maxK * angleStep));

  const centralMaxR = (a * Math.exp(b * angleStep * 0.5)) * (spread / 200) * 0.8;

  // Central cluster — sin-based pseudo-random placement so there's no
  // regular structure visible in the nucleus.
  for (let i = 0; i < centralCount; i++) {
    const angle = (Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5) * Math.PI * 2;
    const uRaw  = (Math.sin(i * 269.5 + 183.3) * 0.5 + 0.5);
    const r = centralMaxR * (1 - Math.sqrt(1 - uRaw));
    positions.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }

  // Two spiral arms — scatter applied only perpendicular to the arm so the
  // two arms remain tight and visually separate. Arm width is 6% of radius,
  // with a small absolute floor so innermost points still have visible spread.
  for (let i = 0; i < armCount; i++) {
    const arm = i % arms;
    const k = Math.floor(i / arms);
    // kAngle drives radius for both arms — arm 1 must start at the same inner
    // radius as arm 0, just offset by π in angle. Using baseAngle (which
    // includes armOffset) for radius made arm 1's inner radius ~1.6× larger
    // than arm 0's, hiding arm 1 near the core and overshooting at the edge.
    const kAngle = k * angleStep;
    const armAngle = armOffset * arm + kAngle;
    const radius = (a * Math.exp(b * kAngle)) * (spread / 200);
    // Tiny along-arm angle wobble to break perfect regularity.
    const jitterAngle = ((i * 12.9898) % Math.PI) * 0.012;
    const finalAngle = armAngle + jitterAngle;
    // Perpendicular direction to the spiral arm at this point.
    const perpAngle = finalAngle + Math.PI / 2;
    const armWidth = Math.max(Math.abs(radius) * 0.025, (spread / 200) * 0.5);
    const perpScatter = (((i * 78.233) % 2) - 1) * armWidth;
    positions.push({
      x: cx + Math.cos(finalAngle) * radius + Math.cos(perpAngle) * perpScatter,
      y: cy + Math.sin(finalAngle) * radius + Math.sin(perpAngle) * perpScatter,
    });
  }
  return positions;
}

/**
 * Oval (elliptical) galaxy layout. Systems are distributed inside an ellipse
 * with a linear density falloff from centre to edge — the centre is the
 * densest region and density decreases to zero at the oval boundary.
 *
 * Angle and radius are sampled with independent sin-based pseudo-random
 * values so there is no correlated structure (no arms, no rings).
 * The ellipse aspect ratio is derived from the galaxy id hash so each
 * oval galaxy has a distinct shape.
 */
export function galaxyOvalPositions(
  count: number,
  cx: number,
  cy: number,
  spread: number,
  galaxyId: string = '',
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const maxR = spread * 0.3;

  // Per-galaxy aspect ratio [1.4, 2.2] derived from id hash.
  const h = hashId(galaxyId);
  const aspectX = 1.4 + (h & 0xfff) / 0xfff * 0.8;

  for (let i = 0; i < count; i++) {
    // Independent sin-based pseudo-random values for angle and radius.
    // Using two different large-prime multipliers keeps them uncorrelated,
    // avoiding the spiral-arm artefact produced by the golden-angle sequence.
    const angleRand  = Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5; // [0, 1)
    const radiusRand = Math.sin(i * 269.5 + 183.3) * 0.5 + 0.5; // [0, 1)

    const angle = angleRand * Math.PI * 2;
    // Linear density falloff: density(r) ∝ (1−r/R) → inverse CDF gives
    // r/R = 1 − sqrt(1 − u), concentrating systems toward the centre.
    const r = maxR * (1 - Math.sqrt(1 - radiusRand));

    positions.push({
      x: cx + Math.cos(angle) * r * aspectX,
      y: cy + Math.sin(angle) * r,
    });
  }
  return positions;
}

// ── Background star field ─────────────────────────────────────────────────
export interface BackgroundStar {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

export function createStarField(viewportW: number, viewportH: number): BackgroundStar[] {
  const rng = lcg(STAR_FIELD_SEED);
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < STAR_FIELD_COUNT; i++) {
    stars.push({
      x: rng() * viewportW,
      y: rng() * viewportH,
      r: rng() * 0.8 + 0.15,
      alpha: rng() * 0.5 + 0.1,
    });
  }
  return stars;
}

// ── Hit-test inputs (consumed by ../components/UniverseCanvas) ────────────
export interface HitCircle {
  x: number;
  y: number;
  r: number;
  kind: 'galaxy' | 'system' | 'planet' | 'satellite' | 'wormhole';
  id: string;
}

// ── Wormhole visuals ──────────────────────────────────────────────────────
// All wormholes share a fixed palette so they read as a single "kind" across
// the universe (planets/satellites vary per subtype/biome; wormholes don't).
// Drawn as a dark grey disc with a thin white halo, statically positioned
// (no orbital motion) at a per-wormhole content-space offset from the system
// centre.
const WORMHOLE_CORE_PX = 7;
const WORMHOLE_CORE_FILL = '#2a2a2e';
const WORMHOLE_HALO_FILL = 'rgba(255,255,255,0.92)';
const WORMHOLE_RING_ALPHA = 0.55;
// `WormholeGenerator` bakes offsets as fractions of "minSide" (the shorter
// viewport dimension). The renderer multiplies by this factor — see
// `drawSystemScene` — so wormholes scale with the system view automatically.
const WORMHOLE_OFFSET_MIN_SIDE_FACTOR = 1;
const WORMHOLE_CONNECTION_STROKE = 'rgba(240,245,255,0.58)';
// Universe-view hover-tier strokes for cross-galaxy lines. The base alpha
// is the same as `WORMHOLE_CONNECTION_STROKE` (0.58); tiers scale that.
//   Tier 1 — line incident to hovered galaxy: full brightness (== base).
//   Tier 2 — line whose at-least-one endpoint is a wormhole neighbour of the
//            hovered galaxy: ~30% of base.
//   Tier 3 — every other inter-galaxy line: ~10% of base.
// When no galaxy is hovered, every line falls back to tier 2 (30%).
const WORMHOLE_LINE_TIER_FULL = 'rgba(240,245,255,0.58)';
const WORMHOLE_LINE_TIER_DIM = 'rgba(240,245,255,0.17)';     // ≈ 0.58 × 0.3
const WORMHOLE_LINE_TIER_FAINT = 'rgba(240,245,255,0.06)';   // ≈ 0.58 × 0.1
const WORMHOLE_CONNECTION_DASH: [number, number] = [4, 4];

function drawWormholeBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  viewScale: number,
): void {
  const coreR = WORMHOLE_CORE_PX / viewScale;
  // Halo: thin white ring just outside the core. Drawn first so the dark
  // core sits on top (cleaner edge than stroking after a fill).
  ctx.beginPath();
  ctx.arc(cx, cy, coreR + 1.4 / viewScale, 0, Math.PI * 2);
  ctx.fillStyle = WORMHOLE_HALO_FILL;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = WORMHOLE_CORE_FILL;
  ctx.fill();
  // Inner highlight ring for a touch of depth without going full glow.
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${WORMHOLE_RING_ALPHA})`;
  ctx.lineWidth = 0.8 / viewScale;
  ctx.stroke();
}

// LOD blend zone for the multi-galaxy scene. Below `LOD_BLEND_START` only
// the stylized glyph is drawn; above `LOD_BLEND_END` only the embedded
// systems. In between, both layers are cross-faded with a smoothstep curve
// so the transition reads as a gradual zoom rather than a hard scene swap.
// Hit emission follows visibility: the galaxy hit is pushed first whenever
// the glyph is at all visible, and the per-system hits are pushed after
// (so direct hits on a star dot win during overlap, while empty galaxy
// space still opens the galaxy popup).
const LOD_BLEND_START = 15;
const LOD_BLEND_END = 35;
// Viewport fit factor: leave a 10% margin on each side so the outermost
// galaxy doesn't kiss the canvas edge.
const VIEWPORT_FIT_FRACTION = 0.45;
// Minimum hit radius for a galaxy glyph (in screen px) so users can always
// click a tiny glyph at low zoom levels.
const GALAXY_HIT_MIN_PX = 14;

function smoothstep01(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

// ── Drawing primitives ────────────────────────────────────────────────────
function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}


function drawOrbitRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  viewScale: number = 1,
  ecc: number = 0,
  tilt: number = 0,
): void {
  ctx.beginPath();
  if (ecc > 0) {
    ctx.ellipse(cx, cy, r, r * (1 - ecc), tilt, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.strokeStyle = 'rgba(180, 200, 240, 0.18)';
  ctx.lineWidth = 1 / viewScale;
  ctx.stroke();
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  stars: BackgroundStar[],
): void {
  ctx.fillStyle = '#05030d';
  ctx.fillRect(0, 0, w, h);
  for (const s of stars) {
    ctx.globalAlpha = s.alpha;
    drawCircle(ctx, s.x, s.y, s.r, '#e8e8ff');
  }
  ctx.globalAlpha = 1;
}

// ── Composition palettes ──────────────────────────────────────────────────
interface StarPalette { core: string; glowInner: string; glowOuter: string }

function starFill(s: StarData): StarPalette {
  // Exotic subtypes use a declarative palette so the renderer is consistent
  // with popup colours. Antimatter override stays in effect — antimatter
  // anywhere should read pink/purple regardless of subtype.
  if (s.composition === 'ANTIMATTER') {
    return { core: '#f4d8ff', glowInner: 'rgba(220,140,255,0.8)', glowOuter: 'rgba(120,40,180,0)' };
  }
  const subHue = STAR_SUBTYPE_HUE[s.subtype];
  if (subHue) return subHue;
  // Fallback (main_sequence and any future unmapped subtype): brightness tint.
  const t = Math.max(0, Math.min(1, (s.brightness - 100) / 900));
  const r = Math.round(255 * (0.85 + 0.15 * t));
  const g = Math.round(220 * (0.7 + 0.3 * (1 - Math.abs(t - 0.5) * 2)));
  const b = Math.round(255 * (1 - 0.7 * t));
  return { core: `rgb(${r},${g},${b})`, glowInner: `rgba(${r},${g},${b},0.8)`, glowOuter: `rgba(${r},${g},${b},0)` };
}

/**
 * Exotic subtypes whose visuals can't be expressed as a circle + glow gradient.
 * Drawn via dedicated helpers that bypass the offscreen glow cache.
 */
const EXOTIC_SUBTYPES: ReadonlySet<StarSubtype> = new Set<StarSubtype>([
  'stellar_black_hole',
  'supermassive_black_hole',
  'pulsar',
  'white_hole',
  'magnetar',
  'quasar',
  'quark_star',
  'boson_star',
]);

function isExoticSubtype(t: StarSubtype): boolean {
  return EXOTIC_SUBTYPES.has(t);
}

/**
 * Stable rotation angle [0, 2π) derived from a body id — used for pulsar
 * beam orientation and other deterministic per-body angles.
 */
function rotationFromId(id: string, salt: number = 0): number {
  let h = 0x1f83d9ab ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000 * Math.PI * 2;
}

function drawAccretionRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  inner: string, outer: string,
  thickness: number = 0.55,
): void {
  const outerR = r * 2.6;
  const grd = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, outerR);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.35, inner);
  grd.addColorStop(0.7, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, thickness);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(0, 0, outerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBlackHole(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  supermassive: boolean,
): void {
  const inner = supermassive ? 'rgba(255,180,80,0.85)' : 'rgba(255,140,40,0.75)';
  const outer = supermassive ? 'rgba(160,40,0,0.30)' : 'rgba(120,30,0,0.20)';
  drawAccretionRing(ctx, cx, cy, r, inner, outer, supermassive ? 0.40 : 0.55);
  // Photon ring + dark core.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.10, 0, Math.PI * 2);
  ctx.strokeStyle = supermassive ? 'rgba(255,210,140,0.85)' : 'rgba(255,180,80,0.7)';
  ctx.lineWidth = Math.max(0.6, r * 0.10);
  ctx.stroke();
  drawCircle(ctx, cx, cy, r * 0.85, '#04020a');
}

function drawNeutronStar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  palette: StarPalette,
): void {
  // Sharp blue-white pinpoint with a tight inner halo.
  const haloR = r * 2.0;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  grd.addColorStop(0, palette.glowInner);
  grd.addColorStop(1, palette.glowOuter);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  drawCircle(ctx, cx, cy, Math.max(0.8, r * 0.6), palette.core);
}

function drawPulsar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  starId: string,
  palette: StarPalette,
): void {
  // Twin beams along a stable axis derived from the star id.
  const angle = rotationFromId(starId);
  const beamLen = r * 5.5;
  const beamWidth = r * 0.9;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const grd = ctx.createLinearGradient(0, 0, beamLen, 0);
  grd.addColorStop(0, palette.glowInner);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(0, -beamWidth);
  ctx.lineTo(beamLen, -beamWidth * 0.15);
  ctx.lineTo(beamLen, beamWidth * 0.15);
  ctx.lineTo(0, beamWidth);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(Math.PI);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(0, -beamWidth);
  ctx.lineTo(beamLen, -beamWidth * 0.15);
  ctx.lineTo(beamLen, beamWidth * 0.15);
  ctx.lineTo(0, beamWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawNeutronStar(ctx, cx, cy, r, palette);
}

function drawWhiteHole(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  palette: StarPalette,
): void {
  const haloR = r * 3.2;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  grd.addColorStop(0, palette.glowInner);
  grd.addColorStop(0.5, 'rgba(255,240,200,0.5)');
  grd.addColorStop(1, palette.glowOuter);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  // Radial burst rays.
  ctx.save();
  ctx.translate(cx, cy);
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    ctx.rotate((Math.PI * 2) / rays);
    const linGrd = ctx.createLinearGradient(0, 0, haloR * 0.95, 0);
    linGrd.addColorStop(0, 'rgba(255,255,240,0.9)');
    linGrd.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = linGrd;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.15);
    ctx.lineTo(haloR * 0.95, -r * 0.04);
    ctx.lineTo(haloR * 0.95, r * 0.04);
    ctx.lineTo(0, r * 0.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  drawCircle(ctx, cx, cy, r * 0.85, palette.core);
}

function drawMagnetar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  starId: string,
  palette: StarPalette,
): void {
  // Concentric magnetic field rings on a tilted axis.
  const tilt = rotationFromId(starId, 0x91);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  for (let i = 1; i <= 3; i++) {
    const rr = r * (1.5 + i * 0.9);
    ctx.beginPath();
    ctx.ellipse(0, 0, rr, rr * 0.35, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(150,200,255,${0.5 / i})`;
    ctx.lineWidth = Math.max(0.5, r * 0.18 / i);
    ctx.stroke();
  }
  ctx.restore();
  drawNeutronStar(ctx, cx, cy, r, palette);
}

function drawQuasar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  starId: string,
  palette: StarPalette,
): void {
  drawAccretionRing(ctx, cx, cy, r, 'rgba(255,200,100,0.9)', 'rgba(180,60,20,0.35)', 0.32);
  // Central jet — vertical with a slight tilt per id.
  const tilt = rotationFromId(starId, 0xa5) * 0.3 - Math.PI / 2;
  const jetLen = r * 6;
  const jetW = r * 0.4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  for (const dir of [1, -1]) {
    const grd = ctx.createLinearGradient(0, 0, 0, dir * jetLen);
    grd.addColorStop(0, palette.glowInner);
    grd.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-jetW, 0);
    ctx.lineTo(jetW, 0);
    ctx.lineTo(jetW * 0.15, dir * jetLen);
    ctx.lineTo(-jetW * 0.15, dir * jetLen);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  drawCircle(ctx, cx, cy, r * 0.9, palette.core);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,230,140,0.8)';
  ctx.lineWidth = Math.max(0.6, r * 0.12);
  ctx.stroke();
}

function drawCompactGlow(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  palette: StarPalette,
): void {
  const haloR = r * 2.4;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  grd.addColorStop(0, palette.glowInner);
  grd.addColorStop(1, palette.glowOuter);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  drawCircle(ctx, cx, cy, r, palette.core);
}

/**
 * Branch a star draw on subtype. Falls back to the standard glow-canvas +
 * solid core for ordinary star subtypes (main sequence, dwarfs, giants).
 */
function drawStarBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, starPx: number,
  star: StarData,
): void {
  const palette = starFill(star);
  switch (star.subtype) {
    case 'stellar_black_hole':
      drawBlackHole(ctx, cx, cy, starPx, false);
      return;
    case 'supermassive_black_hole':
      drawBlackHole(ctx, cx, cy, starPx, true);
      return;
    case 'pulsar':
      drawPulsar(ctx, cx, cy, starPx, star.id, palette);
      return;
    case 'neutron_star':
      drawNeutronStar(ctx, cx, cy, starPx, palette);
      return;
    case 'white_hole':
      drawWhiteHole(ctx, cx, cy, starPx, palette);
      return;
    case 'magnetar':
      drawMagnetar(ctx, cx, cy, starPx, star.id, palette);
      return;
    case 'quasar':
      drawQuasar(ctx, cx, cy, starPx, star.id, palette);
      return;
    case 'quark_star':
    case 'boson_star':
      drawCompactGlow(ctx, cx, cy, starPx, palette);
      return;
    default: {
      // Standard star: cached glow + solid core.
      const outerR = starPx * GLOW_OUTER_MULT;
      ctx.drawImage(getOrBuildGlowCanvas(palette), cx - outerR, cy - outerR, outerR * 2, outerR * 2);
      drawCircle(ctx, cx, cy, starPx, palette.core);
    }
  }
}

// ── Glow canvas cache ─────────────────────────────────────────────────────
// Each unique star color gets a 64×64 offscreen canvas with the radial
// gradient pre-rendered once. drawGlow stamps it via drawImage (cheap GPU
// blit) instead of calling createRadialGradient per system per frame.
// Outer glow radius = sizePx * GLOW_OUTER_MULT (half the original 2.2).
const GLOW_CANVAS_SIZE = 64;
const GLOW_OUTER_MULT = 1.1;
// Ratio of inner to outer gradient radius — same proportions as original.
const GLOW_INNER_FRAC = 0.1 / GLOW_OUTER_MULT;
const glowCanvasCache = new Map<string, HTMLCanvasElement>();

function getOrBuildGlowCanvas(palette: StarPalette): HTMLCanvasElement {
  const cached = glowCanvasCache.get(palette.glowInner);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = GLOW_CANVAS_SIZE;
  canvas.height = GLOW_CANVAS_SIZE;
  const gctx = canvas.getContext('2d')!;
  const half = GLOW_CANVAS_SIZE / 2;
  const grd = gctx.createRadialGradient(half, half, half * GLOW_INNER_FRAC, half, half, half);
  grd.addColorStop(0, palette.glowInner);
  grd.addColorStop(1, palette.glowOuter);
  gctx.fillStyle = grd;
  gctx.fillRect(0, 0, GLOW_CANVAS_SIZE, GLOW_CANVAS_SIZE);

  glowCanvasCache.set(palette.glowInner, canvas);
  return canvas;
}

// ── Galaxy shape glow ─────────────────────────────────────────────────────
// Soft radial halo behind an entire galaxy representing overall luminosity
// and shape. Oval galaxies stretch the gradient to match their aspect ratio.
function drawGalaxyGlow(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, glowR: number,
  shape: 'spiral' | 'oval', galaxyId: string,
  colorRgb: string, peakAlpha: number,
): void {
  ctx.save();
  if (shape === 'oval') {
    const h = hashId(galaxyId);
    const aspectX = 1.4 + (h & 0xfff) / 0xfff * 0.8;
    ctx.translate(cx, cy);
    ctx.scale(aspectX, 1.0);
    ctx.translate(-cx, -cy);
  }
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  grd.addColorStop(0,    `rgba(${colorRgb},${peakAlpha.toFixed(3)})`);
  grd.addColorStop(0.45, `rgba(${colorRgb},${(peakAlpha * 0.45).toFixed(3)})`);
  grd.addColorStop(1,    `rgba(${colorRgb},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(cx - glowR * 1.25, cy - glowR * 1.25, glowR * 2.5, glowR * 2.5);
  ctx.restore();
}

// ── Composition-driven palettes (planets / satellites) ───────────────────
//
// Each palette carries:
//   base    — disk midtone (also the legacy single-color fallback for tiny disks)
//   accent  — highlight color (lit hemisphere of the radial gradient, or band
//             accents for gas giants)
//   shadow  — limb shadow (lower-right of the radial gradient)
//   bands?  — extra color stops for banded gas giants (3+ values, including base)
//   hot?    — molten / volcanic spot color drawn over the disk for lava /
//             volcanic subtypes
//
// Colors were tuned by eye to read distinctly at the system view's tiny
// pixel sizes (1–6 px planet disks) AND look good blown up in the planet
// scene's 6%-of-min-side hero disk.

interface BodyPalette {
  base: string;
  accent: string;
  shadow: string;
  bands?: string[];
  hot?: string;
}

const PLANET_PALETTES: Record<PlanetSubtype, BodyPalette> = {
  // ROCK
  terrestrial: { base: '#4a8ab8', accent: '#9ad0c8', shadow: '#1f3850' },
  desert:      { base: '#d4a06a', accent: '#f0c890', shadow: '#5a3818' },
  volcanic:    { base: '#3a2418', accent: '#7a4830', shadow: '#100804', hot: '#e84818' },
  lava:        { base: '#c83a18', accent: '#ffb040', shadow: '#400808', hot: '#ffd060' },
  iron:        { base: '#a05538', accent: '#d08868', shadow: '#3a1808' },
  carbon:      { base: '#2c2a2a', accent: '#5a5858', shadow: '#0c0c0c' },
  ocean:       { base: '#2a6aa8', accent: '#6ac0e8', shadow: '#0a2848' },
  ice_rock:    { base: '#a8c0d0', accent: '#e8f4fc', shadow: '#506878' },
  // GAS — bands ordered from north pole to south, listed lighter→darker→light
  jovian:        { base: '#c89a64', accent: '#f0d4a0', shadow: '#583820',
                   bands: ['#e8c898', '#a87848', '#d4a878', '#8a5828', '#e0bc88'] },
  hot_jupiter:   { base: '#b8401c', accent: '#ffa050', shadow: '#380808',
                   bands: ['#e88840', '#982818', '#d8602c', '#601808', '#f09858'] },
  ice_giant:     { base: '#7ab8d0', accent: '#ccecf8', shadow: '#1a4858',
                   bands: ['#bce0ec', '#5a98b8', '#9acce0', '#3878a0', '#a8d8e8'] },
  methane_giant: { base: '#3868b8', accent: '#90b8e8', shadow: '#08183f',
                   bands: ['#7aa8e0', '#1848a0', '#5888d0', '#0a2870', '#88b0e0'] },
  ammonia_giant: { base: '#e8d8a0', accent: '#fff4c8', shadow: '#604818',
                   bands: ['#fff0c0', '#c8b878', '#f0e0a8', '#a89848', '#fff8d0'] },
};

const SATELLITE_PALETTES: Record<SatelliteSubtype, BodyPalette> = {
  // ICE
  water_ice:    { base: '#dde8f0', accent: '#fafdff', shadow: '#90a0b0' },
  methane_ice:  { base: '#e8c0c0', accent: '#fadcdc', shadow: '#806060' },
  sulfur_ice:   { base: '#f0e088', accent: '#fff8c0', shadow: '#807038' },
  nitrogen_ice: { base: '#c0d0d8', accent: '#e8f0f4', shadow: '#607080' },
  dirty_ice:    { base: '#b8b0a0', accent: '#d8d0c0', shadow: '#605850' },
  // ROCK
  terrestrial:  { base: '#9a8e80', accent: '#c8bcaa', shadow: '#403828' },
  cratered:     { base: '#7a7470', accent: '#a8a098', shadow: '#302820' },
  volcanic:     { base: '#3c2c20', accent: '#785838', shadow: '#100804', hot: '#d04018' },
  iron_rich:    { base: '#a06848', accent: '#c89070', shadow: '#402010' },
  desert_moon:  { base: '#c89868', accent: '#e8bc88', shadow: '#604018' },
};

/**
 * Life-bearing rock planets/satellites get a biome-tinted palette so an
 * "ocean" world reads as deep blue instead of inheriting whatever rock
 * subtype was rolled underneath. Mirrors the existing biome → terrain
 * profile mapping so the universe disk previews the world the user would
 * generate inside.
 */
const BIOME_PALETTES: Record<PlanetBiome, BodyPalette> = {
  default:   { base: '#5fa86a', accent: '#a0e0a8', shadow: '#1a3820' },
  forest:    { base: '#3a7a3c', accent: '#7ac870', shadow: '#0a2810' },
  ocean:     { base: '#2a6aa8', accent: '#6ac0e8', shadow: '#0a2848' },
  desert:    { base: '#d4a06a', accent: '#f0c890', shadow: '#5a3818' },
  swamp:     { base: '#5a6a3a', accent: '#90a868', shadow: '#1a2010' },
  ice:       { base: '#a8c0d0', accent: '#e8f4fc', shadow: '#506878' },
  mountains: { base: '#8a8478', accent: '#c0baa8', shadow: '#403830' },
};

function planetPalette(p: PlanetData): BodyPalette {
  if (p.life && p.biome && p.composition === 'ROCK') return BIOME_PALETTES[p.biome];
  return PLANET_PALETTES[p.subtype] ?? PLANET_PALETTES.terrestrial;
}

function satellitePalette(s: SatelliteData): BodyPalette {
  if (s.life && s.biome && s.composition === 'ROCK') return BIOME_PALETTES[s.biome];
  return SATELLITE_PALETTES[s.subtype] ?? SATELLITE_PALETTES.terrestrial;
}

// Legacy single-color fallbacks — kept for the hit-test layer / any caller
// that wants a flat color (currently unused; the new disk drawers handle
// every render path).
function planetFill(p: PlanetData): string { return planetPalette(p).base; }
function satelliteFill(s: SatelliteData): string { return satellitePalette(s).base; }

// ── Body disk drawing ─────────────────────────────────────────────────────
//
// drawBodyDisk renders a planet or satellite using a 3-stop radial gradient
// (lit hemisphere → midtone → limb shadow) so any disk ≥ ~3 px reads as a
// 3D sphere rather than a flat dot. For gas giants (palette.bands) we
// additionally clip to the disk and stroke horizontal bands across it. For
// volcanic/lava palettes (palette.hot) we add a small offset hot spot.
//
// Tiny disks (under ~1.6 screen px) skip the gradient and bands entirely —
// the cost of createRadialGradient is wasted on a sub-pixel splat — and just
// paint the base color.
//
// All thresholds are checked against `screenR = r * viewScale` (the on-screen
// pixel size) rather than `r` (map units), so bands and the gradient stay
// visible when the user zooms in: as `viewScale` grows, callers shrink `r`
// proportionally to keep on-screen size constant, but the LOD decision should
// follow the visual size, not the map-unit size.

const TINY_DISK_PX = 1.6;
const BANDS_MIN_PX = 4;
const HOTSPOT_MIN_PX = 3;

function drawBodyDisk(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  palette: BodyPalette,
  viewScale: number = 1,
): void {
  const screenR = r * viewScale;
  if (screenR < TINY_DISK_PX) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.base;
    ctx.fill();
    return;
  }

  // Clip to the disk so band strokes / hot spots stay inside the sphere.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // 3-stop radial gradient — light source from upper-left at ~(-0.45 r, -0.45 r).
  const lightX = x - r * 0.45;
  const lightY = y - r * 0.45;
  const grd = ctx.createRadialGradient(lightX, lightY, r * 0.05, x, y, r * 1.15);
  grd.addColorStop(0, palette.accent);
  grd.addColorStop(0.55, palette.base);
  grd.addColorStop(1, palette.shadow);
  ctx.fillStyle = grd;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  // Gas-giant horizontal bands — only at meaningful on-screen size so tiny
  // disks don't get muddied by sub-pixel band strokes.
  if (palette.bands && screenR >= BANDS_MIN_PX) {
    const n = palette.bands.length;
    const bandH = (r * 2) / n;
    for (let i = 0; i < n; i++) {
      const top = y - r + i * bandH;
      ctx.fillStyle = palette.bands[i];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - r, top, r * 2, bandH);
    }
    ctx.globalAlpha = 1;
    // Re-apply the limb shadow on top of bands so the sphere illusion holds.
    const shadowGrd = ctx.createRadialGradient(lightX, lightY, r * 0.4, x, y, r * 1.15);
    shadowGrd.addColorStop(0, 'rgba(255,255,255,0)');
    shadowGrd.addColorStop(0.7, 'rgba(0,0,0,0)');
    shadowGrd.addColorStop(1, palette.shadow);
    ctx.fillStyle = shadowGrd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Hot spot (volcanic / lava) — small offset glow, only for disks large
  // enough on screen to read it. Inner radius floor is 1.2 SCREEN px, so it
  // converts back into map units via viewScale.
  if (palette.hot && screenR >= HOTSPOT_MIN_PX) {
    const hotR = Math.max(1.2 / viewScale, r * 0.35);
    const hotX = x + r * 0.18;
    const hotY = y + r * 0.22;
    const hotGrd = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, hotR);
    hotGrd.addColorStop(0, palette.hot);
    hotGrd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hotGrd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.restore();
}

function drawPlanetBody(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: PlanetData,
  viewScale: number = 1,
): void {
  drawBodyDisk(ctx, x, y, r, planetPalette(p), viewScale);
}

function drawSatelliteBody(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: SatelliteData,
  viewScale: number = 1,
): void {
  drawBodyDisk(ctx, x, y, r, satellitePalette(s), viewScale);
}

// Re-export legacy fills so any external module pulling them keeps compiling.
export { planetFill, satelliteFill };

// ── Galaxy scene ──────────────────────────────────────────────────────────
export interface GalaxyDrawResult {
  hit: HitCircle[];
}

/** Viewport bounds in canvas content-space (pre-transform coordinates). */
export interface ViewBounds { x0: number; y0: number; x1: number; y1: number }

function circleIntersectsViewBounds(cx: number, cy: number, r: number, b: ViewBounds): boolean {
  return cx + r >= b.x0 && cx - r <= b.x1 && cy + r >= b.y0 && cy - r <= b.y1;
}

/**
 * Top-level scene dispatcher.
 *
 *   - `data.galaxies.length === 1` → legacy single-galaxy spiral, byte-
 *     identical to pre-grouping (galaxy `gal_0` wraps every system).
 *   - `focusGalaxyId` set → focus mode: draw only that galaxy centered with
 *     no LOD (mimics the legacy single-galaxy view for any galaxy in a
 *     grouped universe).
 *   - else → multi-galaxy world layout. Each galaxy is positioned in world
 *     units (`galaxy.cx`, `galaxy.cy`) and rendered as either an embedded
 *     spiral (when its on-screen radius ≥ LOD threshold) or a stylized glyph.
 */
export function drawGalaxyScene(
  ctx: CanvasRenderingContext2D,
  data: UniverseData,
  vw: number,
  vh: number,
  stars: BackgroundStar[],
  cameraScale: number = 1,
  skipBg: boolean = false,
  viewScale: number = 1,
  timeSec: number = 0,
  focusGalaxyId: string | null = null,
  viewBounds?: ViewBounds,
  /**
   * Universe-view hover state. When set to a galaxy id, the cross-galaxy
   * wormhole lines drawn in the multi-galaxy path classify each line into
   * three brightness tiers (incident / neighbour / unrelated). When null,
   * every line renders at the default dim (30%) tier. Has no effect in the
   * focus or single-galaxy paths.
   */
  hoveredGalaxyId: string | null = null,
): GalaxyDrawResult {
  if (!skipBg) drawBackground(ctx, vw, vh, stars);

  // O(1) system lookup — avoids O(N) .find() per ID in focus/multi-galaxy paths.
  const systemById = new Map<string, SolarSystemData>(
    data.solarSystems.map(s => [s.id, s])
  );

  // Focus mode — single galaxy fills the viewport like the legacy view.
  if (focusGalaxyId) {
    const focus = data.galaxies.find(g => g.id === focusGalaxyId);
    if (focus) {
      const systems = focus.systemIds
        .map(id => systemById.get(id))
        .filter((s): s is SolarSystemData => !!s);
      const cx = vw / 2;
      const cy = vh / 2;
      const spreadPx = Math.min(vw, vh) * 0.7;
      const rotOff = galaxyRotationOffset(focus.id);
      const crossDirs = buildCrossGalaxyDirections(data, focus.id);
      return { hit: drawGalaxySpiral(ctx, cx, cy, spreadPx, systems, timeSec, viewScale, cameraScale, viewBounds, rotOff, focus.shape, focus.id, focus.sectors, crossDirs) };
    }
    // Bogus focus id falls through to multi-galaxy view.
  }

  // Single-galaxy legacy path: byte-identical to pre-grouping rendering.
  if (data.galaxies.length <= 1) {
    const cx = vw / 2;
    const cy = vh / 2;
    const spreadPx = Math.min(vw, vh) * 0.7;
    const rotOff = data.galaxies.length === 1 ? galaxyRotationOffset(data.galaxies[0].id) : 0;
    const singleShape = data.galaxies[0]?.shape ?? 'spiral';
    const singleId = data.galaxies[0]?.id ?? '';
    const singleSectors = data.galaxies[0]?.sectors ?? [];
    // Cross-galaxy stubs are a no-op here (single-galaxy universes can't have
    // cross-galaxy wormholes) but the helper handles that case cleanly.
    const crossDirs = buildCrossGalaxyDirections(data, singleId);
    return { hit: drawGalaxySpiral(ctx, cx, cy, spreadPx, data.solarSystems, timeSec, viewScale, cameraScale, viewBounds, rotOff, singleShape, singleId, singleSectors, crossDirs) };
  }

  // Multi-galaxy: world layout with per-galaxy LOD.
  const minSide = Math.min(vw, vh);
  const extent = computeLayoutExtent(data.galaxies);
  const worldScale = (minSide * VIEWPORT_FIT_FRACTION) / extent;
  const originX = vw / 2;
  const originY = vh / 2;

  // Pre-compute every galaxy's canvas-space centre once. Cross-galaxy
  // wormhole lines need both endpoints, drawn after the galaxy bodies so the
  // dashes land on top of the (rendered first) glyphs / embedded spirals.
  const galaxyCanvasPos = new Map<string, { x: number; y: number }>();
  for (const galaxy of data.galaxies) {
    const gSpreadCanvas = galaxy.spread * worldScale;
    const h0 = hashId(galaxy.id);
    const h1 = Math.imul(h0 ^ (h0 >>> 16), 0x45d9f3b) >>> 0;
    const jx = h0 / 0x100000000 * 2 - 1;
    const jy = h1 / 0x100000000 * 2 - 1;
    const gcx = originX + galaxy.cx * worldScale + jx * 0.2 * gSpreadCanvas;
    const gcy = originY + galaxy.cy * worldScale + jy * 0.2 * gSpreadCanvas;
    galaxyCanvasPos.set(galaxy.id, { x: gcx, y: gcy });
  }

  const hit: HitCircle[] = [];
  for (const galaxy of data.galaxies) {
    const gSpreadCanvas = galaxy.spread * worldScale;

    // Derive per-galaxy rotation offset from galaxy id (positions are
    // pre-computed in `galaxyCanvasPos` above so the cross-galaxy wormhole
    // overlay can read them).
    const h0 = hashId(galaxy.id);
    const h1 = Math.imul(h0 ^ (h0 >>> 16), 0x45d9f3b) >>> 0;
    const h2 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b) >>> 0;
    const rotOff = h2 / 0x100000000 * Math.PI * 2;

    const cached = galaxyCanvasPos.get(galaxy.id)!;
    const gcx = cached.x;
    const gcy = cached.y;
    const gRadiusCanvas = galaxy.radius * worldScale;
    const gScreenRadius = gRadiusCanvas * viewScale;

    // Cross-fade glyph ↔ embedded systems across the blend zone.
    const t = (gScreenRadius - LOD_BLEND_START) / (LOD_BLEND_END - LOD_BLEND_START);
    const blend = smoothstep01(t);
    const glyphAlpha = 1 - blend;
    const systemsAlpha = blend;

    if (glyphAlpha > 0) {
      // Skip entirely if this galaxy's bounding circle is offscreen.
      if (!viewBounds || circleIntersectsViewBounds(gcx, gcy, gRadiusCanvas, viewBounds)) {
        ctx.save();
        ctx.globalAlpha = glyphAlpha;
        drawGalaxyGlyph(ctx, gcx, gcy, gRadiusCanvas, galaxy, data, timeSec, viewScale, rotOff);
        ctx.restore();
      }
      // Galaxy hit pushed FIRST so per-system hits (drawn next) win on
      // direct overlap. Below the blend zone systems aren't drawn at all,
      // so the galaxy hit is the only target — exactly what we want.
      hit.push({
        x: gcx,
        y: gcy,
        r: Math.max(gRadiusCanvas, GALAXY_HIT_MIN_PX / viewScale),
        kind: 'galaxy',
        id: galaxy.id,
      });
    }

    if (systemsAlpha > 0) {
      const systems = galaxy.systemIds
        .map(id => systemById.get(id))
        .filter((s): s is SolarSystemData => !!s);
      ctx.save();
      ctx.globalAlpha = systemsAlpha;
      const subHit = drawGalaxySpiral(ctx, gcx, gcy, gSpreadCanvas, systems, timeSec, viewScale, cameraScale, viewBounds, rotOff, galaxy.shape, galaxy.id, galaxy.sectors);
      ctx.restore();
      hit.push(...subHit);
    }
  }

  // Cross-galaxy wormhole links. Walk every wormhole once; for each pair
  // whose two endpoints sit in different galaxies, draw one dotted line
  // between the two galaxy centres (deduplicated per galaxy pair so multiple
  // wormhole connections between the same two galaxies render as a single
  // line). Drawn last so it sits on top of glyphs and embedded spirals.
  drawCrossGalaxyWormholeLines(ctx, data, galaxyCanvasPos, viewScale, hoveredGalaxyId);

  return { hit };
}

/**
 * Build a per-wormhole map of unit-vector world-frame directions pointing
 * from the current galaxy's centre toward each cross-galaxy partner's
 * galaxy. Used by the focused-galaxy view (single-spiral / focus mode) to
 * draw outbound stubs without rendering the target galaxy. Entries are
 * keyed by the SOURCE wormhole id; only wormholes anchored in the current
 * galaxy whose partner lives elsewhere get an entry.
 */
function buildCrossGalaxyDirections(
  data: UniverseData,
  currentGalaxyId: string,
): Map<string, { dx: number; dy: number }> {
  const result = new Map<string, { dx: number; dy: number }>();
  const current = data.galaxies.find(g => g.id === currentGalaxyId);
  if (!current || data.galaxies.length < 2) return result;

  const galaxyById = new Map(data.galaxies.map(g => [g.id, g]));
  // wormholeId → galaxyId — built once from the flattened universe data.
  const wormholeGalaxy = new Map<string, string>();
  for (const sys of data.solarSystems) {
    if (!sys.wormholes || sys.wormholes.length === 0) continue;
    for (const w of sys.wormholes) wormholeGalaxy.set(w.id, w.galaxyId);
  }

  for (const sys of data.solarSystems) {
    if (!sys.wormholes || sys.wormholes.length === 0) continue;
    for (const w of sys.wormholes) {
      if (w.galaxyId !== currentGalaxyId) continue;
      if (!w.partnerId) continue;
      const partnerGalaxyId = wormholeGalaxy.get(w.partnerId);
      if (!partnerGalaxyId || partnerGalaxyId === currentGalaxyId) continue;
      const partnerGalaxy = galaxyById.get(partnerGalaxyId);
      if (!partnerGalaxy) continue;
      const dx = partnerGalaxy.cx - current.cx;
      const dy = partnerGalaxy.cy - current.cy;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      result.set(w.id, { dx: dx / len, dy: dy / len });
    }
  }
  return result;
}

/**
 * Render dotted white lines between galaxies that share at least one
 * wormhole connection across the galaxy boundary. Pairs deduplicated per
 * galaxy-pair (sorted-tuple key) so multiple wormhole links between the same
 * two galaxies render as one line.
 */
function drawCrossGalaxyWormholeLines(
  ctx: CanvasRenderingContext2D,
  data: UniverseData,
  galaxyCanvasPos: Map<string, { x: number; y: number }>,
  viewScale: number,
  hoveredGalaxyId: string | null,
): void {
  // wormholeId → galaxyId, built lazily from `data.solarSystems` so this
  // helper has no dependency on the worker-side `Universe.mapWormholes`.
  const wormholeGalaxy = new Map<string, string>();
  for (const sys of data.solarSystems) {
    if (!sys.wormholes || sys.wormholes.length === 0) continue;
    for (const w of sys.wormholes) {
      wormholeGalaxy.set(w.id, w.galaxyId);
    }
  }

  // Collect each unique galaxy-pair link once (sorted-tuple dedup), since
  // multiple wormholes between the same two galaxies render as a single line.
  const pairs: Array<{ a: string; b: string }> = [];
  const seen = new Set<string>();
  for (const sys of data.solarSystems) {
    if (!sys.wormholes || sys.wormholes.length === 0) continue;
    for (const w of sys.wormholes) {
      if (!w.partnerId) continue;
      const partnerGalaxy = wormholeGalaxy.get(w.partnerId);
      if (!partnerGalaxy || partnerGalaxy === w.galaxyId) continue;
      const a = w.galaxyId < partnerGalaxy ? w.galaxyId : partnerGalaxy;
      const b = w.galaxyId < partnerGalaxy ? partnerGalaxy : w.galaxyId;
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a, b });
    }
  }
  if (pairs.length === 0) return;

  // Neighbour set for the hovered galaxy — every galaxy connected to it via
  // at least one cross-galaxy wormhole. Empty when no galaxy is hovered.
  const neighbours = new Set<string>();
  if (hoveredGalaxyId) {
    for (const { a, b } of pairs) {
      if (a === hoveredGalaxyId) neighbours.add(b);
      else if (b === hoveredGalaxyId) neighbours.add(a);
    }
  }

  // Classify every pair into one of three tiers. Tier draws are batched so
  // we only call setLineDash / set strokeStyle a handful of times.
  const tier1: Array<{ a: string; b: string }> = [];
  const tier2: Array<{ a: string; b: string }> = [];
  const tier3: Array<{ a: string; b: string }> = [];
  for (const p of pairs) {
    if (!hoveredGalaxyId) {
      // Default state: every line at the dim (30%) tier.
      tier2.push(p);
      continue;
    }
    if (p.a === hoveredGalaxyId || p.b === hoveredGalaxyId) {
      tier1.push(p);
    } else if (neighbours.has(p.a) || neighbours.has(p.b)) {
      tier2.push(p);
    } else {
      tier3.push(p);
    }
  }

  ctx.save();
  ctx.setLineDash(WORMHOLE_CONNECTION_DASH);
  ctx.lineWidth = 1 / viewScale;
  // Draw faintest first so brighter tiers paint on top (matters where lines
  // overlap or share a galaxy endpoint).
  const tiers: Array<[Array<{ a: string; b: string }>, string]> = [
    [tier3, WORMHOLE_LINE_TIER_FAINT],
    [tier2, WORMHOLE_LINE_TIER_DIM],
    [tier1, WORMHOLE_LINE_TIER_FULL],
  ];
  for (const [lines, stroke] of tiers) {
    if (lines.length === 0) continue;
    ctx.strokeStyle = stroke;
    for (const { a, b } of lines) {
      const here = galaxyCanvasPos.get(a);
      const there = galaxyCanvasPos.get(b);
      if (!here || !there) continue;
      ctx.beginPath();
      ctx.moveTo(here.x, here.y);
      ctx.lineTo(there.x, there.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function galaxyRotationOffset(galaxyId: string): number {
  const h = hashId(galaxyId);
  const h2 = Math.imul(Math.imul(h ^ (h >>> 16), 0x45d9f3b) ^ ((Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 16)), 0x45d9f3b) >>> 0;
  return h2 / 0x100000000 * Math.PI * 2;
}

// ── Galaxy layout cache ───────────────────────────────────────────────────
// rawPositions and star-radius stats are pure functions of (shape, galaxyId,
// count, cx, cy, spread) — they never change between frames for the same
// galaxy. Caching avoids O(N) Math.exp calls and star-radius scans per frame.
interface GalaxyLayout {
  rawPositions: Array<{ x: number; y: number }>;
  maxStarRadii: number[];
  minR: number;
  maxR: number;
}
const spiralLayoutCache = new Map<string, GalaxyLayout>();
const SPIRAL_CACHE_MAX = 10;

function getOrBuildLayout(
  systems: SolarSystemData[],
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval' = 'spiral',
  galaxyId: string = '',
): GalaxyLayout {
  const key = `${shape}|${galaxyId}|${systems.length}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}`;
  const cached = spiralLayoutCache.get(key);
  if (cached) return cached;

  const rawPositions = shape === 'oval'
    ? galaxyOvalPositions(systems.length, cx, cy, spread, galaxyId)
    : galaxySpiralPositions(systems.length, cx, cy, spread);
  const maxStarRadii = systems.map(ss =>
    ss.stars.length > 0 ? Math.max(...ss.stars.map(s => s.radius)) : 0
  );
  const minR = maxStarRadii.length ? Math.min(...maxStarRadii) : 0;
  const maxR = maxStarRadii.length ? Math.max(...maxStarRadii) : 1;

  if (spiralLayoutCache.size >= SPIRAL_CACHE_MAX) {
    spiralLayoutCache.delete(spiralLayoutCache.keys().next().value!);
  }
  const layout: GalaxyLayout = { rawPositions, maxStarRadii, minR, maxR };
  spiralLayoutCache.set(key, layout);
  return layout;
}

/**
 * Per-galaxy renderer. Handles both spiral and oval layout depending on the
 * galaxy's shape. Extracted from `drawGalaxyScene` so it can be reused for
 * the single-galaxy legacy path, focus mode, and each above-LOD galaxy in
 * the multi-galaxy view. Returns hit circles in canvas coordinates.
 */
function drawGalaxySpiral(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spread: number,
  systems: SolarSystemData[],
  timeSec: number,
  viewScale: number,
  cameraScale: number,
  viewBounds?: ViewBounds,
  rotationOffset: number = 0,
  shape: 'spiral' | 'oval' = 'spiral',
  galaxyId: string = '',
  sectors: SectorData[] = [],
  /**
   * Optional: when the renderer wants to surface cross-galaxy wormhole links
   * inside a focused single-galaxy view, this map provides — per wormhole id
   * anchored in the current galaxy — a unit-vector direction (in world frame,
   * unaffected by galaxy spin) pointing toward the partner's galaxy. The
   * renderer draws a dashed stub from the source system out into that
   * direction, terminating off the visible rim without rendering the target.
   * `null` (default) suppresses the stub layer entirely — used by the multi-
   * galaxy embedded path where full inter-galaxy lines are drawn separately.
   */
  crossGalaxyDirections: Map<string, { dx: number; dy: number }> | null = null,
): HitCircle[] {
  const { rawPositions, maxStarRadii, minR, maxR } = getOrBuildLayout(systems, cx, cy, spread, shape, galaxyId);

  // Ambient galaxy glow — drawn before any star dots so it sits behind them.
  const sampleStar = systems[0]?.stars[0] ?? null;
  const glowRgb = sampleStar?.composition === 'ANTIMATTER' ? '180,110,240' : '125,145,205';
  drawGalaxyGlow(ctx, cx, cy, spread * 0.52, shape, galaxyId, glowRgb, 0.13);

  const galaxyAngle = timeSec * GALAXY_SPIN_SPEED + rotationOffset;

  // Sector mesh sits between glow halo and star dots — thin Voronoi edges
  // only, no fill or glow. LOD fade is inherited from the caller's
  // globalAlpha (systemsAlpha in the multi-galaxy path), so sectors fade in
  // lockstep with star dots.
  const mesh = buildOrGetSectorMesh(sectors, cx, cy, spread, shape, galaxyId);
  drawGalaxySectors(ctx, mesh, cx, cy, spread, shape, galaxyId, galaxyAngle, viewScale);

  const cosG = Math.cos(galaxyAngle);
  const sinG = Math.sin(galaxyAngle);

  // Conservative cull margin using the maximum possible sizePx (scaleMap
  // output is always ≤ 14) — lets us skip scaleMap (Math.sqrt) and the
  // rotation entirely for systems that can't be in view.
  const maxSizePx = 14 * cameraScale / viewScale;
  const cullMargin = maxSizePx * 1.5;

  // Maximum squared distance from galaxy centre that could ever be in view.
  // Rotation preserves distance from centre, so any system whose raw distance
  // exceeds this is always offscreen regardless of the current rotation angle.
  let maxViewDistSq = Infinity;
  if (viewBounds) {
    const corners = [
      [viewBounds.x0 - cx, viewBounds.y0 - cy],
      [viewBounds.x1 - cx, viewBounds.y0 - cy],
      [viewBounds.x0 - cx, viewBounds.y1 - cy],
      [viewBounds.x1 - cx, viewBounds.y1 - cy],
    ];
    const maxCornerDist = Math.max(...corners.map(([x, y]) => Math.sqrt(x * x + y * y)));
    const r = maxCornerDist + cullMargin;
    maxViewDistSq = r * r;
  }

  const hit: HitCircle[] = [];
  // Map system id → rotated screen position. Reused below to draw dotted
  // wormhole connection lines without re-running the rotation per pair.
  // Only systems that survive the frustum cull are inserted.
  const visibleSystemPos = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < systems.length; i++) {
    const raw = rawPositions[i];
    const dx = raw.x - cx;
    const dy = raw.y - cy;

    // Pre-cull by distance from centre — no rotation needed (rotation is
    // rigid-body, so distance from centre is invariant).
    if (viewBounds && dx * dx + dy * dy > maxViewDistSq) continue;

    // Inline rotation.
    const px = cx + dx * cosG - dy * sinG;
    const py = cy + dx * sinG + dy * cosG;

    // Cull by viewport bounds using the conservative max margin.
    if (viewBounds && !circleIntersectsViewBounds(px, py, cullMargin, viewBounds)) continue;

    // Only compute exact sizePx (Math.sqrt inside scaleMap) for visible systems.
    const sizePx = scaleMap(maxStarRadii[i], minR, maxR, 4, 14, 'sqrt') * cameraScale / viewScale;

    hit.push({ x: px, y: py, r: Math.max(sizePx * 1.4, 8 / viewScale), kind: 'system', id: systems[i].id });
    visibleSystemPos.set(systems[i].id, { x: px, y: py });

    const dominant = systems[i].stars[0] ?? null;
    if (dominant && isExoticSubtype(dominant.subtype)) {
      // Exotic systems use their dedicated visual at galaxy zoom too —
      // scaled down so they blend into the spiral but stay recognisable.
      drawStarBody(ctx, px, py, sizePx * 0.6, dominant);
    } else {
      const palette = dominant ? starFill(dominant) : { core: '#fff', glowInner: 'rgba(255,255,255,0.8)', glowOuter: 'rgba(255,255,255,0)' };
      const outerR = sizePx * GLOW_OUTER_MULT;
      ctx.drawImage(getOrBuildGlowCanvas(palette), px - outerR, py - outerR, outerR * 2, outerR * 2);
      drawCircle(ctx, px, py, sizePx * 0.6, palette.core);
    }
  }

  // Same-galaxy wormhole connection lines. Dotted white, drawn after the
  // system dots so the line endpoints land cleanly on top of each visible
  // system. Pairs are deduplicated via a sorted id tuple so each connection
  // is drawn exactly once even when both endpoints are visible.
  const drawnPairs = new Set<string>();
  let dashApplied = false;
  for (const sys of systems) {
    if (!sys.wormholes || sys.wormholes.length === 0) continue;
    const here = visibleSystemPos.get(sys.id);
    if (!here) continue;
    for (const wormhole of sys.wormholes) {
      if (!wormhole.partnerId) continue;
      // Resolve the partner's parent system. Stored on each wormhole in
      // `systemIdToWormhole`-style lookups — but the renderer doesn't carry
      // a universe-wide index. Instead, we walk the galaxy's systems for
      // an O(N · wormholes) match. N is tiny per galaxy (≤ 100 standalone
      // systems in practice), and we already filtered to in-galaxy systems.
      let partnerSystemId: string | null = null;
      for (const candidate of systems) {
        if (!candidate.wormholes) continue;
        for (const cw of candidate.wormholes) {
          if (cw.id === wormhole.partnerId) {
            partnerSystemId = candidate.id;
            break;
          }
        }
        if (partnerSystemId) break;
      }
      if (!partnerSystemId) continue; // partner lives in another galaxy
      const partnerPos = visibleSystemPos.get(partnerSystemId);
      if (!partnerPos) continue; // partner system was culled

      const a = wormhole.id < wormhole.partnerId ? wormhole.id : wormhole.partnerId;
      const b = wormhole.id < wormhole.partnerId ? wormhole.partnerId : wormhole.id;
      const key = `${a}|${b}`;
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      if (!dashApplied) {
        ctx.save();
        ctx.setLineDash(WORMHOLE_CONNECTION_DASH);
        ctx.strokeStyle = WORMHOLE_CONNECTION_STROKE;
        ctx.lineWidth = 1 / viewScale;
        dashApplied = true;
      }
      ctx.beginPath();
      ctx.moveTo(here.x, here.y);
      ctx.lineTo(partnerPos.x, partnerPos.y);
      ctx.stroke();
    }
  }
  if (dashApplied) {
    ctx.restore();
  }

  // Cross-galaxy stubs. In focused single-galaxy view, surface wormholes
  // whose partner sits in another galaxy by drawing a dashed line from the
  // source system out in the world-frame direction of the partner's galaxy —
  // terminating just past the visible rim so the user can read "this link
  // exits the galaxy in roughly that direction" without ever rendering the
  // destination. Skipped (null map) in the multi-galaxy embed path, which
  // already draws full inter-galaxy lines between galaxy centres.
  if (crossGalaxyDirections && crossGalaxyDirections.size > 0) {
    const stubLen = spread * 0.45;
    const tipMarkerR = 2.5 / viewScale;
    let stubDashApplied = false;
    for (const sys of systems) {
      if (!sys.wormholes || sys.wormholes.length === 0) continue;
      const pos = visibleSystemPos.get(sys.id);
      if (!pos) continue;
      for (const wormhole of sys.wormholes) {
        const dir = crossGalaxyDirections.get(wormhole.id);
        if (!dir) continue;
        if (!stubDashApplied) {
          ctx.save();
          ctx.setLineDash(WORMHOLE_CONNECTION_DASH);
          ctx.strokeStyle = WORMHOLE_CONNECTION_STROKE;
          ctx.lineWidth = 1 / viewScale;
          stubDashApplied = true;
        }
        const endX = pos.x + dir.dx * stubLen;
        const endY = pos.y + dir.dy * stubLen;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        // Tiny open ring at the tip suggests "destination off-screen" without
        // implying a clickable target. Drawn solid (no dash) by toggling
        // setLineDash, then restoring the dashed style for the next stub.
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(endX, endY, tipMarkerR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash(WORMHOLE_CONNECTION_DASH);
      }
    }
    if (stubDashApplied) {
      ctx.restore();
    }
  }

  return hit;
}

/**
 * Stand-in figure for an entire galaxy at low zoom: a soft halo + low-res
 * spiral of dots (~20 dots) tinted by the galaxy's dominant matter /
 * antimatter mix, animating with the same rotation as the full spiral so
 * the LOD swap reads as a continuous zoom rather than a scene change.
 *
 * Tint hash is deterministic from `galaxy.id` so the same galaxy always
 * picks the same accent shade.
 */
const GLYPH_DOT_COUNT = 30;

function drawGalaxyGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  galaxy: GalaxyData,
  data: UniverseData,
  timeSec: number,
  viewScale: number,
  rotationOffset: number = 0,
): void {
  // Sample composition from the first few member stars to tint the glyph.
  const sampleSystem = galaxy.systemIds.length > 0
    ? data.solarSystems.find(s => s.id === galaxy.systemIds[0]) ?? null
    : null;
  const dominantStar = sampleSystem?.stars[0] ?? null;
  const dotColor = dominantStar ? starFill(dominantStar).core : '#dde0ff';

  // Galaxy shape glow — drawn before dots so it sits behind them.
  const glowRgb = dominantStar?.composition === 'ANTIMATTER' ? '200,130,255' : '140,160,220';
  drawGalaxyGlow(ctx, cx, cy, radius * 1.3, galaxy.shape, galaxy.id, glowRgb, 0.55);

  // Low-res dots — same shape as the full layout but with a fixed dot count
  // so the glyph reads as a "compressed" galaxy.
  const dotPositions = galaxy.shape === 'oval'
    ? galaxyOvalPositions(GLYPH_DOT_COUNT, cx, cy, radius * 1.6, galaxy.id)
    : galaxySpiralPositions(GLYPH_DOT_COUNT, cx, cy, radius * 1.6);
  const angle = timeSec * GALAXY_SPIN_SPEED + rotationOffset;
  const cosG = Math.cos(angle);
  const sinG = Math.sin(angle);
  const dotR = Math.max(0.6 / viewScale, radius * 0.04);
  for (const pos of dotPositions) {
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const px = cx + dx * cosG - dy * sinG;
    const py = cy + dx * sinG + dy * cosG;
    drawCircle(ctx, px, py, dotR, dotColor);
  }

  // Outline ring at the galaxy's nominal radius for a clean LOD silhouette.
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 200, 240, 0.18)';
  ctx.lineWidth = 1 / viewScale;
  ctx.stroke();
}

// ── System scene ──────────────────────────────────────────────────────────
export interface SystemDrawResult {
  hit: HitCircle[];
}

export function drawSystemScene(
  ctx: CanvasRenderingContext2D,
  system: SolarSystemData,
  vw: number,
  vh: number,
  stars: BackgroundStar[],
  timeSec: number,
  skipBg: boolean = false,
  viewScale: number = 1,
): SystemDrawResult {
  if (!skipBg) drawBackground(ctx, vw, vh, stars);
  const cx = vw / 2;
  const cy = vh / 2;
  const minSide = Math.min(vw, vh);

  // ── 1. Compute star layout (sizes + orbits) before drawing anything ──────
  //
  // Disk sizes use absolute generation bounds [STAR_RADIUS_MIN, STAR_RADIUS_MAX]
  // so visual size is proportional to the real radius attribute across all
  // systems, not just normalised within this one.
  //
  // Multi-star: stars sorted smallest-first (innermost/fastest orbit).
  // Single star: sits at centre with no orbit ring.

  type StarLayout = { star: (typeof system.stars)[0]; px: number; ringR: number; omega: number; phase: number; };
  let starLayouts: StarLayout[];
  let starOrbitRings: number[] = [];
  let outerStarExtent: number; // content-space radius bounding the stellar region
  let starHitR: number;

  if (system.stars.length === 1) {
    const star = system.stars[0];
    const px = scaleMap(star.radius, STAR_RADIUS_MIN, STAR_RADIUS_MAX, STAR_MIN_PX, STAR_MAX_PX, 'sqrt') / viewScale;
    starLayouts = [{ star, px, ringR: 0, omega: 0, phase: 0 }];
    outerStarExtent = px; // disk radius is the stellar "zone" for a solo star
    starHitR = px * GLOW_OUTER_MULT * 1.2;
  } else {
    // Sort smallest-first: index 0 → innermost (fastest) orbit.
    const sorted = [...system.stars]
      .map(star => ({
        star,
        px: scaleMap(star.radius, STAR_RADIUS_MIN, STAR_RADIUS_MAX, STAR_MIN_PX, STAR_MAX_PX, 'sqrt') / viewScale,
      }))
      .sort((a, b) => a.star.radius - b.star.radius);

    // Orbit radii in content-space (scale with viewport like planet rings).
    // Step of minSide×0.04 keeps the cluster well inside the stellar zone for
    // binary and triple systems.
    starOrbitRings = sorted.map((_, i) => minSide * (0.03 + i * 0.04));
    outerStarExtent = starOrbitRings[starOrbitRings.length - 1];
    starHitR = outerStarExtent * 1.2;

    starLayouts = sorted.map(({ star, px }, i) => ({
      star,
      px,
      ringR: starOrbitRings[i],
      omega: orbitalAngularVelocity(i + 1, STAR_K),
      phase: phaseFromId(star.id),
    }));
  }

  // ── 2. Planet orbit ring bounds ───────────────────────────────────────────
  //
  // ringMin = 3 × outermost star extent so planet rings always start clearly
  // beyond the stellar region. ringMax uses linear scale (even pixel steps
  // per planet) so outer rings are not bunched together. A per-planet minimum
  // step ensures adequate separation even in dense systems.

  const orbits = system.planets.map(p => p.orbit);
  const orbitMin = orbits.length ? Math.min(...orbits) : 1;
  const orbitMax = orbits.length ? Math.max(...orbits) : 1;
  const _ringMinBase = Math.max(outerStarExtent * 3, minSide * 0.05);
  const minStepPx = 52;
  const ringMin = _ringMinBase * PLANET_ORBIT_SCALE;
  const ringMax = Math.max(
    minSide * 0.46,
    _ringMinBase + system.planets.length * minStepPx,
  ) * PLANET_ORBIT_SCALE;

  // Planet size mapping
  const planetRadii = system.planets.map(p => p.radius);
  const pRadMin = planetRadii.length ? Math.min(...planetRadii) : 0;
  const pRadMax = planetRadii.length ? Math.max(...planetRadii) : 1;

  // ── 3. Draw orbit rings (planets first so stars render on top) ────────────

  for (const planet of system.planets) {
    const ringR = scaleMap(planet.orbit, orbitMin, orbitMax, ringMin, ringMax, 'linear');
    const ecc = 0.04 + eccentricityFromId(planet.id) * 0.14;
    const tilt = orbitTiltFromId(planet.id);
    drawOrbitRing(ctx, cx, cy, ringR, viewScale, ecc, tilt);
  }
  for (const r of starOrbitRings) {
    drawOrbitRing(ctx, cx, cy, r, viewScale);
  }

  // ── 4. Draw stars ─────────────────────────────────────────────────────────

  if (starLayouts.length === 1) {
    const { star, px: starPx } = starLayouts[0];
    drawStarBody(ctx, cx, cy, starPx, star);
  } else {
    for (const { star, px: starPx, ringR, omega, phase } of starLayouts) {
      const angle = phase + omega * timeSec;
      const sx = cx + Math.cos(angle) * ringR;
      const sy = cy + Math.sin(angle) * ringR;
      drawStarBody(ctx, sx, sy, starPx, star);
    }
  }

  // ── 5. Draw planets ───────────────────────────────────────────────────────
  //
  // Star hit circle added first so planet disks (appended below) take priority
  // on any click overlap.
  // omega uses planet.orbit (simulation units) not pixel ringR so the Kepler
  // exponent keeps human-scale periods regardless of zoom.
  const hit: HitCircle[] = [
    { x: cx, y: cy, r: starHitR, kind: 'system', id: system.id },
  ];
  for (const planet of system.planets) {
    const ringR = scaleMap(planet.orbit, orbitMin, orbitMax, ringMin, ringMax, 'linear');
    const omega = orbitalAngularVelocity(planet.orbit, PLANET_K)
                * (0.8 + speedFromId(planet.id) * 0.4);
    const phase = phaseFromId(planet.id);
    const angle = phase + omega * timeSec;
    const ecc = 0.04 + eccentricityFromId(planet.id) * 0.14;
    const tilt = orbitTiltFromId(planet.id);
    const a = ringR;
    const b = a * (1 - ecc);
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const lx = a * Math.cos(angle), ly = b * Math.sin(angle);
    const px = cx + lx * cosT - ly * sinT;
    const py = cy + lx * sinT + ly * cosT;
    // Divide by viewScale so the disk stays at a constant screen-pixel size
    // regardless of zoom level (orbit radii still scale, only the body shrinks).
    const sizePx = scaleMap(planet.radius, pRadMin, pRadMax, PLANET_MIN_PX, PLANET_MAX_PX, 'sqrt') / viewScale;
    drawPlanetBody(ctx, px, py, sizePx, planet, viewScale);
    if (planet.life) {
      ctx.beginPath();
      ctx.arc(px, py, sizePx + 1.5 / viewScale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,255,150,0.55)';
      ctx.lineWidth = 1 / viewScale;
      ctx.stroke();
    }
    hit.push({ x: px, y: py, r: Math.max(sizePx * 1.6, 8 / viewScale), kind: 'planet', id: planet.id });
  }

  // ── 6. Draw wormholes ─────────────────────────────────────────────────────
  //
  // Standalone-kind systems are the only ones that ever carry wormholes; the
  // generator gates creation behind `isStandaloneKind(kind)`. Standalone
  // systems have no planets, so the wormholes inhabit otherwise-empty space
  // around the central exotic body. Positions are baked at generation time as
  // unit-vector offsets scaled by minSide so they fall at a consistent visual
  // distance from the centre regardless of viewport size.
  if (system.wormholes && system.wormholes.length > 0) {
    const offsetScale = minSide * WORMHOLE_OFFSET_MIN_SIDE_FACTOR;
    for (const wormhole of system.wormholes) {
      const wx = cx + wormhole.offsetX * offsetScale;
      const wy = cy + wormhole.offsetY * offsetScale;
      drawWormholeBody(ctx, wx, wy, viewScale);
      hit.push({
        x: wx,
        y: wy,
        r: Math.max((WORMHOLE_CORE_PX + 4) / viewScale, 10 / viewScale),
        kind: 'wormhole',
        id: wormhole.id,
      });
    }
  }

  return { hit };
}

// ── Planet scene ──────────────────────────────────────────────────────────
export interface PlanetDrawResult {
  hit: HitCircle[];
}

export function drawPlanetScene(
  ctx: CanvasRenderingContext2D,
  planet: PlanetData,
  vw: number,
  vh: number,
  stars: BackgroundStar[],
  timeSec: number,
  skipBg: boolean = false,
  viewScale: number = 1,
): PlanetDrawResult {
  if (!skipBg) drawBackground(ctx, vw, vh, stars);
  const cx = vw / 2;
  const cy = vh / 2;
  const minSide = Math.min(vw, vh);

  // orbitLayoutBase drives satellite ring radii — decoupled from planet disk
  // size so changing the planet's visual scale doesn't affect spatial layout.
  const orbitLayoutBase = minSide * 0.18;
  // planetPx is the visual disk radius, kept constant in screen pixels.
  const planetPx = minSide * 0.06 / viewScale;

  // Hero planet — constant-size disk with composition-driven texture
  drawPlanetBody(ctx, cx, cy, planetPx, planet, viewScale);
  if (planet.life) {
    ctx.beginPath();
    ctx.arc(cx, cy, planetPx + 6 / viewScale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,255,150,0.5)';
    ctx.lineWidth = 2 / viewScale;
    ctx.stroke();
  }

  // Planet hit circle — always present so the central planet is clickable.
  // Satellite disks (appended below) are on outer rings so back-to-front pick
  // order means they take priority over the planet when their disks are clicked.
  const hit: HitCircle[] = [
    { x: cx, y: cy, r: planetPx * 1.1, kind: 'planet', id: planet.id },
  ];

  // Satellites on concentric rings — same Kepler ω, scaled to satellite sizing
  if (planet.satellites.length === 0) return { hit };

  const satRadii = planet.satellites.map(s => s.radius);
  const sRadMin = Math.min(...satRadii);
  const sRadMax = Math.max(...satRadii);

  for (let i = 0; i < planet.satellites.length; i++) {
    const sat = planet.satellites[i];
    const ringR = (orbitLayoutBase + SAT_BASE_ORBIT + i * SAT_ORBIT_STEP) * PLANET_ORBIT_SCALE;
    const satEcc = 0.02 + eccentricityFromId(sat.id) * 0.10;
    const satTilt = orbitTiltFromId(sat.id);
    drawOrbitRing(ctx, cx, cy, ringR, viewScale, satEcc, satTilt);
    // Use (1+i) as the orbital rank so inner satellites are meaningfully faster
    // than outer ones; speedFromId gives each satellite a unique [0.7, 1.3)
    // multiplier so siblings at adjacent rings have distinct periods.
    const omega = orbitalAngularVelocity(1 + i, SAT_K)
                * (0.7 + speedFromId(sat.id) * 0.6);
    const phase = phaseFromId(sat.id);
    const angle = phase + omega * timeSec;
    const sa = ringR;
    const sb = sa * (1 - satEcc);
    const cosST = Math.cos(satTilt), sinST = Math.sin(satTilt);
    const slx = sa * Math.cos(angle), sly = sb * Math.sin(angle);
    const sx = cx + slx * cosST - sly * sinST;
    const sy = cy + slx * sinST + sly * cosST;
    const sizePx = scaleMap(sat.radius, sRadMin, sRadMax, SAT_MIN_PX, SAT_MAX_PX, 'sqrt') / viewScale;
    drawSatelliteBody(ctx, sx, sy, sizePx, sat, viewScale);
    if (sat.life) {
      ctx.beginPath();
      ctx.arc(sx, sy, sizePx + 1.5 / viewScale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,255,150,0.55)';
      ctx.lineWidth = 1 / viewScale;
      ctx.stroke();
    }
    hit.push({ x: sx, y: sy, r: Math.max(sizePx * 2, 10 / viewScale), kind: 'satellite', id: sat.id });
  }
  return { hit };
}
