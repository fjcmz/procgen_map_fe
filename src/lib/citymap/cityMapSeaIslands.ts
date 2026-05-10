// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — sea city island layout generator
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Sea cities are rendered as multiple small disconnected islands (50–100
// polygons each) connected by visible bridges. The total polygon count for the
// city is the same as any land city of the same tier — it's just spread across
// several islands instead of one organic footprint.
//
// Two layout configurations (chosen by RNG):
//   hubSpokes  60% — a central hub island + satellite islands arranged around
//                    it in a rough circle; every satellite bridges to the hub.
//   mesh       40% — islands distributed across the canvas in a loose grid;
//                    each island bridges to its 2 nearest neighbours.
//
// Algorithm:
//   1. Pick layout type and derive island count from total polygon budget.
//   2. Place island center coordinates (hubSpokes: center + even ring;
//      mesh: Poisson-disk with grid fallback).
//   3. Voronoi-partition non-edge polygons: each polygon assigned to its
//      nearest island center, then top-N by distance taken per island.
//   4. BFS-prune each island to its largest connected component.
//   5. Trim polygons adjacent to a different island (guarantees water gap).
//   6. Build bridge connection list (hub↔satellite OR nearest-neighbour pairs).
//   7. Compute bridge endpoints: nearest boundary-polygon edge-midpoints on
//      the two connected islands' facing sides.
//
// RNG sub-stream:  `${seed}_city_${cityName}_sea_islands`
//   Isolated so adding/removing this slice cannot perturb any other city-map
//   stream (voronoi / walls / river / roads / streets / buildings / sprawl).
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CityPolygon } from './cityMapTypesV2';

// ── Public types ─────────────────────────────────────────────────────────────

export type SeaLayoutType = 'hubSpokes' | 'mesh';

export interface SeaIslandBridge {
  /** Index of the first island. */
  islandA: number;
  /** Index of the second island. */
  islandB: number;
  /** Bridge start point on island A's boundary (canvas px). */
  from: [number, number];
  /** Bridge end point on island B's boundary (canvas px). */
  to: [number, number];
}

export interface SeaIslandLayout {
  /** One Set<polygonId> per island. */
  islands: Set<number>[];
  /** Bridge segments connecting pairs of islands. */
  bridges: SeaIslandBridge[];
  /** Which layout pattern was chosen. */
  layoutType: SeaLayoutType;
  /** Union of all island polygon IDs — used as the city footprint. */
  footprintIds: Set<number>;
}

// ── Tuning constants ─────────────────────────────────────────────────────────

const ISLAND_SIZE_MIN = 50;
const ISLAND_SIZE_MAX = 100;
const ISLAND_SIZE_AVG = 70;

// Hub-and-spokes: hub is capped at this many islands total (hub + satellites).
const HUB_SPOKES_MAX_ISLANDS = 9;

// Hub orbit radius as a fraction of canvas size.
const HUB_ORBIT_FRACTION = 0.28;

// Mesh: minimum distance between island centers (px).  With a 1000-px canvas
// and island radius ≈ 86 px, 180 px gives ≈ 8 px water gap at minimum.
const MESH_MIN_CENTER_DIST = 170;

// Margin from canvas edge when placing island centers.
const CENTER_MARGIN = 90;

// Mesh connections: each island connects to this many nearest neighbours.
const MESH_NEIGHBOUR_COUNT = 2;

// ── Main entry point ─────────────────────────────────────────────────────────

