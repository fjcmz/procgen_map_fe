/**
 * Underground map generator — one-shot, deterministic, side-effect-free.
 *
 * The cavern/tunnel graph is built entirely from isolated `${seed}_underground_*`
 * sub-streams so it cannot perturb the surface terrain or history RNG. See
 * `claude_specs/underground_map.md` for the full design.
 */

import { seededPRNG } from '../terrain/noise';
import type { Cell } from '../types';
import type {
  Cavern,
  MazeCluster,
  MazeEdge,
  Point,
  Tunnel,
  UndergroundConnection,
  UndergroundMap,
} from './types';

interface CavernNode {
  id: string;
  cx: number;
  cy: number;
  /** Effective radius used for tunnel-endpoint trimming. */
  radius: number;
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Poisson-disk-ish sampler (Bridson variant, simplified): rejection sampling
 *  with a min-distance check against previously accepted points. Good enough
 *  for cavern centres without the full grid-acceleration. */
function poissonDiskSample(
  rng: () => number,
  width: number,
  height: number,
  minDist: number,
  targetCount: number,
  maxAttempts: number,
  margin: number,
): Point[] {
  const points: Point[] = [];
  const minDistSq = minDist * minDist;
  let attempts = 0;
  while (points.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const x = margin + rng() * (width - 2 * margin);
    const y = margin + rng() * (height - 2 * margin);
    let ok = true;
    for (const p of points) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < minDistSq) {
        ok = false;
        break;
      }
    }
    if (ok) points.push({ x, y });
  }
  return points;
}

/** Build an irregular blob polygon around (cx, cy). Radii are jittered along
 *  N evenly-spaced spokes; the result is a closed CCW polygon. */
function buildBlobPolygon(
  rng: () => number,
  cx: number,
  cy: number,
  baseRadius: number,
  jitter: number,
  spokes: number = 18,
): Point[] {
  const polygon: Point[] = [];
  // Smooth radii via a 1D low-pass over independent draws so the blob doesn't
  // come out spiky.
  const raw: number[] = [];
  for (let i = 0; i < spokes; i++) {
    raw.push(baseRadius * (1 + (rng() * 2 - 1) * jitter));
  }
  const smoothed: number[] = [];
  for (let i = 0; i < spokes; i++) {
    const a = raw[(i - 1 + spokes) % spokes];
    const b = raw[i];
    const c = raw[(i + 1) % spokes];
    smoothed.push((a + b + c) / 3);
  }
  for (let i = 0; i < spokes; i++) {
    const theta = (i / spokes) * Math.PI * 2;
    const r = smoothed[i];
    polygon.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
  }
  return polygon;
}

function polygonAreaApprox(polygon: Point[]): number {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Generate `count` large caverns whose combined area lands near `targetArea`. */
function generateLargeCaverns(
  seed: string,
  width: number,
  height: number,
  targetArea: number,
): Cavern[] {
  const rng = seededPRNG(`${seed}_underground_largecaverns`);
  const count = randInt(rng, 2, 20);
  // Each cavern gets a share of the target area; convert to radius.
  const areaPer = targetArea / count;
  const baseRadius = Math.sqrt(areaPer / Math.PI);
  const minDist = baseRadius * 1.6;
  const margin = baseRadius * 0.9;
  const centres = poissonDiskSample(rng, width, height, minDist, count, count * 60, margin);
  const caverns: Cavern[] = [];
  for (let i = 0; i < centres.length; i++) {
    // Per-cavern radius jitter so they aren't identical.
    const radius = baseRadius * (0.7 + rng() * 0.6);
    const polygon = buildBlobPolygon(rng, centres[i].x, centres[i].y, radius, 0.30, 22);
    caverns.push({
      id: `lg_${i}`,
      cx: centres[i].x,
      cy: centres[i].y,
      polygon,
      areaApprox: polygonAreaApprox(polygon),
    });
  }
  return caverns;
}

function generateSmallCaverns(
  seed: string,
  width: number,
  height: number,
  largeCaverns: Cavern[],
): Cavern[] {
  const rng = seededPRNG(`${seed}_underground_smallcaverns`);
  const count = randInt(rng, 5, 50);
  // Target ~3% of area total split across small caverns — keeps them visibly
  // smaller than the large set.
  const totalArea = 0.03 * width * height;
  const areaPer = totalArea / count;
  const baseRadius = Math.sqrt(areaPer / Math.PI);
  const minDist = baseRadius * 2.4;
  const margin = baseRadius;
  const candidates = poissonDiskSample(rng, width, height, minDist, count, count * 80, margin);
  const caverns: Cavern[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // Reject if centre falls inside a large cavern polygon — small caverns
    // shouldn't overlap large ones (they should hang off them via tunnels).
    let blocked = false;
    for (const lg of largeCaverns) {
      if (pointInPolygon(c.x, c.y, lg.polygon)) { blocked = true; break; }
    }
    if (blocked) continue;
    const radius = baseRadius * (0.7 + rng() * 0.7);
    const polygon = buildBlobPolygon(rng, c.x, c.y, radius, 0.35, 16);
    caverns.push({
      id: `sm_${caverns.length}`,
      cx: c.x,
      cy: c.y,
      polygon,
      areaApprox: polygonAreaApprox(polygon),
    });
  }
  return caverns;
}

function generateMazeClusters(
  seed: string,
  width: number,
  height: number,
  blockers: { cx: number; cy: number; radius: number }[],
): MazeCluster[] {
  const rngTop = seededPRNG(`${seed}_underground_maze_top`);
  const count = randInt(rngTop, 3, 10);
  const clusters: MazeCluster[] = [];
  // Approximate cluster radius — keep them clearly smaller than large caverns.
  const clusterRadius = Math.min(width, height) * 0.05;
  const minDist = clusterRadius * 3;
  const candidates = poissonDiskSample(rngTop, width, height, minDist, count, count * 80, clusterRadius);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // Reject if too close to a large/small cavern centre — keeps maze
    // clusters as distinct features.
    const blocked = blockers.some(b => {
      const dx = b.cx - c.x;
      const dy = b.cy - c.y;
      return dx * dx + dy * dy < (clusterRadius + b.radius) * (clusterRadius + b.radius);
    });
    if (blocked) continue;
    clusters.push(buildMazeCluster(seed, clusters.length, c.x, c.y, clusterRadius));
  }
  return clusters;
}

