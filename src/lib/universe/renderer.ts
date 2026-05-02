import type {
  UniverseData,
  SolarSystemData,
  StarData,
  PlanetData,
  SatelliteData,
} from './types';
import type { PlanetSubtype, PlanetBiome } from './Planet';
import type { SatelliteSubtype } from './Satellite';

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

// ── Reference-repo constants (kept verbatim for visual parity) ────────────
const STAR_FIELD_COUNT = 900;
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

// ── Galaxy spiral layout ──────────────────────────────────────────────────
export function galaxySpiralPositions(
  count: number,
  cx: number,
  cy: number,
  spread: number,
): Array<{ x: number; y: number }> {
  // 2-arm logarithmic spiral. Per-arm we step radius outward and angle by a
  // fixed delta; small per-step noise (deterministic from index) breaks the
  // visible regularity without needing an RNG instance.
  const positions: Array<{ x: number; y: number }> = [];
  const arms = 2;
  const armOffset = Math.PI;
  const a = 8;       // logarithmic spiral inner radius
  const angleStep = 0.42;
  // Adaptive tightness: for high star counts the fixed b=0.18 pushes outer
  // arms far outside the viewport. Compute the maximum b that keeps the last
  // arm within ~45% of `spread` (a * exp(b * maxAngle) * spread/200 ≤ spread*0.45
  // ⟹ b ≤ ln(11.25) / maxAngle ≈ 2.42 / maxAngle). For count ≤ ~64 the cap
  // has no effect and the original value 0.18 is preserved.
  const maxK = Math.max(1, Math.floor(count / 2));
  const b = Math.min(0.18, 2.42 / (maxK * angleStep));

  for (let i = 0; i < count; i++) {
    const arm = i % arms;
    const k = Math.floor(i / arms);
    const angle = armOffset * arm + k * angleStep;
    const radius = (a * Math.exp(b * angle)) * (spread / 200);
    // deterministic jitter from index so neighbours don't align on the spiral
    const jitterAngle = ((i * 12.9898) % Math.PI) * 0.05;
    const jitterRadius = ((i * 78.233) % 23) - 11;
    const finalAngle = angle + jitterAngle;
    const finalRadius = radius + jitterRadius;
    positions.push({
      x: cx + Math.cos(finalAngle) * finalRadius,
      y: cy + Math.sin(finalAngle) * finalRadius,
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
      r: rng() * 1.2 + 0.2,
      alpha: rng() * 0.6 + 0.2,
    });
  }
  return stars;
}

// ── Hit-test inputs (consumed by ../components/UniverseCanvas) ────────────
export interface HitCircle {
  x: number;
  y: number;
  r: number;
  kind: 'system' | 'planet' | 'satellite';
  id: string;
}

