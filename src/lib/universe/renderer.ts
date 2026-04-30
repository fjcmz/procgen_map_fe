import type {
  UniverseData,
  SolarSystemData,
  StarData,
  PlanetData,
  SatelliteData,
} from './types';

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

const PLANET_MIN_PX = 3;
const PLANET_MAX_PX = 18;
const STAR_MIN_PX = 16;
const STAR_MAX_PX = 48;
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
  const b = 0.18;    // tightness — smaller = tighter winding
  const angleStep = 0.42;

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

function drawOrbitRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 200, 240, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBackground(
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

function planetFill(p: PlanetData): string {
  if (p.life) return '#5fa86a';
  return p.composition === 'GAS' ? '#c89a64' : '#9a7a5a';
}

function satelliteFill(s: SatelliteData): string {
  return s.composition === 'ICE' ? '#dde8f0' : '#9a8e80';
}

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
): GalaxyDrawResult {
  drawBackground(ctx, vw, vh, stars);
  const cx = vw / 2;
  const cy = vh / 2;
  const spread = Math.min(vw, vh) * 0.7;
  const positions = galaxySpiralPositions(data.solarSystems.length, cx, cy, spread);

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
    const sizePx = scaleMap(maxStarRadii[i], minR, maxR, 4, 14, 'sqrt') * cameraScale;

    // Mass-weighted compositional palette: ANTIMATTER vs MATTER systems read
    // visually distinct in the galaxy view.
    const dominant = ss.stars[0] ?? null;
    const palette = dominant ? starFill(dominant) : { inner: '#fff', outer: 'rgba(255,255,255,0)', core: '#fff' };
    drawGlow(ctx, pos.x, pos.y, sizePx, palette.inner, palette.outer);
    drawCircle(ctx, pos.x, pos.y, sizePx * 0.6, palette.core);

    hit.push({ x: pos.x, y: pos.y, r: Math.max(sizePx * 1.4, 8), kind: 'system', id: ss.id });
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
): SystemDrawResult {
  drawBackground(ctx, vw, vh, stars);
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
    drawOrbitRing(ctx, cx, cy, ringR);
  }

  // Stars at center — for multi-star systems space them in a tight cluster
  if (system.stars.length === 1) {
    const star = system.stars[0];
    const starPx = scaleMap(star.radius, sRadMin, sRadMax, STAR_MIN_PX, STAR_MAX_PX, 'sqrt');
    const palette = starFill(star);
    drawGlow(ctx, cx, cy, starPx, palette.inner, palette.outer);
    drawCircle(ctx, cx, cy, starPx, palette.core);
  } else {
    const clusterR = STAR_MIN_PX * 1.2;
    for (let i = 0; i < system.stars.length; i++) {
      const star = system.stars[i];
      const angle = (i / system.stars.length) * Math.PI * 2;
      const sx = cx + Math.cos(angle) * clusterR;
      const sy = cy + Math.sin(angle) * clusterR;
      const starPx = scaleMap(star.radius, sRadMin, sRadMax, STAR_MIN_PX, STAR_MAX_PX, 'sqrt') * 0.7;
      const palette = starFill(star);
      drawGlow(ctx, sx, sy, starPx, palette.inner, palette.outer);
      drawCircle(ctx, sx, sy, starPx, palette.core);
    }
  }

  // Planets — Kepler ω ∝ r^-1.5 with seeded phase
  const hit: HitCircle[] = [];
  for (const planet of system.planets) {
    const ringR = scaleMap(planet.orbit, orbitMin, orbitMax, ringMin, ringMax, 'sqrt');
    const omega = orbitalAngularVelocity(ringR);
    const phase = phaseFromId(planet.id);
    const angle = phase + omega * timeSec;
    const px = cx + Math.cos(angle) * ringR;
    const py = cy + Math.sin(angle) * ringR;
    const sizePx = scaleMap(planet.radius, pRadMin, pRadMax, PLANET_MIN_PX, PLANET_MAX_PX, 'sqrt');
    drawCircle(ctx, px, py, sizePx, planetFill(planet));
    if (planet.life) {
      ctx.beginPath();
      ctx.arc(px, py, sizePx + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,255,150,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    hit.push({ x: px, y: py, r: Math.max(sizePx * 1.6, 8), kind: 'planet', id: planet.id });
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
): PlanetDrawResult {
  drawBackground(ctx, vw, vh, stars);
  const cx = vw / 2;
  const cy = vh / 2;
  const minSide = Math.min(vw, vh);

  // Hero planet — large central disk, optional life ring
  const planetPx = minSide * 0.18;
  drawCircle(ctx, cx, cy, planetPx, planetFill(planet));
  if (planet.life) {
    ctx.beginPath();
    ctx.arc(cx, cy, planetPx + 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,255,150,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Satellites on concentric rings — same Kepler ω, scaled to satellite sizing
  if (planet.satellites.length === 0) return { hit: [] };

  const satRadii = planet.satellites.map(s => s.radius);
  const sRadMin = Math.min(...satRadii);
  const sRadMax = Math.max(...satRadii);

  const hit: HitCircle[] = [];
  for (let i = 0; i < planet.satellites.length; i++) {
    const sat = planet.satellites[i];
    const ringR = planetPx + SAT_BASE_ORBIT + i * SAT_ORBIT_STEP;
    drawOrbitRing(ctx, cx, cy, ringR);
    const omega = orbitalAngularVelocity(ringR) * 1.5;
    const phase = phaseFromId(sat.id);
    const angle = phase + omega * timeSec;
    const sx = cx + Math.cos(angle) * ringR;
    const sy = cy + Math.sin(angle) * ringR;
    const sizePx = scaleMap(sat.radius, sRadMin, sRadMax, SAT_MIN_PX, SAT_MAX_PX, 'sqrt');
    drawCircle(ctx, sx, sy, sizePx, satelliteFill(sat));
    hit.push({ x: sx, y: sy, r: Math.max(sizePx * 2, 10), kind: 'satellite', id: sat.id });
  }
  return { hit };
}
