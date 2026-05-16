import type { Universe } from './Universe';
import type { Planet, PlanetBiome, RockPlanetSubtype } from './Planet';
import type { Satellite, RockSatelliteSubtype } from './Satellite';
import type {
  GalaxyData,
  LifeAdvanceEntry,
  LifeLevel,
  PlanetData,
  SatelliteData,
  SolarSystemData,
  UniverseHistoryData,
  UniverseHistoryEvent,
  WormholeData,
} from './types';
import { LIFE_LEVELS } from './types';
import { isPlanetHabitable, isSatelliteHabitable } from './habitability';
import { seededPRNG } from '../terrain/noise';
import { civilisationGenerator } from './CivilisationGenerator';

const LIFE_CHANCE_PER_STEP = 0.00005;
const LIFE_ADVANCE_CHANCE_PER_STEP = 0.0007;

/**
 * Universe-history simulation. Runs after `universeGenerator.generate(...)`
 * when the request carries `generateHistory: true`. Each step represents
 * one million years.
 *
 * Per step, on every body in the habitable zone:
 *
 * 1. Until life appears, roll 0.005% per step on the existing
 *    `${seed}_universe_life_${bodyId}` sub-stream. First success seeds the
 *    body with `lifeLevel = 'unicellular'`, picks a biome, and emits a
 *    `LIFE_APPEARED` event.
 * 2. Once life is present and below the terminal level, roll 0.07% per
 *    step on `${seed}_lifeevolution_${bodyId}` to step one tier up the
 *    `LIFE_LEVELS` ladder. Each success emits `LIFE_ADVANCED`.
 *
 * After the per-body life rolls, the **civilisation expansion** passes run:
 *
 * 3. Every body that just hit `intelligent_animals` rolls its civ-founding
 *    gate on `${seed}_civorigin_${bodyId}` once per step until it spawns
 *    (or the simulation ends, or `MAX_CIVS_PER_UNIVERSE` is reached).
 * 4. Every founded civ rolls one expansion attempt on
 *    `${seed}_civexpand_${civId}`. On success: bucket-weighted into
 *    OUTPOST / COLONY / TERRAFORM-start, then target-weighted with
 *    in-galaxy bias. Reach grows with held systems; wormhole-anchored
 *    systems open up cross-galaxy reach.
 * 5. Any terraforms whose `completeStep === step` flip their body's
 *    composition / subtype / biome / life state — the world-map hand-off
 *    sees the new biome at step >= completeStep.
 *
 * Splitting every new roll onto isolated sub-streams keeps the original
 * `_universe_life_*` / `_lifeevolution_*` consumption unchanged, so seeds
 * that produce zero civilisation activity stay byte-identical to the
 * pre-feature output.
 */
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

const PLANET_BIOME_TO_SUBTYPE: Record<PlanetBiome, RockPlanetSubtype> = {
  default: 'terrestrial',
  forest: 'terrestrial',
  ocean: 'ocean',
  desert: 'desert',
  swamp: 'terrestrial',
  ice: 'ice_rock',
  mountains: 'terrestrial',
};

function satelliteSubtypeForBiome(biome: PlanetBiome): RockSatelliteSubtype {
  return biome === 'desert' ? 'desert_moon' : 'terrestrial';
}

function nextLifeLevel(current: LifeLevel): LifeLevel | null {
  const idx = LIFE_LEVELS.indexOf(current);
  if (idx < 0 || idx >= LIFE_LEVELS.length - 1) return null;
  return LIFE_LEVELS[idx + 1];
}

/**
 * Per-body life-roll state. Cached for the duration of the simulation so
 * each body's `appearanceRng` / `advanceRng` consume their sub-stream in
 * the same order as the pre-refactor per-body loop did.
 */
interface PerBodyLifeState {
  body: Planet | Satellite;
  kind: 'planet' | 'satellite';
  appearanceRng: () => number;
  advanceRng: () => number;
  currentLevel: LifeLevel | undefined;
  done: boolean;
  entries: LifeAdvanceEntry[];
  /** Step at which the body first reached `intelligent_animals`. Used by
   *  the civ-founding pass to gate the founding roll. Undefined until the
   *  body crosses that threshold (or never). */
  intelligentSinceStep: number | undefined;
  /** Civ-origin roll PRNG, created lazily once the body is intelligent so
   *  consumption is byte-stable for bodies that never reach intelligence. */
  civOriginRng: (() => number) | undefined;
}

export class UniverseHistoryGenerator {
  generate(universe: Universe, seed: string, numSteps: number): UniverseHistoryData {
    const events: UniverseHistoryEvent[] = [];
    const lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]> = {};

