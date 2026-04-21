// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 renderer — Voronoi-polygon foundation (PR 1) + walls (PR 2)
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles. Every geometric
// primitive this renderer consumes comes from the polygon graph emitted by
// `cityMapGeneratorV2.ts` and the polygon-edge traversal done by
// `cityMapWalls.ts`.
//
//   Layer 1  — flat cream base #ece5d3
//   Layer 2  — faint Voronoi polygon edges (the "organic cadastral grid")
//   Layer 11 — walls + towers + gate doors (PR 2)  [polygon-edge wall path]
//   …gap…    — Layers 3–10, 12–13 reserved for PR 3–5 (river, streets,
//              roads, bridges, open spaces, buildings, landmarks, labels)
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

  // ── Layers 3–10 + 12–13 reserved for PR 3–5 ────────────────────────────
  //   Layer 3  — docks (PR 5, env.waterSide hatching)
  //   Layer 4  — outside-walls sprawl (PR 5)
  //   Layer 5  — river channel fill (PR 3)
  //   Layer 6  — streets 2 px #b8ad92 (PR 3)
  //   Layer 7  — roads 4 px #2a241c (PR 3)
  //   Layer 8  — bridges (PR 3)
  //   Layer 9  — open spaces / park trees / market stalls (PR 4)
  //   Layer 10 — buildings (PR 5)
  //   Layer 12 — landmarks: castle / palace / temple / monument (PR 4)
  //   Layer 13 — district labels (PR 5)

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
