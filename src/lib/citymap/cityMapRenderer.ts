import type { CityMapData, CityEnvironment } from './cityMapGenerator';
import { seededPRNG } from '../terrain/noise';

// ── Palette tokens ──

const FLAT_PAPER = '#ece5d3';
const INK = '#2a241c';
const PARCHMENT = '#ebdfba'; // ruin overlay + label halo

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

  ctx.clearRect(0, 0, S, S);

  // Layer 1: flat paper background
  ctx.fillStyle = FLAT_PAPER;
  ctx.fillRect(0, 0, S, S);

  // Layer 2: faint cadastral grid (4-tile groupings ≈ 180 px for 720 px canvas)
  drawCadastralGrid(ctx, S, data.grid);

  // Layer 11: walls + towers + gates
  drawWalls(ctx, data);

  // Ruin overlay
  if (env.isRuin) drawRuinOverlay(ctx, S, rng);

  // Layer 14: city name
  drawCityLabel(ctx, S, cityName);
}

// ── Layer implementations ──

function drawCadastralGrid(
  ctx: CanvasRenderingContext2D,
  size: number,
  grid: { w: number; tileSize: number },
): void {
  const spacing = Math.floor(grid.w / 4) * grid.tileSize;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
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

function drawWalls(ctx: CanvasRenderingContext2D, data: CityMapData): void {
  if (data.wallPath.length < 2) return;
  const { tileSize, w: gridW } = data.grid;
  const px = (c: [number, number]): [number, number] => [c[0] * tileSize, c[1] * tileSize];

  // Wall thickness scales gently with grid density (3 px on tiny grids → 5 px on big ones).
  const wallWidth = Math.max(3, Math.min(5, Math.round(tileSize * 0.22)));

  // Gate edges to skip when stroking the wall.
  const gateKeys = new Set<string>();
  for (const g of data.gates) {
    const [a, b] = g.edge;
    gateKeys.add(`${a[0]},${a[1]}|${b[0]},${b[1]}`);
    gateKeys.add(`${b[0]},${b[1]}|${a[0]},${a[1]}`);
  }

  // Stroke wall segments (skipping gate gaps).
  ctx.strokeStyle = INK;
  ctx.lineWidth = wallWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < data.wallPath.length - 1; i++) {
    const a = data.wallPath[i];
    const b = data.wallPath[i + 1];
    const k = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
    if (gateKeys.has(k)) continue;
    const [ax, ay] = px(a);
    const [bx, by] = px(b);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  // Tower circles at convex corners (where the wall turns clockwise = outward bump).
  const towerR = Math.max(2.5, wallWidth * 0.85);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  const seen = new Set<string>();
  const len = data.wallPath.length;
  // wallPath is closed (last == first). Use modular indexing on len-1 unique nodes.
  const n = len - 1;
  for (let i = 0; i < n; i++) {
    const prev = data.wallPath[(i - 1 + n) % n];
    const curr = data.wallPath[i];
    const next = data.wallPath[(i + 1) % n];
    const dx1 = curr[0] - prev[0];
    const dy1 = curr[1] - prev[1];
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];
    if (dx1 === dx2 && dy1 === dy2) continue; // straight, no turn
    // CW turn (convex bump) on a y-down screen has positive cross product.
    const cross = dx1 * dy2 - dy1 * dx2;
    if (cross <= 0) continue;
    const k = `${curr[0]},${curr[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [cx, cy] = px(curr);
    ctx.beginPath();
    ctx.arc(cx, cy, towerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Always plant a tower flanking each gate so the opening reads clearly.
  for (const g of data.gates) {
    for (const c of g.edge) {
      const k = `${c[0]},${c[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const [cx, cy] = px(c);
      ctx.beginPath();
      ctx.arc(cx, cy, towerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Gate door dashes: short tick marks on each side of the gap, perpendicular to the wall.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, wallWidth * 0.5);
  for (const g of data.gates) {
    const [a, b] = g.edge;
    const [ax, ay] = px(a);
    const [bx, by] = px(b);
    const ex = bx - ax;
    const ey = by - ay;
    const elen = Math.hypot(ex, ey) || 1;
    // Inward perpendicular (toward city center) for visual cue.
    const cxTile = (gridW - 1) / 2;
    const cyTile = (gridW - 1) / 2;
    const midTx = (a[0] + b[0]) / 2;
    const midTy = (a[1] + b[1]) / 2;
    let nx = -ey / elen;
    let ny = ex / elen;
    if ((cxTile - midTx) * nx + (cyTile - midTy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const dashLen = tileSize * 0.45;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + nx * dashLen, ay + ny * dashLen);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + nx * dashLen, by + ny * dashLen);
    ctx.stroke();
  }
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

  ctx.fillStyle = `rgba(${parseInt(PARCHMENT.slice(1, 3), 16)}, ${parseInt(PARCHMENT.slice(3, 5), 16)}, ${parseInt(PARCHMENT.slice(5, 7), 16)}, 0.85)`;
  const metrics = ctx.measureText(upper);
  const w = metrics.width;
  ctx.fillRect(size / 2 - w / 2 - 8, 10, w + 16, fontSize + 6);

  ctx.fillStyle = INK;
  ctx.fillText(upper, size / 2, 12);
}
