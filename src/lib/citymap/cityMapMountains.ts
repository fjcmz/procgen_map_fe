// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — mountain polygons (mountain-proximity decoration)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// When a city sits within 5 world-cell BFS hops of a mountain cell (see
// `deriveCityEnvironment` in `cityMapGeneratorV2.ts`), a fraction of the city
// canvas's polygons is tagged as mountain terrain along the canvas edge
// matching the mountain's real-world direction:
//
//   • Mountains cap at 25% of the total canvas polygons (spec: "Mountain
//     polygons should not take more than 25% of the canvas polygons").
//   • Selection is biased toward whichever canvas edge sits on the same
//     side as `env.mountainDirection` so the visible mountains align with
//     the world-map geography.
//   • An FBM perturbation makes the mountain boundary organic rather than
//     a straight strip along the edge.
//   • The selected polygons form the largest connected component touching
//     the target edge so no stray mountain polygons appear inland.
//
// Downstream consumers:
//   • `cityMapShape.ts`    — excludes mountain polygons from city-footprint
//                            eligibility (the built city doesn't sit on a
//                            mountain face).
//   • `cityMapWalls.ts`    — treats mountain-adjacent seams like water
//                            seams: walls don't trace along mountains.
//   • `cityMapNetwork.ts`  — blocks road / street edges shared with a
//                            mountain polygon (roads don't cross a cliff).
//   • `cityMapBlocks.ts`   — may OPTIONALLY absorb mountain polygons
//                            adjacent to the city into foothill-style
//                            blocks, capped at 10% of cityPolygonCount.
//   • `cityMapLandmarks.ts` — mountain polygons get a 5× weighting in the
//                             temple / monument pools (mountaintop shrines
//                             are flavourful landmarks).
//   • `cityMapRendererV2.ts` — fills mountain polygons with a stone-grey
//                              palette and stipples triangular peak
//                              silhouettes.
//
// RNG sub-stream: `${seed}_city_${cityName}_mountains` — independent from
// every other V2 stream so introducing mountain polygons does not perturb
// seeds used by existing terrain / wall / river / network / blocks modules.
// ─────────────────────────────────────────────────────────────────────────────

import { createNoiseSamplers, fbm } from '../terrain/noise';
import type { CityEnvironment, CityPolygon } from './cityMapTypesV2';

// Hard cap on mountain coverage as a fraction of canvas polygons.
const MOUNTAIN_MAX_FRACTION = 0.25;
// Target fraction — close to the cap so the mountain range reads substantial.
// Scales inversely with BFS distance so a far-away mountain shows a thinner
// strip than an adjacent one.
const MOUNTAIN_TARGET_FRACTION_MAX = 0.22;
const MOUNTAIN_TARGET_FRACTION_MIN = 0.10;
// FBM tuning — same scale family as `cityMapWater.ts` so the mountain
// boundary perturbation reads stylistically matched.
const FBM_SCALE = 0.01;
const FBM_AMPLITUDE = 0.55;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Select the polygons that will render as mountains for this city.
 *
 * Returns an empty set when the city is not near mountains
 * (`env.mountainDirection === null`) or when the polygon graph is
 * degenerate. The caller also passes in the existing water polygon set
 * so mountain selection never overlaps water.
 *
 * The `excluded` set collects every polygon that must not become a
 * mountain — currently the water polygons. Mountain selection happens
 * AFTER water selection in `cityMapGeneratorV2.ts` specifically so this
 * set is already populated.
 */
export function generateMountainPolygons(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  canvasSize: number,
  excluded: Set<number>,
): Set<number> {
  if (!env.mountainDirection) return new Set();
  if (polygons.length === 0) return new Set();

  const samplers = createNoiseSamplers(`${seed}_city_${cityName}_mountains`);

  // [Voronoi-polygon] Score every non-excluded polygon by its projection
  // onto the mountain-direction axis (lower projection = farther from the
  // mountain-facing edge). Add an FBM perturbation so the visible mountain
  // outline doesn't read as a straight strip.
  const { dx, dy, distance } = env.mountainDirection;
  const center = canvasSize / 2;

  type Scored = { id: number; score: number };
  const scored: Scored[] = [];
  for (const p of polygons) {
    if (excluded.has(p.id)) continue;
    const [sx, sy] = p.site;
    // Projection onto the mountain direction: lower = far from mountains,
    // higher = near the mountain-facing edge. Normalize by canvas half-width
    // so a fully mountain-side polygon scores ~1 and a fully opposite one
    // scores ~-1.
    const proj = ((sx - center) * dx + (sy - center) * dy) / center;
    const noise = fbm(samplers.elevation, sx * FBM_SCALE, sy * FBM_SCALE, 4);
    const perturb = (noise - 0.5) * FBM_AMPLITUDE;
    // Negate so lowest scores sit at the mountain edge — matches the
    // "lowest-first take N" pattern used in `cityMapWater.ts`.
    scored.push({ id: p.id, score: -proj + perturb });
  }
  scored.sort((a, b) => (a.score - b.score) || (a.id - b.id));
  if (scored.length === 0) return new Set();

  // Target coverage decreases linearly as the city sits farther from the
  // real-world mountains (1 hop = max strip, 5 hops = thin strip).
  const distanceT = Math.max(0, Math.min(1, (distance - 1) / (5 - 1)));
  const targetFrac = MOUNTAIN_TARGET_FRACTION_MAX
    - (MOUNTAIN_TARGET_FRACTION_MAX - MOUNTAIN_TARGET_FRACTION_MIN) * distanceT;
  const cappedFrac = Math.min(MOUNTAIN_MAX_FRACTION, targetFrac);
  const targetCount = Math.max(1, Math.floor(polygons.length * cappedFrac));
  const pool = new Set<number>();
  for (let i = 0; i < targetCount; i++) pool.add(scored[i].id);

  // [Voronoi-polygon] BFS-prune to the connected component seeded by the
  // most-mountain-side polygon so the mountain reads as one solid range
  // instead of disconnected flecks. Same pattern as `cityMapWater.ts`.
  const seedId = scored[0].id;
  const mountain = new Set<number>([seedId]);
  const queue: number[] = [seedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of polygons[id].neighbors) {
      if (pool.has(nb) && !mountain.has(nb)) {
        mountain.add(nb);
        queue.push(nb);
      }
    }
  }

  // Safety net: never exceed the hard cap, even if adjacency absorbed
  // stragglers. Trim the lowest-projection (farthest-from-edge) picks first
  // so the trimmed set stays concentrated against the mountain-facing edge.
  const hardCap = Math.floor(polygons.length * MOUNTAIN_MAX_FRACTION);
  if (mountain.size > hardCap) {
    const ordered = scored.filter(s => mountain.has(s.id));
    ordered.sort((a, b) => (b.score - a.score) || (b.id - a.id));
    for (const s of ordered) {
      if (mountain.size <= hardCap) break;
      mountain.delete(s.id);
    }
  }

  return mountain;
}