    // Build per-body life state in canonical generation order (system,
    // planet, satellites). Iteration order matters for event order within
    // a step — the final stable sort by step preserves "planet first, then
    // its moons" within ties.
    const lifeStates: PerBodyLifeState[] = [];
    const planetRegistry = new Map<string, Planet>();
    const satelliteRegistry = new Map<string, Satellite>();
    for (const ss of universe.solarSystems) {
      for (const planet of ss.planets) {
        planetRegistry.set(planet.id, planet);
        if (isPlanetHabitable(planet)) {
          lifeStates.push({
            body: planet,
            kind: 'planet',
            appearanceRng: seededPRNG(`${seed}_universe_life_${planet.id}`),
            advanceRng: seededPRNG(`${seed}_lifeevolution_${planet.id}`),
            currentLevel: undefined,
            done: false,
            entries: [],
            intelligentSinceStep: undefined,
            civOriginRng: undefined,
          });
        }
        for (const sat of planet.satellites) {
          satelliteRegistry.set(sat.id, sat);
          if (isSatelliteHabitable(sat, planet)) {
            lifeStates.push({
              body: sat,
              kind: 'satellite',
              appearanceRng: seededPRNG(`${seed}_universe_life_${sat.id}`),
              advanceRng: seededPRNG(`${seed}_lifeevolution_${sat.id}`),
              currentLevel: undefined,
              done: false,
              entries: [],
              intelligentSinceStep: undefined,
              civOriginRng: undefined,
            });
          }
        }
      }
    }

    // Civ context — built from the serialised-shape snapshot of the
    // universe. The runtime entity instances stay inside this worker and
    // are mutated in place when a terraform completes; the snapshot's
    // `PlanetData` / `SatelliteData` references point at the same objects
    // that get postMessaged at the end, so terraform completion is
    // visible to the main thread automatically.
    const snapshot = buildUniverseSnapshot(universe);
    const civCtx = civilisationGenerator.initContext(seed, snapshot);

    for (let step = 0; step < numSteps; step++) {
      // 1+2. Per-body life rolls (preserves the pre-refactor draw order
      // because each body's PRNG sub-stream is isolated; the only
      // observable change is that events are emitted interleaved across
      // bodies, then re-sorted by `step` at the end).
      for (const ls of lifeStates) {
        if (ls.done) continue;
        rollLifeStep(ls, step, events);
        // Track the step at which intelligence first appears so civ
        // founding can fire on the same step. (Could also wait one step;
        // immediate is simpler and the rate is gated separately anyway.)
        if (ls.currentLevel === 'intelligent_animals' && ls.intelligentSinceStep === undefined) {
          ls.intelligentSinceStep = step;
        }
      }

      // 3. Civilisation founding pass — one roll per body per step on the
      // body's lazy civ-origin PRNG. The same per-body order as the life
      // pass keeps event emission stable.
      for (const ls of lifeStates) {
        if (ls.intelligentSinceStep === undefined) continue;
        if (civCtx.civOriginBodyIds.has(ls.body.id)) continue;
        if (!ls.civOriginRng) {
          ls.civOriginRng = seededPRNG(`${seed}_civorigin_${ls.body.id}`);
        }
        const evt = civilisationGenerator.tryFoundCiv(
          civCtx,
          ls.body as PlanetData | SatelliteData,
          ls.kind,
          step,
          ls.civOriginRng,
        );
        if (evt) events.push(evt);
      }

      // 4. Per-civ expansion. Walk in foundation order so event emission
      // for a given step is deterministic across runs.
      for (const civ of civCtx.civRuntimes) {
        if (civ.data.foundedStep > step) continue;
        const evt = civilisationGenerator.tryExpand(
          civCtx,
          civ,
          step,
          planetRegistry,
          satelliteRegistry,
        );
        if (evt) events.push(evt);
      }

      // 5. Terraform completions land last so the body's flipped state is
      // visible to subsequent steps' life / civ logic.
      const completions = civilisationGenerator.completeTerraforms(
        civCtx,
        step,
        planetRegistry,
        satelliteRegistry,
      );
      for (const evt of completions) events.push(evt);

      // For bodies whose terraform just completed, kick off life advance
      // rolls on the existing per-body advance stream from this step
      // forward by registering a life-state entry if one didn't exist
      // (i.e. the body wasn't originally in the habitable zone). This
      // lets terraformed bodies climb the life ladder normally.
      for (const evt of completions) {
        if (evt.type !== 'TERRAFORM_COMPLETED') continue;
        const existing = lifeStates.find(ls => ls.body.id === evt.bodyId);
        if (existing) {
          existing.currentLevel = 'unicellular';
          existing.done = false;
          existing.entries.push({ step, level: 'unicellular' });
        } else {
          // Body wasn't habitable originally — start it tracking life
          // advances from the completion step onward. Sub-streams are the
          // same as for natively habitable bodies; existing seeds never
          // consumed these for this body, so byte-stability is preserved
          // (the sub-stream is brand new for this body).
          const body = evt.bodyKind === 'planet'
            ? planetRegistry.get(evt.bodyId)
            : satelliteRegistry.get(evt.bodyId);
          if (body) {
            lifeStates.push({
              body,
              kind: evt.bodyKind,
              appearanceRng: seededPRNG(`${seed}_universe_life_${evt.bodyId}`),
              advanceRng: seededPRNG(`${seed}_lifeevolution_${evt.bodyId}`),
              currentLevel: 'unicellular',
              done: false,
              entries: [{ step, level: 'unicellular' }],
              intelligentSinceStep: undefined,
              civOriginRng: undefined,
            });
          }
        }
      }
    }

