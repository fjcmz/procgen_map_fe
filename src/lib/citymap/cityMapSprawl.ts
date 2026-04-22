// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — outside-walls sprawl (PR 5 slice of specs/City_style_phases.md)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// This module lands the "outside-walls fringe" slice of the spec's PR 5
// (line 73 of specs/City_style_phases.md):
//
//   "Outside-walls fringe: sparse scattered building rects in fringe tiles."
//
// And PR 5's companion entry in the "City map components" section (line 23):
//
//   "Cities will show some sparse buildings in cells out of their area; the
//    bigger the city the more such sparse buildings."
//
// Polygon-graph translation of those two spec lines:
//
//   SPRAWL BUILDING := an axis-aligned rect (x, y, w, h, solid, polygonId)
//                      packed SPARSELY inside a single `CityPolygon.isEdge`
//                      polygon whose block role is `slum` or `agricultural`.
//                      "Fringe tile" → "isEdge polygon in a slum / agricultural
//                      block". "Sparse" → 0–4 rects per polygon (vs. 4–12 for
//                      interior buildings) with smaller size bands, scaled by
//                      city size tier per the "bigger city → more sprawl" line.
//
// This slice is the mirror-image of the interior-buildings slice in
// `cityMapBuildings.ts`: that module packs roles {civic, market, harbor,
// residential} and deliberately skips slum/agricultural, deferring them to
// this file. The two sibling generators are intentionally symmetric — same
// rejection-sampling recipe, same polygon-interior discipline, different
// target roles, different density tunables, different RNG stream, different
// renderer layer (Layer 10 for interior vs. Layer 4 for sprawl per the spec's
// "Renderer layers 3, 4, 10, 13 wired in" (line 76) and the reserved slot at
// `cityMapRendererV2.ts:176`).
//
// Every geometric primitive this module consumes comes from the `CityPolygon`
// contract:
//   • `polygon.id`         — output identity (`CityBuildingV2.polygonId`)
//   • `polygon.vertices`   — unclosed ring; used for point-in-polygon and
//                             distance-to-edge checks during rejection sampling
//   • `polygon.area`       — drives the per-role N-count formula
//   • `polygon.isEdge`     — not filtered per-polygon here; the BLOCK role is
//                             what determines fringe membership. A slum /
//                             agricultural block can contain a few near-edge
//                             interior polygons (since `isExteriorBlock` uses
//                             "any isEdge", not "all isEdge") and we sprawl
//                             over those too so the fringe reads continuous.
//
// NO tile lattice. NO `Math.random`. RNG: one dedicated sub-stream keyed on
// `${seed}_city_${cityName}_sprawl` so it is independent from the `_buildings`
// stream and the future `_docks` / `_labels` PR 5 sub-streams. Iteration order
// is fixed — block order from `blocks[]`, then polygon id order inside each
// block, then slot-by-slot packing — so seed stability is preserved across
// re-runs and across insertion of future PR 5 slices.
//
// Rejection sampling is polygon-interior only — we do NOT compute an inset
// polygon ring. Voronoi cells are convex, so requiring all four corners of a
// candidate rect to (a) pass `pointInPolygon` AND (b) sit at least `INSET_PX`
// away from every polygon edge gives the same effect as an explicit inset
// without the geometric-inset math. This is the same discipline the buildings
// slice uses; see the header of `cityMapBuildings.ts` for the full rationale.
//
// Reference patterns:
//   • cityMapBuildings.ts         — primary template; mirror structure but
//                                    invert the role filter (slum/agricultural)
//                                    and shrink the density / size tunables
//   • cityMapBlocks.ts:73-79,318  — confirms slum/agricultural roles always
//                                    land on `isEdge` polygons (SLUM_SIZE_
//                                    THRESHOLD + isExteriorBlock check)
//   • cityMapLandmarks.ts         — role-filtered iteration pattern
//   • cityMapOpenSpaces.ts        — polygon eligibility + RNG sub-stream naming
//   • cityMapEdgeGraph.ts         — INTENTIONALLY NOT IMPORTED: sprawl is
//                                    polygon-interior rejection sampling, not
//                                    edge-graph traversal; no A* / no canonical
//                                    edge keys / no edge ownership is needed.
// ─────────────────────────────────────────────────────────────────────────────