export function generateSeaIslandLayout(
  seed: string,
  cityName: string,
  polygons: CityPolygon[],
  cityPolygonCount: number,
  canvasSize: number,
): SeaIslandLayout {
  const rng = seededPRNG(`${seed}_city_${cityName}_sea_islands`);

  // ── 1. Layout type and island count ────────────────────────────────────────
  const rawNumIslands = Math.max(2, Math.ceil(cityPolygonCount / ISLAND_SIZE_AVG));

  // Hub-spokes capped at HUB_SPOKES_MAX_ISLANDS; overflow falls to mesh.
  let layoutType: SeaLayoutType = rng() < 0.60 ? 'hubSpokes' : 'mesh';
  if (layoutType === 'hubSpokes' && rawNumIslands > HUB_SPOKES_MAX_ISLANDS) {
    layoutType = 'mesh';
  }
  const numIslands = layoutType === 'hubSpokes'
    ? Math.min(rawNumIslands, HUB_SPOKES_MAX_ISLANDS)
    : rawNumIslands;

  // ── 2. Per-island target sizes (even distribution, clamped to [min, max]) ──
  const islandTargets = distributePolygons(cityPolygonCount, numIslands);

  // ── 3. Island center positions ─────────────────────────────────────────────
  const centers: [number, number][] = layoutType === 'hubSpokes'
    ? placeHubSpokesCenters(rng, numIslands, canvasSize)
    : placeMeshCenters(rng, numIslands, canvasSize);

  // ── 4. Voronoi-partition non-edge polygons, take top-N per island ──────────
  const islandSets = growIslands(polygons, centers, islandTargets);

  // ── 5. Trim polygons adjacent to a different island (water gap) ────────────
  trimIslandGaps(polygons, islandSets);

  // ── 6. Bridge connections ──────────────────────────────────────────────────
  const connections: [number, number][] = layoutType === 'hubSpokes'
    ? hubSpokeConnections(islandSets.length)
    : meshConnections(islandSets, polygons);

  // ── 7. Bridge endpoint segments ────────────────────────────────────────────
  const bridges: SeaIslandBridge[] = [];
  for (const [a, b] of connections) {
    const seg = computeBridgeSegment(polygons, islandSets, a, b);
    if (seg) bridges.push(seg);
  }

  // ── 8. Union footprint ─────────────────────────────────────────────────────
  const footprintIds = new Set<number>();
  for (const island of islandSets) {
    for (const id of island) footprintIds.add(id);
  }

  return { islands: islandSets, bridges, layoutType, footprintIds };
}

// ── Island size distribution ──────────────────────────────────────────────────

/**
 * Evenly distribute `total` polygons among `n` islands.  Each island's
 * allocation is clamped to [ISLAND_SIZE_MIN, ISLAND_SIZE_MAX] — if total
 * exceeds n * MAX the excess is silently dropped (very large cities get
 * more but smaller islands rather than over-sized ones).
 */
function distributePolygons(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = base + (i < remainder ? 1 : 0);
    sizes.push(Math.max(ISLAND_SIZE_MIN, Math.min(ISLAND_SIZE_MAX, raw)));
  }
  return sizes;
}

// ── Island center placement ───────────────────────────────────────────────────

/** Hub at canvas center; satellites evenly spaced on a ring with small jitter. */
function placeHubSpokesCenters(
  rng: () => number,
  numIslands: number,
  canvasSize: number,
): [number, number][] {
  const half = canvasSize / 2;
  const orbitR = canvasSize * HUB_ORBIT_FRACTION;
  const centers: [number, number][] = [[half, half]]; // hub

  const numSatellites = numIslands - 1;
  if (numSatellites === 0) return centers;

  const angleStep = (2 * Math.PI) / numSatellites;
  const startAngle = rng() * Math.PI * 2;

  for (let i = 0; i < numSatellites; i++) {
    const baseAngle = startAngle + i * angleStep;
    const jitter = (rng() - 0.5) * angleStep * 0.25;
    const angle = baseAngle + jitter;
    const r = orbitR * (0.85 + rng() * 0.30);
    const cx = Math.max(CENTER_MARGIN, Math.min(canvasSize - CENTER_MARGIN, half + Math.cos(angle) * r));
    const cy = Math.max(CENTER_MARGIN, Math.min(canvasSize - CENTER_MARGIN, half + Math.sin(angle) * r));
    centers.push([cx, cy]);
  }

  return centers;
}

/**
 * Mesh: Poisson-disk placement with a grid fallback.
 * Tries random sampling first (up to 30× attempts per island); if not enough
 * placements succeed it falls back to a jittered regular grid.
 */
