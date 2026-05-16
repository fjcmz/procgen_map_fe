import type { Planet, PlanetBiome, PlanetSubtype, RockPlanetSubtype } from './Planet';
import type { Satellite, RockSatelliteSubtype, SatelliteSubtype } from './Satellite';
import type {
  BodyOccupancyEntry,
  CivilisationData,
  PlanetData,
  SatelliteData,
  TerraformResult,
  UniverseHistoryEvent,
} from './types';
import { seededPRNG } from '../terrain/noise';
import { civColorAt } from './civColors';
import { generateCivName, pickCivFlavor } from './civNames';
import {
  TERRAFORM_BIOMES,
  buildExpansionIndex,
  computeCivReach,
  isColonyCandidate,
  isOutpostCandidate,
  isTerraformCandidate,
  pickWeightedTarget,
} from './expansion';
import type { BodyRef, ExpansionIndex, UniverseSnapshot } from './expansion';

/**
 * Per-step probability that a body which has reached `intelligent_animals`
 * spawns its civilisation. ~0.5%/step → expected ~200 steps (200 My) of
 * incubation between intelligence emerging and the civ becoming spacefaring,
 * with substantial variance. Tunable.
 */
export const CIV_FOUNDING_CHANCE_PER_STEP = 0.005;

/**
 * Per-step probability that an active civilisation rolls an expansion
 * attempt. 1%/step gives ~50 attempts over 5000 steps per civ. With a 24-
 * entry palette and bucket weights below, a busy seed lands ~10–20 civs,
 * each holding 5–20 bodies by end-of-time.
 */
export const CIV_EXPAND_CHANCE_PER_STEP = 0.01;

/** Bucket weights for what kind of expansion an attempt resolves to. */
export const EXPAND_BUCKET_WEIGHTS = {
  outpost: 0.5,
  colonise: 0.3,
  terraform: 0.2,
} as const;

/** Terraform duration in 1-million-year steps (~20 My base, ±5 jitter). */
export const TERRAFORM_DURATION_BASE = 20;
export const TERRAFORM_DURATION_JITTER = 5;

/** Safety cap so pathological saturation in huge universes doesn't blow up
 *  the events log or starve the per-civ-expand loop. */
export const MAX_CIVS_PER_UNIVERSE = 50;

// Biome → ROCK-planet subtype, mirroring the existing
// `PLANET_BIOME_TO_SUBTYPE` table in `UniverseHistoryGenerator`. Duplicated
// rather than imported so neither file owns the other.
const TERRAFORM_PLANET_SUBTYPE: Record<PlanetBiome, RockPlanetSubtype> = {
  default: 'terrestrial',
  forest: 'terrestrial',
  ocean: 'ocean',
  desert: 'desert',
  swamp: 'terrestrial',
  ice: 'ice_rock',
  mountains: 'terrestrial',
};

function terraformSatelliteSubtype(biome: PlanetBiome): RockSatelliteSubtype {
  return biome === 'desert' ? 'desert_moon' : 'terrestrial';
}

function pickTerraformBiome(rng: () => number): PlanetBiome {
  return TERRAFORM_BIOMES[Math.floor(rng() * TERRAFORM_BIOMES.length) % TERRAFORM_BIOMES.length];
}

/**
 * Per-civ runtime state. Lives only inside the worker; doesn't cross
 * postMessage. `expandRng` is created once at founding time on
 * `${seed}_civexpand_${civId}` so per-step expansion attempts consume
 * draws deterministically.
 */
export interface CivRuntime {
  data: CivilisationData;
  expandRng: () => number;
  /** Galaxy id the civ's origin sits in. Cached so reach computation
   *  doesn't have to resolve it every step. */
  homeGalaxyId: string;
}

/**
 * Snapshot of the universe and accumulated history that the civ generator
 * needs to read each step. Mutated in place by `tryFoundCiv` /
 * `tryExpand` / `completeTerraforms`. The fields are owned by the caller
 * (`UniverseHistoryGenerator`) — this class doesn't own them, just edits.
 */
export interface CivContext {
  seed: string;
  index: ExpansionIndex;
  civs: CivilisationData[];
  civRuntimes: CivRuntime[];
  occupancyByBody: Record<string, BodyOccupancyEntry[]>;
  terraforms: TerraformResult[];
  /** Body ids with an active terraform (started but not completed). */
  terraformInProgress: Set<string>;
  /** Body ids that have ever hosted a civ founding — these bodies are off
   *  the colony-candidate list. */
  civOriginBodyIds: Set<string>;
}

