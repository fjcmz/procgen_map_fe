import { Universe } from './Universe';
import { Galaxy } from './Galaxy';
import { solarSystemGenerator } from './SolarSystemGenerator';
import { sectorGenerator } from './SectorGenerator';
import { rndSize } from './helpers';
import { generateGalaxyName, generateUniverseName } from './universeNameGenerator';
import { layoutGalaxies } from './galaxyLayout';
import { seededPRNG } from '../terrain/noise';
import { isStandaloneKind } from './SystemKind';
import { wormholeGenerator, rollWormholeCount, pairWormholes } from './WormholeGenerator';

export interface UniverseGenerateOptions {
  /**
   * If supplied, overrides the default `rndSize(rng, 5, 1)` system count.
   * Threaded in by the universegen worker so the overlay can expose a
   * num-systems slider. Omitting it preserves the legacy 1–5 default
   * (used by any non-worker call sites and by tests).
   */
  numSolarSystems?: number;
  /**
   * Optional progress callback: receives a 0..1 fraction every time another
   * solar system finishes generating. Used by the worker to drive the
   * progress bar without coupling the generator to `postMessage`.
   */
  onProgress?: (fraction: number) => void;
  /**
   * When true, planet/satellite generators consume the same rng draws as the
   * default path but discard the `life` + biome roll — those fields are
   * owned by `UniverseHistoryGenerator` (run by the worker after this
   * pipeline completes). Keeping the draws preserves byte-stable orbits /
   * subtypes / composition between history-on and history-off for the same
   * seed.
   */
  generateHistory?: boolean;
}

/**
 * Galaxy grouping rules:
 *   - ≤ MAX_SYSTEMS_PER_GALAXY (100): a single galaxy wraps every system; the
 *     UI hides the galaxy level and the renderer falls back to legacy
 *     single-spiral behavior (byte-identical to pre-grouping).
 *   - >  MAX_SYSTEMS_PER_GALAXY: split into `ceil(N/MAX)` equal-sized
 *     sequential chunks; group sizes differ by at most 1.
 */
const MAX_SYSTEMS_PER_GALAXY = 100;

export class UniverseGenerator {
  generate(rng: () => number, seed: string = '', opts: UniverseGenerateOptions = {}): Universe {
    const universe = new Universe(rng, seed);
    const solarSystemCount = opts.numSolarSystems ?? rndSize(rng, 5, 1);
    const generateHistory = !!opts.generateHistory;
    for (let i = 0; i < solarSystemCount; i++) {
      solarSystemGenerator.generate(universe, rng, generateHistory);
      if (opts.onProgress && solarSystemCount > 0) {
        opts.onProgress((i + 1) / solarSystemCount);
      }
    }

    // Universe + galaxy names use isolated PRNG sub-streams — placed after
    // physics generation so they never perturb any physics RNG calls.
    const numGalaxies = Math.max(1, Math.ceil(universe.solarSystems.length / MAX_SYSTEMS_PER_GALAXY));
    const groupSize = Math.ceil(universe.solarSystems.length / numGalaxies);
    for (let i = 0; i < numGalaxies; i++) {
      const galaxy = new Galaxy(i);
      const start = i * groupSize;
      const end = Math.min(start + groupSize, universe.solarSystems.length);
      galaxy.solarSystems = universe.solarSystems.slice(start, end);
      const name = generateGalaxyName(`${seed}_galaxy_${i}`);
      galaxy.humanName = name.human;
      galaxy.scientificName = name.scientific;
      galaxy.shape = seededPRNG(`${seed}_galaxy_shape_${i}`)() < 0.5 ? 'spiral' : 'oval';
      universe.galaxies.push(galaxy);
      universe.mapGalaxies.set(galaxy.id, galaxy);
    }

    layoutGalaxies(universe.galaxies, seed);

    // Sectors depend on the baked galaxy layout (cx/cy/spread/shape) — they
    // group each galaxy's stars into balanced 2-4-star Voronoi cells. Run
    // after layoutGalaxies so the star positions used for balancing match
    // exactly what the renderer will draw.
    for (const galaxy of universe.galaxies) {
      sectorGenerator.generate(galaxy, seed);
    }

    // Wormhole generation phase. Runs after galaxy assignment so every
    // standalone system already knows its parent galaxy id — required for
    // the 90/10 same-galaxy / cross-galaxy pairing bias. Isolated sub-streams
    // keep this feature byte-stable independent of anything else.
    const systemToGalaxy = new Map<string, string>();
    for (const galaxy of universe.galaxies) {
      for (const sys of galaxy.solarSystems) {
        systemToGalaxy.set(sys.id, galaxy.id);
      }
    }
    for (const sys of universe.solarSystems) {
      if (!isStandaloneKind(sys.kind)) continue;
      const galaxyId = systemToGalaxy.get(sys.id) ?? '';
      const countRng = seededPRNG(`${seed}_wormhole_count_${sys.id}`);
      const count = rollWormholeCount(countRng);
      for (let i = 0; i < count; i++) {
        wormholeGenerator.generate(sys, galaxyId, i, universe);
      }
    }
    pairWormholes(universe);

    if (universe.galaxies.length === 1) {
      // Legacy single-galaxy case: name the universe with the same galaxy
      // name so existing UI labels ("↑ Galaxy", breadcrumb "Galaxy", etc.)
      // continue to make sense.
      const gal = universe.galaxies[0];
      universe.humanName = gal.humanName;
      universe.scientificName = gal.scientificName;
    } else {
      const universeName = generateUniverseName(seed);
      universe.humanName = universeName.human;
      universe.scientificName = universeName.scientific;
    }

    return universe;
  }
}

export const universeGenerator = new UniverseGenerator();
