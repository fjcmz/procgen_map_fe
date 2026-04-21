import type { CityEnvironment, CityMapData, CitySize } from './cityMapTypes';

const INK = '#2a241c';

const SIZE_TIER: Record<CitySize, number> = {
  small: 0,
  medium: 0.25,
  large: 0.5,
  metropolis: 0.75,
  megalopolis: 1,
};

// PR 2: adds layer 11 (walls + towers + gate gaps with door dashes) on top of
// the PR 1 base (layers 1, 2) and under the title (layer 14). Other layers
// land in PRs 3-5.
export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapData,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
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

  // Layer 11: walls + towers + gates.
  drawWallsAndGates(ctx, data, env);

  // Layer 14: city name at top-center.
  ctx.fillStyle = INK;
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(cityName, size / 2, 16);
}

function gateEdgeKey(a: [number, number], b: [number, number]): string {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax < bx || (ax === bx && ay <= by)) {
    return `${ax},${ay}-${bx},${by}`;
  }
  return `${bx},${by}-${ax},${ay}`;
}

function drawWallsAndGates(
  ctx: CanvasRenderingContext2D,
  data: CityMapData,
  env: CityEnvironment,
): void {
  const path = data.wallPath;
  if (path.length < 3) return;

  const { tileSize } = data.grid;
  const tier = SIZE_TIER[env.size];
  const strokeWidth = 3 + Math.round(tier * 2); // 3..5 px across size tiers
  const towerRadius = strokeWidth * 1.1;

  const gateKeys = new Set<string>();
  for (const g of data.gates) {
    gateKeys.add(gateEdgeKey(g.edge[0], g.edge[1]));
  }

  const toPx = (p: [number, number]): [number, number] => [
    p[0] * tileSize,
    p[1] * tileSize,
  ];

  // Wall stroke: expand each simplified segment into unit-length grid-corner
  // steps, skipping any unit-edge that matches a gate (leaves the gap).
  ctx.strokeStyle = INK;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    strokeSegmentWithGates(ctx, a, b, gateKeys, toPx);
  }
  ctx.stroke();

  // Tower circles at every simplified corner.
  ctx.fillStyle = INK;
  for (const p of path) {
    const [px, py] = toPx(p);
    ctx.beginPath();
    ctx.arc(px, py, towerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gate door dashes: two inward-pointing ticks flanking each gate opening.
  if (data.gates.length > 0) {
    const gridCenter = data.grid.w / 2;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const g of data.gates) {
      drawDoorDashes(ctx, g.edge, gridCenter, tileSize);
    }
    ctx.stroke();
  }
}

function strokeSegmentWithGates(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  gateKeys: Set<string>,
  toPx: (p: [number, number]) => [number, number],
): void {
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  const steps = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);

  let cur: [number, number] = [a[0], a[1]];
  const [sx, sy] = toPx(cur);
  ctx.moveTo(sx, sy);

  for (let k = 0; k < steps; k++) {
    const next: [number, number] = [cur[0] + dx, cur[1] + dy];
    if (gateKeys.has(gateEdgeKey(cur, next))) {
      // Break the stroke across the gate opening.
      const [nx, ny] = toPx(next);
      ctx.moveTo(nx, ny);
    } else {
      const [nx, ny] = toPx(next);
      ctx.lineTo(nx, ny);
    }
    cur = next;
  }
}

function drawDoorDashes(
  ctx: CanvasRenderingContext2D,
  edge: [[number, number], [number, number]],
  gridCenter: number,
  tileSize: number,
): void {
  const [a, b] = edge;
  const horizontal = a[1] === b[1];
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  // Inward normal points from the edge midpoint toward the grid centre.
  const inwardX = horizontal ? 0 : Math.sign(gridCenter - midX) || 1;
  const inwardY = horizontal ? Math.sign(gridCenter - midY) || 1 : 0;

  const dashLen = tileSize * 0.45;
  for (const end of [a, b]) {
    const ex = end[0] * tileSize;
    const ey = end[1] * tileSize;
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + inwardX * dashLen, ey + inwardY * dashLen);
  }
}
