import { seededPRNG } from '../lib/terrain';
import { universeGenerator } from '../lib/universe/UniverseGenerator';
import { universeHistoryGenerator } from '../lib/universe/UniverseHistoryGenerator';
import type { Universe } from '../lib/universe/Universe';
import type {
  UniverseData,
  UniverseGenerateRequest,
  UniverseWorkerMessage,
  SolarSystemData,
  GalaxyData,
  SectorData,
  WormholeData,
  UniverseHistoryData,
} from '../lib/universe/types';

const DEFAULT_NUM_HISTORY_STEPS = 5000;
const MIN_HISTORY_STEPS = 1;
const MAX_HISTORY_STEPS = 5000;

function post(msg: UniverseWorkerMessage): void {
  self.postMessage(msg);
}

/**
 * Flatten the runtime `Universe` (with its `Map<string, …>` indexes) into a
 * structured-clone-safe `UniverseData`. Mirrors how `mapgen.worker.ts`
 * serializes `World` into `RegionData[]` / `ContinentData[]` before
 * postMessage.
 */
function serializeUniverse(universe: Universe, history: UniverseHistoryData | undefined): UniverseData {
  const solarSystems: SolarSystemData[] = universe.solarSystems.map(ss => ({
    id: ss.id,
    humanName: ss.humanName,
    scientificName: ss.scientificName,
    composition: ss.composition,
    kind: ss.kind,
    sectorId: ss.sectorId,
    stars: ss.stars.map(star => ({
      id: star.id,
      humanName: star.humanName,
      scientificName: star.scientificName,
      radius: star.radius,
      brightness: star.brightness,
      composition: star.composition,
      subtype: star.subtype,
    })),
    planets: ss.planets.map(planet => ({
      id: planet.id,
      humanName: planet.humanName,
      scientificName: planet.scientificName,
      radius: planet.radius,
      orbit: planet.orbit,
      life: planet.life,
      lifeLevel: planet.lifeLevel,
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
        lifeLevel: sat.lifeLevel,
        biome: sat.biome,
      })),
    })),
    wormholes: ss.wormholes.map<WormholeData>(w => ({
      id: w.id,
      scientificName: w.scientificName,
      systemId: w.solarSystemId,
      galaxyId: w.galaxyId,
      partnerId: w.partnerId,
      offsetX: w.offsetX,
      offsetY: w.offsetY,
    })),
  }));
  const galaxies: GalaxyData[] = universe.galaxies.map(g => {
    const sectors: SectorData[] = g.sectors.map(sec => ({
      id: sec.id,
      scientificName: sec.scientificName,
      cx: sec.cx,
      cy: sec.cy,
      systemIds: sec.solarSystems.map(ss => ss.id),
    }));
    return {
      id: g.id,
      humanName: g.humanName,
      scientificName: g.scientificName,
      systemIds: g.solarSystems.map(ss => ss.id),
      cx: g.cx,
      cy: g.cy,
      radius: g.radius,
      spread: g.spread,
      shape: g.shape,
      sectors,
    };
  });
  return {
    id: universe.id,
    humanName: universe.humanName,
    scientificName: universe.scientificName,
    seed: universe.seed,
    solarSystems,
    galaxies,
    history,
  };
}

self.onmessage = (e: MessageEvent<UniverseGenerateRequest>) => {
  handleGenerate(e.data);
};

function handleGenerate(req: UniverseGenerateRequest): void {
  const { seed, numSolarSystems } = req;
  const generateHistory = !!req.generateHistory;
  const numHistorySteps = clampSteps(req.numHistorySteps ?? DEFAULT_NUM_HISTORY_STEPS);

  try {
    post({ type: 'PROGRESS', step: 'Seeding RNG…', pct: 5 });
    const rng = seededPRNG(seed + '_universe');

    post({ type: 'PROGRESS', step: 'Building solar systems…', pct: 15 });
    let lastReportedPct = 15;
    const physicsCeil = generateHistory ? 80 : 85;
    const universe = universeGenerator.generate(rng, seed, {
      numSolarSystems,
      generateHistory,
      onProgress: (fraction) => {
        // Map [0, 1] generator progress onto [15, physicsCeil] of the bar;
        // shorten the physics span when history is on so the universe-history
        // pass has room to report progress before serialization.
        const pct = 15 + Math.floor(fraction * (physicsCeil - 15));
        if (pct > lastReportedPct) {
          lastReportedPct = pct;
          post({ type: 'PROGRESS', step: 'Building solar systems…', pct });
        }
      },
    });

    let history: UniverseHistoryData | undefined;
    if (generateHistory) {
      post({ type: 'PROGRESS', step: 'Simulating universe history…', pct: 85 });
      history = universeHistoryGenerator.generate(universe, seed, numHistorySteps);
    }

    post({ type: 'PROGRESS', step: 'Serializing…', pct: 90 });
    const data = serializeUniverse(universe, history);

    post({ type: 'PROGRESS', step: 'Done', pct: 100 });
    post({ type: 'DONE', data });
  } catch (err) {
    post({ type: 'ERROR', message: String(err) });
  }
}

function clampSteps(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_NUM_HISTORY_STEPS;
  return Math.max(MIN_HISTORY_STEPS, Math.min(MAX_HISTORY_STEPS, Math.floor(n)));
}
