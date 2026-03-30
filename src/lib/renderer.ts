import type { MapData, LayerVisibility, Cell } from './types';
import { BIOME_INFO } from './biomes';
import { getNoisyEdge, initNoisyEdges } from './noisyEdges';

// Kingdom colors (semi-transparent fills and border strokes)
const KINGDOM_COLORS = [
  { fill: 'rgba(220,80,80,0.12)',  stroke: '#c04040' },
  { fill: 'rgba(80,120,220,0.12)', stroke: '#3060b0' },
  { fill: 'rgba(80,190,80,0.12)',  stroke: '#308030' },
  { fill: 'rgba(220,160,40,0.12)', stroke: '#a07020' },
  { fill: 'rgba(160,80,200,0.12)', stroke: '#804090' },
];

function cellPath(ctx: CanvasRenderingContext2D, cell: Cell): void {
  const verts = cell.vertices;
  if (verts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(verts[0][0], verts[0][1]);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i][0], verts[i][1]);
  }
  ctx.closePath();
}

function drawBiomeFill(ctx: CanvasRenderingContext2D, cells: Cell[]): void {
  // Draw land first, water last — ensures water always wins at shared polygon edges
  // regardless of cell index order (which has no spatial meaning in Voronoi).
  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;
    ctx.fillStyle = BIOME_INFO[cell.biome].fillColor;
    cellPath(ctx, cell);
    ctx.fill();
  }
  for (const cell of cells) {
    if (!cell.isWater || cell.vertices.length < 2) continue;
    ctx.fillStyle = BIOME_INFO[cell.biome].fillColor;
    cellPath(ctx, cell);
    ctx.fill();
  }
}

function drawWaterDepth(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  width: number,
  height: number
): void {
  for (const cell of cells) {
    if (!cell.isWater || cell.vertices.length < 2) continue;
    const depth = Math.max(0, 1 - cell.elevation / 0.4); // 0=shallow, 1=deep
    const alpha = depth * 0.3;
    ctx.fillStyle = `rgba(20,50,100,${alpha.toFixed(3)})`;
    cellPath(ctx, cell);
    ctx.fill();
  }
  // Suppress unused parameter warning
  void width; void height;
}

function isCoastEdge(cell: Cell, cells: Cell[], ni: number): boolean {
  return cell.isWater !== cells[ni].isWater;
}

function drawNoisyCoastlines(
  ctx: CanvasRenderingContext2D,
  cells: Cell[]
): void {
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawnPairs = new Set<string>();

  for (const cell of cells) {
    if (!cell.isWater) continue; // draw from water side
    for (const ni of cell.neighbors) {
      if (!isCoastEdge(cell, cells, ni)) continue;
      const key = [cell.index, ni].sort().join('-');
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      // Find shared edge vertices between the two cells
      const other = cells[ni];
      const sharedVerts = cell.vertices.filter(v =>
        other.vertices.some(v2 => Math.abs(v[0] - v2[0]) < 0.5 && Math.abs(v[1] - v2[1]) < 0.5)
      );
      if (sharedVerts.length < 2) continue;

      const pts = getNoisyEdge(sharedVerts[0], sharedVerts[1], 3, 0.3);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }
  }
}

function drawRivers(
  ctx: CanvasRenderingContext2D,
  data: MapData
): void {
  const { cells, rivers } = data;
  ctx.strokeStyle = '#4a7fa5';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const river of rivers) {
    if (river.path.length < 2) continue;
    ctx.lineWidth = river.width;
    ctx.beginPath();
    const first = cells[river.path[0]];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < river.path.length; i++) {
      const c = cells[river.path[i]];
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
  }
}

