import type { MapData, MapView, PoliticalMode, LayerVisibility, Cell, Road, RegionData, HistoryEvent, HistoryData, TradeRouteEntry, EmpireSnapshotEntry, Season } from '../types';
import { BIOME_INFO, getVegetationDensity, modulateBiomeColor, getSeasonalBiome, getPermafrostAlpha } from '../terrain/biomes';
import { getNoisyEdge, initNoisyEdges } from './noisyEdges';
import { getOwnershipAtYear, getTradesAtYear, getRoadsAtYear, getWondersAtYear, getReligionsAtYear } from '../history/history';
import { getLegacyCategory } from '../history/physical/ResourceCatalog';
import { INDEX_TO_CITY_SIZE } from '../history/physical/CityEntity';
import type { ResourceType } from '../history/physical/Resource';
import { PatternCache, strokeColorForIndex } from './patterns';
import { unwrapX, drawWrappedPath, findSharedWrapAwareVerts } from './wrap';

// Kingdom colors for terrain view (subtle fills)
const KINGDOM_COLORS_TERRAIN = [
  { fill: 'rgba(220,80,80,0.12)',  stroke: '#c04040' },
  { fill: 'rgba(80,120,220,0.12)', stroke: '#3060b0' },
  { fill: 'rgba(80,190,80,0.12)',  stroke: '#308030' },
  { fill: 'rgba(220,160,40,0.12)', stroke: '#a07020' },
  { fill: 'rgba(160,80,200,0.12)', stroke: '#804090' },
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
  // Secondary loop for cells that wrap across the east-west seam. The ghost
  // polygon lives inside the same `[0, width]` frame as the main loop and
  // fills the strip between the main polygon's clipped edge and the nearest
  // seam that would otherwise show the parchment background.
  const wv = cell.wrapVertices;
  if (wv && wv.length >= 2) {
    ctx.moveTo(wv[0][0], wv[0][1]);
    for (let i = 1; i < wv.length; i++) {
      ctx.lineTo(wv[i][0], wv[i][1]);
    }
    ctx.closePath();
  }
}

function drawBiomeFill(ctx: CanvasRenderingContext2D, cells: Cell[], season: Season = 0): void {
  // Draw land first, water last — ensures water always wins at shared polygon edges
  // regardless of cell index order (which has no spatial meaning in Voronoi).
  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;
    const effectiveBiome = season !== 0 ? getSeasonalBiome(cell, season) : cell.biome;
    const density = getVegetationDensity(cell);
    ctx.fillStyle = modulateBiomeColor(BIOME_INFO[effectiveBiome].fillColor, density);
    cellPath(ctx, cell);
    ctx.fill();
  }
  for (const cell of cells) {
    if (!cell.isWater || cell.vertices.length < 2) continue;
    const effectiveBiome = season !== 0 ? getSeasonalBiome(cell, season) : cell.biome;
    ctx.fillStyle = BIOME_INFO[effectiveBiome].fillColor;
    cellPath(ctx, cell);
    ctx.fill();
  }
}

function drawPermafrost(ctx: CanvasRenderingContext2D, cells: Cell[], season: Season): void {
  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;
    const alpha = getPermafrostAlpha(cell, season);
    if (alpha <= 0) continue;
    ctx.fillStyle = `rgba(180,200,220,${alpha.toFixed(3)})`;
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

    // Derive SST anomaly by comparing cell temperature to latitude baseline
    const ny = (cell.y / height) * 2 - 1;
    const baseTemp = 1.0 - Math.abs(ny);
    const tempDelta = cell.temperature - baseTemp; // positive = warm current, negative = cold

    // Tint water color: warm currents → slightly warmer hue, cold currents → deeper blue
    const r = Math.round(20 + tempDelta * 40);   // ~8–32 range
    const g = Math.round(50 + tempDelta * 30);   // ~38–62 range
    const b = Math.round(100 - tempDelta * 30);  // ~70–130 range

    // Spatial hash dither to break horizontal banding
    const hash = Math.sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453;
    const dither = (hash - Math.floor(hash)) * 0.06 - 0.03;

    const alpha = Math.max(0, Math.min(0.3, depth * 0.3 + dither));
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    cellPath(ctx, cell);
    ctx.fill();
  }
  void width; // used only by callers for consistent signature
}

