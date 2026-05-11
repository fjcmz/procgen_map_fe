import type { SolarSystem } from './SolarSystem';

/**
 * Runtime sector entity. Lives only inside the worker — flattened into
 * `SectorData` for postMessage. Created by `SectorGenerator` after each
 * galaxy's solar systems have been generated and laid out.
 *
 * `cx` / `cy` are in raw galaxy-frame coordinates (same coordinate system as
 * the rendered star positions), so the renderer can derive the visual Voronoi
 * mesh directly from `sectors[].cx/cy` without re-running the balancing pass.
 *
 * Sectors carry a scientific name only — no human name.
 */
export class Sector {
  readonly id: string;
  scientificName: string = '';
  solarSystems: SolarSystem[] = [];
  cx: number;
  cy: number;
  galaxyId: string;

  constructor(id: string, cx: number, cy: number, galaxyId: string) {
    this.id = id;
    this.cx = cx;
    this.cy = cy;
    this.galaxyId = galaxyId;
  }
}
