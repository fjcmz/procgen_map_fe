import { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { starGenerator } from './StarGenerator';
import { planetGenerator } from './PlanetGenerator';
import { rndSize } from './helpers';
import type { UniverseCatalogueSnapshot } from '../extensions/registry';

export class SolarSystemGenerator {
  generate(universe: Universe, rng: () => number, catalogue: UniverseCatalogueSnapshot): SolarSystem {
    const solarSystem = new SolarSystem(rng);
    solarSystem.universeId = universe.id;
    solarSystem.composition = rng() < 0.5 ? 'ROCK' : 'GAS';
    universe.addSolarSystem(solarSystem);
    universe.mapSolarSystems.set(solarSystem.id, solarSystem);

    const starCount = rndSize(rng, 3, 1);
    for (let i = 0; i < starCount; i++) {
      starGenerator.generate(solarSystem, rng, universe);
    }

    // Solar system name derives from primary star — no new RNG needed.
    const primaryStar = solarSystem.stars[0];
    solarSystem.humanName = primaryStar?.humanName ?? solarSystem.id;
    solarSystem.scientificName = primaryStar?.scientificName ?? solarSystem.id;

    const planetCount = solarSystem.stars.length * 2 + Math.floor(rng() * 15);
    for (let i = 0; i < planetCount; i++) {
      planetGenerator.generate(solarSystem, rng, universe, catalogue);
    }

    return solarSystem;
  }
}

export const solarSystemGenerator = new SolarSystemGenerator();
