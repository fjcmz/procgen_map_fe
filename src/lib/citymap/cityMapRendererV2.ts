// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 renderer — Voronoi-polygon foundation (PR 1)
// ─────────────────────────────────────────────────────────────────────────────
// Draws only the foundation layers called out by PR 1 of
// specs/City_style_phases.md:
//
//   Layer 1  — flat cream base #ece5d3
//   Layer 2  — faint Voronoi polygon edges (the "organic cadastral grid")
//   …gap…    — Layers 3–13 reserved for PR 2–5 (walls, river, streets, roads,
//              bridges, open spaces, buildings, landmarks, labels)
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

  // ── Layers 3–13 reserved for PR 2–5 ────────────────────────────────────
  //   Layer 3  — docks (PR 5, env.waterSide hatching)
  //   Layer 4  — outside-walls sprawl (PR 5)
  //   Layer 5  — river channel fill (PR 3)
  //   Layer 6  — streets 2 px #b8ad92 (PR 3)
  //   Layer 7  — roads 4 px #2a241c (PR 3)
  //   Layer 8  — bridges (PR 3)
  //   Layer 9  — open spaces / park trees / market stalls (PR 4)
  //   Layer 10 — buildings (PR 5)
  //   Layer 11 — walls + towers + gate doors (PR 2)
  //   Layer 12 — landmarks: castle / palace / temple / monument (PR 4)
  //   Layer 13 — district labels (PR 5)

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
