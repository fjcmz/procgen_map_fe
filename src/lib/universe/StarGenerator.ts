import { Star } from './Star';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';

export class StarGenerator {
  generate(solarSystem: SolarSystem, rng: () => number, universe: Universe): Star {
    const star = new Star(rng);
    star.solarSystemId = solarSystem.id;
    star.radius = (Math.floor(rng() * 500000) + 400000) / 1000;
    star.brightness = Math.floor(rng() * 900) + 100;
    star.composition = rng() < 0.5 ? 'MATTER' : 'ANTIMATTER';
    solarSystem.stars.push(star);
    universe.mapStars.set(star.id, star);
    return star;
  }
}

export const starGenerator = new StarGenerator();