function drawHillshading(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  width: number,
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

    // Estimate gradient from neighbors. Wrap-neighbors across the seam are
    // unwrapped so the gradient uses the true short-arc distance (without
    // this, border cells would see their wrap-neighbors ~width away and
    // produce flipped shading at x ≈ 0 / x ≈ width).
    let dzdx = 0;
    let dzdy = 0;
    let weightSum = 0;
    for (const ni of cell.neighbors) {
      const nb = cells[ni];
      if (!nb) continue;
      const dx = unwrapX(cell.x, nb.x, width) - cell.x;
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
  cells: Cell[],
  width: number,
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

      // Find shared edge vertices between the two cells, tolerating wrap
      // (a cell on the left edge and its wrap-neighbor on the right edge
      // have vertices clipped at x=0 and x=width respectively; the helper
      // tries ±width shifts before giving up).
      const other = cells[ni];
      const shared = findSharedWrapAwareVerts(cell, other, width);
      if (!shared) continue;

      const pts = getNoisyEdge(shared[0], shared[1], 3, 0.3);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }
  }
}

// River rendering tuning constants — tweak these to taste.
// Rivers are drawn with zoom-stable thickness (lineWidth = screenPx / scale) and
// zoom-dependent culling (skip any river with maxFlow < RIVER_VISIBILITY_BASE / scale^2).
const RIVER_VISIBILITY_BASE = 60;      // at scale=1, only rivers with maxFlow >= 60 are drawn
const RIVER_MIN_SCREEN_PX = 0.6;       // smallest visible rivers
const RIVER_MAX_SCREEN_PX = 2.4;       // cap for the largest trunk rivers
const RIVER_WIDTH_COEFF = 0.22;        // maps sqrt(maxFlow) → screen px before clamping

function drawRivers(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  scale: number,
): void {
  const { cells, rivers, width } = data;
  ctx.strokeStyle = '#4a7fa5';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const visibilityCutoff = RIVER_VISIBILITY_BASE / (scale * scale);

  for (const river of rivers) {
    if (river.path.length < 2) continue;
    if (river.maxFlow < visibilityCutoff) continue;

    const screenPx = Math.max(
      RIVER_MIN_SCREEN_PX,
      Math.min(RIVER_MAX_SCREEN_PX, RIVER_WIDTH_COEFF * Math.sqrt(river.maxFlow)),
    );
    ctx.lineWidth = screenPx / scale;

    // Segments that cross the cylindrical seam are drawn the short way;
    // the 3× horizontal offset loop in render() handles visibility.
    drawWrappedPath(ctx, river.path.map(i => cells[i]), width);
  }
}

