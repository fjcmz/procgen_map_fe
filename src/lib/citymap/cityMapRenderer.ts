import type { CityMapData, CityEnvironment, CityDistrict, CityBuilding, CityLandmark } from './cityMapGenerator';
import { findSharedEdge } from './cityMapGenerator';
import type { BiomeType } from '../types';
import { seededPRNG, createNoiseSamplers, fbm } from '../terrain/noise';

// ── Palette tokens ──
// Hand-drawn medieval town-plan palette: warm parchment + charcoal ink + one
// soft biome tint. All renderer hex literals should reference these tokens.

const PARCHMENT = '#ebdfba';
const INK = '#2a241c';
const GRID_INK = 'rgba(58, 50, 38, 0.18)';
const RIVER_OUTER = '#6d665a';
const RIVER_INNER = '#544e44';
const BRIDGE_INK = '#3a322a';
const ROAD_MAIN = '#d9ccaa';
const STREET_PAVE = '#f3e9c8';
const DISTRICT_FILL = '#d8ccaa';
const BUILDING_FILL = '#c0b8a5';
const COAST_WATER = '#7e786c';
const COAST_SHORE = '#9a948a';

// Soft per-biome tint — applied as a low-alpha overlay so the parchment +
// ink illustration style stays dominant.
function biomeTint(biome: BiomeType): string {
  if (biome.includes('DESERT')) return '#e6d49a';
  if (biome === 'SNOW' || biome === 'ICE') return '#d6dde3';
  if (biome === 'TUNDRA') return '#c6c9b8';
  if (biome.includes('FOREST') || biome.includes('RAIN') || biome === 'TAIGA') return '#b8c49a';
  if (biome === 'MARSH') return '#a8b488';
  if (biome === 'GRASSLAND' || biome === 'SHRUBLAND') return '#cfd39a';
  if (biome === 'ALPINE_MEADOW') return '#c6d0a4';
  if (biome === 'BEACH') return '#e3d8b0';
  return '#d6cba8';
}

// ── Geometry helpers ──

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const denom = yj - yi || 1e-12;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / denom + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function nearestWallSegmentAngle(walls: [number, number][], gx: number, gy: number): number {
  let bestAngle = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const [x1, y1] = walls[i];
    const [x2, y2] = walls[(i + 1) % walls.length];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((gx - x1) * dx + (gy - y1) * dy) / len2));
    const px = x1 + dx * t, py = y1 + dy * t;
    const d = (gx - px) ** 2 + (gy - py) ** 2;
    if (d < bestDistSq) {
      bestDistSq = d;
      bestAngle = Math.atan2(dy, dx);
    }
  }
  return bestAngle;
}

// Walk wall polyline by arc length, emit tower positions every `spacing` px
// (always include each polyline vertex too).
function placeTowers(walls: [number, number][], spacing: number): [number, number][] {
  const towers: [number, number][] = walls.slice() as [number, number][];
  for (let i = 0; i < walls.length; i++) {
    const [x1, y1] = walls[i];
    const [x2, y2] = walls[(i + 1) % walls.length];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < spacing) continue;
    const numExtra = Math.floor(len / spacing);
    for (let j = 1; j <= numExtra; j++) {
      const t = j / (numExtra + 1);
      towers.push([x1 + dx * t, y1 + dy * t]);
    }
  }
  return towers;
}

function makeFieldHatch(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas');
  const TS = 12;
  tile.width = TS;
  tile.height = TS;
  const t = tile.getContext('2d');
  if (!t) return null;
  t.strokeStyle = 'rgba(42, 36, 28, 0.55)';
  t.lineWidth = 0.8;
  t.lineCap = 'round';
  // Three diagonal strokes per tile, shifted to tile cleanly.
  t.beginPath();
  t.moveTo(-2, 6); t.lineTo(6, -2);
  t.moveTo(0, 12); t.lineTo(12, 0);
  t.moveTo(6, 14); t.lineTo(14, 6);
  t.stroke();
  return ctx.createPattern(tile, 'repeat');
}

// ── Main render function ──

