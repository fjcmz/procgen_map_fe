import { Delaunay } from 'd3-delaunay';
import { hashId } from './renderer';
import type { SectorData } from './types';

/**
 * Visual Voronoi mesh derived from sector centroids. Sectors themselves are
 * generated at universe-generation time by `SectorGenerator` (worker side);
 * this module only owns the Path2D that the renderer strokes.
 *
 * Sector centroids in `SectorData` are stored in **unit-local galaxy frame**
 * (cx=0, cy=0, spread=1). The renderer's `(cx, cy, spread)` differ per render
 * mode (focus mode uses canvas-fit dimensions, multi-galaxy uses world-scaled
 * dimensions), so we transform each centroid to canvas-pre-zoom coords here
 * via `(cx + sec.cx * spread, cy + sec.cy * spread)`. Only the interior edges
 * between cells are stroked — no fill, no glow.
 */

export interface GalaxySectorMesh {
  edges: Path2D | null;
}

const meshCache = new Map<string, GalaxySectorMesh>();
const MESH_CACHE_MAX = 10;

function buildEdges(sectors: SectorData[], cx: number, cy: number, spread: number): Path2D | null {
  if (sectors.length < 2) return null;
  // Transform unit-local centroids to canvas-pre-zoom coords.
  const points: Array<[number, number]> = sectors.map(s => [cx + s.cx * spread, cy + s.cy * spread]);
  const margin = spread * 0.6;
  const bbox: [number, number, number, number] = [cx - margin, cy - margin, cx + margin, cy + margin];
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi(bbox);
  const path = new Path2D();
  voronoi.render(path);
  return path;
}

export function buildOrGetSectorMesh(
  sectors: SectorData[],
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval',
  galaxyId: string,
): GalaxySectorMesh {
  const key = `${shape}|${galaxyId}|${sectors.length}|${cx.toFixed(1)}|${cy.toFixed(1)}|${spread.toFixed(1)}`;
  const cached = meshCache.get(key);
  if (cached) return cached;

  const mesh: GalaxySectorMesh = { edges: buildEdges(sectors, cx, cy, spread) };
  if (meshCache.size >= MESH_CACHE_MAX) {
    meshCache.delete(meshCache.keys().next().value!);
  }
  meshCache.set(key, mesh);
  return mesh;
}

// ── Renderer ──────────────────────────────────────────────────────────────
const EDGE_STROKE = 'rgba(170, 190, 220, 0.22)';

export function drawGalaxySectors(
  ctx: CanvasRenderingContext2D,
  mesh: GalaxySectorMesh,
  cx: number,
  cy: number,
  spread: number,
  shape: 'spiral' | 'oval',
  galaxyId: string,
  galaxyAngle: number,
  viewScale: number,
): void {
  if (!mesh.edges) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(galaxyAngle);
  ctx.translate(-cx, -cy);

  const clipR = spread * 0.52;
  ctx.beginPath();
  if (shape === 'oval') {
    const h = hashId(galaxyId);
    const aspectX = 1.4 + (h & 0xfff) / 0xfff * 0.8;
    ctx.ellipse(cx, cy, clipR * aspectX, clipR, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
  }
  ctx.clip();

  ctx.lineWidth = 1 / Math.max(viewScale, 0.0001);
  ctx.strokeStyle = EDGE_STROKE;
  ctx.stroke(mesh.edges);

  ctx.restore();
}