import { seededPRNG } from '../terrain/noise';
import type { CitySize } from './cityMapTypes';
import type {
  CityBlockV2,
  CityBuildingV2,
  CityEnvironment,
  CityLandmarkV2,
  CityMapDataV2,
  CityPolygon,
  DistrictRole,
} from './cityMapTypesV2';

// ─── Tunables ────────────────────────────────────────────────────────────────

// Roles that receive sparse fringe packing. Exactly the pair that
// `cityMapBuildings.ts` excludes from PACKING_ROLES — symmetric coverage so
// every block ends up with some content on the canvas (or is intentionally
// empty via the reserved openSpaces / landmarks sets).
type SprawlRole = 'slum' | 'agricultural';
const SPRAWL_ROLES: ReadonlySet<DistrictRole> = new Set<DistrictRole>([
  'slum',
  'agricultural',
]);

// Per-role base count and density divisor. Tuned so sprawl reads ~15% as
// dense as interior buildings (`cityMapBuildings.ts` BASE_COUNT/DENSITY_DIVISOR
// at roughly 5–10 / 140–300). Slum clusters a bit tighter than agricultural
// (shanty huts vs. scattered farmhouses).
const SPRAWL_BASE_COUNT: Record<SprawlRole, number> = {
  slum: 2,
  agricultural: 1,
};
const SPRAWL_DENSITY_DIVISOR: Record<SprawlRole, number> = {
  slum: 600,
  agricultural: 1000,
};

// Size-tier multiplier for total sprawl density, addressing spec line 23:
// "the bigger the city the more such sparse buildings". Applied as a scalar
// on the clamped targetN per polygon so megalopolis fringes read visibly
// busier than small-city fringes, without shifting the 0..4 per-polygon cap.
const SPRAWL_TIER_SCALE: Record<CitySize, number> = {
  small: 0.5,
  medium: 0.75,
  large: 1.0,
  metropolis: 1.25,
  megalopolis: 1.5,
};

// Per-role rect size bands (px). Smaller than the interior bands in
// `cityMapBuildings.ts` (8–22) — sprawl reads as huts / farmhouses, not
// administrative blocks. Aspect stays close to square-to-mildly-elongated.
interface SizeBand {
  min: number;
  max: number;
  aspectMin: number;
  aspectMax: number;
}
const SPRAWL_SIZE_BAND: Record<SprawlRole, SizeBand> = {
  slum: { min: 4, max: 8, aspectMin: 1.0, aspectMax: 1.3 },
  agricultural: { min: 6, max: 11, aspectMin: 1.0, aspectMax: 1.6 },
};

// Fringe polygons may end up empty — unlike interior buildings (N >= 4),
// sprawl ALLOWS zero rects on small/sparse polygons so the outside-walls
// area reads as open ground punctuated by scattered structures rather than
// a secondary dense ring.
const MIN_SPRAWL_PER_POLYGON = 0;
const MAX_SPRAWL_PER_POLYGON = 4;
const MAX_RETRIES_PER_SLOT = 8; // less aggressive than interior's 12 — sparse = quick fail-outs
const INSET_PX = 2; // keeps rects off polygon edges (streets / roads / walls all live on edges)
const MORTAR_PX = 1; // gap between accepted rects in the same polygon
const SOLID_PROBABILITY = 0.45; // slightly airier than interior's 0.55 — more hollow outlines

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the `sprawlBuildings: CityBuildingV2[]` payload for a V2 city map.
 *
 * Signature matches the other PR 4 / PR 5 slice generators (`generateOpenSpaces`,
 * `generateBlocks`, `generateLandmarks`, `generateBuildings`) so the V2
 * pipeline stays uniform:
 *
 *   (seed, cityName, env, polygons, <feature-specific context>, canvasSize)
 *
 * `canvasSize` is currently unused — every sprawl rect sits inside a polygon
 * and polygons are already clipped to the canvas at the generator layer — but
 * it is kept in the signature for pipeline consistency and so future tuning
 * (e.g. scaling size bands with canvas size) can land without an ABI change.
 */
