import { Satellite } from './Satellite';
import type { PlanetBiome } from './Planet';
import type { Planet } from './Planet';
import type { Universe } from './Universe';
import { generateSatelliteName } from './universeNameGenerator';

function pickBiome(rng: () => number): PlanetBiome {
  const r = rng();
  if (r < 0.40) return 'default';
  if (r < 0.50) return 'desert';
  if (r < 0.60) return 'ice';
  if (r < 0.70) return 'forest';
  if (r < 0.80) return 'swamp';
  if (r < 0.90) return 'mountains';
  return 'ocean';
}

export class SatelliteGenerator {
  generate(planet: Planet, rng: () => number, universe: Universe): Satellite {
    const satellite = new Satellite(rng);
    satellite.planetId = planet.id;
    const parentRadius = planet.radius * 10;
    satellite.radius = (Math.floor(rng() * Math.floor(parentRadius)) + parentRadius / 5) / 1000;
    satellite.composition = rng() > 0.5 ? 'ICE' : 'ROCK';
    satellite.life = rng() < 0.1;
    if (satellite.composition === 'ROCK' && satellite.life) {
      satellite.biome = pickBiome(rng);
    }
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
