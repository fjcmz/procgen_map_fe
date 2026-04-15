import type { CityMapData, CityEnvironment, CityDistrict, CityBuilding } from './cityMapGenerator';
import { findSharedEdge } from './cityMapGenerator';
import type { BiomeType } from '../types';
import { seededPRNG, createNoiseSamplers, fbm } from '../terrain/noise';

// ── Color helpers ──

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function shiftColor(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${Math.min(255, Math.round(r * factor))},${Math.min(255, Math.round(g * factor))},${Math.min(255, Math.round(b * factor))})`;
}

// ── District color palette ──

const DISTRICT_COLORS: Record<string, string> = {
  civic: '#c4a46a',
  market: '#d4b87a',
  residential: '#c9b08a',
  harbor: '#a0b0a0',
  agricultural: '#a8c878',
  slum: '#b09878',
};

// ── Ground color by biome category ──

function groundColor(biome: BiomeType): string {
  if (biome.includes('DESERT') || biome === 'SUBTROPICAL_DESERT') return '#d9c084';
  if (biome === 'SNOW' || biome === 'ICE') return '#dde4e8';
  if (biome === 'TUNDRA') return '#b8c0a8';
  if (biome.includes('FOREST') || biome.includes('RAIN') || biome === 'TAIGA') return '#a0b070';
  if (biome === 'MARSH') return '#7a9a6a';
  if (biome === 'GRASSLAND' || biome === 'SHRUBLAND') return '#b0c080';
  if (biome === 'BEACH') return '#d4c59a';
  if (biome === 'ALPINE_MEADOW') return '#a8c080';
  return '#c0b090'; // default earthy
}

function streetColor(biome: BiomeType): string {
  if (biome.includes('DESERT')) return '#c8b070';
  if (biome === 'SNOW' || biome === 'ICE') return '#c8d0d8';
  return '#9a8a6a';
}

function buildingColor(biome: BiomeType, rng: () => number): string {
  const variation = 0.9 + rng() * 0.2;
  if (biome.includes('DESERT')) return shiftColor('#d4b88a', variation);
  if (biome === 'SNOW' || biome === 'ICE') return shiftColor('#c0c8d0', variation);
  if (biome.includes('FOREST') || biome === 'TAIGA') return shiftColor('#8a7a5a', variation);
  return shiftColor('#b0956a', variation);
}

function roofColor(biome: BiomeType, rng: () => number): string {
  const variation = 0.9 + rng() * 0.2;
  if (biome.includes('DESERT')) return shiftColor('#c09060', variation);
  if (biome === 'SNOW' || biome === 'ICE') return shiftColor('#6080a0', variation);
  if (biome.includes('FOREST') || biome === 'TAIGA') return shiftColor('#5a7040', variation);
  return shiftColor('#8a5030', variation);
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

  // Layer 1: Base terrain background with noise texture
  drawBackground(ctx, S, env, noise);

  // Layer 2: Surrounding terrain fringe
  drawFringe(ctx, S, env, rng);

  // Layer 3: Water (coastal side)
  if (env.isCoastal && env.waterSide) {
    drawCoastalWater(ctx, S, env, noise);
  }

  // Layer 4: District fills
  drawDistricts(ctx, data.districts, env, rng, noise);

  // Layer 5: Streets (Voronoi edges between districts)
  drawStreets(ctx, data.districts, env);

  // Layer 6: Main roads
  drawMainRoads(ctx, data.mainRoads, env);

  // Layer 7: River
  if (data.river) {
    drawRiver(ctx, data.river, env);
  }

  // Layer 8: Bridges
  for (const bridge of data.bridges) {
    drawBridge(ctx, bridge, env);
  }

  // Layer 9: Walls
  if (data.walls) {
    drawWalls(ctx, data.walls, data.gates, env);
  }

  // Layer 10: Buildings
  drawBuildings(ctx, data.buildings, env, rng);

  // Layer 11: Landmarks
  for (const lm of data.landmarks) {
    drawLandmark(ctx, lm.x, lm.y, lm.type, env);
  }

  // Layer 12: Ruin overlay
  if (env.isRuin) {
    drawRuinOverlay(ctx, S, rng);
  }

  // Layer 13: City name label
  drawCityLabel(ctx, S, cityName, env);
}

// ── Layer implementations ──

function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: number,
  env: CityEnvironment,
  noise: { elevation: (x: number, y: number) => number },
): void {
  const base = groundColor(env.biome);
  const [br, bg, bb] = parseHex(base.startsWith('#') ? base : '#c0b090');

  // Draw with noise-modulated color for texture
  const step = 4;
  for (let x = 0; x < size; x += step) {
    for (let y = 0; y < size; y += step) {
      const n = fbm(noise.elevation, x * 0.008, y * 0.008, 3);
      const factor = 0.85 + n * 0.3;
      const r = Math.min(255, Math.round(br * factor));
      const g = Math.min(255, Math.round(bg * factor));
      const b = Math.min(255, Math.round(bb * factor));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, step, step);
    }
  }
}

function drawFringe(
  ctx: CanvasRenderingContext2D,
  size: number,
  env: CityEnvironment,
  rng: () => number,
): void {
  const margin = size * 0.15;

  // Draw trees in fringe for forest biomes
  const isForest = env.biome.includes('FOREST') || env.biome === 'TAIGA' || env.biome === 'SHRUBLAND';
  if (isForest) {
    const treeCount = 60 + Math.floor(rng() * 40);
    for (let i = 0; i < treeCount; i++) {
      const x = rng() * size;
      const y = rng() * size;
      // Only in fringe area (outside the city core)
      const dx = x - size / 2;
      const dy = y - size / 2;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);
      if (distFromCenter < size * 0.35) continue;

      const treeSize = 4 + rng() * 4;
      const green = env.biome === 'TAIGA' ? '#4a7848' : '#3a6830';
      ctx.fillStyle = shiftColor(green, 0.85 + rng() * 0.3);
      ctx.beginPath();
      ctx.moveTo(x, y - treeSize);
      ctx.lineTo(x - treeSize * 0.6, y + treeSize * 0.4);
      ctx.lineTo(x + treeSize * 0.6, y + treeSize * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Sand dunes for desert biomes
  const isDesert = env.biome.includes('DESERT');
  if (isDesert) {
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.3)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      const y = margin * 0.5 + rng() * (size - margin);
      const x = rng() * size;
      const dx = x - size / 2;
      const dy = y - size / 2;
      if (Math.sqrt(dx * dx + dy * dy) < size * 0.35) continue;
      ctx.beginPath();
      ctx.arc(x, y, 15 + rng() * 20, 0, Math.PI, false);
      ctx.stroke();
    }
  }

  // Snow/ice patches for cold biomes
  const isCold = env.biome === 'SNOW' || env.biome === 'ICE' || env.biome === 'TUNDRA';
  if (isCold) {
    for (let i = 0; i < 30; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const dx = x - size / 2;
      const dy = y - size / 2;
      if (Math.sqrt(dx * dx + dy * dy) < size * 0.35) continue;
      ctx.fillStyle = `rgba(220, 230, 240, ${0.3 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 8 + rng() * 12, 4 + rng() * 8, rng() * Math.PI, 0, Math.PI * 2);
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
  const waterColor = '#4a7fa5';
  const shoreColor = '#5b9abf';

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
  _env: CityEnvironment,
  _rng: () => number,
  noise: { elevation: (x: number, y: number) => number },
): void {
  for (const d of districts) {
    const baseColor = DISTRICT_COLORS[d.role] ?? '#c9b08a';
    const n = fbm(noise.elevation, d.x * 0.01, d.y * 0.01, 2);
    const variation = 0.92 + n * 0.16;
    ctx.fillStyle = shiftColor(baseColor, variation);

    ctx.beginPath();
    const v = d.vertices;
    if (v.length < 3) continue;
    ctx.moveTo(v[0][0], v[0][1]);
    for (let i = 1; i < v.length; i++) {
      ctx.lineTo(v[i][0], v[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawStreets(
  ctx: CanvasRenderingContext2D,
  districts: CityDistrict[],
  env: CityEnvironment,
): void {
  ctx.strokeStyle = streetColor(env.biome);
  ctx.lineWidth = 1.2;

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
  env: CityEnvironment,
): void {
  ctx.strokeStyle = streetColor(env.biome);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const road of mainRoads) {
    if (road.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(road[0][0], road[0][1]);
    if (road.length === 3) {
      // Quadratic curve through midpoint
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
  env: CityEnvironment,
): void {
  const waterBlue = env.temperature < 0.2 ? '#8ab0c8' : '#4a88b0';

  ctx.strokeStyle = waterBlue;
  ctx.lineWidth = river.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  const p = river.path;
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) {
    // Smooth with quadratic curves between midpoints
    if (i < p.length - 1) {
      const mx = (p[i][0] + p[i + 1][0]) / 2;
      const my = (p[i][1] + p[i + 1][1]) / 2;
      ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
    } else {
      ctx.lineTo(p[i][0], p[i][1]);
    }
  }
  ctx.stroke();

  // River bank highlights
  ctx.strokeStyle = 'rgba(80, 120, 160, 0.3)';
  ctx.lineWidth = river.width + 3;
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
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawBridge(
  ctx: CanvasRenderingContext2D,
  bridge: [number, number][],
  _env: CityEnvironment,
): void {
  if (bridge.length < 2) return;
  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bridge[0][0], bridge[0][1]);
  ctx.lineTo(bridge[1][0], bridge[1][1]);
  ctx.stroke();

  // Bridge railing
  ctx.strokeStyle = '#6a5a3a';
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
  const wallColor = env.biome === 'SNOW' || env.biome === 'ICE' ? '#a0a8b0' : '#6a5a3a';
  const isDouble = env.size === 'megalopolis';

  // Outer wall
  if (isDouble) {
    const outerWall = walls.map(([x, y]) => {
      const cx = 250, cy = 250;
      const dx = x - cx, dy = y - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      return [x + (dx / len) * 8, y + (dy / len) * 8] as [number, number];
    });
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(outerWall[0][0], outerWall[0][1]);
    for (let i = 1; i < outerWall.length; i++) {
      ctx.lineTo(outerWall[i][0], outerWall[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Main wall
  ctx.strokeStyle = wallColor;
  ctx.lineWidth = isDouble ? 3 : 4;
  ctx.beginPath();
  ctx.moveTo(walls[0][0], walls[0][1]);
  for (let i = 1; i < walls.length; i++) {
    ctx.lineTo(walls[i][0], walls[i][1]);
  }
  ctx.closePath();
  ctx.stroke();

  // Towers at corners for large+ cities
  const hasTowers = env.size === 'large' || env.size === 'metropolis' || env.size === 'megalopolis';
  if (hasTowers) {
    ctx.fillStyle = wallColor;
    for (const [wx, wy] of walls) {
      ctx.beginPath();
      ctx.arc(wx, wy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a3a2a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Gate markers
  for (const [gx, gy] of gates) {
    ctx.fillStyle = '#c0a060';
    ctx.fillRect(gx - 4, gy - 4, 8, 8);
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(gx - 4, gy - 4, 8, 8);
  }
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  buildings: CityBuilding[],
  env: CityEnvironment,
  rng: () => number,
): void {
  for (const b of buildings) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);

    // Building body
    ctx.fillStyle = buildingColor(env.biome, rng);
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);

    // Roof (top portion)
    ctx.fillStyle = roofColor(env.biome, rng);
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * 0.35);

    // Outline
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);

    ctx.restore();
  }
}

function drawLandmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: 'castle' | 'temple' | 'monument',
  _env: CityEnvironment,
): void {
  ctx.save();
  ctx.translate(x, y);

  switch (type) {
    case 'castle': {
      const s = 16;
      // Castle base
      ctx.fillStyle = '#5a4a2a';
      ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
      // Towers
      ctx.fillRect(-s - 3, -s, 6, s * 1.6);
      ctx.fillRect(s - 3, -s, 6, s * 1.6);
      // Battlements
      for (let i = -s; i < s; i += 5) {
        ctx.fillRect(i, -s * 0.6 - 3, 3, 3);
      }
      // Tower tops
      ctx.fillRect(-s - 4, -s - 3, 8, 3);
      ctx.fillRect(s - 4, -s - 3, 8, 3);
      // Gate
      ctx.fillStyle = '#2a1a0a';
      ctx.beginPath();
      ctx.arc(0, s * 0.6, 4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-4, s * 0.1, 8, s * 0.5);
      // Outline
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 1;
      ctx.strokeRect(-s, -s * 0.6, s * 2, s * 1.2);
      break;
    }
    case 'temple': {
      const s = 10;
      // Base
      ctx.fillStyle = '#c0a870';
      ctx.fillRect(-s, -2, s * 2, s + 2);
      // Columns
      ctx.fillStyle = '#d8c890';
      for (let i = -s + 2; i < s; i += 5) {
        ctx.fillRect(i, -2, 2, s + 2);
      }
      // Roof triangle
      ctx.fillStyle = '#a08050';
      ctx.beginPath();
      ctx.moveTo(-s - 2, -2);
      ctx.lineTo(0, -s - 2);
      ctx.lineTo(s + 2, -2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#6a5a3a';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'monument': {
      const s = 8;
      // Obelisk
      ctx.fillStyle = '#d0c090';
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, s);
      ctx.lineTo(-s * 0.25, -s * 0.5);
      ctx.lineTo(0, -s);
      ctx.lineTo(s * 0.25, -s * 0.5);
      ctx.lineTo(s * 0.4, s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8a7a5a';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Base
      ctx.fillStyle = '#a09070';
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
  // Semi-transparent dark overlay
  ctx.fillStyle = 'rgba(40, 30, 20, 0.2)';
  ctx.fillRect(0, 0, size, size);

  // Crack lines
  ctx.strokeStyle = 'rgba(30, 20, 10, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x, cy = y;
    for (let j = 0; j < 4; j++) {
      cx += (rng() - 0.5) * 40;
      cy += (rng() - 0.5) * 40;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Overgrown patches
  ctx.fillStyle = 'rgba(60, 80, 40, 0.25)';
  for (let i = 0; i < 20; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.ellipse(x, y, 5 + rng() * 15, 3 + rng() * 10, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCityLabel(
  ctx: CanvasRenderingContext2D,
  size: number,
  name: string,
  _env: CityEnvironment,
): void {
  const fontSize = 16;
  ctx.font = `bold ${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Text shadow/outline
  ctx.fillStyle = 'rgba(255, 245, 230, 0.85)';
  const metrics = ctx.measureText(name);
  const textWidth = metrics.width;
  ctx.fillRect(size / 2 - textWidth / 2 - 6, 8, textWidth + 12, fontSize + 8);

  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(size / 2 - textWidth / 2 - 6, 8, textWidth + 12, fontSize + 8);

  // Text
  ctx.fillStyle = '#2a1a00';
  ctx.fillText(name, size / 2, 12);
}

