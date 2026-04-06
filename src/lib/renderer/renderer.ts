import type { MapData, MapView, LayerVisibility, Cell, RegionData, HistoryEvent, TradeRouteEntry } from '../types';
import { BIOME_INFO } from '../terrain/biomes';
import { getNoisyEdge, initNoisyEdges } from './noisyEdges';
import { getOwnershipAtYear, getTradesAtYear, getWondersAtYear, getReligionsAtYear } from '../history/history';
import { getResourceCategory } from '../history/physical/Resource';
import type { ResourceType } from '../history/physical/Resource';

// Kingdom colors for terrain view (subtle fills)
const KINGDOM_COLORS_TERRAIN = [
  { fill: 'rgba(220,80,80,0.12)',  stroke: '#c04040' },
  { fill: 'rgba(80,120,220,0.12)', stroke: '#3060b0' },
  { fill: 'rgba(80,190,80,0.12)',  stroke: '#308030' },
  { fill: 'rgba(220,160,40,0.12)', stroke: '#a07020' },
  { fill: 'rgba(160,80,200,0.12)', stroke: '#804090' },
];

// Kingdom colors for political view (stronger fills)
const KINGDOM_COLORS_POLITICAL = [
  { fill: 'rgba(220,80,80,0.35)',  stroke: '#c04040' },
  { fill: 'rgba(80,120,220,0.35)', stroke: '#3060b0' },
  { fill: 'rgba(80,190,80,0.35)',  stroke: '#308030' },
  { fill: 'rgba(220,160,40,0.35)', stroke: '#a07020' },
  { fill: 'rgba(160,80,200,0.35)', stroke: '#804090' },
];

type KingdomColor = { fill: string; stroke: string };

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

    // Spatial hash dither to break horizontal banding
    const hash = Math.sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453;
    const dither = (hash - Math.floor(hash)) * 0.06 - 0.03;

    const alpha = Math.max(0, Math.min(0.3, depth * 0.3 + dither));
    ctx.fillStyle = `rgba(20,50,100,${alpha.toFixed(3)})`;
    cellPath(ctx, cell);
    ctx.fill();
  }
  // Suppress unused parameter warning
  void width; void height;
}

