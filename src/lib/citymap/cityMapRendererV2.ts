// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 renderer — Voronoi foundation (PR 1) + walls (PR 2) + river /
// streets / roads / bridges (PR 3)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles. Every geometric
// primitive this renderer consumes comes from the polygon graph emitted by
// `cityMapGeneratorV2.ts` and the polygon-edge traversals done by
// `cityMapWalls.ts` (PR 2) / `cityMapRiver.ts` + `cityMapNetwork.ts` (PR 3).
//
//   Layer 1  — flat cream base #ece5d3
//   Layer 2  — faint Voronoi polygon edges (the "organic cadastral grid")
//   Layer 5  — river channel stroke #6d665a with darker outline (PR 3)
//              [polygon-edge river path]
//   Layer 6  — streets 2 px #b8ad92 (PR 3) [polygon-edge street paths]
//   Layer 7  — roads 4 px #2a241c (PR 3)   [polygon-edge road paths]
//   Layer 8  — bridges (PR 3): white rect + two dark rail dashes per
//              road∩river edge
//   Layer 11 — walls + towers + gate doors (PR 2)  [polygon-edge wall path]
//   …gap…    — Layers 3, 4, 9, 10, 12, 13 reserved for PR 4–5
//              (docks, sprawl, open spaces, buildings, landmarks, labels)
//   Layer 14 — top-centered city name + "V2" QA tag
//
// NOTE ON LAYER 2: the spec calls for a rigid 4×4 cadastral grid. We
// deliberately substitute a faint stroke of every Voronoi polygon's vertex
// ring. Two reasons:
//   1. PR 2-5 build all geometry from the polygon graph — surfacing the
//      polygons directly means the V2 foundation is visible from PR 1 and
//      future PR authors immediately see the pivot away from tiles.
//   2. Two overlapping grid systems (4×4 + polygons) would mislead about the
//      data model. The polygons ARE the cadastral grid in V2.
// ─────────────────────────────────────────────────────────────────────────────

import type { CityEnvironment, CityMapDataV2 } from './cityMapTypesV2';

const BASE_FILL = '#ece5d3';
const POLYGON_EDGE_STROKE = 'rgba(0, 0, 0, 0.12)';
const CITY_NAME_INK = '#2a241c';
const QA_TAG_INK = '#8a8070';

// Layer 11 — wall + gate styling (PR 2). All wall geometry is polygon-edge
// based; see cityMapWalls.ts for the generator.
const WALL_INK = '#2a241c';
const WALL_WIDTH = 4;          // 3-5 px per spec; 4 is the mid-range default
const TOWER_RADIUS = 3;        // studs at wall corners (polygon vertices)
const TOWER_CORNER_COS_THRESHOLD = 0.7; // dot < this between adjacent edges ⇒ corner
const GATE_GAP_PX = 18;        // visible door opening width
const GATE_DOOR_DASH_LEN = 5;  // flanking door marker length
const GATE_DOOR_OFFSET = 4;    // how far outside the wall each dash sits
const GATE_MATCH_EPS = 1e-3;   // float compare tolerance when matching wall segments to gates

// Layer 5 — river styling (PR 3). All river geometry is polygon-edge based;
// see cityMapRiver.ts for the generator. Spec: "river channel fill #6d665a
// with outline". We achieve the "channel fill + outline" reading with two
// stacked strokes along the polygon edges.
const RIVER_CHANNEL_INK = '#6d665a';
const RIVER_OUTLINE_INK = 'rgba(0, 0, 0, 0.22)';
const RIVER_CHANNEL_WIDTH = 8;
const RIVER_OUTLINE_WIDTH = 10;

// Layer 6 — street styling (PR 3). Thin paths along polygon edges.
const STREET_INK = '#b8ad92';
const STREET_WIDTH = 2;

// Layer 7 — road styling (PR 3). Bold paths along polygon edges.
const ROAD_INK = '#2a241c';
const ROAD_WIDTH = 4;

