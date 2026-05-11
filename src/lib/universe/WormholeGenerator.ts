import { Wormhole } from './Wormhole';
import type { SolarSystem } from './SolarSystem';
import type { Universe } from './Universe';
import { seededPRNG } from '../terrain/noise';
import { generateWormholeName } from './universeNameGenerator';

/**
 * Per-wormhole offset distance from the system view's centre, in content-space
 * units. Tuned to sit clearly outside the central exotic body (whose widest
 * dramatic halo, e.g. a supermassive black hole's accretion ring, stretches
 * out to a few star-pixel multiples) without colliding with the canvas edge.
 *
 * The system view uses `minSide` for its own scaling, but wormholes need a
 * value that's stable across viewports. The renderer multiplies our offset by
 * the system view's `minSide` (via a constant) so the visual placement scales
 * with the viewport. We bake the offset as a unit-vector tuple here.
 */
const WORMHOLE_RADIUS_BASE = 0.18; // fraction of minSide — set by renderer
const WORMHOLE_RADIUS_JITTER = 0.04;

/**
 * 20% chance of one wormhole, 10% of two, 70% of none. Sequence used: first
 * draw decides whether any wormhole is present, second draw promotes to two.
 * Implemented in {@link rollWormholeCount} so the contract is reusable / unit-
 * testable without instantiating the generator.
 */
export function rollWormholeCount(rng: () => number): number {
  const r = rng();
  if (r < 0.10) return 2;
  if (r < 0.30) return 1;
  return 0;
}

export class WormholeGenerator {
  /**
   * Generate a single Wormhole attached to a standalone-kind solar system.
   * The caller is responsible for:
   *   - gating creation behind `isStandaloneKind(system.kind)`
   *   - supplying the system's parent galaxy id
   *   - rolling the per-system count via {@link rollWormholeCount}
   *
   * Partner resolution does NOT happen here — it runs as a separate global
   * pass after every standalone system has emitted its wormholes (see
   * `pairWormholes`).
   *
   * Uses two isolated sub-streams:
   *   - `${seed}_wormhole_create_${systemId}_${indexInSystem}` for the id /
   *     offset rolls — keyed off the system id + per-system index so adding a
   *     wormhole to a previously-empty system doesn't shift existing ids in
   *     other systems.
   *   - `${seed}_wormholename_${wormholeId}` (inside `generateWormholeName`)
   *     for the catalog designation.
   */
  generate(
    system: SolarSystem,
    galaxyId: string,
    indexInSystem: number,
    universe: Universe,
  ): Wormhole {
    const createRng = seededPRNG(
      `${universe.seed}_wormhole_create_${system.id}_${indexInSystem}`
    );
    const wormhole = new Wormhole(createRng);
    wormhole.solarSystemId = system.id;
    wormhole.galaxyId = galaxyId;

    // Fixed angular position around the centre. Distribute the 1 or 2
    // wormholes per system on a coarse 8-slot ring (so they don't overlap the
    // central body or each other) with a small per-wormhole angular wobble.
    // Distance gets ±jitter so multiple wormholes don't sit on a perfect arc.
    const slot = indexInSystem * (Math.PI * 2 / 2); // 0, π for indices 0, 1
    const wobble = (createRng() - 0.5) * (Math.PI / 6); // ±30°
    const angle = slot + wobble + Math.PI / 4;         // base rotation so neither sits straight up
    const dist = WORMHOLE_RADIUS_BASE + (createRng() - 0.5) * WORMHOLE_RADIUS_JITTER;
    wormhole.offsetX = Math.cos(angle) * dist;
    wormhole.offsetY = Math.sin(angle) * dist;

    system.wormholes.push(wormhole);
    universe.mapWormholes.set(wormhole.id, wormhole);

    const { scientific } = generateWormholeName(
      universe.seed,
      wormhole.id,
      system.id,
      indexInSystem,
      universe.usedWormholeNames,
    );
    wormhole.scientificName = scientific;

    return wormhole;
  }
}

export const wormholeGenerator = new WormholeGenerator();

/**
 * Pair every wormhole with another reciprocally. Per-roll target: 90%
 * same-galaxy partner, 10% cross-galaxy. Falls back to the other bucket if the
 * preferred one is exhausted. If both buckets are empty (e.g. one wormhole in
 * the universe, or a universe with all wormholes in the same galaxy and only
 * one of them needs cross-galaxy), the wormhole stays unpaired (`partnerId =
 * null`) — the popup surfaces this as "Unconnected".
 *
 * Uses a single isolated sub-stream `${seed}_wormhole_pairing` so the pairing
 * order is deterministic and independent of any other random draws. Walks
 * wormholes in id-sorted order so insertion order in `universe.mapWormholes`
 * never affects pairing.
 */
export function pairWormholes(universe: Universe): void {
  const all = Array.from(universe.mapWormholes.values()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (all.length < 2) return;

  const pairRng = seededPRNG(`${universe.seed}_wormhole_pairing`);
  const unpaired = new Set(all);

  for (const w of all) {
    if (w.partnerId !== null) continue;
    unpaired.delete(w);

    const sameGalaxy: typeof all = [];
    const otherGalaxy: typeof all = [];
    for (const u of unpaired) {
      if (u.galaxyId === w.galaxyId) sameGalaxy.push(u);
      else otherGalaxy.push(u);
    }

    const prefersSame = pairRng() < 0.90;
    const primary = prefersSame ? sameGalaxy : otherGalaxy;
    const fallback = prefersSame ? otherGalaxy : sameGalaxy;
    const pool = primary.length > 0 ? primary : fallback;
    if (pool.length === 0) continue; // stays unpaired

    const pick = pool[Math.floor(pairRng() * pool.length)];
    w.partnerId = pick.id;
    pick.partnerId = w.id;
    unpaired.delete(pick);
  }
}