function buildMazeCluster(
  seed: string,
  index: number,
  cx: number,
  cy: number,
  radius: number,
): MazeCluster {
  const rng = seededPRNG(`${seed}_underground_maze_${index}`);
  // 4–12 mini-caverns on a jittered grid inside the cluster bbox.
  const miniCount = randInt(rng, 4, 12);
  const gridSide = Math.ceil(Math.sqrt(miniCount));
  const cellSize = (radius * 2) / gridSide;
  const miniCaverns: Cavern[] = [];
  const slots: { x: number; y: number; idx: number }[] = [];
  for (let gy = 0; gy < gridSide; gy++) {
    for (let gx = 0; gx < gridSide; gx++) {
      slots.push({
        x: cx - radius + (gx + 0.5) * cellSize,
        y: cy - radius + (gy + 0.5) * cellSize,
        idx: slots.length,
      });
    }
  }
  // Fisher-Yates over slots to pick miniCount of them.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i];
    slots[i] = slots[j];
    slots[j] = tmp;
  }
  const taken = slots.slice(0, miniCount);
  const miniRadius = cellSize * 0.32;
  for (let i = 0; i < taken.length; i++) {
    const s = taken[i];
    // Jitter within the slot so the grid doesn't look mechanical.
    const jx = s.x + (rng() * 2 - 1) * cellSize * 0.15;
    const jy = s.y + (rng() * 2 - 1) * cellSize * 0.15;
    const r = miniRadius * (0.8 + rng() * 0.4);
    const polygon = buildBlobPolygon(rng, jx, jy, r, 0.25, 12);
    miniCaverns.push({
      id: `mz_${index}_${i}`,
      cx: jx,
      cy: jy,
      polygon,
      areaApprox: polygonAreaApprox(polygon),
    });
  }
  // Build an MST over mini-caverns (Prim) + a few extra edges for loops.
  const edges: MazeEdge[] = buildMazeEdges(rng, miniCaverns);
  return {
    id: `mz_${index}`,
    bbox: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 },
    miniCaverns,
    edges,
  };
}

