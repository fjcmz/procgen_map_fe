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
const STAR_ORBIT_SPEED  = 0.08;   // rad/s — multi-star binary orbit ≈ 79 s
// k constants for orbitalAngularVelocity — tuned so the range of orbit/index
// values used by each body type yields visible periods (seconds, not hours):
//   planet.orbit is in ~[0, 20] → innermost ≈ 13 s, outermost ≈ 2–8 min
//   satellite index (1+i)  in [1…]  → innermost ≈  8 s, each outer ring slower
const PLANET_K = 0.5;
const SAT_K    = 0.8;

const PLANET_MIN_PX = 1;
const PLANET_MAX_PX = 6;
const STAR_MIN_PX = 5;
const STAR_MAX_PX = 16;
const SAT_MIN_PX = 2;
const SAT_MAX_PX = 10;

const SAT_BASE_ORBIT = 90;
const SAT_ORBIT_STEP = 44;

// ── FNV-1a hash for deterministic per-galaxy variability ─────────────────
// Produces a uint32 from a string id so the same galaxy always gets the
// same jitter / rotation offset, independent of generation order.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ── Tiny seeded LCG used only for the static background star field ─────
function lcg(seed: number): () => number {
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
  const angleStep = 0.42;
  const maxK = Math.max(1, Math.floor(armCount / 2));
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
    const baseAngle = armOffset * arm + k * angleStep;
    const radius = (a * Math.exp(b * baseAngle)) * (spread / 200);
    // Tiny along-arm angle wobble to break perfect regularity.
    const jitterAngle = ((i * 12.9898) % Math.PI) * 0.012;
    const finalAngle = baseAngle + jitterAngle;
    // Perpendicular direction to the spiral arm at this point.
    const perpAngle = finalAngle + Math.PI / 2;
    const armWidth = Math.max(Math.abs(radius) * 0.06, (spread / 200) * 2);
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
  kind: 'galaxy' | 'system' | 'planet' | 'satellite';
  id: string;
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


function drawOrbitRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, viewScale: number = 1): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
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
  if (s.composition === 'ANTIMATTER') {
    return { core: '#f4d8ff', glowInner: 'rgba(220,140,255,0.8)', glowOuter: 'rgba(120,40,180,0)' };
  }
  // brightness 100..1000 → tint warmer at the bright end
  const t = Math.max(0, Math.min(1, (s.brightness - 100) / 900));
  const r = Math.round(255 * (0.85 + 0.15 * t));
  const g = Math.round(220 * (0.7 + 0.3 * (1 - Math.abs(t - 0.5) * 2)));
  const b = Math.round(255 * (1 - 0.7 * t));
  return { core: `rgb(${r},${g},${b})`, glowInner: `rgba(${r},${g},${b},0.8)`, glowOuter: `rgba(${r},${g},${b},0)` };
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
      return { hit: drawGalaxySpiral(ctx, cx, cy, spreadPx, systems, timeSec, viewScale, cameraScale, viewBounds, rotOff, focus.shape, focus.id) };
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
    return { hit: drawGalaxySpiral(ctx, cx, cy, spreadPx, data.solarSystems, timeSec, viewScale, cameraScale, viewBounds, rotOff, singleShape, singleId) };
  }

  // Multi-galaxy: world layout with per-galaxy LOD.
  const minSide = Math.min(vw, vh);
  const extent = computeLayoutExtent(data.galaxies);
  const worldScale = (minSide * VIEWPORT_FIT_FRACTION) / extent;
  const originX = vw / 2;
  const originY = vh / 2;

  const hit: HitCircle[] = [];
  for (const galaxy of data.galaxies) {
    const gSpreadCanvas = galaxy.spread * worldScale;

    // Derive per-galaxy position jitter and initial rotation from galaxy id.
    const h0 = hashId(galaxy.id);
    const h1 = Math.imul(h0 ^ (h0 >>> 16), 0x45d9f3b) >>> 0;
    const h2 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b) >>> 0;
    const jx = h0 / 0x100000000 * 2 - 1;   // ±1, used for x position jitter
    const jy = h1 / 0x100000000 * 2 - 1;   // ±1, used for y position jitter
    const rotOff = h2 / 0x100000000 * Math.PI * 2;

    // Apply ±20% of spread as a position offset so galaxies don't sit on a
    // perfectly regular grid even after layout recentering.
    const gcx = originX + galaxy.cx * worldScale + jx * 0.2 * gSpreadCanvas;
    const gcy = originY + galaxy.cy * worldScale + jy * 0.2 * gSpreadCanvas;
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
      const subHit = drawGalaxySpiral(ctx, gcx, gcy, gSpreadCanvas, systems, timeSec, viewScale, cameraScale, viewBounds, rotOff, galaxy.shape, galaxy.id);
      ctx.restore();
      hit.push(...subHit);
    }
  }
  return { hit };
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
): HitCircle[] {
  const { rawPositions, maxStarRadii, minR, maxR } = getOrBuildLayout(systems, cx, cy, spread, shape, galaxyId);

  const galaxyAngle = timeSec * GALAXY_SPIN_SPEED + rotationOffset;
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

    const dominant = systems[i].stars[0] ?? null;
    const palette = dominant ? starFill(dominant) : { core: '#fff', glowInner: 'rgba(255,255,255,0.8)', glowOuter: 'rgba(255,255,255,0)' };
    const outerR = sizePx * GLOW_OUTER_MULT;
    ctx.drawImage(getOrBuildGlowCanvas(palette), px - outerR, py - outerR, outerR * 2, outerR * 2);
    drawCircle(ctx, px, py, sizePx * 0.6, palette.core);
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
const GLYPH_DOT_COUNT = 20;

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

  // Orbit radius mapping: planet.orbit values are loosely in [1, 50] from
  // PlanetGenerator; map them to a comfortable on-screen ring spread.
  const orbits = system.planets.map(p => p.orbit);
  const orbitMin = orbits.length ? Math.min(...orbits) : 1;
  const orbitMax = orbits.length ? Math.max(...orbits) : 1;
  const ringMin = minSide * 0.10;
  const ringMax = minSide * 0.45;

  // Planet size mapping
  const planetRadii = system.planets.map(p => p.radius);
  const pRadMin = planetRadii.length ? Math.min(...planetRadii) : 0;
  const pRadMax = planetRadii.length ? Math.max(...planetRadii) : 1;

  // Star size mapping (within this system)
  const starRadii = system.stars.map(s => s.radius);
  const sRadMin = starRadii.length ? Math.min(...starRadii) : 0;
  const sRadMax = starRadii.length ? Math.max(...starRadii) : 1;

  // Draw orbit rings first so planets and stars layer on top
  for (const planet of system.planets) {
    const ringR = scaleMap(planet.orbit, orbitMin, orbitMax, ringMin, ringMax, 'sqrt');
    drawOrbitRing(ctx, cx, cy, ringR, viewScale);
  }

  // Stars at center — for multi-star systems space them in a tight cluster.
  // Sizes divided by viewScale to stay constant in screen pixels regardless
  // of how far the user has zoomed in.
  if (system.stars.length === 1) {
    const star = system.stars[0];
    const starPx = scaleMap(star.radius, sRadMin, sRadMax, STAR_MIN_PX, STAR_MAX_PX, 'sqrt') / viewScale;
    const palette = starFill(star);
    const outerR = starPx * GLOW_OUTER_MULT;
    ctx.drawImage(getOrBuildGlowCanvas(palette), cx - outerR, cy - outerR, outerR * 2, outerR * 2);
    drawCircle(ctx, cx, cy, starPx, palette.core);
  } else {
    const clusterR = STAR_MIN_PX * 1.2 / viewScale;
    for (let i = 0; i < system.stars.length; i++) {
      const star = system.stars[i];
      const baseAngle = (i / system.stars.length) * Math.PI * 2;
      const phase = phaseFromId(star.id);
      const angle = baseAngle + phase + STAR_ORBIT_SPEED * timeSec;
      const sx = cx + Math.cos(angle) * clusterR;
      const sy = cy + Math.sin(angle) * clusterR;
      const starPx = scaleMap(star.radius, sRadMin, sRadMax, STAR_MIN_PX, STAR_MAX_PX, 'sqrt') * 0.7 / viewScale;
      const palette = starFill(star);
      const outerR = starPx * GLOW_OUTER_MULT;
      ctx.drawImage(getOrBuildGlowCanvas(palette), sx - outerR, sy - outerR, outerR * 2, outerR * 2);
      drawCircle(ctx, sx, sy, starPx, palette.core);
    }
  }

  // Planets — Kepler ω ∝ r^-1.5 with seeded phase.
  // omega uses planet.orbit (simulation units ~[0,20]) not the pixel ringR so
  // the Kepler exponent produces human-scale periods (seconds, not hours).
  // speedFromId multiplies by [0.8, 1.2) so two planets at the same orbit
  // value still have distinct periods.
  // Star hit circle — clicking the central star(s) opens the system popup.
  // Added first so planet disks (appended later) take priority on any overlap.
  const hit: HitCircle[] = [
    { x: cx, y: cy, r: STAR_MAX_PX * 1.2 / viewScale, kind: 'system', id: system.id },
  ];
  for (const planet of system.planets) {
    const ringR = scaleMap(planet.orbit, orbitMin, orbitMax, ringMin, ringMax, 'sqrt');
    const omega = orbitalAngularVelocity(planet.orbit, PLANET_K)
                * (0.8 + speedFromId(planet.id) * 0.4);
    const phase = phaseFromId(planet.id);
    const angle = phase + omega * timeSec;
    const px = cx + Math.cos(angle) * ringR;
    const py = cy + Math.sin(angle) * ringR;
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
    const ringR = orbitLayoutBase + SAT_BASE_ORBIT + i * SAT_ORBIT_STEP;
    drawOrbitRing(ctx, cx, cy, ringR, viewScale);
    // Use (1+i) as the orbital rank so inner satellites are meaningfully faster
    // than outer ones; speedFromId gives each satellite a unique [0.7, 1.3)
    // multiplier so siblings at adjacent rings have distinct periods.
    const omega = orbitalAngularVelocity(1 + i, SAT_K)
                * (0.7 + speedFromId(sat.id) * 0.6);
    const phase = phaseFromId(sat.id);
    const angle = phase + omega * timeSec;
    const sx = cx + Math.cos(angle) * ringR;
    const sy = cy + Math.sin(angle) * ringR;
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
