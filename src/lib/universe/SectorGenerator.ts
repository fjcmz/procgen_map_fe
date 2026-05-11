import { Sector } from './Sector';
import type { Galaxy } from './Galaxy';
import { balanceSites } from './sectorBalance';
import { galaxyOvalPositions, galaxySpiralPositions } from './renderer';
import { generateSectorName } from './universeNameGenerator';

/**
 * Generates sectors for a single galaxy. Sectors are a balanced Voronoi
 * partition of the galaxy's star positions, each containing 2–4 stars; see
 * `sectorBalance.ts` for the algorithm.
 *
 * The star positions used here come from the same `galaxySpiralPositions` /
 * `galaxyOvalPositions` helpers the renderer uses, so the visual mesh
 * (rebuilt at draw time from `sector.cx/cy`) lines up exactly with the
 * sector membership stored in the data.
 *
 * Each sector gets a `SEC-XXXX` scientific name from an isolated sub-stream
 * (`${seed}_sectorname_${sectorId}`). Sectors do not carry human names.
 *
 * Side effects:
 *  - Populates `galaxy.sectors`.
 *  - Sets `sectorId` on every `SolarSystem` in the galaxy.
 */
class SectorGenerator {
  generate(galaxy: Galaxy, universeSeed: string): void {
    const systems = galaxy.solarSystems;
    galaxy.sectors = [];
    if (systems.length === 0) return;

    // Compute star positions in unit-local galaxy frame (cx=0, cy=0, spread=1).
    // Both galaxySpiralPositions and galaxyOvalPositions are linear in spread
    // and translated by (cx, cy), so the renderer can transform these centroids
    // to canvas coords via `(cx + sec.cx * spread, cy + sec.cy * spread)`
    // regardless of which (cx, cy, spread) it's using for that frame
    // (focus mode, single-galaxy, multi-galaxy each pick their own).
    const rawPositions = galaxy.shape === 'oval'
      ? galaxyOvalPositions(systems.length, 0, 0, 1, galaxy.id)
      : galaxySpiralPositions(systems.length, 0, 0, 1);

    const { sites, assignment } = balanceSites(rawPositions, galaxy.id);
    if (sites.length === 0) return;

    const sectors: Sector[] = sites.map((site, i) => {
      const id = `${galaxy.id}_sec_${i}`;
      const sector = new Sector(id, site[0], site[1], galaxy.id);
      sector.scientificName = generateSectorName(universeSeed, id).scientific;
      return sector;
    });

    for (let i = 0; i < systems.length; i++) {
      const sector = sectors[assignment[i]];
      sector.solarSystems.push(systems[i]);
      systems[i].sectorId = sector.id;
    }

    galaxy.sectors = sectors;
  }
}

export const sectorGenerator = new SectorGenerator();