export function generateSprawl(
  seed: string,
  cityName: string,
  env: CityEnvironment,
  polygons: CityPolygon[],
  blocks: CityBlockV2[],
  openSpaces: CityMapDataV2['openSpaces'],
  landmarks: CityLandmarkV2[],
  canvasSize: number,
): CityBuildingV2[] {
  // `canvasSize` is reserved for future tuning hooks (e.g. canvas-scale-aware
  // size bands) but unused in this slice. Kept in the signature for pipeline
  // uniformity with the other slice generators.
  void canvasSize;

  // Degenerate input — empty polygons or no blocks yet. Matches the pattern
  // the other V2 slice generators use: return [] so the caller can spread
  // without special-casing.
  if (polygons.length === 0 || blocks.length === 0) return [];

  // [Voronoi-polygon] Reserved set — polygons claimed by plazas / markets /
  // parks (`openSpaces`) or landmark glyphs (`landmarks`). Sprawl NEVER
  // overwrites these, even on isEdge polygons (rare but possible — e.g. a
  // harbor market polygon that happens to touch the canvas edge). Building
  // the set once at the start is O(openSpaces + landmarks), then per-polygon
  // lookup is O(1). Mirrors `cityMapBuildings.ts:174-178` byte-for-byte so
  // the two building-ink modules use the exact same eligibility semantics.
  const reservedPolygonIds = new Set<number>();
  for (const entry of openSpaces) {
    for (const id of entry.polygonIds) reservedPolygonIds.add(id);
  }
  for (const lm of landmarks) reservedPolygonIds.add(lm.polygonId);

  const rng = seededPRNG(`${seed}_city_${cityName}_sprawl`);
  const tierScale = SPRAWL_TIER_SCALE[env.size];
  const out: CityBuildingV2[] = [];

  // [Voronoi-polygon] Iterate blocks in their natural order — the flood in
  // `cityMapBlocks.ts` produces a stable ordering seeded by polygon.id, so
  // this iteration is deterministic. Within a block we walk `polygonIds` in
  // the order the block generator stored them (polygon.id ascending).
  for (const block of blocks) {
    if (!SPRAWL_ROLES.has(block.role)) continue; // only slum / agricultural — the rest is interior buildings territory
    // Narrow the role type for the per-role constant lookups below. We know
    // the role is in SPRAWL_ROLES, but TypeScript needs the explicit cast.
    const role = block.role as SprawlRole;

    for (const polygonId of block.polygonIds) {
      if (reservedPolygonIds.has(polygonId)) continue; // plaza / park / landmark — skip
      const polygon = polygons[polygonId];
      if (!polygon) continue;
      if (polygon.vertices.length < 3) continue; // degenerate clip
      // [Voronoi-polygon] Note: `cityMapBlocks.ts::isExteriorBlock` classifies
      // a cluster as slum/agricultural if ANY of its polygons has `isEdge=true`
      // — not ALL. Mixed clusters therefore contain a few interior-ish
      // polygons sitting immediately inside the canvas-edge ring. We render
      // sprawl over the WHOLE block (edge and near-edge polygons alike) so
      // the outside-walls area reads as one continuous sprawl cluster rather
      // than a ring-of-dots on the canvas border. The block's slum /
      // agricultural role is the authoritative "this is outside-walls" tag.
      packSprawlInPolygon(polygon, role, tierScale, rng, out);
    }
  }

  return out;
}

// ─── Per-polygon rejection-sampling packer ───────────────────────────────────