function placeMeshCenters(
  rng: () => number,
  numIslands: number,
  canvasSize: number,
): [number, number][] {
  const margin = CENTER_MARGIN;
  const w = canvasSize - 2 * margin;
  const h = canvasSize - 2 * margin;
  const minDist = MESH_MIN_CENTER_DIST;

  const centers: [number, number][] = [];
  let attempts = 0;

  while (centers.length < numIslands && attempts < numIslands * 30) {
    attempts++;
    const cx = margin + rng() * w;
    const cy = margin + rng() * h;

    let tooClose = false;
    for (const [ex, ey] of centers) {
      if (Math.hypot(cx - ex, cy - ey) < minDist) { tooClose = true; break; }
    }
    if (!tooClose) centers.push([cx, cy]);
  }

  // Grid fallback
  if (centers.length < numIslands) {
    centers.length = 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(numIslands * w / h)));
    const rows = Math.ceil(numIslands / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    for (let r = 0; r < rows && centers.length < numIslands; r++) {
      for (let c = 0; c < cols && centers.length < numIslands; c++) {
        const cx = margin + (c + 0.5) * cellW + (rng() - 0.5) * cellW * 0.35;
        const cy = margin + (r + 0.5) * cellH + (rng() - 0.5) * cellH * 0.35;
        centers.push([
          Math.max(margin, Math.min(canvasSize - margin, cx)),
          Math.max(margin, Math.min(canvasSize - margin, cy)),
        ]);
      }
    }
  }

  return centers;
}

// ── Island growth ─────────────────────────────────────────────────────────────

/**
 * Voronoi-partition non-edge polygons among island centers, then take the
 * top `targets[i]` polygons (by squared distance) for each island and
 * BFS-prune each to its largest connected component.
 */
function growIslands(
  polygons: CityPolygon[],
  centers: [number, number][],
  targets: number[],
): Set<number>[] {
  // Assign each non-edge polygon to the nearest center
  const buckets: { id: number; dist: number }[][] = centers.map(() => []);
  for (const p of polygons) {
    if (p.isEdge) continue;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const dx = p.site[0] - centers[i][0];
      const dy = p.site[1] - centers[i][1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    buckets[bestIdx].push({ id: p.id, dist: bestDist });
  }

  // Sort each bucket by distance, take top `targets[i]` polygons
  return buckets.map((bucket, i) => {
    bucket.sort((a, b) => a.dist - b.dist);
    const count = Math.min(targets[i], bucket.length);
    const initial = new Set(bucket.slice(0, count).map(r => r.id));
    return bfsPruneLargestComponent(polygons, initial);
  });
}

/**
 * Reduce a polygon set to its single largest connected component via BFS
 * over `polygon.neighbors`. Returns the largest component as a new Set.
 */
function bfsPruneLargestComponent(
  polygons: CityPolygon[],
  island: Set<number>,
): Set<number> {
  const visited = new Set<number>();
  let largest = new Set<number>();

  for (const seedId of island) {
    if (visited.has(seedId)) continue;
    const component = new Set<number>([seedId]);
    const queue: number[] = [seedId];
    visited.add(seedId);
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      for (const nb of polygons[curr].neighbors) {
        if (island.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          component.add(nb);
          queue.push(nb);
        }
      }
    }
    if (component.size > largest.size) largest = component;
  }

  return largest;
}

// ── Gap trimming ──────────────────────────────────────────────────────────────

/**
 * Remove any polygon that is Delaunay-adjacent to a polygon in a different
 * island, then re-prune each island to its largest connected component.
 * This guarantees a one-polygon water gap between every pair of islands so
 * no island directly touches another.
 */
function trimIslandGaps(
  polygons: CityPolygon[],
  islands: Set<number>[],
): void {
  // Build ownership map
  const ownership = new Map<number, number>();
  for (let i = 0; i < islands.length; i++) {
    for (const id of islands[i]) ownership.set(id, i);
  }

  // Collect conflict polygons (adjacent to a different island)
  const toRemove = new Set<number>();
  for (let i = 0; i < islands.length; i++) {
    for (const polyId of islands[i]) {
      for (const nb of polygons[polyId].neighbors) {
        const nbOwner = ownership.get(nb);
        if (nbOwner !== undefined && nbOwner !== i) {
          toRemove.add(polyId);
          break;
        }
      }
    }
  }

  // Remove conflicts
  for (const polyId of toRemove) {
    const owner = ownership.get(polyId)!;
    islands[owner].delete(polyId);
  }

  // Re-prune each island after trimming
  for (let i = 0; i < islands.length; i++) {
    const pruned = bfsPruneLargestComponent(polygons, islands[i]);
    islands[i].clear();
    for (const id of pruned) islands[i].add(id);
  }
}

// ── Bridge connections ────────────────────────────────────────────────────────