function drawHillshading(
  ctx: CanvasRenderingContext2D,
  cells: Cell[]
): void {
  // Virtual light source: azimuth 315° (NW), altitude 45°
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const lightX = Math.cos(az) * Math.cos(alt);
  const lightY = Math.sin(az) * Math.cos(alt);
  const lightZ = Math.sin(alt);
  const elevScale = 8.0; // exaggerate relief

  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;

    // Estimate gradient from neighbors
    let dzdx = 0;
    let dzdy = 0;
    let weightSum = 0;
    for (const ni of cell.neighbors) {
      const nb = cells[ni];
      if (!nb) continue;
      const dx = nb.x - cell.x;
      const dy = nb.y - cell.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 1e-6) continue;
      const dz = (nb.elevation - cell.elevation) * elevScale;
      const w = 1 / dist2;
      dzdx += dz * dx * w;
      dzdy += dz * dy * w;
      weightSum += w;
    }
    if (weightSum > 0) {
      dzdx /= weightSum;
      dzdy /= weightSum;
    }

    // Surface normal = normalize(-dzdx, -dzdy, 1)
    const nx = -dzdx;
    const ny = -dzdy;
    const nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const illum = (nx * lightX + ny * lightY + nz * lightZ) / len;

    if (illum > 0.5) {
      const alpha = (illum - 0.5) * 0.3;
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    } else {
      const alpha = (0.5 - illum) * 0.4;
      ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
    }
    cellPath(ctx, cell);
    ctx.fill();
  }
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
  cells: Cell[],
  ownershipOverride?: Int16Array,
  colors: KingdomColor[] = KINGDOM_COLORS_TERRAIN
): void {
  const getOwner = (cell: Cell): number | null => {
    if (ownershipOverride) {
      const o = ownershipOverride[cell.index];
      return o >= 0 ? o : null;
    }
    return cell.kingdom;
  };

  // Fill kingdom regions
  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;
    const owner = getOwner(cell);
    if (owner === null) continue;
    const kc = colors[owner % colors.length];
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
    const cellOwner = getOwner(cell);
    for (const ni of cell.neighbors) {
      const neighbor = cells[ni];
      if (neighbor.isWater) continue;
      const neighborOwner = getOwner(neighbor);
      if (cellOwner === neighborOwner) continue;
      const key = [cell.index, ni].sort().join('-');
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const sharedVerts = cell.vertices.filter(v =>
        neighbor.vertices.some(v2 => Math.abs(v[0] - v2[0]) < 0.5 && Math.abs(v[1] - v2[1]) < 0.5)
      );
      if (sharedVerts.length < 2) continue;

      const kc = cellOwner !== null
        ? colors[cellOwner % colors.length]
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
  ctx.fillStyle = '#7a6050';
  ctx.strokeStyle = '#4a3020';
  ctx.lineWidth = 0.8;
  // Background peak (small, behind the others)
  ctx.beginPath();
  ctx.moveTo(x - s * 1.1, y + s * 0.5);
  ctx.lineTo(x - s * 0.6, y - s * 0.5);
  ctx.lineTo(x - s * 0.1, y + s * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Left peak
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s * 0.2, y - s * 0.8);
  ctx.lineTo(x + s * 0.4, y + s * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right peak (biggest)
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y + s * 0.5);
  ctx.lineTo(x + s * 0.5, y - s);
  ctx.lineTo(x + s * 1.1, y + s * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Snow caps on right peak
  ctx.fillStyle = '#e8e8f0';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y - s);
  ctx.lineTo(x + s * 0.2, y - s * 0.5);
  ctx.lineTo(x + s * 0.8, y - s * 0.5);
  ctx.closePath();
  ctx.fill();
  // Snow cap on left peak
  ctx.beginPath();
  ctx.moveTo(x - s * 0.2, y - s * 0.8);
  ctx.lineTo(x - s * 0.45, y - s * 0.4);
  ctx.lineTo(x + s * 0.05, y - s * 0.4);
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

const CITY_SIZE_SCALE: Record<string, number> = {
  small: 0.8,
  medium: 1.0,
  large: 1.4,
  metropolis: 1.9,
  megalopolis: 2.5,
};

function drawCityIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  isCapital: boolean,
  sizeScale: number = 1.0
): void {
  const ss = s * sizeScale;
  if (isCapital) {
    // Castle silhouette
    ctx.fillStyle = '#c8a060';
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 1;
    ctx.fillRect(x - ss, y - ss * 0.3, ss * 2, ss * 1.1);
    // Battlements
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(x + i * ss * 0.6 - ss * 0.15, y - ss * 0.8, ss * 0.3, ss * 0.5);
    }
    ctx.strokeRect(x - ss, y - ss * 0.3, ss * 2, ss * 1.1);
  } else {
    // Simple tower
    ctx.fillStyle = '#d4b880';
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 0.8;
    ctx.fillRect(x - ss * 0.4, y - ss * 0.5, ss * 0.8, ss * 1.2);
    ctx.fillRect(x - ss * 0.6, y - ss * 0.9, ss * 0.3, ss * 0.5);
    ctx.fillRect(x + ss * 0.3, y - ss * 0.9, ss * 0.3, ss * 0.5);
    ctx.strokeRect(x - ss * 0.4, y - ss * 0.5, ss * 0.8, ss * 1.2);
  }
}