// ── Drawing primitives ────────────────────────────────────────────────────
function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  innerColor: string, outerColor: string,
): void {
  const grd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
  grd.addColorStop(0, innerColor);
  grd.addColorStop(1, outerColor);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
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
function starFill(s: StarData): { inner: string; outer: string; core: string } {
  if (s.composition === 'ANTIMATTER') {
    return { inner: 'rgba(220,140,255,0.95)', outer: 'rgba(120,40,180,0)', core: '#f4d8ff' };
  }
  // brightness 100..1000 → tint warmer at the bright end
  const t = Math.max(0, Math.min(1, (s.brightness - 100) / 900));
  const r = Math.round(255 * (0.85 + 0.15 * t));
  const g = Math.round(220 * (0.7 + 0.3 * (1 - Math.abs(t - 0.5) * 2)));
  const b = Math.round(255 * (1 - 0.7 * t));
  const core = `rgb(${r},${g},${b})`;
  return { inner: `rgba(${r},${g},${b},0.95)`, outer: `rgba(${r},${g},${b},0)`, core };
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
// Tiny disks (r < 1.6 px) skip the gradient and bands entirely — the cost
// of createRadialGradient is wasted on a sub-pixel splat — and just paint
// the base color. This keeps the galaxy-spread system view fast even with
// hundreds of bodies.

const TINY_DISK_PX = 1.6;

function drawBodyDisk(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  palette: BodyPalette,
): void {
  if (r < TINY_DISK_PX) {
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

  // Gas-giant horizontal bands — only at meaningful disk size (≥ 4 px) so
  // tiny disks don't get muddied by sub-pixel band strokes.
  if (palette.bands && r >= 4) {
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
  // enough to read it.
  if (palette.hot && r >= 3) {
    const hotR = Math.max(1.2, r * 0.35);
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
): void {
  drawBodyDisk(ctx, x, y, r, planetPalette(p));
}

function drawSatelliteBody(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: SatelliteData,
): void {
  drawBodyDisk(ctx, x, y, r, satellitePalette(s));
}

// Re-export legacy fills so any external module pulling them keeps compiling.
export { planetFill, satelliteFill };

// ── Galaxy scene ──────────────────────────────────────────────────────────
export interface GalaxyDrawResult {
  hit: HitCircle[];
}

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
): GalaxyDrawResult {
  if (!skipBg) drawBackground(ctx, vw, vh, stars);
  const cx = vw / 2;
  const cy = vh / 2;
  const spread = Math.min(vw, vh) * 0.7;
  const rawPositions = galaxySpiralPositions(data.solarSystems.length, cx, cy, spread);

  // Rotate the entire galaxy around its center
  const galaxyAngle = timeSec * GALAXY_SPIN_SPEED;
  const cosG = Math.cos(galaxyAngle);
  const sinG = Math.sin(galaxyAngle);
  const positions = rawPositions.map(pos => {
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    return { x: cx + dx * cosG - dy * sinG, y: cy + dx * sinG + dy * cosG };
  });

  // Pre-compute domain for fair sizing across orders of magnitude.
  const maxStarRadii = data.solarSystems.map(ss =>
    ss.stars.length > 0 ? Math.max(...ss.stars.map(s => s.radius)) : 0
  );
  const minR = maxStarRadii.length ? Math.min(...maxStarRadii) : 0;
  const maxR = maxStarRadii.length ? Math.max(...maxStarRadii) : 1;

  const hit: HitCircle[] = [];
  for (let i = 0; i < data.solarSystems.length; i++) {
    const ss = data.solarSystems[i];
    const pos = positions[i];
    // Divide by viewScale so the glyph stays at a constant screen-pixel size
    // regardless of the canvas zoom level (the canvas transform already
    // multiplies everything by viewScale, so dividing here cancels it out).
    const sizePx = scaleMap(maxStarRadii[i], minR, maxR, 4, 14, 'sqrt') * cameraScale / viewScale;

    // Mass-weighted compositional palette: ANTIMATTER vs MATTER systems read
    // visually distinct in the galaxy view.
    const dominant = ss.stars[0] ?? null;
    const palette = dominant ? starFill(dominant) : { inner: '#fff', outer: 'rgba(255,255,255,0)', core: '#fff' };
    drawGlow(ctx, pos.x, pos.y, sizePx, palette.inner, palette.outer);
    drawCircle(ctx, pos.x, pos.y, sizePx * 0.6, palette.core);

    hit.push({ x: pos.x, y: pos.y, r: Math.max(sizePx * 1.4, 8 / viewScale), kind: 'system', id: ss.id });
  }
  return { hit };
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
    drawGlow(ctx, cx, cy, starPx, palette.inner, palette.outer);
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
      drawGlow(ctx, sx, sy, starPx, palette.inner, palette.outer);
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
    drawPlanetBody(ctx, px, py, sizePx, planet);
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
  drawPlanetBody(ctx, cx, cy, planetPx, planet);
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
    drawSatelliteBody(ctx, sx, sy, sizePx, sat);
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
