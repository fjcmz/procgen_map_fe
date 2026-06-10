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
 * On every body in the habitable zone:
 *
 * 1. Life appears with probability 0.005% per step, drawn from the body's
 *    isolated `${seed}_universe_life_${bodyId}` sub-stream. First success
 *    seeds the body with `lifeLevel = 'unicellular'`, picks a biome, and
 *    emits a `LIFE_APPEARED` event.
 * 2. Once life is present and below the terminal level, it climbs one tier
 *    up the `LIFE_LEVELS` ladder with probability 0.07% per step, drawn
 *    from `${seed}_lifeevolution_${bodyId}`. Each success emits
 *    `LIFE_ADVANCED`.
 *
 * Both are implemented by **geometric sampling**, not per-step Bernoulli
 * rolls: each draw directly yields the step of the next success
 * (`stepsUntilSuccess`), and bodies sit in a per-step event schedule until
 * then. This is distribution-identical to rolling every step but costs
 * O(events) instead of O(bodies × steps) — the per-step roll loop was the
 * dominant cost of the whole simulation (~880M draws at 10K systems). It
 * consumes the per-body sub-streams differently, so same-seed histories
 * changed once when this landed (a deliberate perf trade-off; the universe
 * layer is not covered by the sweep harness).
 *
 * The per-step **civilisation expansion** passes:
 *
 * 3. Every body that has hit `intelligent_animals` rolls its civ-founding
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
 * Number of failed per-step Bernoulli(p) trials before the first success,
 * sampled directly from the geometric distribution: a body whose "first
 * trial" happens at step S succeeds at step `S + stepsUntilSuccess(u, p)`.
 * `u` comes from the body's isolated PRNG sub-stream, so one draw replaces
 * the entire run of per-step rolls. `u ∈ [0, 1)` ⇒ `1 - u ∈ (0, 1]` ⇒ the
 * result is a finite integer ≥ 0 (possibly far beyond the simulation
 * horizon, in which case the event is simply never scheduled).
 */
function stepsUntilSuccess(u: number, p: number): number {
  return Math.floor(Math.log(1 - u) / Math.log(1 - p));
}

/**
 * Per-body life-roll state, driven by the per-step event schedule: at any
 * time a body has at most one pending scheduled event (life appearance or
 * the next advancement), identified by `scheduleToken`.
 */
