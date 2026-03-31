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

/** One round of Lloyd relaxation — move each point to its cell centroid. */
function lloydRelax(
  points: [number, number][],
  width: number,
  height: number
): [number, number][] {
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  const relaxed: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 3) {
      relaxed.push(points[i]);
      continue;
    }
    let cx = 0, cy = 0;
    // poly is closed (first == last)
    const n = poly.length - 1;
    for (let j = 0; j < n; j++) {
      cx += poly[j][0];
      cy += poly[j][1];
    }
    relaxed.push([cx / n, cy / n]);
  }
  return relaxed;
}

export interface CellGraph {
  cells: Cell[];
}

/** Build cell graph from seed and dimensions. */
export function buildCellGraph(
  seed: string,
  numCells: number,
  width: number,
  height: number
): CellGraph {
  const rng = seededPRNG(seed + '_pts');
  let points = generatePoints(numCells, width, height, rng);

  // 2 rounds of Lloyd relaxation for even distribution
  points = lloydRelax(points, width, height);
  points = lloydRelax(points, width, height);

  const delaunay = Delaunay.from(points);
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

    // Collect neighbors via half-edge traversal
    const neighbors: number[] = [];
    for (const j of delaunay.neighbors(i)) {
      neighbors.push(j);
    }

    cells.push({
      index: i,
      x: points[i][0],
      y: points[i][1],
      vertices,
      neighbors,
      elevation: 0,
      moisture: 0,
      biome: 'OCEAN',
      isWater: true,
      isCoast: false,
      riverFlow: 0,
      kingdom: null,
    });
  }

  return { cells };
}
