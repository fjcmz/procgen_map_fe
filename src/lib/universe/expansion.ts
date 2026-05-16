import type {
  BodyOccupancyEntry,
  CivilisationData,
  GalaxyData,
  PlanetData,
  SatelliteData,
  SolarSystemData,
} from './types';
import { isPlanetHabitable, isSatelliteHabitable } from './habitability';

/**
 * Reach + target-selection for civilisation expansion. Mode A: a civ's
 * reachable bodies are the union of
 *
 *   1. bodies in systems the civ already holds at least one body in,
 *   2. bodies in systems adjacent (within the same galaxy) to held
 *      systems — adjacency proxied by the civ's home galaxy as a whole
 *      (all systems in the home galaxy count), and
 *   3. bodies in the partner system of any wormhole anchored in a held
 *      system. Cross-galaxy reach is enabled — once a civ holds a
 *      wormhole system, the entire partner galaxy joins its reach.
 *
 * The reach algorithm is intentionally permissive: civs see far more than
 * they can practically occupy in 5000 steps. Per-step expansion picks one
 * target per attempt, so saturation grows linearly with civ count, not with
 * reach radius.
 */
export interface UniverseSnapshot {
  solarSystems: SolarSystemData[];
  galaxies: GalaxyData[];
}

export interface BodyRef {
  kind: 'planet' | 'satellite';
  body: PlanetData | SatelliteData;
  system: SolarSystemData;
  parentPlanet?: PlanetData; // populated when kind === 'satellite'
}

/**
 * Lookup tables built once at sim start and reused every step.
 * `bodyById` lets a civ find its origin's parent system in O(1);
 * `systemToGalaxyId` lets us cluster reach by galaxy.
 */
export interface ExpansionIndex {
  bodyById: Map<string, BodyRef>;
  systemById: Map<string, SolarSystemData>;
  systemToGalaxyId: Map<string, string>;
  /** Every body in the universe, in canonical generation order. Used by
   *  target-selection to scan candidate buckets without rebuilding per step. */
  allBodies: BodyRef[];
  /** Universe-wide wormhole id → its parent system id. */
  wormholeToSystem: Map<string, string>;
}

export function buildExpansionIndex(snap: UniverseSnapshot): ExpansionIndex {
  const bodyById = new Map<string, BodyRef>();
  const systemById = new Map<string, SolarSystemData>();
  const systemToGalaxyId = new Map<string, string>();
  const allBodies: BodyRef[] = [];
  const wormholeToSystem = new Map<string, string>();

  for (const g of snap.galaxies) {
    for (const sid of g.systemIds) systemToGalaxyId.set(sid, g.id);
  }
  for (const sys of snap.solarSystems) {
    systemById.set(sys.id, sys);
    for (const planet of sys.planets) {
      const ref: BodyRef = { kind: 'planet', body: planet, system: sys };
      bodyById.set(planet.id, ref);
      allBodies.push(ref);
      for (const sat of planet.satellites) {
        const sref: BodyRef = { kind: 'satellite', body: sat, system: sys, parentPlanet: planet };
        bodyById.set(sat.id, sref);
        allBodies.push(sref);
      }
    }
    for (const w of sys.wormholes) wormholeToSystem.set(w.id, sys.id);
  }
  return { bodyById, systemById, systemToGalaxyId, allBodies, wormholeToSystem };
}

/**
 * Set of held systems + reachable systems for a civ given its current
 * occupancy snapshot. "Held" = civ has the latest non-TERRAFORM_START
 * occupancy entry on at least one body in that system.
 */
export function computeCivReach(
  civ: CivilisationData,
  step: number,
  index: ExpansionIndex,
  occupancyByBody: Record<string, BodyOccupancyEntry[]>,
): { heldSystemIds: Set<string>; reachableSystemIds: Set<string> } {
  const heldSystemIds = new Set<string>();

  // Origin always counts as held even before any expansion lands — a civ
  // can outpost/colonise from its home planet immediately.
  const origin = index.bodyById.get(civ.originBodyId);
  if (origin) heldSystemIds.add(origin.system.id);

  for (const ref of index.allBodies) {
    const current = currentOccupant(occupancyByBody[ref.body.id], step);
    if (current === civ.id) heldSystemIds.add(ref.system.id);
  }

  // Expand to the entire home galaxy of every held system, plus any
  // partner galaxies reachable through a wormhole anchored in a held
  // system. We collect galaxy ids first, then materialise their member
  // systems via systemToGalaxyId.
  const reachableGalaxyIds = new Set<string>();
  for (const sid of heldSystemIds) {
    const gid = index.systemToGalaxyId.get(sid);
    if (gid) reachableGalaxyIds.add(gid);
  }

  // Wormhole hops: if a held system carries a wormhole, the partner
  // wormhole's parent system's galaxy joins the reach set.
  for (const sid of heldSystemIds) {
    const sys = index.systemById.get(sid);
    if (!sys) continue;
    for (const w of sys.wormholes) {
      if (!w.partnerId) continue;
      const partnerSystemId = index.wormholeToSystem.get(w.partnerId);
      if (!partnerSystemId) continue;
      const partnerGalaxyId = index.systemToGalaxyId.get(partnerSystemId);
      if (partnerGalaxyId) reachableGalaxyIds.add(partnerGalaxyId);
    }
  }

  const reachableSystemIds = new Set<string>();
  for (const [sid, gid] of index.systemToGalaxyId) {
    if (reachableGalaxyIds.has(gid)) reachableSystemIds.add(sid);
  }
  return { heldSystemIds, reachableSystemIds };
}