interface PerBodyLifeState {
  body: Planet | Satellite;
  kind: 'planet' | 'satellite';
  /** Position in the canonical `lifeStates` registration order. Used to
   *  keep the intelligent-body founding list in canonical order. */
  orderIdx: number;
  /** Appearance stream — consumed once for the geometric appearance sample
   *  and once more for the biome pick when life actually appears. */
  appearanceRng: (() => number) | undefined;
  /** Advance stream, created lazily on the first advancement sample — most
   *  bodies never develop life, so eagerly hashing a sub-stream seed string
   *  per habitable body is wasted work. The stream is isolated per body, so
   *  creation timing doesn't affect its output. */
  advanceRng: (() => number) | undefined;
  /** Bumped on every (re)schedule or cancellation. A schedule-bucket entry
   *  is live iff its token still matches — this is how a pending appearance
   *  gets cancelled when a terraform completes on the body first. */
  scheduleToken: number;
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

/** One pending life event in the per-step schedule. */
interface ScheduledLifeEvent {
  ls: PerBodyLifeState;
  token: number;
}

export class UniverseHistoryGenerator {
  generate(
    universe: Universe,
    seed: string,
    numSteps: number,
    onProgress?: (fraction: number) => void,
  ): UniverseHistoryData {
    const events: UniverseHistoryEvent[] = [];
    const lifeAdvancesByBody: Record<string, LifeAdvanceEntry[]> = {};

    // Build per-body life state in canonical generation order (system,
    // planet, satellites). Iteration order matters for event order within
    // a step — "planet first, then its moons" within a step follows from
    // walking `lifeStates` in registration order.
    const lifeStates: PerBodyLifeState[] = [];
    const lifeStateByBodyId = new Map<string, PerBodyLifeState>();
    const registerLifeState = (ls: PerBodyLifeState): void => {
      lifeStates.push(ls);
      lifeStateByBodyId.set(ls.body.id, ls);
    };
    const planetRegistry = new Map<string, Planet>();
    const satelliteRegistry = new Map<string, Satellite>();
    for (const ss of universe.solarSystems) {
      for (const planet of ss.planets) {
        planetRegistry.set(planet.id, planet);
        if (isPlanetHabitable(planet)) {
          registerLifeState({
            body: planet,
            kind: 'planet',
            orderIdx: lifeStates.length,
            appearanceRng: undefined,
            advanceRng: undefined,
            scheduleToken: 0,
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
            registerLifeState({
              body: sat,
              kind: 'satellite',
              orderIdx: lifeStates.length,
              appearanceRng: undefined,
              advanceRng: undefined,
              scheduleToken: 0,
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

    // Bodies at `intelligent_animals` that haven't founded a civ yet, kept
    // sorted by `orderIdx` so the founding pass visits them in the same
    // canonical order as the old full `lifeStates` walk. Tiny in practice
    // (reaching intelligence takes 4 advance rolls at 0.07%/step), which is
    // the point — the founding pass no longer scans every habitable body.
    const intelligentPending: PerBodyLifeState[] = [];
    const markIntelligent = (ls: PerBodyLifeState, step: number): void => {
      ls.intelligentSinceStep = step;
      let lo = 0;
      let hi = intelligentPending.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (intelligentPending[mid].orderIdx < ls.orderIdx) lo = mid + 1;
        else hi = mid;
      }
      intelligentPending.splice(lo, 0, ls);
    };

    // ── Life-event schedule ──────────────────────────────────────────────
    // schedule[s] holds the bodies whose next life event (appearance or
    // advancement) falls on step s. Entries whose token no longer matches
    // the body's `scheduleToken` are stale — the body was rescheduled by a
    // terraform completion in the meantime — and are skipped.
    const schedule: Array<ScheduledLifeEvent[] | undefined> = new Array(numSteps);
    const scheduleAt = (ls: PerBodyLifeState, step: number): void => {
      // Bump the token even when the event falls beyond the horizon, so an
      // out-of-range reschedule still cancels any pending in-range event.
      ls.scheduleToken++;
      if (step >= numSteps) return;
      let bucket = schedule[step];
      if (!bucket) {
        bucket = [];
        schedule[step] = bucket;
      }
      bucket.push({ ls, token: ls.scheduleToken });
    };

    // Sample the gap to the body's next advancement and schedule it. A body
    // that reached its current level during step s makes its first
    // advancement roll at step s+1, hence the +1.
    const scheduleNextAdvance = (ls: PerBodyLifeState, step: number): void => {
      const next = ls.currentLevel !== undefined ? nextLifeLevel(ls.currentLevel) : null;
      if (!next) {
        ls.done = true;
        ls.scheduleToken++; // terminal — cancel any pending event
        return;
      }
      ls.done = false;
      if (!ls.advanceRng) {
        ls.advanceRng = seededPRNG(`${seed}_lifeevolution_${ls.body.id}`);
      }
      scheduleAt(ls, step + 1 + stepsUntilSuccess(ls.advanceRng(), LIFE_ADVANCE_CHANCE_PER_STEP));
    };

    const applyLifeAppeared = (ls: PerBodyLifeState, step: number): void => {
      const biome = pickBiome(ls.appearanceRng!);
      // Mutate the runtime entity so subsequent biome-driven logic + the
      // serialiser see the new state. The `Planet` and `Satellite` shapes
      // both carry these fields.
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
      ls.body.lifeLevel = ls.currentLevel;
      ls.entries.push({ step, level: ls.currentLevel });
      events.push({
        type: 'LIFE_APPEARED',
        step,
        bodyKind: ls.kind,
        bodyId: ls.body.id,
        level: 'unicellular',
      });
      scheduleNextAdvance(ls, step);
    };

    const applyLifeAdvanced = (ls: PerBodyLifeState, step: number): void => {
      const fromLevel = ls.currentLevel;
      const next = fromLevel !== undefined ? nextLifeLevel(fromLevel) : null;
      if (fromLevel === undefined || !next) {
        ls.done = true;
        return;
      }
      ls.currentLevel = next;
      ls.body.lifeLevel = next;
      ls.entries.push({ step, level: next });
      events.push({
        type: 'LIFE_ADVANCED',
        step,
        bodyKind: ls.kind,
        bodyId: ls.body.id,
        fromLevel,
        toLevel: next,
      });
      // Track the step at which intelligence first appears so civ founding
      // can fire on the same step.
      if (next === 'intelligent_animals' && ls.intelligentSinceStep === undefined) {
        markIntelligent(ls, step);
      }
      scheduleNextAdvance(ls, step);
    };

    // Seed the schedule with every body's sampled life-appearance step, in
    // canonical registration order so same-step appearances fire in
    // canonical order. Most bodies sample a step beyond the horizon and are
    // never touched again.
    for (const ls of lifeStates) {
      ls.appearanceRng = seededPRNG(`${seed}_universe_life_${ls.body.id}`);
      scheduleAt(ls, stepsUntilSuccess(ls.appearanceRng(), LIFE_CHANCE_PER_STEP));
    }

    for (let step = 0; step < numSteps; step++) {
      if (onProgress && step % 100 === 0) onProgress(step / numSteps);

      // 1+2. Apply the life events due this step. A live entry's kind is
      // implied by the body's current state — no life yet means appearance,
      // otherwise the next advancement (any state change in between would
      // have bumped the token and invalidated the entry).
      const due = schedule[step];
      if (due) {
        schedule[step] = undefined;
        for (const entry of due) {
          if (entry.token !== entry.ls.scheduleToken) continue;
          if (entry.ls.currentLevel === undefined) applyLifeAppeared(entry.ls, step);
          else applyLifeAdvanced(entry.ls, step);
        }
      }

      // 3. Civilisation founding pass — one roll per intelligent body per
      // step on the body's lazy civ-origin PRNG. Canonical (orderIdx) order
      // keeps event emission stable. Founders are removed from the pending
      // list; `tryFoundCiv` still gates the MAX_CIVS cap internally without
      // consuming a draw, matching the old per-body behavior exactly.
      for (let i = 0; i < intelligentPending.length; i++) {
        const ls = intelligentPending[i];
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
        if (evt) {
          events.push(evt);
          intelligentPending.splice(i, 1);
          i--;
        }
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
        const existing = lifeStateByBodyId.get(evt.bodyId);
        if (existing) {
          existing.currentLevel = 'unicellular';
          existing.entries.push({ step, level: 'unicellular' });
          // Rescheduling also cancels a still-pending natural-appearance
          // event via the token bump.
          scheduleNextAdvance(existing, step);
        } else {
          // Body wasn't habitable originally — start it tracking life
          // advances from the completion step onward. Sub-streams are the
          // same as for natively habitable bodies; existing seeds never
          // consumed these for this body, so the new stream is unentangled.
          const body = evt.bodyKind === 'planet'
            ? planetRegistry.get(evt.bodyId)
            : satelliteRegistry.get(evt.bodyId);
          if (body) {
            const ls: PerBodyLifeState = {
              body,
              kind: evt.bodyKind,
              orderIdx: lifeStates.length,
              appearanceRng: undefined,
              advanceRng: undefined,
              scheduleToken: 0,
              currentLevel: 'unicellular',
              done: false,
              entries: [{ step, level: 'unicellular' }],
              intelligentSinceStep: undefined,
              civOriginRng: undefined,
            };
            registerLifeState(ls);
            scheduleNextAdvance(ls, step);
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

    // No sort needed: the per-step outer loop emits events in
    // non-decreasing step order already (every push within an iteration
    // uses the current `step`), and intra-step ordering follows the pass
    // order (life → founding → expansion → terraform completion).

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
