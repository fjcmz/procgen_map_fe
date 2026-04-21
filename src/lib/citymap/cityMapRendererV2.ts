import type { CityEnvironment, CityMapData } from './cityMapTypes';

// PR 1 foundation: flat-paper base + faint cadastral grid + top-center city
// title. Matches the final 14-layer stack's layers 1, 2, and 14; all other
// layers (walls, river, roads, buildings...) land in PRs 2-5.
export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapData,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
  void env;
  void seed;

  const size = data.canvasSize;
  const { w, tileSize } = data.grid;

  // Layer 1: flat paper background.
  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, size, size);

  // Layer 2: faint cadastral grid every 4 tiles.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k <= w; k += 4) {
    const p = Math.round(k * tileSize) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  // Layer 14: city name at top-center.
  ctx.fillStyle = '#2a241c';
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(cityName, size / 2, 16);
}
