import { Satellite } from './Satellite';
import type { Planet } from './Planet';
import type { Universe } from './Universe';

export class SatelliteGenerator {
  generate(planet: Planet, rng: () => number, universe: Universe): Satellite {
    const satellite = new Satellite(rng);
    satellite.planetId = planet.id;
    const parentRadius = planet.radius * 10;
    satellite.radius = (Math.floor(rng() * Math.floor(parentRadius)) + parentRadius / 5) / 1000;
    satellite.composition = rng() > 0.5 ? 'ICE' : 'ROCK';
    planet.satellites.push(satellite);
    universe.mapSatellites.set(satellite.id, satellite);
    return satellite;
  }
}

export const satelliteGenerator = new SatelliteGenerator();
