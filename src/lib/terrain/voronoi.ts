import { Delaunay } from 'd3-delaunay';
import type { Cell } from '../types';
import { seededPRNG } from './noise';

/** Generate evenly-distributed random points using LCG seeded RNG. */
function generatePoints(
  n: number,
  width: number,
  height: number,
  rng: () => number
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    pts.push([rng() * width, rng() * height]);
  }
  return pts;
}

/**
 * Build ghost points for east-west wrapping.
 * Points near the left edge get a ghost on the right (+width), and vice versa.
 * Returns [allPoints, ghostToReal] where ghostToReal maps ghost indices to real indices.
 */
function buildGhostPoints(
  points: [number, number][],
  width: number,
  margin: number
): { allPoints: [number, number][]; ghostToReal: Map<number, number> } {
  const ghosts: [number, number][] = [];
  const ghostToReal = new Map<number, number>();
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    if (x < margin) {
      ghostToReal.set(n + ghosts.length, i);
      ghosts.push([x + width, y]);
    }
    if (x > width - margin) {
      ghostToReal.set(n + ghosts.length, i);
      ghosts.push([x - width, y]);
    }
  }

  return { allPoints: [...points, ...ghosts], ghostToReal };
}

/**
 * One round of Lloyd relaxation with east-west wrapping.
 * Ghost points are included so cells near edges relax correctly,
 * then centroids are wrapped back into [0, width).
 */
function lloydRelaxWrapped(
  points: [number, number][],
  width: number,
  height: number,
  margin: number
): [number, number][] {
  const { allPoints } = buildGhostPoints(points, width, margin);
  const n = points.length;

  const delaunay = Delaunay.from(allPoints);
  const voronoi = delaunay.voronoi([-margin, 0, width + margin, height]);

  const relaxed: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 3) {
      relaxed.push(points[i]);
      continue;
    }
    let cx = 0, cy = 0;
    const pLen = poly.length - 1; // poly is closed (first == last)
    for (let j = 0; j < pLen; j++) {
      cx += poly[j][0];
      cy += poly[j][1];
    }
    let rx = cx / pLen;
    const ry = cy / pLen;

    // Wrap x back into [0, width)
    if (rx < 0) rx += width;
    else if (rx >= width) rx -= width;

    relaxed.push([rx, ry]);
  }
  return relaxed;
}

export interface CellGraph {
  cells: Cell[];
}

/** Build cell graph from seed and dimensions with east-west wrapping. */
export function buildCellGraph(
  seed: string,
  numCells: number,
  width: number,
  height: number
): CellGraph {
  const rng = seededPRNG(seed + '_pts');
  let points = generatePoints(numCells, width, height, rng);

  const margin = width * 0.15;

  // 2 rounds of Lloyd relaxation with wrapping
  points = lloydRelaxWrapped(points, width, height, margin);
  points = lloydRelaxWrapped(points, width, height, margin);

  // Build final Delaunay with ghost points for correct cross-seam adjacency
  const { allPoints, ghostToReal } = buildGhostPoints(points, width, margin);

  const delaunay = Delaunay.from(allPoints);
  const voronoi = delaunay.voronoi([0, 0, width, height]);

  const cells: Cell[] = [];

  for (let i = 0; i < numCells; i++) {
    const poly = voronoi.cellPolygon(i);
    const vertices: [number, number][] = [];
    if (poly) {
      const n = poly.length - 1; // last == first
      for (let j = 0; j < n; j++) {
        vertices.push([poly[j][0], poly[j][1]]);
      }
    }

    // Collect neighbors via half-edge traversal, mapping ghosts to real cells
    const neighborSet = new Set<number>();
    for (const j of delaunay.neighbors(i)) {
      const realIdx = ghostToReal.get(j) ?? j;
      if (realIdx !== i && realIdx < numCells) {
        neighborSet.add(realIdx);
      }
    }

    cells.push({
      index: i,
      x: points[i][0],
      y: points[i][1],
      vertices,
      neighbors: Array.from(neighborSet),
      elevation: 0,
      moisture: 0,
      temperature: 0,
      biome: 'OCEAN',
      isWater: true,
      isCoast: false,
      riverFlow: 0,
      kingdom: null,
    });
  }

  // Attach wrap-vertex loops for cells whose ghost has a clipped polygon
  // inside the bounding box. Between a cell near `x=ε1` (with ghost at
  // `x=ε1+width`) and its wrap-neighbor near `x=width-ε2` (with ghost at
  // `x=-ε2`), the Voronoi edge with the *ghost* lies at
  // `x=width+(ε1-ε2)/2` on the east seam and `x=(ε1-ε2)/2` on the west
  // seam. Whenever those midpoints land inside `[0, width]`, the strip
  // between the real cell's polygon and the bounding box is owned by a
  // ghost that the regular loop above never iterates — so that strip is
  // drawn as parchment background (the "tan seam band" artifact). Here we
  // fetch each ghost's clipped polygon and attribute it to its real cell
  // as a secondary vertex loop. The renderer's 3× offset loop then draws
  // the loop in the correct position and the gap disappears.
  for (const [ghostIdx, realIdx] of ghostToReal) {
    const ghostPoly = voronoi.cellPolygon(ghostIdx);
    if (!ghostPoly || ghostPoly.length < 4) continue;
    const verts: [number, number][] = [];
    const n = ghostPoly.length - 1; // last == first
    for (let j = 0; j < n; j++) {
      verts.push([ghostPoly[j][0], ghostPoly[j][1]]);
    }
    if (verts.length < 3) continue;
    // In practice each real cell has at most one ghost that contributes a
    // non-empty clipped polygon (cells near only one edge of the map), so
    // the first ghost wins and later ones are discarded.
    if (!cells[realIdx].wrapVertices) {
      cells[realIdx].wrapVertices = verts;
    }
  }

  return { cells };
}