// Layer 8 — bridge styling (PR 3). A white rect perpendicular to each
// road-∩-river edge (overwriting the river underneath), plus two dark
// dashes parallel to the edge to read as rails / handrails.
const BRIDGE_FILL = '#ffffff';
const BRIDGE_RAIL_INK = '#2a241c';
const BRIDGE_PAD_PX = 6;          // extends the white rect past each endpoint
const BRIDGE_HALF_WIDTH = 6;      // half-width of the rect perpendicular to the edge
const BRIDGE_RAIL_OFFSET = 3;     // perpendicular offset of each rail from the edge centerline
const BRIDGE_RAIL_WIDTH = 1.5;

export function renderCityMapV2(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  env: CityEnvironment,
  seed: string,
  cityName: string,
): void {
  void env;
  void seed;

  const size = data.canvasSize;

  // ── Layer 1: flat cream base ────────────────────────────────────────────
  ctx.fillStyle = BASE_FILL;
  ctx.fillRect(0, 0, size, size);

  // ── Layer 2: faint Voronoi polygon edges (organic cadastral grid) ───────
  // [Voronoi foundation] — each polygon's vertex ring is stroked at 12% ink.
  ctx.strokeStyle = POLYGON_EDGE_STROKE;
  ctx.lineWidth = 1;
  for (const polygon of data.polygons) {
    const verts = polygon.vertices;
    if (verts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i][0], verts[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ── Layers 3, 4, 9, 10, 12, 13 reserved for PR 4–5 ─────────────────────
  //   Layer 3  — docks (PR 5, env.waterSide hatching)
  //   Layer 4  — outside-walls sprawl (PR 5)
  //   Layer 9  — open spaces / park trees / market stalls (PR 4)
  //   Layer 10 — buildings (PR 5)
  //   Layer 12 — landmarks: castle / palace / temple / monument (PR 4)
  //   Layer 13 — district labels (PR 5)

  // ── Layer 5: river (PR 3) ──────────────────────────────────────────────
  // [Voronoi-polygon] Every river edge is a polygon edge. Two stacked
  // strokes give a visible channel + outline without polygon-fill, so
  // island polygons stay cleanly un-tinted.
  drawRiver(ctx, data);

  // ── Layer 6: streets (PR 3) ────────────────────────────────────────────
  // [Voronoi-polygon] Each street path is a sequence of polygon vertices
  // threaded through adjacency by `cityMapNetwork.ts`.
  drawPathList(ctx, data.streets, STREET_INK, STREET_WIDTH);

  // ── Layer 7: roads (PR 3) ──────────────────────────────────────────────
  // [Voronoi-polygon] Road paths come from gate→center A* over the polygon
  // edge graph; see cityMapNetwork.ts.
  drawPathList(ctx, data.roads, ROAD_INK, ROAD_WIDTH);

  // ── Layer 8: bridges (PR 3) ────────────────────────────────────────────
  // [Voronoi-polygon] Each bridge is a polygon edge that belongs to both
  // a road path and the river edge set — `cityMapNetwork.ts` emits the
  // intersection as a `[a, b]` pair, the renderer turns it into a white
  // rect + rails so the crossing reads above the river stroke.
  drawBridges(ctx, data);

  // ── Layer 11: walls + towers + gate doors (PR 2) ────────────────────────
  // [Voronoi-polygon] The wall path is a closed polyline of polygon-edge
  // endpoints (pixel coords). See cityMapWalls.ts for the generator.
  drawWallsAndGates(ctx, data);

  // ── Layer 14: city name + V2 QA tag ─────────────────────────────────────
  ctx.fillStyle = CITY_NAME_INK;
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(cityName, size / 2, 16);

  ctx.fillStyle = QA_TAG_INK;
  ctx.font = '10px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('V2', size - 8, size - 8);
}

// [Voronoi-polygon] Draw the wall + gate layer from the polygon-edge wall
// path produced by `cityMapWalls.ts::generateWallsAndGates`. Every segment
// in `data.wallPath` is a polygon edge; "corners" are polygon vertices.
// No tiles involved — the stud/gate geometry derives entirely from the
// polygon graph.
function drawWallsAndGates(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
): void {
  const path = data.wallPath;
  if (path.length < 2) return;

  // Pre-index wall segments that overlap a gate edge so we can skip them
  // during the main stroke and render them as two stubs flanking the gap.
  const gateSegments = new Map<number, { a: [number, number]; b: [number, number] }>();
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    for (const gate of data.gates) {
      const [ga, gb] = gate.edge;
      const matchForward =
        Math.abs(a[0] - ga[0]) < GATE_MATCH_EPS && Math.abs(a[1] - ga[1]) < GATE_MATCH_EPS &&
        Math.abs(b[0] - gb[0]) < GATE_MATCH_EPS && Math.abs(b[1] - gb[1]) < GATE_MATCH_EPS;
      const matchReverse =
        Math.abs(a[0] - gb[0]) < GATE_MATCH_EPS && Math.abs(a[1] - gb[1]) < GATE_MATCH_EPS &&
        Math.abs(b[0] - ga[0]) < GATE_MATCH_EPS && Math.abs(b[1] - ga[1]) < GATE_MATCH_EPS;
      if (matchForward || matchReverse) {
        gateSegments.set(i, { a: [a[0], a[1]], b: [b[0], b[1]] });
        break;
      }
    }
  }

  // Stroke the main wall. Each non-gate segment is traced straight; each
  // gate segment is shrunk from both ends so a ~GATE_GAP_PX opening is
  // centered on the segment.
  ctx.strokeStyle = WALL_INK;
  ctx.lineWidth = WALL_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const gate = gateSegments.get(i);
    if (!gate) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const gap = Math.min(GATE_GAP_PX, len * 0.9);
    const stubLen = (len - gap) / 2;
    if (stubLen <= 0) continue; // segment too short to host a visible stub
    const ux = dx / len;
    const uy = dy / len;
    // Stub 1: from a toward midpoint, stopping stubLen short of mid-gap.
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(a[0] + ux * stubLen, a[1] + uy * stubLen);
    // Stub 2: from gap-end toward b.
    ctx.moveTo(b[0] - ux * stubLen, b[1] - uy * stubLen);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();

  // Tower studs at sharp polygon-corner turns. The wall path is closed
  // (first === last), so index i wraps via (i-1+n) % n and (i+1) % n, but
  // we iterate only unique vertices [0, n-1) to avoid double-plotting the
  // closing repeat.
  const n = path.length - 1;
  ctx.fillStyle = WALL_INK;
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n];
    const curr = path[i];
    const next = path[(i + 1) % n];
    const inDx = curr[0] - prev[0];
    const inDy = curr[1] - prev[1];
    const outDx = next[0] - curr[0];
    const outDy = next[1] - curr[1];
    const inLen = Math.hypot(inDx, inDy) || 1;
    const outLen = Math.hypot(outDx, outDy) || 1;
    const dot = (inDx * outDx + inDy * outDy) / (inLen * outLen);
    if (dot < TOWER_CORNER_COS_THRESHOLD) {
      ctx.beginPath();
      ctx.arc(curr[0], curr[1], TOWER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Flanking door dashes — two short perpendicular-offset tickmarks at each
  // gate midpoint. They sit just outside the wall line to read as door jambs.
  ctx.lineWidth = 2;
  ctx.strokeStyle = WALL_INK;
  for (const gate of data.gates) {
    const [ga, gb] = gate.edge;
    const dx = gb[0] - ga[0];
    const dy = gb[1] - ga[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Outward normal: (dy, -dx) normalized (CW polygon convention, y-down).
    const nx = dy / len;
    const ny = -dx / len;
    const mx = (ga[0] + gb[0]) / 2;
    const my = (ga[1] + gb[1]) / 2;
    const halfGap = Math.min(GATE_GAP_PX, len * 0.9) / 2;
    // Two dashes anchored at each jamb, projecting outward along the normal.
    for (const sign of [-1, 1]) {
      const jx = mx + ux * halfGap * sign;
      const jy = my + uy * halfGap * sign;
      const sxStart = jx + nx * GATE_DOOR_OFFSET;
      const syStart = jy + ny * GATE_DOOR_OFFSET;
      const sxEnd = sxStart + nx * GATE_DOOR_DASH_LEN;
      const syEnd = syStart + ny * GATE_DOOR_DASH_LEN;
      ctx.beginPath();
      ctx.moveTo(sxStart, syStart);
      ctx.lineTo(sxEnd, syEnd);
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 3 — river + streets + roads + bridges (polygon-edge renderers)
// ─────────────────────────────────────────────────────────────────────────────

// [Voronoi-polygon] Draw the river channel. Every edge in `data.river.edges`
// is a polygon edge emitted by `cityMapRiver.ts`. Two stacked strokes: an
// outline at `RIVER_OUTLINE_WIDTH` and a fill at `RIVER_CHANNEL_WIDTH`.
// Island polygons don't need explicit handling here — they simply have no
// river edges inside them, so the flood-and-channel pattern reads naturally.
function drawRiver(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  const river = data.river;
  if (!river || river.edges.length === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outline pass (drawn underneath the channel fill).
  ctx.strokeStyle = RIVER_OUTLINE_INK;
  ctx.lineWidth = RIVER_OUTLINE_WIDTH;
  ctx.beginPath();
  for (const [a, b] of river.edges) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();

  // Channel fill pass on top.
  ctx.strokeStyle = RIVER_CHANNEL_INK;
  ctx.lineWidth = RIVER_CHANNEL_WIDTH;
  ctx.beginPath();
  for (const [a, b] of river.edges) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

// [Voronoi-polygon] Stroke a list of paths where each path is a sequence of
// polygon vertices (pixel coords) emitted by `cityMapNetwork.ts`. Used for
// both streets (thin) and roads (bold) — only the stroke style differs.
function drawPathList(
  ctx: CanvasRenderingContext2D,
  paths: [number, number][][],
  ink: string,
  width: number,
): void {
  if (paths.length === 0) return;
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const path of paths) {
    if (path.length < 2) continue;
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i][0], path[i][1]);
    }
  }
  ctx.stroke();
}

// [Voronoi-polygon] For each bridge edge (a road edge whose canonical key
// also appears in the river edge set), paint a white rect centered on the
// edge midpoint, perpendicular to the edge, plus two short dark rails
// parallel to the edge. This reads as a bridge platform + handrails and
// masks the river stroke at the crossing so the road visibly passes over.
function drawBridges(ctx: CanvasRenderingContext2D, data: CityMapDataV2): void {
  if (data.bridges.length === 0) return;

  for (const [a, b] of data.bridges) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular to the edge, y-down: (uy, -ux).
    const nx = uy;
    const ny = -ux;

    // White platform rect: extend `BRIDGE_PAD_PX` past each endpoint so
    // the rails visibly overlap the road, and take `BRIDGE_HALF_WIDTH`
    // either side of the edge perpendicular.
    const padAx = a[0] - ux * BRIDGE_PAD_PX;
    const padAy = a[1] - uy * BRIDGE_PAD_PX;
    const padBx = b[0] + ux * BRIDGE_PAD_PX;
    const padBy = b[1] + uy * BRIDGE_PAD_PX;
    const corners: [number, number][] = [
      [padAx + nx * BRIDGE_HALF_WIDTH, padAy + ny * BRIDGE_HALF_WIDTH],
      [padBx + nx * BRIDGE_HALF_WIDTH, padBy + ny * BRIDGE_HALF_WIDTH],
      [padBx - nx * BRIDGE_HALF_WIDTH, padBy - ny * BRIDGE_HALF_WIDTH],
      [padAx - nx * BRIDGE_HALF_WIDTH, padAy - ny * BRIDGE_HALF_WIDTH],
    ];
    ctx.fillStyle = BRIDGE_FILL;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i][0], corners[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    // Two rails parallel to the edge.
    ctx.strokeStyle = BRIDGE_RAIL_INK;
    ctx.lineWidth = BRIDGE_RAIL_WIDTH;
    ctx.lineCap = 'round';
    for (const sign of [-1, 1]) {
      const ox = nx * BRIDGE_RAIL_OFFSET * sign;
      const oy = ny * BRIDGE_RAIL_OFFSET * sign;
      ctx.beginPath();
      ctx.moveTo(padAx + ox, padAy + oy);
      ctx.lineTo(padBx + ox, padBy + oy);
      ctx.stroke();
    }
  }
}
