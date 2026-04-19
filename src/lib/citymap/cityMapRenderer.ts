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
