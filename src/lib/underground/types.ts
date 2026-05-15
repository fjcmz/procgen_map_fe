/**
 * Underground map data shapes — plain data (no Map/Set) so the worker can
 * ship them across `postMessage` natively. See `claude_specs/underground_map.md`.
 */

export interface Point {
  x: number;
  y: number;
}

/** A single cavern (large, small, or maze mini-cavern). */
export interface Cavern {
  id: string;
  cx: number;
  cy: number;
  /** Closed polygon in world coordinates, CCW. First point is NOT repeated at the end. */
  polygon: Point[];
  /** Rough area in world-squared units; used for connection sampling weights. */
  areaApprox: number;
}

/** A maze cluster — a dungeon-room-style group of mini-caverns wired together. */
export interface MazeCluster {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  miniCaverns: Cavern[];
  /** Internal passages between mini-caverns. */
  edges: MazeEdge[];
}

export interface MazeEdge {
  from: string;
  to: string;
  path: Point[];
}

/** A tunnel between two top-level cavern nodes (large/small caverns or maze clusters). */
export interface Tunnel {
  from: string;
  to: string;
  path: Point[];
  /** True for MST edges (mandatory connectivity); false for extra loop edges. */
  mandatory: boolean;
}

/** A surface↔underground connection point. */
export interface UndergroundConnection {
  /** ID of the cavern (or maze cluster) reached through this entrance. */
  cavernId: string;
  /** Index into MapData.cells of the surface tile where the entrance sits. */
  surfaceCellIndex: number;
  /** World-coordinate position of the entrance icon. */
  xy: Point;
}

export interface UndergroundMap {
  seed: string;
  width: number;
  height: number;
  largeCaverns: Cavern[];
  smallCaverns: Cavern[];
  mazeClusters: MazeCluster[];
  tunnels: Tunnel[];
  connections: UndergroundConnection[];
}
