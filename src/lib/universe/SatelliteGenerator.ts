import { Satellite } from './Satellite';
import type { Planet } from './Planet';
import type { Universe } from './Universe';
import { generateSatelliteName } from './universeNameGenerator';

export class SatelliteGenerator {
  generate(planet: Planet, rng: () => number, universe: Universe): Satellite {
    const satellite = new Satellite(rng);
    satellite.planetId = planet.id;
    const parentRadius = planet.radius * 10;
    satellite.radius = (Math.floor(rng() * Math.floor(parentRadius)) + parentRadius / 5) / 1000;
    satellite.composition = rng() > 0.5 ? 'ICE' : 'ROCK';
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
