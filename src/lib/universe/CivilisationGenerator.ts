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
  computeReachableGalaxyIds,
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
  /** System the civ's origin body sits in. Always counts as held, even
   *  with zero occupancy entries — a civ can expand from home immediately. */
  originSystemId: string;
  /** Number of bodies this civ currently occupies, per system. Maintained
   *  incrementally on every occupancy change so reach never needs the old
   *  full `allBodies` occupancy scan. A body mid-terraform can be outposted
   *  by another civ and reclaimed at completion, so per-system counts (not
   *  just a set) are needed to know when a system is genuinely lost. */
  systemHoldCounts: Map<string, number>;
  /** Systems where this civ holds ≥1 body, plus `originSystemId`. */
  heldSystemIds: Set<string>;
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
  /** Running current-occupant map: bodyId → civId of the latest
   *  non-TERRAFORM_START occupancy entry. Kept in lockstep with
   *  `occupancyByBody` so candidate predicates and held-system tracking
   *  read O(1) instead of walking entry arrays. */
  ownerByBody: Map<string, string>;
  /** civId → runtime, for held-system bookkeeping on occupancy changes. */
  runtimeByCivId: Map<string, CivRuntime>;
  /** Pending terraforms bucketed by `completeStep`, so per-step completion
   *  doesn't rescan the whole `terraforms` array. */
  terraformsByCompleteStep: Map<number, TerraformResult[]>;
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
      ownerByBody: new Map(),
      runtimeByCivId: new Map(),
      terraformsByCompleteStep: new Map(),
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
    const runtime: CivRuntime = {
      data,
      expandRng,
      homeGalaxyId,
      originSystemId: ref.system.id,
      systemHoldCounts: new Map(),
      heldSystemIds: new Set([ref.system.id]),
    };
    ctx.civRuntimes.push(runtime);
    ctx.runtimeByCivId.set(civId, runtime);
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

    const reachableGalaxyIds = computeReachableGalaxyIds(civ.heldSystemIds, ctx.index);

    // Bucket roll first so the bucket weight controls how often each kind
    // of action happens irrespective of candidate availability.
    const bucket = pickBucket(civ.expandRng());

    // Collect candidates from the reachable galaxies' contiguous ranges of
    // `index.allBodies`. Galaxies are visited in canonical order and each
    // range preserves canonical body order, so the candidate list is
    // identical to the old full `allBodies` scan filtered by reachable
    // system — without touching the (usually vast) unreachable remainder.
    const candidates: BodyRef[] = [];
    const { allBodies, galaxyIdsInOrder, galaxyBodyRanges } = ctx.index;
    for (const gid of galaxyIdsInOrder) {
      if (!reachableGalaxyIds.has(gid)) continue;
      const range = galaxyBodyRanges.get(gid);
      if (!range) continue;
      for (let i = range.start; i < range.end; i++) {
        const ref = allBodies[i];
        if (bucket === 'outpost') {
          if (isOutpostCandidate(ref, ctx.ownerByBody)) candidates.push(ref);
        } else if (bucket === 'colonise') {
          if (isColonyCandidate(ref, ctx.ownerByBody, ctx.civOriginBodyIds)) candidates.push(ref);
        } else {
          if (isTerraformCandidate(ref, ctx.ownerByBody, ctx.terraformInProgress)) candidates.push(ref);
        }
      }
    }

    const target = pickWeightedTarget(civ.expandRng, candidates, civ.homeGalaxyId, ctx.index);
    if (!target) return null;

    if (bucket === 'outpost') {
      appendOccupancy(ctx, target.body.id, { step, type: 'OUTPOST', civId: civ.data.id });
      claimBody(ctx, civ.data.id, target.body.id);
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
      claimBody(ctx, civ.data.id, target.body.id);
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
    const terraform: TerraformResult = {
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
    };
    ctx.terraforms.push(terraform);
    let bucketArr = ctx.terraformsByCompleteStep.get(completeStep);
    if (!bucketArr) {
      bucketArr = [];
      ctx.terraformsByCompleteStep.set(completeStep, bucketArr);
    }
    bucketArr.push(terraform);
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
    const pending = ctx.terraformsByCompleteStep.get(step);
    if (!pending) return [];
    ctx.terraformsByCompleteStep.delete(step);
    const events: UniverseHistoryEvent[] = [];
    for (const tf of pending) {
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
      claimBody(ctx, tf.civId, tf.bodyId);
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

/**
 * Record `civId` as the body's current occupant and update both civs'
 * held-system bookkeeping. Called for every owner-setting occupancy entry
 * (OUTPOST / COLONY / TERRAFORM_COMPLETE — TERRAFORM_START leaves the body
 * unclaimed). Ownership CAN flip between civs: a body mid-terraform is
 * still a valid outpost/colony target for others, and the terraforming
 * civ reclaims it at completion. The per-system hold counts make that loss
 * exact: a civ only loses a held system when its last body there is gone
 * (the origin system is held unconditionally).
 */
function claimBody(ctx: CivContext, civId: string, bodyId: string): void {
  const ref = ctx.index.bodyById.get(bodyId);
  if (!ref) return;
  const systemId = ref.system.id;
  const prevCivId = ctx.ownerByBody.get(bodyId);
  if (prevCivId === civId) return;
  if (prevCivId !== undefined) {
    const prev = ctx.runtimeByCivId.get(prevCivId);
    if (prev) {
      const n = (prev.systemHoldCounts.get(systemId) ?? 0) - 1;
      if (n > 0) {
        prev.systemHoldCounts.set(systemId, n);
      } else {
        prev.systemHoldCounts.delete(systemId);
        if (systemId !== prev.originSystemId) prev.heldSystemIds.delete(systemId);
      }
    }
  }
  ctx.ownerByBody.set(bodyId, civId);
  const runtime = ctx.runtimeByCivId.get(civId);
  if (runtime) {
    runtime.systemHoldCounts.set(systemId, (runtime.systemHoldCounts.get(systemId) ?? 0) + 1);
    runtime.heldSystemIds.add(systemId);
  }
}

function pickBucket(r: number): 'outpost' | 'colonise' | 'terraform' {
  if (r < EXPAND_BUCKET_WEIGHTS.outpost) return 'outpost';
  if (r < EXPAND_BUCKET_WEIGHTS.outpost + EXPAND_BUCKET_WEIGHTS.colonise) return 'colonise';
  return 'terraform';
}

export const civilisationGenerator = new CivilisationGenerator();
