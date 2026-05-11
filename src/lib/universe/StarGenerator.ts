import { Star } from './Star';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { generateStarName } from './universeNameGenerator';
import type { SystemKind, StarSubtype } from './SystemKind';
import { SYSTEM_KIND_INFO } from './SystemKindInfo';

export class StarGenerator {
  /**
   * Generate one star. The `kind` and `subtype` arguments are kind-aware:
   * `kind` is the parent system's archetype (drives catalog prefix), `subtype`
   * is the per-star body type. For most kinds `subtype === kind`; for
   * 'binary_star' each star is one of the regular planetary star subtypes
   * (e.g. main_sequence + red_dwarf) precomputed by SolarSystemGenerator.
   */
  generate(
    solarSystem: SolarSystem,
    rng: () => number,
    universe: Universe,
    kind: SystemKind = 'main_sequence',
    subtype: StarSubtype = 'main_sequence',
  ): Star {
    const star = new Star(rng);
    star.solarSystemId = solarSystem.id;
    star.subtype = subtype;

    // Use the subtype's radius/brightness ranges, falling back to the kind's.
    const subtypeInfo = SYSTEM_KIND_INFO[subtype as SystemKind] ?? SYSTEM_KIND_INFO[kind];
    const [rMin, rMax] = subtypeInfo.radiusRange;
    const [bMin, bMax] = subtypeInfo.brightnessRange;
    // Preserve the same number of rng() calls as the legacy generator.
    star.radius = rMin + Math.floor(rng() * Math.max(1, (rMax - rMin) * 1000)) / 1000;
    star.brightness = bMin + Math.floor(rng() * Math.max(1, (bMax - bMin) + 1));
    star.composition = rng() < 0.5 ? 'MATTER' : 'ANTIMATTER';

    solarSystem.stars.push(star);
    universe.mapStars.set(star.id, star);

    // Naming uses an isolated sub-stream; `kind` only affects catalog prefix.
    const { human, scientific } = generateStarName(universe.seed, star.id, universe.usedStarNames, kind);
    star.humanName = human;
    star.scientificName = scientific;
    return star;
  }
}

export const starGenerator = new StarGenerator();
