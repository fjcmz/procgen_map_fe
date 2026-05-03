import { seededPRNG } from '../lib/terrain';
import { universeGenerator } from '../lib/universe/UniverseGenerator';
import type { Universe } from '../lib/universe/Universe';
import type {
  UniverseData,
  UniverseGenerateRequest,
  UniverseWorkerMessage,
  SolarSystemData,
  GalaxyData,
} from '../lib/universe/types';

function post(msg: UniverseWorkerMessage): void {
  self.postMessage(msg);
}

/**
 * Flatten the runtime `Universe` (with its `Map<string, …>` indexes) into a
 * structured-clone-safe `UniverseData`. Mirrors how `mapgen.worker.ts`
 * serializes `World` into `RegionData[]` / `ContinentData[]` before
 * postMessage.
 */
function serializeUniverse(universe: Universe): UniverseData {
  const solarSystems: SolarSystemData[] = universe.solarSystems.map(ss => ({
    id: ss.id,
    humanName: ss.humanName,
    scientificName: ss.scientificName,
    composition: ss.composition,
    stars: ss.stars.map(star => ({
      id: star.id,
      humanName: star.humanName,
      scientificName: star.scientificName,
      radius: star.radius,
      brightness: star.brightness,
      composition: star.composition,
    })),
    planets: ss.planets.map(planet => ({
      id: planet.id,
      humanName: planet.humanName,
      scientificName: planet.scientificName,
      radius: planet.radius,
      orbit: planet.orbit,
      life: planet.life,
      composition: planet.composition,
      subtype: planet.subtype,
      biome: planet.biome,
      satellites: planet.satellites.map(sat => ({
        id: sat.id,
        humanName: sat.humanName,
        scientificName: sat.scientificName,
        radius: sat.radius,
        composition: sat.composition,
        subtype: sat.subtype,
        life: sat.life,
        biome: sat.biome,
      })),
    })),
  }));
  const galaxies: GalaxyData[] = universe.galaxies.map(g => ({
    id: g.id,
    humanName: g.humanName,
    scientificName: g.scientificName,
    systemIds: g.solarSystems.map(ss => ss.id),
    cx: g.cx,
    cy: g.cy,
    radius: g.radius,
    spread: g.spread,
    shape: g.shape,
  }));
  return {
    id: universe.id,
    humanName: universe.humanName,
    scientificName: universe.scientificName,
    seed: universe.seed,
    solarSystems,
    galaxies,
  };
}

self.onmessage = (e: MessageEvent<UniverseGenerateRequest>) => {
  handleGenerate(e.data);
};

function handleGenerate(req: UniverseGenerateRequest): void {
  const { seed, numSolarSystems, subtypeCatalogue } = req;

  try {
    post({ type: 'PROGRESS', step: 'Seeding RNG…', pct: 5 });
    const rng = seededPRNG(seed + '_universe');

    post({ type: 'PROGRESS', step: 'Building solar systems…', pct: 15 });
    let lastReportedPct = 15;
    const universe = universeGenerator.generate(rng, seed, {
      numSolarSystems,
      catalogue: subtypeCatalogue,
      onProgress: (fraction) => {
        // Map [0, 1] generator progress onto [15, 85] of the bar; throttle
        // to whole-percent steps to avoid postMessage spam on large counts.
        const pct = 15 + Math.floor(fraction * 70);
        if (pct > lastReportedPct) {
          lastReportedPct = pct;
          post({ type: 'PROGRESS', step: 'Building solar systems…', pct });
        }
      },
    });

    post({ type: 'PROGRESS', step: 'Serializing…', pct: 90 });
    const data = serializeUniverse(universe);

    post({ type: 'PROGRESS', step: 'Done', pct: 100 });
    post({ type: 'DONE', data });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
}