function drawIcons(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  selectedYear?: number
): void {
  const { cells, cities } = data;
  const visibleCities = selectedYear === undefined
    ? cities
    : cities.filter(c => c.foundedYear <= selectedYear);
  const citySet = new Set(visibleCities.map(c => c.cellIndex));
  const iconSize = Math.max(4, Math.min(8, data.width / 150));

  // Biome icons (sample ~20% of cells for density control, ~40% for mountains)
  for (const cell of cells) {
    if (cell.isWater || citySet.has(cell.index)) continue;

    // High-elevation cells (>= 0.75) get mountain icons regardless of biome iconType
    const isHighElev = !cell.isWater && cell.elevation >= 0.75;
    const info = BIOME_INFO[cell.biome];

    if (isHighElev) {
      // ~40% density for mountains
      if (cell.index % 5 >= 2) continue;
      // Scale icon size by elevation: higher = bigger
      const elevScale = Math.max(0.8, Math.min(1.4, 0.8 + (cell.elevation - 0.75) * 1.6));
      drawMountainIcon(ctx, cell.x, cell.y, iconSize * elevScale);
    } else if (info.iconType) {
      // ~20% density for other icons
      if (cell.index % 5 !== 0) continue;
      const s = iconSize;
      switch (info.iconType) {
        case 'mountain': drawMountainIcon(ctx, cell.x, cell.y, s); break;
        case 'tree':     drawTreeIcon(ctx, cell.x, cell.y, s * 0.8); break;
        case 'desert':   drawDesertIcon(ctx, cell.x, cell.y, s * 0.7); break;
        case 'snow':     drawSnowIcon(ctx, cell.x, cell.y, s); break;
      }
    }
  }

  // City icons
  for (const city of visibleCities) {
    const cell = cells[city.cellIndex];
    drawCityIcon(ctx, cell.x, cell.y, iconSize * 1.2, city.isCapital, CITY_SIZE_SCALE[city.size] ?? 1.0);
  }
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  selectedYear?: number
): void {
  const { cells, cities } = data;
  const visibleCities = selectedYear === undefined
    ? cities
    : cities.filter(c => c.foundedYear <= selectedYear);
  const fontSize = Math.max(9, Math.min(13, data.width / 100));

  for (const city of visibleCities) {
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

function drawRegionBorders(
  ctx: CanvasRenderingContext2D,
  cells: Cell[]
): void {
  ctx.strokeStyle = 'rgba(100,80,50,0.35)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([]);

  const drawnPairs = new Set<string>();

  for (const cell of cells) {
    if (cell.isWater || !cell.regionId) continue;
    for (const ni of cell.neighbors) {
      const neighbor = cells[ni];
      if (neighbor.isWater) continue;
      if (!neighbor.regionId || neighbor.regionId === cell.regionId) continue;
      const key = cell.index < ni ? `${cell.index}-${ni}` : `${ni}-${cell.index}`;
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const sharedVerts = cell.vertices.filter(v =>
        neighbor.vertices.some(v2 => Math.abs(v[0] - v2[0]) < 0.5 && Math.abs(v[1] - v2[1]) < 0.5)
      );
      if (sharedVerts.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(sharedVerts[0][0], sharedVerts[0][1]);
      ctx.lineTo(sharedVerts[1][0], sharedVerts[1][1]);
      ctx.stroke();
    }
  }
}

function drawStrategicIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // Pickaxe: two rects forming a cross
  ctx.fillStyle = '#555';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  // Vertical bar
  ctx.fillRect(x - s * 0.15, y - s * 0.6, s * 0.3, s * 1.2);
  // Horizontal bar
  ctx.fillRect(x - s * 0.6, y - s * 0.15, s * 1.2, s * 0.3);
  ctx.strokeRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 1.2);
}

function drawAgriculturalIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // Wheat stalk: vertical stem with diagonal seeds
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + s);
  ctx.lineTo(x, y - s);
  ctx.stroke();
  // Grains branching out
  const offsets = [-0.7, -0.35, 0, 0.35, 0.7];
  for (const dy of offsets) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * s);
    ctx.lineTo(x - s * 0.45, y + dy * s - s * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + dy * s);
    ctx.lineTo(x + s * 0.45, y + dy * s - s * 0.2);
    ctx.stroke();
  }
}

function drawLuxuryIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 6-pointed sparkle (lines radiating from center)
  ctx.strokeStyle = '#d4a017';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * s * 0.3, y + Math.sin(angle) * s * 0.3);
    ctx.lineTo(x + Math.cos(angle) * s, y + Math.sin(angle) * s);
    ctx.stroke();
  }
  // Center dot
  ctx.fillStyle = '#d4a017';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawResources(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  regions: RegionData[]
): void {
  const iconSize = 5;

  for (const region of regions) {
    if (!region.primaryResourceType || region.cellIndices.length === 0) continue;

    // Find center cell: cell nearest the median x/y of the region
    let sumX = 0, sumY = 0;
    for (const ci of region.cellIndices) {
      sumX += cells[ci].x;
      sumY += cells[ci].y;
    }
    const mx = sumX / region.cellIndices.length;
    const my = sumY / region.cellIndices.length;

    let bestDist = Infinity;
    let centerCell = cells[region.cellIndices[0]];
    for (const ci of region.cellIndices) {
      const c = cells[ci];
      const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
      if (d < bestDist) { bestDist = d; centerCell = c; }
    }

    if (centerCell.isWater) continue;

    const category = getResourceCategory(region.primaryResourceType as ResourceType);
    switch (category) {
      case 'strategic':    drawStrategicIcon(ctx, centerCell.x, centerCell.y, iconSize); break;
      case 'agricultural': drawAgriculturalIcon(ctx, centerCell.x, centerCell.y, iconSize); break;
      case 'luxury':       drawLuxuryIcon(ctx, centerCell.x, centerCell.y, iconSize); break;
    }
  }
}