function packSprawlInPolygon(
  // [Voronoi-polygon] Source geometry — polygon.vertices (unclosed ring) and
  // polygon.area drive both the count formula and every inside-polygon test.
  polygon: CityPolygon,
  role: SprawlRole,
  tierScale: number,
  rng: () => number,
  out: CityBuildingV2[],
): void {
  const base = SPRAWL_BASE_COUNT[role];
  const divisor = SPRAWL_DENSITY_DIVISOR[role];
  // Spec line 23: the bigger the city, the more sprawl. Apply tierScale to
  // the polygon-area contribution so megalopolis fringes fill out visibly
  // more than small-tier ones, then clamp to [0, 4] per-polygon so even the
  // largest fringe polygon stays sparse relative to interior packing.
  const targetN = clamp(
    MIN_SPRAWL_PER_POLYGON,
    MAX_SPRAWL_PER_POLYGON,
    Math.round((base + polygon.area / divisor) * tierScale),
  );
  if (targetN === 0) return; // sparse polygon — leave empty (this is intentional)

  const band = SPRAWL_SIZE_BAND[role];

  // [Voronoi-polygon] Polygon bounding box — the rejection-sampling envelope.
  // Cheap single-pass O(vertices) scan; Voronoi cells at our tier are < 12
  // vertices each on average. Same helper pattern as `cityMapBuildings.ts`.
  const verts = polygon.vertices;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [vx, vy] of verts) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }

  // Track accepted rects in this polygon for intra-polygon mortar overlap
  // tests. Inter-polygon overlap is geometrically impossible because each
  // rect is strictly inside its owning polygon.
  const accepted: CityBuildingV2[] = [];

  for (let slot = 0; slot < targetN; slot++) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_SLOT; attempt++) {
      // Size — axis-aligned w × h with a role-driven aspect, orientation
      // flipped 50/50 so farmhouses don't all point the same way.
      let shorter = lerp(band.min, band.max, rng());
      const aspect = lerp(band.aspectMin, band.aspectMax, rng());
      let longer = shorter * aspect;
      if (longer > band.max) {
        longer = band.max;
        shorter = Math.min(shorter, longer / band.aspectMin);
      }
      const horizontal = rng() < 0.5;
      const w = horizontal ? longer : shorter;
      const h = horizontal ? shorter : longer;

      // Skip if the polygon bbox is smaller than the rect — nothing to try.
      if (w > maxX - minX || h > maxY - minY) continue;

      const x = lerp(minX, maxX - w, rng());
      const y = lerp(minY, maxY - h, rng());

      // [Voronoi-polygon] All four rect corners must be inside the polygon
      // ring AND sit at least INSET_PX from every polygon edge. Convex-cell
      // guarantee: all-four-corners-inside ⇒ whole rect inside. Same check
      // as `cityMapBuildings.ts:266-280`.
      const corners: [number, number][] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
      let ok = true;
      for (const c of corners) {
        if (!pointInPolygon(c, verts)) { ok = false; break; }
        if (distanceToPolygonEdge(c, verts) < INSET_PX) { ok = false; break; }
      }
      if (!ok) continue;

      // Mortar overlap — AABB with MORTAR_PX padding on each side.
      let overlaps = false;
      for (const prev of accepted) {
        if (rectsOverlapWithMortar({ x, y, w, h }, prev, MORTAR_PX)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      const building: CityBuildingV2 = {
        x,
        y,
        w,
        h,
        solid: rng() < SOLID_PROBABILITY,
        polygonId: polygon.id,
      };
      accepted.push(building);
      out.push(building);
      break;
    }
    // If no placement happened after MAX_RETRIES, drop the slot silently —
    // matches the interior-buildings behavior. A fringe polygon ending up
    // slightly under-filled reads fine (and is arguably more authentic,
    // since real medieval sprawl was chaotic).
  }
}

// ─── Local helpers — [Voronoi-polygon] geometry on CityPolygon.vertices ──────
// These are duplicated from `cityMapBuildings.ts:319-385` on purpose. The V2
// architecture keeps each slice self-contained (see cityMapLandmarks.ts and
// cityMapOpenSpaces.ts for the same pattern), and these ~25 lines of geometry
// are small, stable, and polygon-interior by design. Do NOT reach into
// `cityMapEdgeGraph.ts` — that module is for edge-graph traversal (A*, canonical
// edge keys, edge ownership), which sprawl explicitly does not need.

// [Voronoi-polygon] Classic ray-cast point-in-polygon. Operates on the
// UNCLOSED vertex ring from `CityPolygon.vertices` — uses `(j + 1) % n` for
// the partner vertex rather than any closing duplicate.
function pointInPolygon(p: [number, number], verts: [number, number][]): boolean {
  const [px, py] = p;
  const n = verts.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// [Voronoi-polygon] Minimum distance from point `p` to any edge of the
// polygon ring. Standard point-to-segment distance iterated over every
// `(verts[i], verts[(i+1) % n])` pair. Used to enforce the INSET_PX gap
// between accepted rect corners and the polygon boundary — avoids building
// edges kissing streets / roads / walls, which all live on polygon edges.
function distanceToPolygonEdge(p: [number, number], verts: [number, number][]): number {
  const n = verts.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const d = pointSegmentDistance(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

function pointSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]); // degenerate edge
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

interface AABB { x: number; y: number; w: number; h: number }

function rectsOverlapWithMortar(a: AABB, b: AABB, mortar: number): boolean {
  return (
    a.x < b.x + b.w + mortar &&
    a.x + a.w + mortar > b.x &&
    a.y < b.y + b.h + mortar &&
    a.y + a.h + mortar > b.y
  );
}

function clamp(min: number, max: number, v: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