function drawKingdomBorders(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  width: number,
  ownershipOverride?: Int16Array,
  colors: KingdomColor[] = KINGDOM_COLORS_TERRAIN,
  expansionFlags?: Uint8Array,
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
    // Darken expansion territory
    if (expansionFlags && expansionFlags[cell.index] === 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      cellPath(ctx, cell);
      ctx.fill();
    }
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

      const shared = findSharedWrapAwareVerts(cell, neighbor, width);
      if (!shared) continue;

      const kc = cellOwner !== null
        ? colors[cellOwner % colors.length]
        : { stroke: '#888' };
      ctx.strokeStyle = kc.stroke;
      ctx.beginPath();
      ctx.moveTo(shared[0][0], shared[0][1]);
      ctx.lineTo(shared[1][0], shared[1][1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

// ── Empire snapshot lookup (mirrors HierarchyTab.lookupEmpireSnapshot) ──

function lookupEmpireSnapshot(
  historyData: HistoryData,
  selectedYear: number,
): EmpireSnapshotEntry[] {
  const finalKey = historyData.numYears;
  if (selectedYear >= finalKey && historyData.empireSnapshots[finalKey]) {
    return historyData.empireSnapshots[finalKey];
  }
  const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
  for (let y = floored; y >= 0; y -= 20) {
    const snap = historyData.empireSnapshots[y];
    if (snap) return snap;
  }
  return [];
}

// ── Patterned borders (countries = stripes, empires = plaid) ────────

function drawPatternedBorders(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  width: number,
  ownershipOverride: Int16Array | undefined,
  politicalMode: PoliticalMode,
  historyData: HistoryData | undefined,
  selectedYear: number | undefined,
  patternCache: PatternCache,
  expansionFlags?: Uint8Array,
): void {
  const ALPHA = 0.55;

  const getOwner = (cell: Cell): number | null => {
    if (ownershipOverride) {
      const o = ownershipOverride[cell.index];
      return o >= 0 ? o : null;
    }
    return cell.kingdom;
  };

  // Build country→empire map for empire mode
  let countryToEmpireIdx: Map<number, number> | undefined;
  if (politicalMode === 'empires' && historyData && selectedYear !== undefined) {
    const snapshot = lookupEmpireSnapshot(historyData, selectedYear);
    countryToEmpireIdx = new Map();
    // Sort by empireId for deterministic index assignment
    const sorted = [...snapshot].sort((a, b) => a.empireId.localeCompare(b.empireId));
    sorted.forEach((emp, empIdx) => {
      for (const memberIdx of emp.memberCountryIndices) {
        countryToEmpireIdx!.set(memberIdx, empIdx);
      }
    });
  }

  // Fill cells with patterns
  for (const cell of cells) {
    if (cell.isWater || cell.vertices.length < 2) continue;
    const owner = getOwner(cell);
    if (owner === null) continue;

    let pattern: CanvasPattern;
    if (politicalMode === 'empires' && countryToEmpireIdx) {
      const empIdx = countryToEmpireIdx.get(owner);
      if (empIdx !== undefined) {
        // Empire member → plaid
        pattern = patternCache.getPlaid(ctx, empIdx, ALPHA);
      } else {
        // Independent country → diagonal stripes
        pattern = patternCache.getStripe(ctx, owner, ALPHA);
      }
    } else {
      // Country mode → diagonal stripes
      pattern = patternCache.getStripe(ctx, owner, ALPHA);
    }

    ctx.fillStyle = pattern;
    cellPath(ctx, cell);
    ctx.fill();
    // Darken expansion territory
    if (expansionFlags && expansionFlags[cell.index] === 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      cellPath(ctx, cell);
      ctx.fill();
    }
  }

  // Draw border edges (same logic as drawKingdomBorders but with pattern-derived strokes)
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

      const shared = findSharedWrapAwareVerts(cell, neighbor, width);
      if (!shared) continue;

      // Determine stroke color from the entity index
      let strokeIdx: number;
      if (cellOwner !== null && politicalMode === 'empires' && countryToEmpireIdx) {
        const empIdx = countryToEmpireIdx.get(cellOwner);
        strokeIdx = empIdx !== undefined ? empIdx : cellOwner;
      } else {
        strokeIdx = cellOwner ?? 0;
      }
      ctx.strokeStyle = strokeColorForIndex(strokeIdx);
      ctx.beginPath();
      ctx.moveTo(shared[0][0], shared[0][1]);
      ctx.lineTo(shared[1][0], shared[1][1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function drawRoads(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  roads: Road[],
  width: number,
): void {
  ctx.strokeStyle = '#8b6040';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([4, 3]);

  for (const road of roads) {
    if (road.path.length < 2) continue;
    // A* roads follow the Voronoi neighbor graph which legitimately crosses
    // the east-west seam; drawWrappedPath keeps each segment on the short arc.
    drawWrappedPath(ctx, road.path.map(i => cells[i]), width);
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
  s: number,
  density: number = 0.5
): void {
  // Modulate tree color by vegetation density: sparse/dry → lighter, dense/wet → darker
  const r = Math.round(58 - density * 20);   // 58 → 38
  const g = Math.round(96 - density * 30);   // 96 → 66
  const b = Math.round(48 - density * 16);   // 48 → 32
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.strokeStyle = `rgb(${r - 16},${g - 16},${b - 16})`;
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

function drawRuinIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
): void {
  // Crumbled walls — two broken pillars with rubble
  ctx.fillStyle = '#999';
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 0.8;
  // Left pillar (broken top)
  ctx.fillRect(x - s * 0.7, y - s * 0.2, s * 0.3, s * 0.9);
  ctx.strokeRect(x - s * 0.7, y - s * 0.2, s * 0.3, s * 0.9);
  // Right pillar (shorter, more broken)
  ctx.fillRect(x + s * 0.3, y + 0, s * 0.3, s * 0.7);
  ctx.strokeRect(x + s * 0.3, y + 0, s * 0.3, s * 0.7);
  // Rubble dots
  ctx.fillStyle = '#888';
  ctx.beginPath();
  ctx.arc(x - s * 0.1, y + s * 0.5, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + s * 0.15, y + s * 0.6, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawIcons(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  selectedYear?: number,
  season: Season = 0,
  highlightSet?: Set<number>,
  citySizesAtYear?: Uint8Array,
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
    const effectiveBiome = season !== 0 ? getSeasonalBiome(cell, season) : cell.biome;
    const info = BIOME_INFO[effectiveBiome];

    if (isHighElev) {
      // ~40% density for mountains
      if (cell.index % 5 >= 2) continue;
      // Scale icon size by elevation: higher = bigger
      const elevScale = Math.max(0.8, Math.min(1.4, 0.8 + (cell.elevation - 0.75) * 1.6));
      drawMountainIcon(ctx, cell.x, cell.y, iconSize * elevScale);
    } else if (info.iconType) {
      if (info.iconType === 'tree') {
        // Variable tree density: 10% at dry edges, 30% at wet edges
        const density = getVegetationDensity(cell);
        const treeRate = 0.1 + density * 0.2;
        const hash = Math.sin(cell.x * 127.1 + cell.y * 311.7) * 43758.5453;
        const rand = hash - Math.floor(hash);
        if (rand > treeRate) continue;
        const sizeScale = 0.85 + density * 0.3;
        drawTreeIcon(ctx, cell.x, cell.y, iconSize * 0.8 * sizeScale, density);
      } else {
        // ~20% density for non-tree icons
        if (cell.index % 5 !== 0) continue;
        const s = iconSize;
        switch (info.iconType) {
          case 'mountain': drawMountainIcon(ctx, cell.x, cell.y, s); break;
          case 'desert':   drawDesertIcon(ctx, cell.x, cell.y, s * 0.7); break;
          case 'snow':     drawSnowIcon(ctx, cell.x, cell.y, s); break;
        }
      }
    }
  }

  // City icons — resolve dynamic size from snapshot when available
  // Split into active cities and ruins
  const activeCities = visibleCities.filter(c =>
    !c.isRuin || (selectedYear !== undefined && c.ruinYear > selectedYear)
  );
  const ruinCities = visibleCities.filter(c =>
    c.isRuin && (selectedYear === undefined || c.ruinYear <= selectedYear)
  );

  // Build a cellIndex → cities[] array index map for snapshot lookup
  const cityIdxMap = citySizesAtYear
    ? new Map(data.cities.map((c, i) => [c.cellIndex, i]))
    : undefined;
  for (const city of activeCities) {
    const cell = cells[city.cellIndex];
    if (highlightSet) {
      ctx.globalAlpha = highlightSet.has(city.cellIndex) ? 1.0 : 0.25;
    }
    let sizeKey = city.size;
    if (citySizesAtYear && cityIdxMap) {
      const idx = cityIdxMap.get(city.cellIndex);
      if (idx !== undefined) sizeKey = INDEX_TO_CITY_SIZE[citySizesAtYear[idx]] ?? city.size;
    }
    drawCityIcon(ctx, cell.x, cell.y, iconSize * 1.2, city.isCapital, CITY_SIZE_SCALE[sizeKey] ?? 1.0);
  }

  // Ruin icons
  for (const city of ruinCities) {
    const cell = cells[city.cellIndex];
    if (highlightSet) {
      ctx.globalAlpha = highlightSet.has(city.cellIndex) ? 1.0 : 0.25;
    }
    drawRuinIcon(ctx, cell.x, cell.y, iconSize * 1.2);
  }
  if (highlightSet) ctx.globalAlpha = 1.0;
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  data: MapData,
  selectedYear?: number,
  highlightSet?: Set<number>,
): void {
  const { cells, cities } = data;
  const visibleCities = selectedYear === undefined
    ? cities
    : cities.filter(c => c.foundedYear <= selectedYear);
  const fontSize = Math.max(9, Math.min(13, data.width / 100));

  for (const city of visibleCities) {
    const cell = cells[city.cellIndex];
    if (highlightSet) {
      ctx.globalAlpha = highlightSet.has(city.cellIndex) ? 1.0 : 0.25;
    }

    const isRuinNow = city.isRuin && (selectedYear === undefined || city.ruinYear <= selectedYear);

    if (isRuinNow) {
      // Ruins: italic, gray, dimmed
      ctx.font = `italic ${fontSize}px Georgia, serif`;
      const baseAlpha = highlightSet ? (highlightSet.has(city.cellIndex) ? 1.0 : 0.25) : 1.0;
      ctx.globalAlpha = baseAlpha * 0.6;

      // Shadow
      ctx.fillStyle = 'rgba(200,200,200,0.7)';
      ctx.fillText(city.name, cell.x + 9, cell.y + 4);
      ctx.fillText(city.name, cell.x + 11, cell.y + 4);
      ctx.fillText(city.name, cell.x + 9, cell.y + 6);
      ctx.fillText(city.name, cell.x + 11, cell.y + 6);

      // Text
      ctx.fillStyle = '#777';
      ctx.fillText(city.name, cell.x + 10, cell.y + 5);
    } else {
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
  if (highlightSet) ctx.globalAlpha = 1.0;
}

function drawRegionBorders(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  width: number,
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

      const shared = findSharedWrapAwareVerts(cell, neighbor, width);
      if (!shared) continue;

      ctx.beginPath();
      ctx.moveTo(shared[0][0], shared[0][1]);
      ctx.lineTo(shared[1][0], shared[1][1]);
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
    if (!region.resources) continue;
    for (const r of region.resources) {
      const cell = cells[r.cellIndex];
      if (!cell) continue;
      const category = getLegacyCategory(r.type as ResourceType);
      switch (category) {
        case 'strategic':    drawStrategicIcon(ctx, cell.x, cell.y, iconSize); break;
        case 'agricultural': drawAgriculturalIcon(ctx, cell.x, cell.y, iconSize); break;
        case 'luxury':       drawLuxuryIcon(ctx, cell.x, cell.y, iconSize); break;
      }
    }
  }
}

/** Draw active trade route lines between city pairs (persistent state layer). */
function drawTradeRoutes(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  tradeRoutes: TradeRouteEntry[],
  width: number,
): void {
  if (tradeRoutes.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#c8a020';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([4, 6]);
  for (const route of tradeRoutes) {
    if (route.path && route.path.length >= 2) {
      // Draw multi-segment pathfound route (coastal-hugging / island-hopping),
      // unwrapping any seam-crossing segments onto the short arc.
      drawWrappedPath(ctx, route.path.map(i => cells[i]), width);
    } else {
      // Fallback: straight line between endpoints, pick the short arc across
      // the cylindrical seam so trade lines don't stretch the long way.
      const c1 = cells[route.cell1];
      const c2 = cells[route.cell2];
      if (!c1 || !c2) continue;
      const c2x = unwrapX(c1.x, c2.x, width);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2x, c2.y);
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
  highlightSet?: Set<number>,
): void {
  if (wonderCells.length === 0) return;
  ctx.save();
  ctx.font = 'bold 11px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ci of wonderCells) {
    const cell = cells[ci];
    if (!cell) continue;
    if (highlightSet) {
      ctx.globalAlpha = highlightSet.has(ci) ? 1.0 : 0.25;
    }
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
  highlightSet?: Set<number>,
): void {
  if (religionCells.length === 0) return;
  ctx.save();
  ctx.font = '9px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ci of religionCells) {
    const cell = cells[ci];
    if (!cell) continue;
    if (highlightSet) {
      ctx.globalAlpha = highlightSet.has(ci) ? 1.0 : 0.25;
    }
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

function drawHighlight(ctx: CanvasRenderingContext2D, cells: Cell[], highlightCells: number[], width: number): void {
  ctx.save();
  // Fill pass
  ctx.fillStyle = 'rgba(255, 220, 60, 0.35)';
  for (const ci of highlightCells) {
    const cell = cells[ci];
    if (!cell || cell.vertices.length < 2) continue;
    cellPath(ctx, cell);
    ctx.fill();
  }
  // Stroke pass — only external boundary edges
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  const highlightSet = new Set(highlightCells);

  if (highlightSet.size === 1) {
    // Single cell: stroke the full polygon (every edge is external)
    const cell = cells[highlightCells[0]];
    if (cell && cell.vertices.length >= 2) {
      cellPath(ctx, cell);
      ctx.stroke();
    }
  } else {
    // Multi-cell: only stroke edges adjacent to non-highlighted cells
    const drawnPairs = new Set<string>();
    for (const ci of highlightCells) {
      const cell = cells[ci];
      if (!cell) continue;
      for (const ni of cell.neighbors) {
        if (highlightSet.has(ni)) continue;
        const key = ci < ni ? `${ci}-${ni}` : `${ni}-${ci}`;
        if (drawnPairs.has(key)) continue;
        drawnPairs.add(key);

        const neighbor = cells[ni];
        if (!neighbor) continue;
        const shared = findSharedWrapAwareVerts(cell, neighbor, width);
        if (!shared) continue;

        ctx.beginPath();
        ctx.moveTo(shared[0][0], shared[0][1]);
        ctx.lineTo(shared[1][0], shared[1][1]);
        ctx.stroke();
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
  mapView: MapView = 'terrain',
  season: Season = 0,
  politicalMode: PoliticalMode = 'countries',
  highlightCells?: number[],
  citySizesAtYear?: Uint8Array,
  expansionFlags?: Uint8Array,
  scale: number = 1,
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
  const roadsAtYear =
    layers.roads && data.history && selectedYear !== undefined
      ? getRoadsAtYear(data.history, selectedYear)
      : undefined;
  const wonderCells =
    layers.wonderMarkers && data.history && selectedYear !== undefined
      ? getWondersAtYear(data.history, selectedYear)
      : undefined;
  const religionCells =
    layers.religionMarkers && data.history && selectedYear !== undefined
      ? getReligionsAtYear(data.history, selectedYear)
      : undefined;

  // Pattern cache for patterned political fills (shared across all offset copies)
  const patternCache = mapView === 'political' ? new PatternCache() : undefined;

  // Pre-compute highlight set for label/icon focus dimming
  const highlightSet = highlightCells && highlightCells.length > 0
    ? new Set(highlightCells) : undefined;

  // Draw the map at three horizontal offsets for seamless east-west wrapping.
  // The canvas clip region (set by the caller's transform) hides invisible copies.
  const offsets = [-width, 0, width];
  for (const ox of offsets) {
    ctx.save();
    ctx.translate(ox, 0);

    // Parchment background
    ctx.fillStyle = '#f5e9c8';
    ctx.fillRect(0, 0, width, height);

    // Layer 1: Biome fill (with seasonal variation when enabled)
    const effectiveSeason = layers.seasonalIce ? season : 0 as Season;
    drawBiomeFill(ctx, data.cells, effectiveSeason);

    // Layer 1b: Hillshading (shaded relief on land)
    if (layers.hillshading) drawHillshading(ctx, data.cells, width);

    // Layer 1c: Permafrost overlay (seasonal blue-gray tint on sub-polar land)
    if (layers.seasonalIce && effectiveSeason !== 0) {
      drawPermafrost(ctx, data.cells, effectiveSeason);
    }

    // Layer 2: Water depth shading
    drawWaterDepth(ctx, data.cells, width, height);

    // Layer 3: Noisy coastlines
    drawNoisyCoastlines(ctx, data.cells, width);

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
    if (layers.regions) drawRegionBorders(ctx, data.cells, width);

    // Layer 4b: Rivers
    if (layers.rivers) drawRivers(ctx, data, scale);

    // Layer 4c: Resource icons
    if (layers.resources) drawResources(ctx, data.cells, data.regions ?? []);

    // Layer 5: Kingdom borders
    if (layers.borders) {
      if (mapView === 'political' && patternCache) {
        drawPatternedBorders(
          ctx, data.cells, width, ownershipAtYear,
          politicalMode, data.history, selectedYear, patternCache,
          expansionFlags,
        );
      } else {
        drawKingdomBorders(ctx, data.cells, width, ownershipAtYear, KINGDOM_COLORS_TERRAIN, expansionFlags);
      }
    }

    // Layer 5b: Trade routes
    if (tradeRoutes) {
      drawTradeRoutes(ctx, data.cells, tradeRoutes, width);
    }

    // Layer 6: Roads (year-aware when history exists, else static fallback)
    if (layers.roads) {
      const roads = roadsAtYear ?? data.roads;
      if (roads.length > 0) drawRoads(ctx, data.cells, roads, width);
    }

    // Layer 7: Icons (biome + cities)
    if (layers.icons) drawIcons(ctx, data, selectedYear, effectiveSeason, highlightSet, citySizesAtYear);

    // Layer 7b: Wonder badges
    if (wonderCells) {
      drawWonderBadges(ctx, data.cells, wonderCells, highlightSet);
    }

    // Layer 7c: Religion markers
    if (religionCells) {
      drawReligionMarkers(ctx, data.cells, religionCells, highlightSet);
    }

    // Layer 7d: Current-year event overlays
    if (layers.eventOverlay && data.history && selectedYear !== undefined) {
      const yearData = data.history.years[selectedYear];
      if (yearData) drawCurrentYearEvents(ctx, data.cells, yearData.events);
    }

    // Layer 8: City labels
    if (layers.labels) drawLabels(ctx, data, selectedYear, highlightSet);

    // Layer 9: Entity highlight (click-to-navigate)
    if (highlightCells && highlightCells.length > 0) {
      drawHighlight(ctx, data.cells, highlightCells, width);
    }

    ctx.restore();
  }
}