/** Draw active trade route lines between city pairs (persistent state layer). */
function drawTradeRoutes(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  tradeRoutes: TradeRouteEntry[],
): void {
  if (tradeRoutes.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#c8a020';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([4, 6]);
  for (const route of tradeRoutes) {
    if (route.path && route.path.length >= 2) {
      // Draw multi-segment pathfound route (coastal-hugging / island-hopping)
      ctx.beginPath();
      ctx.moveTo(cells[route.path[0]].x, cells[route.path[0]].y);
      for (let i = 1; i < route.path.length; i++) {
        ctx.lineTo(cells[route.path[i]].x, cells[route.path[i]].y);
      }
      ctx.stroke();
    } else {
      // Fallback: straight line between endpoints
      const c1 = cells[route.cell1];
      const c2 = cells[route.cell2];
      if (!c1 || !c2) continue;
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw a ★ badge above cities with standing wonders. */
function drawWonderBadges(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  wonderCells: number[],
): void {
  if (wonderCells.length === 0) return;
  ctx.save();
  ctx.font = 'bold 11px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ci of wonderCells) {
    const cell = cells[ci];
    if (!cell) continue;
    // Gold star above city
    ctx.fillStyle = '#d4a800';
    ctx.strokeStyle = '#7a5500';
    ctx.lineWidth = 0.5;
    ctx.fillText('★', cell.x, cell.y - 14);
    ctx.strokeText('★', cell.x, cell.y - 14);
  }
  ctx.restore();
}

/** Draw a small ✦ beside cities with active religions. */
function drawReligionMarkers(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  religionCells: number[],
): void {
  if (religionCells.length === 0) return;
  ctx.save();
  ctx.font = '9px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ci of religionCells) {
    const cell = cells[ci];
    if (!cell) continue;
    ctx.fillStyle = '#8040a0';
    ctx.strokeStyle = '#400060';
    ctx.lineWidth = 0.5;
    ctx.fillText('✦', cell.x + 10, cell.y - 6);
    ctx.strokeText('✦', cell.x + 10, cell.y - 6);
  }
  ctx.restore();
}

/** Draw type-specific icons/effects for events that occurred at the currently selected year. */
function drawCurrentYearEvents(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  events: HistoryEvent[],
): void {
  if (events.length === 0) return;
  ctx.save();

  for (const ev of events) {
    const locCell = ev.locationCellIndex !== undefined ? cells[ev.locationCellIndex] : undefined;
    const tgtCell = ev.targetCellIndex !== undefined ? cells[ev.targetCellIndex] : undefined;

    switch (ev.type) {
      case 'FOUNDATION': {
        if (!locCell) break;
        // Pulsing ring around the new city
        ctx.beginPath();
        ctx.arc(locCell.x, locCell.y, 16, 0, Math.PI * 2);
        ctx.strokeStyle = '#c07820';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(locCell.x, locCell.y, 22, 0, Math.PI * 2);
        ctx.strokeStyle = '#c07820';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'CONTACT': {
        if (!locCell || !tgtCell) break;
        // Dotted arc between the two cities
        ctx.beginPath();
        ctx.moveTo(locCell.x, locCell.y);
        ctx.lineTo(tgtCell.x, tgtCell.y);
        ctx.strokeStyle = '#4080c0';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 5]);
        ctx.globalAlpha = 0.65;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        break;
      }
      case 'COUNTRY': {
        if (!locCell) break;
        // Purple ring on new country capital
        ctx.beginPath();
        ctx.arc(locCell.x, locCell.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = '#6040b0';
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ILLUSTRATE': {
        if (!locCell) break;
        ctx.font = 'bold 14px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#a0a000';
        ctx.globalAlpha = 0.9;
        ctx.fillText('⭐', locCell.x, locCell.y - 20);
        ctx.globalAlpha = 1;
        break;
      }
      case 'RELIGION': {
        if (!locCell) break;
        ctx.font = 'bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8040a0';
        ctx.globalAlpha = 0.9;
        ctx.fillText('✚', locCell.x - 12, locCell.y - 18);
        ctx.globalAlpha = 1;
        break;
      }
      case 'TRADE': {
        if (!locCell || !tgtCell) break;
        // Bright gold arc for new trade (more prominent than persistent routes)
        ctx.beginPath();
        ctx.moveTo(locCell.x, locCell.y);
        ctx.lineTo(tgtCell.x, tgtCell.y);
        ctx.strokeStyle = '#f0c020';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        break;
      }
      case 'WONDER': {
        if (!locCell) break;
        ctx.font = 'bold 16px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#d4a800';
        ctx.globalAlpha = 0.95;
        ctx.fillText('✦', locCell.x + 14, locCell.y - 18);
        ctx.globalAlpha = 1;
        break;
      }
      case 'CATACLYSM': {
        if (!locCell) break;
        // Semi-transparent danger overlay at epicenter
        const radius = 30;
        const grad = ctx.createRadialGradient(locCell.x, locCell.y, 4, locCell.x, locCell.y, radius);
        grad.addColorStop(0, 'rgba(220,60,20,0.55)');
        grad.addColorStop(1, 'rgba(200,100,0,0)');
        ctx.beginPath();
        ctx.arc(locCell.x, locCell.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🌋', locCell.x, locCell.y - 22);
        break;
      }
      case 'WAR': {
        if (!locCell || !tgtCell) break;
        // Red line between the two country capitals
        ctx.beginPath();
        ctx.moveTo(locCell.x, locCell.y);
        ctx.lineTo(tgtCell.x, tgtCell.y);
        ctx.strokeStyle = '#c03020';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        // Swords icon at midpoint
        const mx = (locCell.x + tgtCell.x) / 2;
        const my = (locCell.y + tgtCell.y) / 2;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚔️', mx, my);
        break;
      }
      case 'TECH': {
        if (!locCell) break;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.9;
        ctx.fillText('⚙️', locCell.x + 14, locCell.y - 20);
        ctx.globalAlpha = 1;
        break;
      }
      case 'CONQUEST': {
        if (!locCell) break;
        // Ring on the victor's capital
        ctx.beginPath();
        ctx.arc(locCell.x, locCell.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = '#803020';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🏴', locCell.x, locCell.y - 24);
        break;
      }
      case 'EMPIRE': {
        if (!locCell) break;
        ctx.font = '15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.95;
        ctx.fillText('👑', locCell.x, locCell.y - 24);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  layers: LayerVisibility,
  seed: string,
  selectedYear?: number,
  mapView: MapView = 'terrain'
): void {
  initNoisyEdges(seed);

  const { width, height } = data;

  // Pre-compute ownership once (shared across all draw copies)
  const ownershipAtYear =
    layers.borders && data.history && selectedYear !== undefined
      ? getOwnershipAtYear(data.history, selectedYear)
      : undefined;
  const tradeRoutes =
    layers.tradeRoutes && data.history && selectedYear !== undefined
      ? getTradesAtYear(data.history, selectedYear)
      : undefined;
  const wonderCells =
    layers.wonderMarkers && data.history && selectedYear !== undefined
      ? getWondersAtYear(data.history, selectedYear)
      : undefined;
  const religionCells =
    layers.religionMarkers && data.history && selectedYear !== undefined
      ? getReligionsAtYear(data.history, selectedYear)
      : undefined;

  // Draw the map at three horizontal offsets for seamless east-west wrapping.
  // The canvas clip region (set by the caller's transform) hides invisible copies.
  const offsets = [-width, 0, width];
  for (const ox of offsets) {
    ctx.save();
    ctx.translate(ox, 0);

    // Parchment background
    ctx.fillStyle = '#f5e9c8';
    ctx.fillRect(0, 0, width, height);

    // Layer 1: Biome fill
    drawBiomeFill(ctx, data.cells);

    // Layer 1b: Hillshading (shaded relief on land)
    if (layers.hillshading) drawHillshading(ctx, data.cells);

    // Layer 2: Water depth shading
    drawWaterDepth(ctx, data.cells, width, height);

    // Layer 3: Noisy coastlines
    drawNoisyCoastlines(ctx, data.cells);

    // Political view: mute terrain with parchment overlay on land cells
    if (mapView === 'political') {
      ctx.fillStyle = 'rgba(245, 233, 200, 0.55)';
      for (const cell of data.cells) {
        if (cell.isWater || cell.vertices.length < 2) continue;
        cellPath(ctx, cell);
        ctx.fill();
      }
    }

    // Layer 4: Region borders (before rivers so rivers draw on top)
    if (layers.regions) drawRegionBorders(ctx, data.cells);

    // Layer 4b: Rivers
    if (layers.rivers) drawRivers(ctx, data);

    // Layer 4c: Resource icons
    if (layers.resources) drawResources(ctx, data.cells, data.regions ?? []);

    // Layer 5: Kingdom borders
    if (layers.borders) {
      const kingdomColors = mapView === 'political'
        ? KINGDOM_COLORS_POLITICAL
        : KINGDOM_COLORS_TERRAIN;
      drawKingdomBorders(ctx, data.cells, ownershipAtYear, kingdomColors);
    }

    // Layer 5b: Trade routes
    if (tradeRoutes) {
      drawTradeRoutes(ctx, data.cells, tradeRoutes);
    }

    // Layer 6: Roads
    if (layers.roads) drawRoads(ctx, data);

    // Layer 7: Icons (biome + cities)
    if (layers.icons) drawIcons(ctx, data, selectedYear);

    // Layer 7b: Wonder badges
    if (wonderCells) {
      drawWonderBadges(ctx, data.cells, wonderCells);
    }

    // Layer 7c: Religion markers
    if (religionCells) {
      drawReligionMarkers(ctx, data.cells, religionCells);
    }

    // Layer 7d: Current-year event overlays
    if (layers.eventOverlay && data.history && selectedYear !== undefined) {
      const yearData = data.history.years[selectedYear];
      if (yearData) drawCurrentYearEvents(ctx, data.cells, yearData.events);
    }

    // Layer 8: City labels
    if (layers.labels) drawLabels(ctx, data, selectedYear);

    ctx.restore();
  }
}
