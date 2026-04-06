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

  return { cells };
}