export class CivilisationGenerator {
  /** Build a fresh context referencing the snapshot the worker just
   *  generated. The worker passes in the same `SolarSystemData` /
   *  `GalaxyData` shapes it would otherwise post over the wire — keeps
   *  the civ layer decoupled from the entity-class runtime. */
  initContext(seed: string, snap: UniverseSnapshot): CivContext {
    const index = buildExpansionIndex(snap);
    return {
      seed,
      index,
      civs: [],
      civRuntimes: [],
      occupancyByBody: {},
      terraforms: [],
      terraformInProgress: new Set(),
      civOriginBodyIds: new Set(),
    };
  }

  /**
   * Try to spawn a civilisation on `body` at `step`. The body must have
   * just reached (or be at) `intelligent_animals` AND have no civ
   * previously rooted on it. The founding roll consumes one draw on
   * `${seed}_civorigin_${bodyId}` per step regardless of outcome, so the
   * sub-stream's consumption is deterministic per body.
   *
   * Returns the founding event when a civ spawned, else null.
   */
  tryFoundCiv(
    ctx: CivContext,
    body: PlanetData | SatelliteData,
    bodyKind: 'planet' | 'satellite',
    step: number,
    foundingRng: () => number,
  ): UniverseHistoryEvent | null {
    if (ctx.civOriginBodyIds.has(body.id)) return null;
    if (ctx.civs.length >= MAX_CIVS_PER_UNIVERSE) return null;
    if (foundingRng() >= CIV_FOUNDING_CHANCE_PER_STEP) return null;

    // Resolve the body's parent system + galaxy for naming + reach.
    const ref = ctx.index.bodyById.get(body.id);
    if (!ref) return null;
    const homeGalaxyId = ctx.index.systemToGalaxyId.get(ref.system.id);
    if (!homeGalaxyId) return null;

    const civId = `civ_${body.id}_${step}`;
    const flavorRng = seededPRNG(`${ctx.seed}_civflavor_${civId}`);
    const nameRng = seededPRNG(`${ctx.seed}_civname_${civId}`);
    const expandRng = seededPRNG(`${ctx.seed}_civexpand_${civId}`);

    const flavor = pickCivFlavor(flavorRng);
    const name = generateCivName(flavor, nameRng, { body, system: ref.system });
    const color = civColorAt(ctx.civs.length);

    const data: CivilisationData = {
      id: civId,
      name,
      flavor,
      originBodyId: body.id,
      originBodyKind: bodyKind,
      foundedStep: step,
      color,
    };
    ctx.civs.push(data);
    ctx.civRuntimes.push({ data, expandRng, homeGalaxyId });
    ctx.civOriginBodyIds.add(body.id);

    return {
      type: 'CIV_FOUNDED',
      step,
      civId,
      bodyKind,
      bodyId: body.id,
    };
  }

  /**
   * Try one expansion attempt for `civ` at `step`. Bucket choice + target
   * draw both come from the civ's dedicated `expandRng`, so a civ's
   * attempt sequence is deterministic given its origin and the universe's
   * occupancy state at each step.
   *
   * Returns the resulting event (and side-effects: occupancy entry,
   * terraform registration) or null when the roll failed or no candidate
   * exists.
   */
  tryExpand(
    ctx: CivContext,
    civ: CivRuntime,
    step: number,
    planetRegistry: Map<string, Planet>,
    satelliteRegistry: Map<string, Satellite>,
  ): UniverseHistoryEvent | null {
    if (civ.expandRng() >= CIV_EXPAND_CHANCE_PER_STEP) return null;

    const reach = computeCivReach(civ.data, step, ctx.index, ctx.occupancyByBody);

    // Bucket roll first so the bucket weight controls how often each kind
    // of action happens irrespective of candidate availability.
    const bucket = pickBucket(civ.expandRng());

    // Collect candidates from `index.allBodies` restricted to reachable
    // systems. Walking allBodies preserves canonical iteration order so
    // event emission is deterministic across runs.
    const candidates: BodyRef[] = [];
    for (const ref of ctx.index.allBodies) {
      if (!reach.reachableSystemIds.has(ref.system.id)) continue;
      if (bucket === 'outpost') {
        if (isOutpostCandidate(ref, ctx.occupancyByBody, step)) candidates.push(ref);
      } else if (bucket === 'colonise') {
        if (isColonyCandidate(ref, ctx.occupancyByBody, step, ctx.civOriginBodyIds)) candidates.push(ref);
      } else {
        if (isTerraformCandidate(ref, ctx.occupancyByBody, step, ctx.terraformInProgress)) candidates.push(ref);
      }
    }

    const target = pickWeightedTarget(civ.expandRng, candidates, civ.homeGalaxyId, ctx.index);
    if (!target) return null;

    if (bucket === 'outpost') {
      appendOccupancy(ctx, target.body.id, { step, type: 'OUTPOST', civId: civ.data.id });
      return {
        type: 'OUTPOST_ESTABLISHED',
        step,
        civId: civ.data.id,
        bodyKind: target.kind,
        bodyId: target.body.id,
      };
    }
    if (bucket === 'colonise') {
      appendOccupancy(ctx, target.body.id, { step, type: 'COLONY', civId: civ.data.id });
      return {
        type: 'COLONY_FOUNDED',
        step,
        civId: civ.data.id,
        bodyKind: target.kind,
        bodyId: target.body.id,
      };
    }

    // Terraform — register a pending operation. The completion event will
    // fire on the matching step in `completeTerraforms`. Capture the
    // pre-terraform body fields so scrubbing back before completion can
    // re-render the original visual.
    const terraformRng = seededPRNG(`${ctx.seed}_terraform_${target.body.id}`);
    const jitter = Math.floor(terraformRng() * (TERRAFORM_DURATION_JITTER * 2 + 1)) - TERRAFORM_DURATION_JITTER;
    const completeStep = step + TERRAFORM_DURATION_BASE + jitter;
    const newBiome = pickTerraformBiome(terraformRng);
    const newSubtype: PlanetSubtype | SatelliteSubtype = target.kind === 'planet'
      ? TERRAFORM_PLANET_SUBTYPE[newBiome]
      : terraformSatelliteSubtype(newBiome);
    ctx.terraforms.push({
      bodyKind: target.kind,
      bodyId: target.body.id,
      civId: civ.data.id,
      startStep: step,
      completeStep,
      newBiome,
      newSubtype,
      newComposition: 'ROCK',
      newLifeLevel: 'unicellular',
      originalBiome: target.body.biome,
      originalSubtype: target.body.subtype,
      originalComposition: target.body.composition,
    });
    ctx.terraformInProgress.add(target.body.id);
    appendOccupancy(ctx, target.body.id, { step, type: 'TERRAFORM_START', civId: civ.data.id });
    // Sanity: registries are passed in so we can apply the body mutation
    // at completion time. Not needed at start, but the parameter shape
    // documents the registries we depend on.
    void planetRegistry;
    void satelliteRegistry;
    return {
      type: 'TERRAFORM_STARTED',
      step,
      civId: civ.data.id,
      bodyKind: target.kind,
      bodyId: target.body.id,
      completeStep,
    };
  }

