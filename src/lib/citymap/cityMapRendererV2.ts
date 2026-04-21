import type { CityEnvironment, CityMapData } from './cityMapTypes';

// PR 0 skeleton: flat cream canvas + centered city name + a small "V2" tag
// so QA can distinguish V2 from V1 at a glance. PR 1 replaces this with the
// real flat-paper base + cadastral grid.
export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapData,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
  void data;
  void env;
  void seed;

  const size = 720;

  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#2a241c';
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cityName, size / 2, size / 2);

  ctx.fillStyle = '#8a8070';
  ctx.font = '10px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('V2', size - 8, size - 8);
}