function drawKingdomBorders(
  ctx: CanvasRenderingContext2D,
  cells: Cell[]
): void {
  // Fill kingdom regions
  for (const cell of cells) {
    if (cell.kingdom === null || cell.isWater || cell.vertices.length < 2) continue;
    const kc = KINGDOM_COLORS[cell.kingdom % KINGDOM_COLORS.length];
    ctx.fillStyle = kc.fill;
    cellPath(ctx, cell);
    ctx.fill();
  }

  // Draw border edges
  const drawnPairs = new Set<string>();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;

  for (const cell of cells) {
    if (cell.isWater) continue;
    for (const ni of cell.neighbors) {
      const neighbor = cells[ni];
      if (neighbor.isWater) continue;
      if (cell.kingdom === neighbor.kingdom) continue;
      const key = [cell.index, ni].sort().join('-');
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const sharedVerts = cell.vertices.filter(v =>
        neighbor.vertices.some(v2 => Math.abs(v[0] - v2[0]) < 0.5 && Math.abs(v[1] - v2[1]) < 0.5)
      );
      if (sharedVerts.length < 2) continue;

      const kc = cell.kingdom !== null
        ? KINGDOM_COLORS[cell.kingdom % KINGDOM_COLORS.length]
        : { stroke: '#888' };
      ctx.strokeStyle = kc.stroke;
      ctx.beginPath();
      ctx.moveTo(sharedVerts[0][0], sharedVerts[0][1]);
      ctx.lineTo(sharedVerts[1][0], sharedVerts[1][1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function drawRoads(ctx: CanvasRenderingContext2D, data: MapData): void {
  const { cells, roads } = data;
  ctx.strokeStyle = '#8b6040';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([4, 3]);

  for (const road of roads) {
    if (road.path.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(cells[road.path[0]].x, cells[road.path[0]].y);
    for (let i = 1; i < road.path.length; i++) {
      ctx.lineTo(cells[road.path[i]].x, cells[road.path[i]].y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawMountainIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
): void {
  ctx.fillStyle = '#8a7060';
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 0.8;
  // Left peak
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s * 0.2, y - s * 0.8);
  ctx.lineTo(x + s * 0.4, y + s * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right peak (bigger)
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y + s * 0.5);
  ctx.lineTo(x + s * 0.5, y - s);
  ctx.lineTo(x + s * 1.1, y + s * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Snow caps
  ctx.fillStyle = '#e8e8f0';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y - s);
  ctx.lineTo(x + s * 0.2, y - s * 0.5);
  ctx.lineTo(x + s * 0.8, y - s * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawTreeIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
): void {
  ctx.fillStyle = '#3a6030';
  ctx.strokeStyle = '#2a4020';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x - s * 0.7, y + s * 0.3);
  ctx.lineTo(x - s * 0.3, y + s * 0.3);
  ctx.lineTo(x - s * 0.4, y + s);
  ctx.lineTo(x + s * 0.4, y + s);
  ctx.lineTo(x + s * 0.3, y + s * 0.3);
  ctx.lineTo(x + s * 0.7, y + s * 0.3);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawDesertIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
): void {
  // Cactus
  ctx.fillStyle = '#6a9040';
  ctx.strokeStyle = '#4a6020';
  ctx.lineWidth = 0.8;
  // Trunk
  ctx.fillRect(x - s * 0.2, y - s * 0.5, s * 0.4, s * 1.2);
  // Arms
  ctx.fillRect(x - s * 0.7, y - s * 0.1, s * 0.5, s * 0.25);
  ctx.fillRect(x + s * 0.2, y + s * 0.1, s * 0.5, s * 0.25);
}

function drawSnowIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
): void {
  ctx.strokeStyle = '#a0b8d0';
  ctx.lineWidth = 1;
  // Simple snowflake (6 lines)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * s, y + Math.sin(angle) * s);
    ctx.stroke();
  }
}

function drawCityIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  isCapital: boolean
): void {
  if (isCapital) {
    // Castle silhouette
    ctx.fillStyle = '#c8a060';
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 1;
    ctx.fillRect(x - s, y - s * 0.3, s * 2, s * 1.1);
    // Battlements
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(x + i * s * 0.6 - s * 0.15, y - s * 0.8, s * 0.3, s * 0.5);
    }
    ctx.strokeRect(x - s, y - s * 0.3, s * 2, s * 1.1);
  } else {
    // Simple tower
    ctx.fillStyle = '#d4b880';
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 0.8;
    ctx.fillRect(x - s * 0.4, y - s * 0.5, s * 0.8, s * 1.2);
    ctx.fillRect(x - s * 0.6, y - s * 0.9, s * 0.3, s * 0.5);
    ctx.fillRect(x + s * 0.3, y - s * 0.9, s * 0.3, s * 0.5);
    ctx.strokeRect(x - s * 0.4, y - s * 0.5, s * 0.8, s * 1.2);
  }
}

function drawIcons(
  ctx: CanvasRenderingContext2D,
  data: MapData
): void {
  const { cells, cities } = data;
  const citySet = new Set(cities.map(c => c.cellIndex));
  const iconSize = Math.max(4, Math.min(8, data.width / 150));

  // Biome icons (sample ~20% of cells for density control)
  for (const cell of cells) {
    if (cell.isWater || citySet.has(cell.index)) continue;
    const info = BIOME_INFO[cell.biome];
    if (!info.iconType) continue;
    // Sample every ~5th cell based on index
    if (cell.index % 5 !== 0) continue;

    const s = iconSize;
    switch (info.iconType) {
      case 'mountain': drawMountainIcon(ctx, cell.x, cell.y, s); break;
      case 'tree':     drawTreeIcon(ctx, cell.x, cell.y, s * 0.8); break;
      case 'desert':   drawDesertIcon(ctx, cell.x, cell.y, s * 0.7); break;
      case 'snow':     drawSnowIcon(ctx, cell.x, cell.y, s); break;
    }
  }

  // City icons
  for (const city of cities) {
    const cell = cells[city.cellIndex];
    drawCityIcon(ctx, cell.x, cell.y, iconSize * 1.2, city.isCapital);
  }
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  data: MapData
): void {
  const { cells, cities } = data;
  const fontSize = Math.max(9, Math.min(13, data.width / 100));

  for (const city of cities) {
    const cell = cells[city.cellIndex];
    const fontStyle = city.isCapital ? `bold ${fontSize + 1}px Georgia, serif` : `${fontSize}px Georgia, serif`;
    ctx.font = fontStyle;

    // Shadow
    ctx.fillStyle = 'rgba(255,248,230,0.85)';
    ctx.fillText(city.name, cell.x + 9, cell.y + 4);
    ctx.fillText(city.name, cell.x + 11, cell.y + 4);
    ctx.fillText(city.name, cell.x + 9, cell.y + 6);
    ctx.fillText(city.name, cell.x + 11, cell.y + 6);

    // Text
    ctx.fillStyle = city.isCapital ? '#2a1a00' : '#3a2a10';
    ctx.fillText(city.name, cell.x + 10, cell.y + 5);
  }
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  data: MapData
): void {
  const pad = 10;
  const itemH = 16;
  const boxW = 140;
  const shownBiomes = new Set(data.cells.map(c => c.biome));
  const entries = (Object.entries(BIOME_INFO) as [string, typeof BIOME_INFO[keyof typeof BIOME_INFO]][])
    .filter(([k]) => shownBiomes.has(k as never))
    .slice(0, 14);
  const boxH = pad * 2 + entries.length * itemH + 20;

  const x = pad;
  const y = data.height - boxH - pad;

  ctx.fillStyle = 'rgba(255,248,230,0.88)';
  ctx.strokeStyle = '#8b6040';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 6);
  ctx.fill(); ctx.stroke();

  ctx.font = 'bold 10px Georgia, serif';
  ctx.fillStyle = '#2a1a00';
  ctx.fillText('Biomes', x + pad, y + pad + 10);

  ctx.font = '9px Georgia, serif';
  entries.forEach(([, info], i) => {
    const iy = y + pad + 20 + i * itemH;
    ctx.fillStyle = info.fillColor;
    ctx.fillRect(x + pad, iy, 12, 10);
    ctx.strokeStyle = '#8b6040';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + pad, iy, 12, 10);
    ctx.fillStyle = '#2a1a00';
    ctx.fillText(info.label, x + pad + 16, iy + 9);
  });
}

export function render(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  layers: LayerVisibility,
  seed: string
): void {
  initNoisyEdges(seed);

  const { width, height } = data;
  ctx.clearRect(0, 0, width, height);

  // Parchment background
  ctx.fillStyle = '#f5e9c8';
  ctx.fillRect(0, 0, width, height);

  // Layer 1: Biome fill
  drawBiomeFill(ctx, data.cells);

  // Layer 2: Water depth shading
  drawWaterDepth(ctx, data.cells, width, height);

  // Layer 3: Noisy coastlines
  drawNoisyCoastlines(ctx, data.cells);

  // Layer 4: Rivers
  if (layers.rivers) drawRivers(ctx, data);

  // Layer 5: Kingdom borders
  if (layers.borders) drawKingdomBorders(ctx, data.cells);

  // Layer 6: Roads
  if (layers.roads) drawRoads(ctx, data);

  // Layer 7: Icons (biome + cities)
  if (layers.icons) drawIcons(ctx, data);

  // Layer 8: City labels
  if (layers.labels) drawLabels(ctx, data);

  // Layer 9: Legend
  if (layers.legend) drawLegend(ctx, data);
}