export function renderCityMap(
  ctx: CanvasRenderingContext2D,
  data: CityMapData,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
  const S = data.canvasSize;
  const rng = seededPRNG(seed + '_cityrender_' + cityName);
  const noise = createNoiseSamplers(seed + '_cityrender_' + cityName);

  ctx.clearRect(0, 0, S, S);

  const hatch = makeFieldHatch(ctx);

  // Layer 1: parchment background + soft biome tint
  drawBackground(ctx, S, env, noise);

  // Layer 2: cadastral grid (survey-paper feel)
  drawCadastralGrid(ctx, S);

  // Layer 3: surrounding terrain fringe (muted ink-on-parchment glyphs)
  drawFringe(ctx, S, env, rng);

  // Layer 4: water on the coastal side, charcoal-gray ink wash
  if (env.isCoastal && env.waterSide) {
    drawCoastalWater(ctx, S, env, noise);
  }

  // Layer 5: district fills (soft per-district jitter, hatched fields outside walls)
  drawDistricts(ctx, data.districts, data.walls, hatch, rng, noise);

  // Layer 6: streets (thin pale paving)
  drawStreets(ctx, data.districts);

  // Layer 7: main roads (slightly heavier than streets)
  drawMainRoads(ctx, data.mainRoads);

  // Layer 8: river (charcoal two-tone channel, no blue)
  if (data.river) {
    drawRiver(ctx, data.river);
  }

  // Layer 9: bridges
  for (const bridge of data.bridges) {
    drawBridge(ctx, bridge);
  }

  // Layer 10: walls + tower dots + gate gaps
  if (data.walls) {
    drawWalls(ctx, data.walls, data.gates, env);
  }

  // Layer 11: buildings (cool-gray fill + ink outline; ~5% promoted to solid ink)
  drawBuildings(ctx, data.buildings, data.districts, data.landmarks, rng);

  // Layer 12: landmarks (castle/temple/monument glyphs in ink palette)
  for (const lm of data.landmarks) {
    drawLandmark(ctx, lm.x, lm.y, lm.type);
  }

  // Layer 13: ruin overlay
  if (env.isRuin) {
    drawRuinOverlay(ctx, S, rng);
  }

  // Layer 14: city name label
  drawCityLabel(ctx, S, cityName);
}

// ── Layer implementations ──

function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: number,
  env: CityEnvironment,
  noise: { elevation: (x: number, y: number) => number },
): void {
  // 1. Parchment base.
  ctx.fillStyle = PARCHMENT;
  ctx.fillRect(0, 0, size, size);

  // 2. Faint paper-grain noise modulation in tile sweeps.
  const step = 6;
  for (let x = 0; x < size; x += step) {
    for (let y = 0; y < size; y += step) {
      const n = fbm(noise.elevation, x * 0.008, y * 0.008, 3);
      const a = Math.max(0, Math.min(0.18, (n - 0.5) * 0.5));
      // Sign of the deviation flips between subtle dark and light flecks.
      ctx.fillStyle = n > 0.5 ? `rgba(58, 50, 38, ${a})` : `rgba(255, 248, 222, ${a})`;
      ctx.fillRect(x, y, step, step);
    }
  }

  // 3. Soft biome tint overlay (very low alpha — keeps parchment dominant).
  ctx.fillStyle = biomeTint(env.biome);
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
}

function drawCadastralGrid(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.strokeStyle = GRID_INK;
  ctx.lineWidth = 1;
  const spacing = 180;
  ctx.beginPath();
  for (let x = spacing; x < size; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
  }
  for (let y = spacing; y < size; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
  }
  ctx.stroke();
}