    // Finalise per-body life-advance lookups.
    for (const ls of lifeStates) {
      if (ls.entries.length > 0) {
        // A body may already have entries from a previous registration
        // (terraform completion re-uses the body id). Concatenate rather
        // than overwrite so the timeline shows the full progression.
        const existing = lifeAdvancesByBody[ls.body.id];
        if (existing) {
          for (const e of ls.entries) existing.push(e);
        } else {
          lifeAdvancesByBody[ls.body.id] = ls.entries.slice();
        }
      }
    }

    // Per-step iteration emits events grouped within a step; sort by step
    // so the event log reads chronologically. Stable sort preserves
    // intra-step "planet first, then satellites, then civs" ordering.
    events.sort((a, b) => a.step - b.step);

    return {
      numSteps,
      events,
      lifeAdvancesByBody,
      civilisations: civCtx.civs,
      occupancyByBody: civCtx.occupancyByBody,
      terraforms: civCtx.terraforms,
    };
  }
}

function rollLifeStep(
  ls: PerBodyLifeState,
  step: number,
  events: UniverseHistoryEvent[],
): void {
  if (ls.currentLevel === undefined) {
    if (ls.appearanceRng() < LIFE_CHANCE_PER_STEP) {
      const biome = pickBiome(ls.appearanceRng);
      // Mutate the runtime entity so subsequent biome-driven logic + the
      // serialiser see the new state. The `Planet` and `Satellite`
      // shapes both carry these fields.
      if (ls.kind === 'planet') {
        const p = ls.body as Planet;
        p.life = true;
        p.biome = biome;
        p.subtype = PLANET_BIOME_TO_SUBTYPE[biome];
      } else {
        const s = ls.body as Satellite;
        s.life = true;
        s.biome = biome;
        s.subtype = satelliteSubtypeForBiome(biome);
      }
      ls.currentLevel = 'unicellular';
      (ls.body as Planet | Satellite).lifeLevel = ls.currentLevel;
      ls.entries.push({ step, level: ls.currentLevel });
      events.push({
        type: 'LIFE_APPEARED',
        step,
        bodyKind: ls.kind,
        bodyId: ls.body.id,
        level: 'unicellular',
      });
    }
    return;
  }
  const next = nextLifeLevel(ls.currentLevel);
  if (!next) {
    ls.done = true;
    return;
  }
  if (ls.advanceRng() < LIFE_ADVANCE_CHANCE_PER_STEP) {
    const fromLevel = ls.currentLevel;
    ls.currentLevel = next;
    (ls.body as Planet | Satellite).lifeLevel = ls.currentLevel;
    ls.entries.push({ step, level: ls.currentLevel });
    events.push({
      type: 'LIFE_ADVANCED',
      step,
      bodyKind: ls.kind,
      bodyId: ls.body.id,
      fromLevel,
      toLevel: ls.currentLevel,
    });
  }
}

/**
 * Build the `UniverseSnapshot` consumed by the civ generator. The runtime
 * `Planet` / `Satellite` / `Star` classes are structurally assignable to
 * their `*Data` counterparts (they carry the same fields, plus a couple of
 * worker-private extras), so we expose the live arrays directly via a
 * single cast. Terraform mutations on `Planet.life` / `.biome` / `.subtype`
 * / `.composition` are visible to civ-candidate predicates immediately,
 * without any rebuilds. Only `Wormhole` and `Galaxy` need reshaping
 * (different field names / array shapes).
 */
function buildUniverseSnapshot(universe: Universe): {
  solarSystems: SolarSystemData[];
  galaxies: GalaxyData[];
} {
  const solarSystems: SolarSystemData[] = universe.solarSystems.map(ss => ({
    id: ss.id,
    humanName: ss.humanName,
    scientificName: ss.scientificName,
    composition: ss.composition,
    kind: ss.kind,
    sectorId: ss.sectorId,
    stars: ss.stars as unknown as SolarSystemData['stars'],
    // Runtime `Planet[]` is structurally `PlanetData[]` (plus the extra
    // worker-private `solarSystemId` field). Pass the live array through
    // so terraform-completion mutations propagate without rebuilds.
    planets: ss.planets as unknown as PlanetData[],
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
    sectors: g.sectors.map(sec => ({
      id: sec.id,
      scientificName: sec.scientificName,
      cx: sec.cx,
      cy: sec.cy,
      systemIds: sec.solarSystems.map(ss => ss.id),
    })),
  }));
  return { solarSystems, galaxies };
}

export const universeHistoryGenerator = new UniverseHistoryGenerator();
