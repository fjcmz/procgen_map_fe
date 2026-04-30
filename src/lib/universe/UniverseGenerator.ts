import { Universe } from './Universe';
import { solarSystemGenerator } from './SolarSystemGenerator';
import { rndSize } from './helpers';
import { generateGalaxyName } from './universeNameGenerator';

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
    // Galaxy name uses an isolated sub-stream — placed after physics generation
    // so it never perturbs any physics RNG calls.
    const galaxyName = generateGalaxyName(seed);
    universe.humanName = galaxyName.human;
    universe.scientificName = galaxyName.scientific;
    return universe;
  }
}

export const universeGenerator = new UniverseGenerator();