  /**
   * Apply any terraform completions whose `completeStep === step`. Mutates
   * the matching `Planet` / `Satellite` runtime instances (they're still
   * alive inside the worker) AND the `PlanetData` / `SatelliteData` in
   * the index so serialization picks up the new biome / subtype /
   * composition. Returns the resulting events in pending order.
   */
  completeTerraforms(
    ctx: CivContext,
    step: number,
    planetRegistry: Map<string, Planet>,
    satelliteRegistry: Map<string, Satellite>,
  ): UniverseHistoryEvent[] {
    const events: UniverseHistoryEvent[] = [];
    for (const tf of ctx.terraforms) {
      if (tf.completeStep !== step) continue;
      // Mutate runtime entity (for any post-history consumers in-worker).
      if (tf.bodyKind === 'planet') {
        const p = planetRegistry.get(tf.bodyId);
        if (p) {
          p.composition = 'ROCK';
          p.subtype = tf.newSubtype as PlanetSubtype;
          p.biome = tf.newBiome;
          p.life = true;
          p.lifeLevel = tf.newLifeLevel;
        }
      } else {
        const s = satelliteRegistry.get(tf.bodyId);
        if (s) {
          s.composition = 'ROCK';
          s.subtype = tf.newSubtype as SatelliteSubtype;
          s.biome = tf.newBiome;
          s.life = true;
          s.lifeLevel = tf.newLifeLevel;
        }
      }
      appendOccupancy(ctx, tf.bodyId, {
        step,
        type: 'TERRAFORM_COMPLETE',
        civId: tf.civId,
      });
      ctx.terraformInProgress.delete(tf.bodyId);
      events.push({
        type: 'TERRAFORM_COMPLETED',
        step,
        civId: tf.civId,
        bodyKind: tf.bodyKind,
        bodyId: tf.bodyId,
        newBiome: tf.newBiome,
      });
    }
    return events;
  }
}

function appendOccupancy(ctx: CivContext, bodyId: string, entry: BodyOccupancyEntry): void {
  let arr = ctx.occupancyByBody[bodyId];
  if (!arr) {
    arr = [];
    ctx.occupancyByBody[bodyId] = arr;
  }
  arr.push(entry);
}

function pickBucket(r: number): 'outpost' | 'colonise' | 'terraform' {
  if (r < EXPAND_BUCKET_WEIGHTS.outpost) return 'outpost';
  if (r < EXPAND_BUCKET_WEIGHTS.outpost + EXPAND_BUCKET_WEIGHTS.colonise) return 'colonise';
  return 'terraform';
}

export const civilisationGenerator = new CivilisationGenerator();