function drawFringe(
  ctx: CanvasRenderingContext2D,
  size: number,
  env: CityEnvironment,
  rng: () => number,
): void {
  const margin = size * 0.15;
  const coreRadius = size * 0.35;
  const cx = size / 2, cy = size / 2;

  // Forest: small ink triangles (tree glyphs).
  const isForest = env.biome.includes('FOREST') || env.biome === 'TAIGA' || env.biome === 'SHRUBLAND';
  if (isForest) {
    const treeCount = 80 + Math.floor(rng() * 60);
    ctx.fillStyle = 'rgba(42, 36, 28, 0.55)';
    for (let i = 0; i < treeCount; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) < coreRadius) continue;
      const ts = 3 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y - ts);
      ctx.lineTo(x - ts * 0.55, y + ts * 0.4);
      ctx.lineTo(x + ts * 0.55, y + ts * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Desert: faint dune arcs.
  const isDesert = env.biome.includes('DESERT');
  if (isDesert) {
    ctx.strokeStyle = 'rgba(120, 100, 60, 0.4)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      const y = margin * 0.5 + rng() * (size - margin);
      const x = rng() * size;
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) < coreRadius) continue;
      ctx.beginPath();
      ctx.arc(x, y, 14 + rng() * 22, 0, Math.PI, false);
      ctx.stroke();
    }
  }

  // Cold biomes: pale snow patches in muted ink-on-parchment.
  const isCold = env.biome === 'SNOW' || env.biome === 'ICE' || env.biome === 'TUNDRA';
  if (isCold) {
    for (let i = 0; i < 36; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) < coreRadius) continue;
      ctx.fillStyle = `rgba(214, 221, 227, ${0.4 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 + rng() * 11, 4 + rng() * 7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCoastalWater(
  ctx: CanvasRenderingContext2D,
  size: number,
  env: CityEnvironment,
  noise: { elevation: (x: number, y: number) => number },
): void {
  const waterColor = COAST_WATER;
  const shoreColor = COAST_SHORE;

  // Draw water on the appropriate side
  ctx.fillStyle = waterColor;
  const waterDepth = size * 0.18;

  ctx.beginPath();
  switch (env.waterSide) {
    case 'north': {
      ctx.moveTo(0, 0);
      for (let x = 0; x <= size; x += 8) {
        const wave = fbm(noise.elevation, x * 0.015, 0.5, 2) * 15;
        ctx.lineTo(x, waterDepth + wave);
      }
      ctx.lineTo(size, 0);
      break;
    }
    case 'south': {
      ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 8) {
        const wave = fbm(noise.elevation, x * 0.015, 10.5, 2) * 15;
        ctx.lineTo(x, size - waterDepth - wave);
      }
      ctx.lineTo(size, size);
      break;
    }
    case 'east': {
      ctx.moveTo(size, 0);
      for (let y = 0; y <= size; y += 8) {
        const wave = fbm(noise.elevation, 20.5, y * 0.015, 2) * 15;
        ctx.lineTo(size - waterDepth - wave, y);
      }
      ctx.lineTo(size, size);
      break;
    }
    case 'west': {
      ctx.moveTo(0, 0);
      for (let y = 0; y <= size; y += 8) {
        const wave = fbm(noise.elevation, 30.5, y * 0.015, 2) * 15;
        ctx.lineTo(waterDepth + wave, y);
      }
      ctx.lineTo(0, size);
      break;
    }
  }
  ctx.closePath();
  ctx.fill();

  // Shore line highlight
  ctx.strokeStyle = shoreColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDistricts(
  ctx: CanvasRenderingContext2D,
  districts: CityDistrict[],
  walls: [number, number][] | null,
  hatch: CanvasPattern | null,
  _rng: () => number,
  noise: { elevation: (x: number, y: number) => number },
): void {
  // Soft warm-gray fill with a touch of FBM jitter — districts give shape
  // without competing with walls or buildings for the eye.
  for (const d of districts) {
    const v = d.vertices;
    if (v.length < 3) continue;

    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i][0], v[i][1]);
    ctx.closePath();

    const baseR = parseInt(DISTRICT_FILL.slice(1, 3), 16);
    const baseG = parseInt(DISTRICT_FILL.slice(3, 5), 16);
    const baseB = parseInt(DISTRICT_FILL.slice(5, 7), 16);
    const jitter = (fbm(noise.elevation, d.x * 0.01, d.y * 0.01, 2) - 0.5) * 16;
    ctx.fillStyle = `rgb(${Math.round(baseR + jitter)}, ${Math.round(baseG + jitter)}, ${Math.round(baseB + jitter)})`;
    ctx.fill();

    // Diagonal hatching for agricultural districts that lie outside the
    // wall perimeter (suburban fields, like the striped patches in the
    // reference plates).
    if (hatch && d.role === 'agricultural') {
      const outside = !walls || !pointInPolygon(d.x, d.y, walls);
      if (outside) {
        ctx.fillStyle = hatch;
        ctx.fill();
      }
    }
  }
}

function drawStreets(
  ctx: CanvasRenderingContext2D,
  districts: CityDistrict[],
): void {
  ctx.strokeStyle = STREET_PAVE;
  ctx.lineWidth = 1;

  const drawn = new Set<string>();
  for (const d of districts) {
    for (const ni of d.neighbors) {
      if (ni < 0 || ni >= districts.length) continue;
      const key = Math.min(d.index, ni) + '_' + Math.max(d.index, ni);
      if (drawn.has(key)) continue;
      drawn.add(key);

      const edge = findSharedEdge(d, districts[ni]);
      if (!edge) continue;

      ctx.beginPath();
      ctx.moveTo(edge[0][0], edge[0][1]);
      ctx.lineTo(edge[1][0], edge[1][1]);
      ctx.stroke();
    }
  }
}

function drawMainRoads(
  ctx: CanvasRenderingContext2D,
  mainRoads: [number, number][][],
): void {
  ctx.strokeStyle = ROAD_MAIN;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const road of mainRoads) {
    if (road.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(road[0][0], road[0][1]);
    if (road.length === 3) {
      ctx.quadraticCurveTo(road[1][0], road[1][1], road[2][0], road[2][1]);
    } else {
      for (let i = 1; i < road.length; i++) {
        ctx.lineTo(road[i][0], road[i][1]);
      }
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawRiver(
  ctx: CanvasRenderingContext2D,
  river: { path: [number, number][]; width: number },
): void {
  const p = river.path;
  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) {
      if (i < p.length - 1) {
        const mx = (p[i][0] + p[i + 1][0]) / 2;
        const my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      } else {
        ctx.lineTo(p[i][0], p[i][1]);
      }
    }
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer charcoal channel.
  ctx.strokeStyle = RIVER_OUTER;
  ctx.lineWidth = river.width;
  tracePath();
  ctx.stroke();

  // Inner darker thread for two-tone channel feel.
  ctx.strokeStyle = RIVER_INNER;
  ctx.lineWidth = river.width * 0.55;
  tracePath();
  ctx.stroke();

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawBridge(
  ctx: CanvasRenderingContext2D,
  bridge: [number, number][],
): void {
  if (bridge.length < 2) return;
  ctx.strokeStyle = PARCHMENT;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bridge[0][0], bridge[0][1]);
  ctx.lineTo(bridge[1][0], bridge[1][1]);
  ctx.stroke();

  // Bridge ink rails.
  ctx.strokeStyle = BRIDGE_INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bridge[0][0], bridge[0][1]);
  ctx.lineTo(bridge[1][0], bridge[1][1]);
  ctx.stroke();
}

function drawWalls(
  ctx: CanvasRenderingContext2D,
  walls: [number, number][],
  gates: [number, number][],
  env: CityEnvironment,
): void {
  const isDouble = env.size === 'megalopolis';

  // Optional thinner outer wall (concentric ring) for the largest cities.
  if (isDouble) {
    const cx = walls.reduce((s, p) => s + p[0], 0) / walls.length;
    const cy = walls.reduce((s, p) => s + p[1], 0) / walls.length;
    const outer = walls.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      return [x + (dx / len) * 12, y + (dy / len) * 12] as [number, number];
    });
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
    ctx.closePath();
    ctx.stroke();
  }

  // Main wall — thick ink stroke with rounded joins.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(walls[0][0], walls[0][1]);
  for (let i = 1; i < walls.length; i++) ctx.lineTo(walls[i][0], walls[i][1]);
  ctx.closePath();
  ctx.stroke();

  // Tower dots — every vertex plus interpolated points along long segments.
  const towers = placeTowers(walls, 70);
  ctx.fillStyle = INK;
  for (const [tx, ty] of towers) {
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gate gaps — paint a parchment-colored cross-segment over the wall, then
  // two small ink dashes either side to read as gate doors.
  for (const [gx, gy] of gates) {
    const angle = nearestWallSegmentAngle(walls, gx, gy);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angle);
    // Erase the wall ink at this point (slightly taller than wall lineWidth).
    ctx.fillStyle = PARCHMENT;
    ctx.fillRect(-7, -5, 14, 10);
    // Two gate-door dashes flanking the opening.
    ctx.fillStyle = INK;
    ctx.fillRect(-7, -1.2, 4, 2.4);
    ctx.fillRect(3, -1.2, 4, 2.4);
    ctx.restore();
  }

  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  buildings: CityBuilding[],
  districts: CityDistrict[],
  landmarks: CityLandmark[],
  rng: () => number,
): void {
  // Cache per-district promotion baseline so the random distribution of
  // "important" filled-ink buildings concentrates around civic + market
  // districts (and bumps further if a landmark is nearby).
  const promoteByDistrict = new Map<number, number>();
  for (const d of districts) {
    let chance = 0.03;
    if (d.role === 'civic') chance = 0.18;
    else if (d.role === 'market') chance = 0.12;
    else if (d.role === 'harbor') chance = 0.08;
    promoteByDistrict.set(d.index, chance);
  }

  for (const b of buildings) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);

    let chance = promoteByDistrict.get(b.districtIndex) ?? 0.03;
    for (const lm of landmarks) {
      const dx = lm.x - b.x, dy = lm.y - b.y;
      if (dx * dx + dy * dy < 50 * 50) { chance += 0.15; break; }
    }

    if (rng() < chance) {
      // "Important" building — solid ink block (church, warehouse, hall).
      ctx.fillStyle = INK;
      ctx.fillRect(-b.w / 2 - 0.3, -b.h / 2 - 0.3, b.w + 0.6, b.h + 0.6);
    } else {
      ctx.fillStyle = BUILDING_FILL;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    }

    ctx.restore();
  }
}

function drawLandmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: 'castle' | 'temple' | 'monument',
): void {
  ctx.save();
  ctx.translate(x, y);

  switch (type) {
    case 'castle': {
      const s = 16;
      // Citadel keep — solid ink with parchment battlement notches.
      ctx.fillStyle = INK;
      ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
      ctx.fillRect(-s - 3, -s, 6, s * 1.6);
      ctx.fillRect(s - 3, -s, 6, s * 1.6);
      ctx.fillStyle = PARCHMENT;
      for (let i = -s + 2; i < s; i += 6) {
        ctx.fillRect(i, -s * 0.6 - 3, 3, 3);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(-s - 4, -s - 3, 8, 3);
      ctx.fillRect(s - 4, -s - 3, 8, 3);
      // Gate arch.
      ctx.fillStyle = PARCHMENT;
      ctx.beginPath();
      ctx.arc(0, s * 0.6, 4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-4, s * 0.1, 8, s * 0.5);
      break;
    }
    case 'temple': {
      const s = 10;
      ctx.fillStyle = INK;
      ctx.fillRect(-s, -2, s * 2, s + 2);
      ctx.fillStyle = PARCHMENT;
      for (let i = -s + 2; i < s; i += 5) {
        ctx.fillRect(i, -1, 2, s);
      }
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(-s - 2, -2);
      ctx.lineTo(0, -s - 2);
      ctx.lineTo(s + 2, -2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'monument': {
      const s = 8;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, s);
      ctx.lineTo(-s * 0.25, -s * 0.5);
      ctx.lineTo(0, -s);
      ctx.lineTo(s * 0.25, -s * 0.5);
      ctx.lineTo(s * 0.4, s);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-s * 0.6, s, s * 1.2, 3);
      break;
    }
  }
  ctx.restore();
}

function drawRuinOverlay(
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
): void {
  ctx.fillStyle = 'rgba(40, 30, 20, 0.18)';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(42, 36, 28, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x, cy = y;
    for (let j = 0; j < 4; j++) {
      cx += (rng() - 0.5) * 50;
      cy += (rng() - 0.5) * 50;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Overgrown patches in muted ink-on-parchment.
  ctx.fillStyle = 'rgba(120, 130, 90, 0.22)';
  for (let i = 0; i < 22; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.ellipse(x, y, 5 + rng() * 16, 3 + rng() * 11, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCityLabel(
  ctx: CanvasRenderingContext2D,
  size: number,
  name: string,
): void {
  const upper = name.toUpperCase();
  const fontSize = 22;
  ctx.font = `bold ${fontSize}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Faint parchment halo so the label reads cleanly over fringe glyphs.
  ctx.fillStyle = 'rgba(235, 223, 186, 0.85)';
  const metrics = ctx.measureText(upper);
  const w = metrics.width;
  ctx.fillRect(size / 2 - w / 2 - 8, 10, w + 16, fontSize + 6);

  ctx.fillStyle = INK;
  ctx.fillText(upper, size / 2, 12);
}

