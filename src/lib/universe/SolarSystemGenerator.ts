import { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { starGenerator } from './StarGenerator';
import { planetGenerator } from './PlanetGenerator';
import { seededPRNG } from '../terrain/noise';
import type { SystemKind, StarSubtype } from './SystemKind';
import { SYSTEM_KIND_INFO, pickSystemKind, isStandaloneKind } from './SystemKindInfo';

/**
 * Subset of PlanetaryStarKind that maps cleanly to a single Star.subtype.
 * Used to roll the two star subtypes that compose a binary_star system.
 */
const BINARY_COMPONENT_SUBTYPES: ReadonlyArray<StarSubtype> = [
  'main_sequence',
  'main_sequence',
  'main_sequence',
  'red_dwarf',
  'red_dwarf',
  'white_dwarf',
  'red_giant',
  'blue_giant',
  'neutron_star',
];

function pickFrom<T>(arr: ReadonlyArray<T>, rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export class SolarSystemGenerator {
  generate(universe: Universe, rng: () => number): SolarSystem {
    const solarSystem = new SolarSystem(rng);
    solarSystem.universeId = universe.id;
    solarSystem.composition = rng() < 0.5 ? 'ROCK' : 'GAS';
    universe.addSolarSystem(solarSystem);
    universe.mapSolarSystems.set(solarSystem.id, solarSystem);

    // Kind roll uses an isolated sub-stream so the main rng sequence stays
    // mostly untouched. Skipping the planet loop for standalone kinds will
    // still shift downstream draws, but that's expected.
    const kindRng = seededPRNG(`${universe.seed}_systemkind_${solarSystem.id}`);
    const kind: SystemKind = pickSystemKind(kindRng);
    solarSystem.kind = kind;
    const info = SYSTEM_KIND_INFO[kind];

    // Star count: consume one rng() draw whether or not the range is a point
    // so the main rng is consumed uniformly across kinds.
    const [scMin, scMax] = info.starCount;
    const starCountSpan = Math.max(1, scMax - scMin + 1);
    const starCount = scMin + Math.floor(rng() * starCountSpan);

    // Pre-roll binary component subtypes on the isolated kind sub-stream so
    // main rng is not perturbed for non-binary kinds.
    let binaryComponents: StarSubtype[] | null = null;
    if (kind === 'binary_star') {
      binaryComponents = [
        pickFrom(BINARY_COMPONENT_SUBTYPES, kindRng),
        pickFrom(BINARY_COMPONENT_SUBTYPES, kindRng),
      ];
    }

    // Every SystemKind value except 'binary_star' is also a StarSubtype, so
    // the cast is safe in the non-binary branch.
    const defaultSubtype: StarSubtype =
      kind === 'binary_star' ? 'main_sequence' : (kind as StarSubtype);

    for (let i = 0; i < starCount; i++) {
      const subtype: StarSubtype = binaryComponents ? binaryComponents[i] : defaultSubtype;
      starGenerator.generate(solarSystem, rng, universe, kind, subtype);
    }

    // System name inherits from the primary star (no new rng).
    const primaryStar = solarSystem.stars[0];
    solarSystem.humanName = primaryStar?.humanName ?? solarSystem.id;
    solarSystem.scientificName = primaryStar?.scientificName ?? solarSystem.id;

    // Standalone kinds skip planet generation entirely.
    if (!isStandaloneKind(kind)) {
      const planetCount = solarSystem.stars.length * 2 + Math.floor(rng() * 15);
      for (let i = 0; i < planetCount; i++) {
        planetGenerator.generate(solarSystem, rng, universe);
      }
    }

    return solarSystem;
  }
}

export const solarSystemGenerator = new SolarSystemGenerator();
