/**
 * Underground map data shapes — plain data (no Map/Set) so the worker can
 * ship them across `postMessage` natively. See `claude_specs/underground_map.md`.
 *
 * The underground uses its own Voronoi polygon graph (sized independently of
 * the surface) so caverns are sets of polygons and tunnels are single-cell-
 * wide chains, matching the surface map's visual language.
 */

export interface Point {
  x: number;
  y: number;
}

export type UndergroundCellCategory = 'solid' | 'cavern' | 'tunnel';

export type CavernKind = 'large' | 'small' | 'maze';

/** A single Voronoi cell of the underground graph. Geometric fields are
 *  copied out of `terrain/voronoi.buildCellGraph` after generation; only
 *  the bits the renderer needs are preserved (no biome, no elevation, etc). */
export interface UndergroundCell {
  index: number;
  x: number;
  y: number;
  vertices: [number, number][];
  /** Secondary polygon for cells that straddle the east-west seam.
   *  Mirrors `Cell.wrapVertices`. */
  wrapVertices?: [number, number][];
  neighbors: number[];
  category: UndergroundCellCategory;
  /** Cavern this cell belongs to. Solid cells: always null. Cavern cells:
   *  the owning cavern. Tunnel cells: null for inter-cavern tunnels;
   *  a maze cluster id for tunnels internal to that cluster (so the
   *  renderer can paint the whole cluster cohesively). */
  cavernId: string | null;
}

/** Cavern metadata. Cells live on `UndergroundMap.cells`; this record holds
 *  the per-cavern aggregate. */
export interface Cavern {
  id: string;
  kind: CavernKind;
  /** Indices into `UndergroundMap.cells`. */
  cellIndices: number[];
  cx: number;
  cy: number;
}

/** A surface↔underground connection point. */
export interface UndergroundConnection {
  /** ID of the cavern reached through this entrance. */
  cavernId: string;
  /** Cell index in the SURFACE graph (i.e. into `MapData.cells`). */
  surfaceCellIndex: number;
  /** Cell index in the UNDERGROUND graph (inside the owning cavern). */
  undergroundCellIndex: number;
  /** Surface-coordinate position of the entrance icon. */
  xy: Point;
}

export interface UndergroundMap {
  seed: string;
  width: number;
  height: number;
  cells: UndergroundCell[];
  caverns: Cavern[];
  connections: UndergroundConnection[];
}
