import { IdUtil } from '../history/IdUtil';
import type { SolarSystem } from './SolarSystem';
import type { Star } from './Star';
import type { Planet } from './Planet';
import type { Satellite } from './Satellite';
import type { Galaxy } from './Galaxy';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Universe {
  readonly id: string;
  /**
   * Captured worker seed string so future linking work can derive isolated
   * PRNG sub-streams via `seededPRNG(`${seed}_universe_<id>`)` without
   * perturbing the main terrain/history RNGs. Mirrors `World.seed`. Empty
   * string when no seed is supplied (sub-stream draws are still deterministic,
   * just keyed off the empty-string root).
   */
  readonly seed: string;
  humanName: string = '';
  scientificName: string = '';
  solarSystems: SolarSystem[] = [];
  galaxies: Galaxy[] = [];
  // Indexes
  mapSolarSystems: Map<string, SolarSystem> = new Map();
  mapStars: Map<string, Star> = new Map();
  mapPlanets: Map<string, Planet> = new Map();
  mapSatellites: Map<string, Satellite> = new Map();
  mapGalaxies: Map<string, Galaxy> = new Map();
  // Per-tier used-name sets for deduplication within a generation run
  usedStarNames: Set<string> = new Set();
  usedPlanetNames: Set<string> = new Set();
  usedSatelliteNames: Set<string> = new Set();

  constructor(rng: () => number, seed: string = '') {
    this.id = IdUtil.id('universe', rngHex(rng)) ?? 'universe_unknown';
    this.seed = seed;
  }

  addSolarSystem(solarSystem: SolarSystem): void {
    this.solarSystems.push(solarSystem);
    // universeId and mapSolarSystems are set by SolarSystemGenerator.
  }
}
