import { Universe } from './Universe';
import { Galaxy } from './Galaxy';
import { solarSystemGenerator } from './SolarSystemGenerator';
import { rndSize } from './helpers';
import { generateGalaxyName, generateUniverseName } from './universeNameGenerator';
import { layoutGalaxies } from './galaxyLayout';

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
    for (let i = 0; i < solarSystemCount; i++) {
      solarSystemGenerator.generate(universe, rng);
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
      universe.galaxies.push(galaxy);
      universe.mapGalaxies.set(galaxy.id, galaxy);
    }

    layoutGalaxies(universe.galaxies, seed);

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
