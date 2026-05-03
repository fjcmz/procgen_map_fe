import { Satellite } from './Satellite';
import type { Planet } from './Planet';
import type { Universe } from './Universe';
import { generateSatelliteName } from './universeNameGenerator';
import { seededPRNG } from '../terrain/noise';
import type { UniverseCatalogueSnapshot } from '../extensions/registry';
import { pickSubtype, pickBiome } from '../extensions/picker';

export class SatelliteGenerator {
  generate(
    planet: Planet,
    rng: () => number,
    universe: Universe,
    catalogue: UniverseCatalogueSnapshot,
  ): Satellite {
    const satellite = new Satellite(rng);
    satellite.planetId = planet.id;
    const parentRadius = planet.radius * 10;
    satellite.radius = (Math.floor(rng() * Math.floor(parentRadius)) + parentRadius / 5) / 1000;
    satellite.composition = rng() > 0.5 ? 'ICE' : 'ROCK';
    satellite.life = rng() < 0.1;
    if (satellite.composition === 'ROCK' && satellite.life) {
      satellite.biome = pickBiome(catalogue.satellite.biomeWeights, rng, 'default');
    }
    const subRng = seededPRNG(`${universe.seed}_satsubtype_${satellite.id}`);
    satellite.subtype = pickSubtype(
      catalogue.satellite.rollRules,
      {
        composition: satellite.composition,
        life: satellite.life,
        biome: satellite.biome,
        parentOrbit: planet.orbit,
      },
      subRng,
      'terrestrial',
    );
    // Read moon index BEFORE pushing — same convention as PlanetGenerator for orbit.
    const moonIndex = planet.satellites.length;
    planet.satellites.push(satellite);
    universe.mapSatellites.set(satellite.id, satellite);
    // Isolated sub-stream — no physics RNG perturbed.
    const { human, scientific } = generateSatelliteName(
      universe.seed, satellite.id, planet.scientificName, moonIndex, universe.usedSatelliteNames,
    );
    satellite.humanName = human;
    satellite.scientificName = scientific;
    return satellite;
  }
}

export const satelliteGenerator = new SatelliteGenerator();