function buildMazeEdges(rng: () => number, miniCaverns: Cavern[]): MazeEdge[] {
  if (miniCaverns.length <= 1) return [];
  const n = miniCaverns.length;
  // Prim's MST on full graph (n is small).
  const inTree = new Array<boolean>(n).fill(false);
  inTree[0] = true;
  const edges: MazeEdge[] = [];
  const usedPairs = new Set<string>();
  while (edges.length < n - 1) {
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const dx = miniCaverns[i].cx - miniCaverns[j].cx;
        const dy = miniCaverns[i].cy - miniCaverns[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;
    inTree[bestJ] = true;
    edges.push(makeJaggedEdge(rng, miniCaverns[bestI], miniCaverns[bestJ]));
    usedPairs.add(edgeKey(miniCaverns[bestI].id, miniCaverns[bestJ].id));
  }
  // Add 1–3 extra random edges for loops.
  const extras = randInt(rng, 1, Math.min(3, n - 1));
  for (let e = 0; e < extras; e++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (j === i) j = (j + 1) % n;
    const key = edgeKey(miniCaverns[i].id, miniCaverns[j].id);
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    edges.push(makeJaggedEdge(rng, miniCaverns[i], miniCaverns[j]));
  }
  return edges;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function makeJaggedEdge(rng: () => number, a: Cavern, b: Cavern): MazeEdge {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Maze passages are short and angular — a small jitter on the midpoint.
  const mx = (a.cx + b.cx) / 2 + (rng() * 2 - 1) * len * 0.12;
  const my = (a.cy + b.cy) / 2 + (rng() * 2 - 1) * len * 0.12;
  return {
    from: a.id,
    to: b.id,
    path: [{ x: a.cx, y: a.cy }, { x: mx, y: my }, { x: b.cx, y: b.cy }],
  };
}

/** MST + a few extra edges over top-level cavern nodes. Uses Prim's; the node
 *  count is well under 100 so the O(n²) cost is fine. */
function buildTunnelGraph(seed: string, nodes: CavernNode[]): Tunnel[] {
  if (nodes.length <= 1) return [];
  const rng = seededPRNG(`${seed}_underground_tunnels`);
  const n = nodes.length;
  const inTree = new Array<boolean>(n).fill(false);
  inTree[0] = true;
  const tunnels: Tunnel[] = [];
  const usedPairs = new Set<string>();
  for (let step = 0; step < n - 1; step++) {
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const dx = nodes[i].cx - nodes[j].cx;
        const dy = nodes[i].cy - nodes[j].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;
    inTree[bestJ] = true;
    tunnels.push({
      from: nodes[bestI].id,
      to: nodes[bestJ].id,
      path: bendyPath(rng, nodes[bestI], nodes[bestJ]),
      mandatory: true,
    });
    usedPairs.add(edgeKey(nodes[bestI].id, nodes[bestJ].id));
  }
  // 10–20% loop edges on top of the MST. Add randomly between distinct nodes.
  const loopCount = clamp(Math.floor((n - 1) * (0.10 + rng() * 0.10)), 0, n);
  for (let e = 0; e < loopCount * 5 && tunnels.length < (n - 1) + loopCount; e++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (j === i) j = (j + 1) % n;
    const key = edgeKey(nodes[i].id, nodes[j].id);
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    tunnels.push({
      from: nodes[i].id,
      to: nodes[j].id,
      path: bendyPath(rng, nodes[i], nodes[j]),
      mandatory: false,
    });
  }
  return tunnels;
}

/** Cubic Bezier-like polyline between two cavern centres, with a perpendicular
 *  bulge so tunnels don't look ruler-straight. */
function bendyPath(rng: () => number, a: CavernNode, b: CavernNode): Point[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return [{ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }];
  // Perpendicular unit vector.
  const px = -dy / len;
  const py = dx / len;
  // Bulge proportional to length; sign random.
  const bulge = (rng() * 2 - 1) * len * 0.15;
  const samples = 12;
  const path: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Quadratic bezier: P0=a, P1=midpoint+bulge*perp, P2=b
    const mx = (a.cx + b.cx) / 2 + px * bulge;
    const my = (a.cy + b.cy) / 2 + py * bulge;
    const x = (1 - t) * (1 - t) * a.cx + 2 * (1 - t) * t * mx + t * t * b.cx;
    const y = (1 - t) * (1 - t) * a.cy + 2 * (1 - t) * t * my + t * t * b.cy;
    path.push({ x, y });
  }
  return path;
}

/** Pick 4–20 surface entrances. Each picks a cavern (weighted by area), then
 *  finds a land surface cell whose centroid lies inside the cavern polygon. */
function generateConnections(
  seed: string,
  cells: Cell[],
  allCaverns: Cavern[],
): UndergroundConnection[] {
  if (allCaverns.length === 0) return [];
  const rng = seededPRNG(`${seed}_underground_connections`);
  const count = randInt(rng, 4, 20);

  // Build a CDF over caverns weighted by area so large caverns dominate but
  // small/maze caverns still occasionally get an entrance.
  const weights = allCaverns.map(c => Math.max(1, c.areaApprox));
  const total = weights.reduce((a, b) => a + b, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w / total;
    cdf.push(acc);
  }

  const connections: UndergroundConnection[] = [];
  const usedCells = new Set<number>();
  let attempts = 0;
  const maxAttempts = count * 30;
  while (connections.length < count && attempts < maxAttempts) {
    attempts++;
    const r = rng();
    let cavIdx = cdf.findIndex(v => v >= r);
    if (cavIdx < 0) cavIdx = cdf.length - 1;
    const cavern = allCaverns[cavIdx];
    // Find a land cell whose centroid sits inside the cavern polygon.
    const candidate = findLandCellInPolygon(cells, cavern, rng);
    if (candidate === null || usedCells.has(candidate)) continue;
    const cell = cells[candidate];
    connections.push({
      cavernId: cavern.id,
      surfaceCellIndex: candidate,
      xy: { x: cell.x, y: cell.y },
    });
    usedCells.add(candidate);
  }
  return connections;
}

function findLandCellInPolygon(
  cells: Cell[],
  cavern: Cavern,
  rng: () => number,
): number | null {
  // Pick a few random cells; check each for (a) land and (b) centroid inside
  // the cavern polygon. If none hit, fall back to the nearest land cell to
  // the cavern centre.
  const tries = 24;
  for (let i = 0; i < tries; i++) {
    const idx = Math.floor(rng() * cells.length);
    const c = cells[idx];
    if (c.isWater || c.isLake) continue;
    if (pointInPolygon(c.x, c.y, cavern.polygon)) return idx;
  }
  // Fallback: nearest land cell to cavern centre. O(N) scan over all cells;
  // OK because total connection count is small.
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.isWater || c.isLake) continue;
    const dx = c.x - cavern.cx;
    const dy = c.y - cavern.cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx >= 0 ? bestIdx : null;
}