/** Hub-spokes: island 0 (hub) bridges to every satellite. */
function hubSpokeConnections(numIslands: number): [number, number][] {
  const connections: [number, number][] = [];
  for (let i = 1; i < numIslands; i++) connections.push([0, i]);
  return connections;
}

/**
 * Mesh: connect each island to its `MESH_NEIGHBOUR_COUNT` nearest neighbours
 * by centroid distance. Deduplicated so each pair appears once.
 */
function meshConnections(
  islands: Set<number>[],
  polygons: CityPolygon[],
): [number, number][] {
  // Compute island centroids
  const centroids: [number, number][] = islands.map(island => {
    let sx = 0, sy = 0;
    for (const id of island) { sx += polygons[id].site[0]; sy += polygons[id].site[1]; }
    const n = island.size;
    return [sx / (n || 1), sy / (n || 1)];
  });

  const seen = new Set<string>();
  const result: [number, number][] = [];

  for (let i = 0; i < islands.length; i++) {
    // Rank other islands by centroid distance
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < islands.length; j++) {
      if (j === i) continue;
      const dx = centroids[i][0] - centroids[j][0];
      const dy = centroids[i][1] - centroids[j][1];
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((a, b) => a.d - b.d);

    for (let k = 0; k < Math.min(MESH_NEIGHBOUR_COUNT, dists.length); k++) {
      const j = dists[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push([i, j]);
      }
    }
  }

  return result;
}

// ── Bridge segment computation ────────────────────────────────────────────────

/**
 * Find the bridge segment between two islands. The segment runs from the
 * edge-midpoint of the boundary polygon in island A that faces island B,
 * to the corresponding edge-midpoint of island B's boundary polygon facing A.
 *
 * Returns null when either island is empty or no boundary polygon is found.
 */
function computeBridgeSegment(
  polygons: CityPolygon[],
  islands: Set<number>[],
  islandA: number,
  islandB: number,
): SeaIslandBridge | null {
  const setA = islands[islandA];
  const setB = islands[islandB];
  if (setA.size === 0 || setB.size === 0) return null;

  // Island centroids
  let axc = 0, ayc = 0;
  for (const id of setA) { axc += polygons[id].site[0]; ayc += polygons[id].site[1]; }
  axc /= setA.size; ayc /= setA.size;

  let bxc = 0, byc = 0;
  for (const id of setB) { bxc += polygons[id].site[0]; byc += polygons[id].site[1]; }
  bxc /= setB.size; byc /= setB.size;

  // Boundary polygon in A closest to B's centroid
  const pA = nearestBoundaryPolygon(polygons, setA, bxc, byc);
  // Boundary polygon in B closest to A's centroid
  const pB = nearestBoundaryPolygon(polygons, setB, axc, ayc);
  if (!pA || !pB) return null;

  // Edge midpoint of pA that faces pB's site
  const from = closestEdgeMidpoint(pA, pB.site);
  // Edge midpoint of pB that faces pA's site
  const to = closestEdgeMidpoint(pB, pA.site);

  return { islandA, islandB, from, to };
}

/**
 * Find the polygon in `island` that is:
 *  (a) a boundary polygon (has at least one Delaunay neighbor outside the island)
 *  (b) closest to the target point `(tx, ty)`.
 */
function nearestBoundaryPolygon(
  polygons: CityPolygon[],
  island: Set<number>,
  tx: number,
  ty: number,
): CityPolygon | null {
  let best: CityPolygon | null = null;
  let bestDist = Infinity;

  for (const id of island) {
    const p = polygons[id];
    if (!p.neighbors.some(nb => !island.has(nb))) continue; // not a boundary polygon
    const dx = p.site[0] - tx;
    const dy = p.site[1] - ty;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = p; }
  }

  return best;
}

/**
 * Among all consecutive edge midpoints of `poly`, return the one closest to
 * the target point `target`. Falls back to `poly.site` when the polygon has
 * fewer than 3 vertices.
 */
function closestEdgeMidpoint(
  poly: CityPolygon,
  target: [number, number],
): [number, number] {
  const verts = poly.vertices;
  if (verts.length < 3) return [poly.site[0], poly.site[1]];

  let best: [number, number] = [poly.site[0], poly.site[1]];
  let bestDist = Infinity;
  const n = verts.length;

  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = mx - target[0];
    const dy = my - target[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = [mx, my]; }
  }

  return best;
}