/** The current occupant of a body, or `null`. Ignores TERRAFORM_START
 *  entries since the body remains lifeless + unclaimed during work-in-
 *  progress; the matching TERRAFORM_COMPLETE entry stamps the claim. */
export function currentOccupant(
  entries: BodyOccupancyEntry[] | undefined,
  step: number,
): string | null {
  if (!entries || entries.length === 0) return null;
  let owner: string | null = null;
  for (const e of entries) {
    if (e.step > step) break;
    if (e.type === 'TERRAFORM_START') continue;
    owner = e.civId;
  }
  return owner;
}

/** Latest occupancy entry (any type) at step T, or `null`. Used by the UI
 *  to distinguish "outpost" / "colony" / "terraforming in progress" /
 *  "terraformed". A TERRAFORM_START with no later TERRAFORM_COMPLETE at
 *  step T means the work is still under way. */
export function latestOccupancyAtStep(
  entries: BodyOccupancyEntry[] | undefined,
  step: number,
): BodyOccupancyEntry | null {
  if (!entries || entries.length === 0) return null;
  let last: BodyOccupancyEntry | null = null;
  for (const e of entries) {
    if (e.step > step) break;
    last = e;
  }
  return last;
}

// ── Target classification ─────────────────────────────────────────────────

/**
 * Outpost targets are lifeless bodies (any composition) that aren't
 * currently held by another civ. Gas giants count — they're staging posts
 * in the atmosphere for resource extraction.
 */
export function isOutpostCandidate(
  ref: BodyRef,
  occupancyByBody: Record<string, BodyOccupancyEntry[]>,
  step: number,
): boolean {
  if (ref.body.life) return false;
  return currentOccupant(occupancyByBody[ref.body.id], step) === null;
}

/**
 * Colonisation targets are habitable-zone bodies that do NOT carry
 * intelligent life and aren't held. (A body with primitive life is still
 * a colonisation target — the colonists overlay onto the existing
 * biosphere.) Skips bodies that already host the civ-founder for any
 * existing civ — once a civ is rooted, that body is its origin and isn't
 * up for colonisation by anyone.
 */
export function isColonyCandidate(
  ref: BodyRef,
  occupancyByBody: Record<string, BodyOccupancyEntry[]>,
  step: number,
  civsByOrigin: Set<string>,
): boolean {
  if (currentOccupant(occupancyByBody[ref.body.id], step) !== null) return false;
  if (civsByOrigin.has(ref.body.id)) return false;
  if (ref.kind === 'planet') {
    if (!isPlanetHabitable(ref.body as PlanetData)) return false;
  } else {
    if (!ref.parentPlanet) return false;
    if (!isSatelliteHabitable(ref.body as SatelliteData, ref.parentPlanet)) return false;
  }
  if (ref.body.lifeLevel === 'intelligent_animals') return false;
  return true;
}

/**
 * Terraform targets are lifeless ROCK or ICE bodies (gas giants excluded —
 * no solid surface to engineer). The body must not be currently held and
 * must not have a terraform already in progress (the worker tracks pending
 * completions separately to avoid double-bookings).
 */
export function isTerraformCandidate(
  ref: BodyRef,
  occupancyByBody: Record<string, BodyOccupancyEntry[]>,
  step: number,
  inProgressBodyIds: Set<string>,
): boolean {
  if (ref.body.life) return false;
  if (currentOccupant(occupancyByBody[ref.body.id], step) !== null) return false;
  if (inProgressBodyIds.has(ref.body.id)) return false;
  if (ref.kind === 'planet') {
    if ((ref.body as PlanetData).composition === 'GAS') return false;
  }
  return true;
}

// ── Target selection ──────────────────────────────────────────────────────

/**
 * Pick one body from the candidate list using an inverse-distance bias
 * over wormhole-aware galaxy clustering. For Mode A we approximate distance
 * by a simple in-galaxy vs cross-galaxy split: in-galaxy candidates get
 * weight 1.0, cross-galaxy candidates (reached via wormhole) get weight 0.4.
 * This makes wormhole hops rare but possible — civs grow within their home
 * galaxy first.
 */
export function pickWeightedTarget(
  rng: () => number,
  candidates: BodyRef[],
  civHomeGalaxyId: string,
  index: ExpansionIndex,
): BodyRef | null {
  if (candidates.length === 0) return null;
  let totalWeight = 0;
  const weights: number[] = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const sysGid = index.systemToGalaxyId.get(candidates[i].system.id);
    const w = sysGid === civHomeGalaxyId ? 1.0 : 0.4;
    weights[i] = w;
    totalWeight += w;
  }
  let pick = rng() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * Terraforming output: pick a habitable biome + the matching subtype for
 * the new ROCK body. Same biome distribution as the existing
 * `pickBiome`/biome-to-subtype map in `UniverseHistoryGenerator`.
 */
export const TERRAFORM_BIOMES = [
  'default', 'forest', 'desert', 'swamp', 'ocean', 'mountains', 'ice',
] as const;