export function generateUnderground(
  seed: string,
  width: number,
  height: number,
  cells: Cell[],
): UndergroundMap {
  const targetLargeArea = 0.30 * width * height;
  const largeCaverns = generateLargeCaverns(seed, width, height, targetLargeArea);
  const smallCaverns = generateSmallCaverns(seed, width, height, largeCaverns);

  // Blockers for maze placement — keep mazes from sitting on top of caverns.
  const blockers = [
    ...largeCaverns.map(c => ({ cx: c.cx, cy: c.cy, radius: Math.sqrt(c.areaApprox / Math.PI) })),
    ...smallCaverns.map(c => ({ cx: c.cx, cy: c.cy, radius: Math.sqrt(c.areaApprox / Math.PI) })),
  ];
  const mazeClusters = generateMazeClusters(seed, width, height, blockers);

  // Top-level tunnel nodes: large caverns, small caverns, and each maze cluster
  // (treated as a single node anchored at the cluster centroid).
  const nodes: CavernNode[] = [
    ...largeCaverns.map(c => ({
      id: c.id,
      cx: c.cx,
      cy: c.cy,
      radius: Math.sqrt(c.areaApprox / Math.PI),
    })),
    ...smallCaverns.map(c => ({
      id: c.id,
      cx: c.cx,
      cy: c.cy,
      radius: Math.sqrt(c.areaApprox / Math.PI),
    })),
    ...mazeClusters.map(m => ({
      id: m.id,
      cx: m.bbox.x + m.bbox.w / 2,
      cy: m.bbox.y + m.bbox.h / 2,
      radius: Math.min(m.bbox.w, m.bbox.h) * 0.5,
    })),
  ];
  const tunnels = buildTunnelGraph(seed, nodes);

  // Connections: sampled across caverns + maze clusters. Mazes report their
  // bbox centroid for connection placement.
  const cavernsForConnection: Cavern[] = [
    ...largeCaverns,
    ...smallCaverns,
    // Synthesize a Cavern-like proxy for each maze cluster so the area-
    // weighted CDF in generateConnections works uniformly.
    ...mazeClusters.map(m => {
      const cx = m.bbox.x + m.bbox.w / 2;
      const cy = m.bbox.y + m.bbox.h / 2;
      const r = Math.min(m.bbox.w, m.bbox.h) * 0.45;
      // Build a rough octagon as the "polygon" so pointInPolygon works.
      const polygon: Point[] = [];
      for (let i = 0; i < 8; i++) {
        const theta = (i / 8) * Math.PI * 2;
        polygon.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
      }
      return {
        id: m.id,
        cx,
        cy,
        polygon,
        areaApprox: Math.PI * r * r,
      };
    }),
  ];
  const connections = generateConnections(seed, cells, cavernsForConnection);

  return {
    seed: `${seed}_underground`,
    width,
    height,
    largeCaverns,
    smallCaverns,
    mazeClusters,
    tunnels,
    connections,
  };
}
