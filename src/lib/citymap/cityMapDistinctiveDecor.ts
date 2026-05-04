// ─────────────────────────────────────────────────────────────────────────────
// City Map V2 — Per-feature renderer for distinctive landmarks.
// ─────────────────────────────────────────────────────────────────────────────
// V2 IS VORONOI-POLYGON-BASED. DO NOT reintroduce tiles.
//
// Each of the 30 distinctive features ships with its own decoration pass —
// what you see ON TOP of the cluster fill that `drawLandmarkFills` already
// painted. The base fill (translucent category color) communicates "this is
// the Crystal Bloom area"; the decoration pass communicates "this is what a
// crystal bloom LOOKS like — diamond shapes scattered through the cluster".
//
// Architecture:
//   • One dispatch function `drawDistinctiveDecorations` switches on
//     `lm.kind` and calls a per-feature painter.
//   • Painters share a small set of primitives (towers, arches, diamonds,
//     trees, tombstones, etc.) defined at the bottom of this file.
//   • All randomness routes through the shared `_distinctive_render` RNG
//     stream (see `cityMapRendererV2.ts`) so every feature stays byte-stable.
//
// Reused, no duplication: `tracePolygonRing` and `scatterInsidePolygon`
// helpers live on the renderer side; this module receives the raw context
// + polygon array and reimplements the few primitives it needs locally to
// stay self-contained (the renderer file is already large).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CityMapDataV2,
  CityPolygon,
  LandmarkV2,
} from './cityMapTypesV2';

interface DecorContext {
  ctx: CanvasRenderingContext2D;
  data: CityMapDataV2;
  /** Cluster polygon ids — already resolved by the caller. */
  pids: number[];
  /** Mean of `polygon.site` over the cluster — passed in to avoid recompute. */
  centroid: [number, number];
  /** RNG stream for any per-feature random scatter. */
  rng: () => number;
  /** Base color pair for the feature (from `LANDMARK_COLORS`). */
  fill: string;
  /** High-contrast ink for the feature. */
  ink: string;
  /** Square root of total cluster area — characteristic length for sizing. */
  scale: number;
}

/**
 * Top-level dispatch. Called once per distinctive landmark from the renderer.
 * Each branch is a small per-feature painter; helpers below are shared.
 */
export function drawDistinctiveDecorations(
  ctx: CanvasRenderingContext2D,
  data: CityMapDataV2,
  lm: LandmarkV2,
  rng: () => number,
): void {
  if (!lm.distinctive) return;
  const pids = lm.polygonIds ?? [lm.polygonId];
  const centroid = computeClusterCentroid(data.polygons, pids);
  if (centroid === null) return;
  const totalArea = computeClusterArea(data.polygons, pids);
  const scale = Math.sqrt(Math.max(1, totalArea));

  const colors = LANDMARK_DECOR_COLORS[lm.kind];
  const fill = colors?.fill ?? '#888888';
  const ink = colors?.ink ?? '#222222';
  const dctx: DecorContext = { ctx, data, pids, centroid, rng, fill, ink, scale };

  switch (lm.kind) {
    // Geographical
    case 'dist_volcanic_caldera':         drawVolcanicCaldera(dctx); break;
    case 'dist_sinkhole_cenote':          drawSinkholeCenote(dctx); break;
    case 'dist_sky_plateau':              drawSkyPlateau(dctx); break;
    case 'dist_ancient_grove':            drawAncientGrove(dctx); break;
    case 'dist_geyser_field':             drawGeyserField(dctx); break;
    // Military
    case 'dist_bastion_citadel':          drawBastionCitadel(dctx); break;
    case 'dist_triumphal_way':            drawTriumphalWay(dctx); break;
    case 'dist_obsidian_wall_district':   drawObsidianWallDistrict(dctx); break;
    case 'dist_siege_memorial_field':     drawSiegeMemorialField(dctx); break;
    case 'dist_under_warrens':            drawUnderWarrens(dctx); break;
    // Magical
    case 'dist_floating_spires':          drawFloatingSpires(dctx); break;
    case 'dist_arcane_laboratorium':      drawArcaneLaboratorium(dctx); break;
    case 'dist_ley_convergence':          drawLeyConvergence(dctx); break;
    case 'dist_mage_tower_constellation': drawMageTowerConstellation(dctx); break;
    case 'dist_eldritch_mirror_lake':     drawEldritchMirrorLake(dctx); break;
    // Entertainment
    case 'dist_grand_colosseum':          drawGrandColosseum(dctx); break;
    case 'dist_pleasure_gardens':         drawPleasureGardens(dctx); break;
    case 'dist_carnival_quarter':         drawCarnivalQuarter(dctx); break;
    case 'dist_royal_hippodrome':         drawRoyalHippodrome(dctx); break;
    case 'dist_opera_quarter':            drawOperaQuarter(dctx); break;
    // Religious
    case 'dist_pilgrimage_cathedral':     drawPilgrimageCathedral(dctx); break;
    case 'dist_necropolis_hill':          drawNecropolisHill(dctx); break;
    case 'dist_pantheon_of_all_gods':     drawPantheonOfAllGods(dctx); break;
    case 'dist_shrine_labyrinth':         drawShrineLabyrinth(dctx); break;
    case 'dist_world_tree_pillar':        drawWorldTreePillar(dctx); break;
    // Extraordinary
    case 'dist_meteor_crater':            drawMeteorCrater(dctx); break;
    case 'dist_petrified_titan':          drawPetrifiedTitan(dctx); break;
    case 'dist_crystal_bloom':            drawCrystalBloom(dctx); break;
    case 'dist_ancient_portal_ruin':      drawAncientPortalRuin(dctx); break;
    case 'dist_time_frozen_quarter':      drawTimeFrozenQuarter(dctx); break;
    default:
      break;
  }
}

// ─── Per-feature ink overrides ─────────────────────────────────────────────
// The cluster fill (LANDMARK_COLORS) reads as the feature's ground tone, but
// many decorations need a contrasting accent (e.g. lava-orange dots over a
// dark caldera, gold inlay on obsidian, warm tile on a colosseum). This
// table lets each feature override the decoration pass without disturbing
// the cluster fill; missing entries fall through to the LANDMARK_COLORS
// pair on the renderer side.

const LANDMARK_DECOR_COLORS: Partial<Record<LandmarkV2['kind'], { fill: string; ink: string }>> = {
  dist_volcanic_caldera:         { fill: '#ff8030', ink: '#3a0c08' },
  dist_sinkhole_cenote:          { fill: '#86b9d8', ink: '#0c2840' },
  dist_sky_plateau:              { fill: '#5c5040', ink: '#1c1408' },
  dist_ancient_grove:            { fill: '#2c5418', ink: '#0c1c08' },
  dist_geyser_field:             { fill: '#94c4dc', ink: '#1a3850' },
  dist_bastion_citadel:          { fill: '#3a3a44', ink: '#080808' },
  dist_triumphal_way:            { fill: '#bca888', ink: '#2a1a08' },
  dist_obsidian_wall_district:   { fill: '#0c0c14', ink: '#dca838' },
  dist_siege_memorial_field:     { fill: '#5c4830', ink: '#1c1408' },
  dist_under_warrens:            { fill: '#2c241c', ink: '#a48848' },
  dist_floating_spires:          { fill: '#6c5cb8', ink: '#1a0a3c' },
  dist_arcane_laboratorium:      { fill: '#5c4a90', ink: '#0a0028' },
  dist_ley_convergence:          { fill: '#dca8e8', ink: '#240840' },
  dist_mage_tower_constellation: { fill: '#5c4ca0', ink: '#180834' },
  dist_eldritch_mirror_lake:     { fill: '#a4c0d8', ink: '#0c1c40' },
  dist_grand_colosseum:          { fill: '#b88c54', ink: '#3a1a08' },
  dist_pleasure_gardens:         { fill: '#dc6884', ink: '#3a1430' },
  dist_carnival_quarter:         { fill: '#dc4830', ink: '#3a1408' },
  dist_royal_hippodrome:         { fill: '#a47848', ink: '#3a2008' },
  dist_opera_quarter:            { fill: '#a4684c', ink: '#3a1c08' },
  dist_pilgrimage_cathedral:     { fill: '#d4b860', ink: '#3a2008' },
  dist_necropolis_hill:          { fill: '#5c5868', ink: '#080810' },
  dist_pantheon_of_all_gods:     { fill: '#dca838', ink: '#3a2008' },
  dist_shrine_labyrinth:         { fill: '#7c6840', ink: '#1c1008' },
  dist_world_tree_pillar:        { fill: '#2c5418', ink: '#0c1c08' },
  dist_meteor_crater:            { fill: '#1c1408', ink: '#e88838' },
  dist_petrified_titan:          { fill: '#cab8a4', ink: '#080810' },
  dist_crystal_bloom:            { fill: '#5cb0d8', ink: '#0a3850' },
  dist_ancient_portal_ruin:      { fill: '#7c4cb8', ink: '#dca838' },
  dist_time_frozen_quarter:      { fill: '#80a0b8', ink: '#1a2030' },
};

// ─── Geographical ──────────────────────────────────────────────────────────

function drawVolcanicCaldera(d: DecorContext): void {
  // Repaint the central polygon as a darker bowl so the caldera reads as a
  // crater, then scatter lava-orange dots throughout to suggest molten rock.
  paintCentralPolygons(d, 0.18, '#1a0808', 0.95);
  scatterShapesAcrossCluster(d, 8, 14, (x, y) => {
    const r = 1.5 + d.rng() * 2.5;
    fillCircle(d.ctx, x, y, r, d.fill);
  });
  // A few darker lava cracks radiating from the centroid.
  drawRayBurst(d.ctx, d.centroid, 8, d.scale * 0.18, d.ink, 1);
}

function drawSinkholeCenote(d: DecorContext): void {
  // Concentric ripple rings on the central polygon + a darker pool fill.
  paintCentralPolygons(d, 0.15, d.ink, 0.4);
  drawConcentricRings(d.ctx, d.centroid, d.scale * 0.32, 5, d.fill, 0.7);
  // A few sparkle dots around the rim.
  scatterShapesAcrossCluster(d, 3, 5, (x, y) => {
    fillCircle(d.ctx, x, y, 1.2, '#ffffff');
  });
}

function drawSkyPlateau(d: DecorContext): void {
  // Slanted hatch ridges across the cluster suggesting elevation lines, plus
  // dark cliff-shadow strokes along the cluster boundary edges.
  drawHatchAcrossCluster(d, 14, Math.PI * 0.18, 1, d.ink, 0.45);
  // Cliff-shadow ring just inside the cluster boundary.
  for (const pid of d.pids) {
    const poly = d.data.polygons[pid];
    if (!poly) continue;
    if (poly.neighbors.some(nb => !d.pids.includes(nb))) {
      drawPolygonInsetStroke(d.ctx, poly, 2.5, d.ink, 0.55);
    }
  }
}

function drawAncientGrove(d: DecorContext): void {
  // Dense canopy of large tree dots across every cluster polygon.
  for (const pid of d.pids) {
    const poly = d.data.polygons[pid];
    if (!poly || poly.vertices.length < 3) continue;
    const count = 5 + Math.floor(d.rng() * 6);
    const spread = Math.sqrt(poly.area) * 0.32;
    for (let i = 0; i < count; i++) {
      const [x, y] = scatterInside(poly, d.rng, spread);
      drawTreeIcon(d.ctx, x, y, 4 + d.rng() * 2, d.fill, d.ink);
    }
  }
}

function drawGeyserField(d: DecorContext): void {
  // Vertical plume marks scattered through the field.
  scatterShapesAcrossCluster(d, 4, 8, (x, y) => {
    drawPlume(d.ctx, x, y, 4 + d.rng() * 3, d.fill, d.ink);
  });
  // A few mineral-deposit ring stains at large random offsets.
  scatterShapesAcrossCluster(d, 2, 4, (x, y) => {
    drawConcentricRings(d.ctx, [x, y], 4, 2, d.ink, 0.35);
  });
}

// ─── Military ──────────────────────────────────────────────────────────────

function drawBastionCitadel(d: DecorContext): void {
  // Central large keep with four corner towers + crenellation along boundary.
  const [cx, cy] = d.centroid;
  const keepSize = Math.min(28, d.scale * 0.22);
  drawTowerSilhouette(d.ctx, cx, cy, keepSize, d.fill, d.ink);
  // Four satellite towers arranged in a square around the keep.
  const r = keepSize * 1.4;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r;
    drawTowerSilhouette(d.ctx, tx, ty, keepSize * 0.6, d.fill, d.ink);
  }
}

function drawTriumphalWay(d: DecorContext): void {
  // Chain of arches along the cluster's PCA major axis.
  const axis = computeClusterPCA(d.data.polygons, d.pids);
  if (!axis) return;
  const { cx, cy, ux, uy, length } = axis;
  const archCount = Math.max(3, Math.min(7, Math.round(length / 24)));
  const archSize = Math.min(14, length / (archCount + 1));
  for (let i = 0; i < archCount; i++) {
    const t = (i + 0.5) / archCount - 0.5;
    const x = cx + ux * length * t;
    const y = cy + uy * length * t;
    drawArchShape(d.ctx, x, y, archSize, d.fill, d.ink);
  }
}

function drawObsidianWallDistrict(d: DecorContext): void {
  // Diagonal gold inlay strokes against the dark obsidian cluster.
  drawHatchAcrossCluster(d, 18, Math.PI / 4, 1.5, d.fill, 0.85);
  drawHatchAcrossCluster(d, 12, -Math.PI / 4, 0.8, d.ink, 0.5);
}

function drawSiegeMemorialField(d: DecorContext): void {
  // Cross markers (graves) scattered across the field.
  scatterShapesAcrossCluster(d, 6, 12, (x, y) => {
    drawCrossMarker(d.ctx, x, y, 4 + d.rng() * 2, d.ink);
  });
}

function drawUnderWarrens(d: DecorContext): void {
  // Dark cross-hatched tunnel network — dual diagonal strokes.
  drawHatchAcrossCluster(d, 20, Math.PI / 6, 0.8, d.fill, 0.55);
  drawHatchAcrossCluster(d, 20, -Math.PI / 6, 0.8, d.fill, 0.55);
  // A few cluster of warren-mouth dots at random spots.
  scatterShapesAcrossCluster(d, 4, 8, (x, y) => {
    fillCircle(d.ctx, x, y, 2, d.ink);
  });
}

// ─── Magical ───────────────────────────────────────────────────────────────

function drawFloatingSpires(d: DecorContext): void {
  // 3–6 tall slim spires scattered across the cluster.
  scatterShapesAcrossCluster(d, 3, 6, (x, y) => {
    drawSpire(d.ctx, x, y, 6 + d.rng() * 6, d.fill, d.ink);
  });
}

function drawArcaneLaboratorium(d: DecorContext): void {
  // Central pentagram inside a circle.
  const [cx, cy] = d.centroid;
  const r = Math.min(22, d.scale * 0.18);
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.2;
  d.ctx.beginPath();
  d.ctx.arc(cx, cy, r, 0, Math.PI * 2);
  d.ctx.stroke();
  // Pentagram inscribed in the circle.
  d.ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) d.ctx.moveTo(px, py);
    else d.ctx.lineTo(px, py);
  }
  d.ctx.closePath();
  d.ctx.stroke();
  // The pentagram has 5 points; connect every-other point for the star.
  d.ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = ((i * 2) % 5) / 5 * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) d.ctx.moveTo(px, py);
    else d.ctx.lineTo(px, py);
  }
  d.ctx.closePath();
  d.ctx.stroke();
}

function drawLeyConvergence(d: DecorContext): void {
  // Ray burst from centroid + concentric glow rings.
  drawRayBurst(d.ctx, d.centroid, 12, Math.min(80, d.scale * 0.5), d.fill, 1.2);
  drawConcentricRings(d.ctx, d.centroid, Math.min(40, d.scale * 0.3), 4, d.ink, 0.6);
}

function drawMageTowerConstellation(d: DecorContext): void {
  // 5–7 small towers connected by faint ley-lines forming a constellation.
  const towerCount = 5 + Math.floor(d.rng() * 3);
  const towers: [number, number][] = [];
  for (let i = 0; i < towerCount; i++) {
    const pid = d.pids[Math.floor(d.rng() * d.pids.length)];
    const poly = d.data.polygons[pid];
    if (!poly) continue;
    const [x, y] = scatterInside(poly, d.rng, Math.sqrt(poly.area) * 0.25);
    towers.push([x, y]);
  }
  // Faint connection lines first so towers sit on top.
  d.ctx.strokeStyle = d.fill;
  d.ctx.lineWidth = 0.6;
  d.ctx.globalAlpha = 0.55;
  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      if (d.rng() > 0.45) continue;
      d.ctx.beginPath();
      d.ctx.moveTo(towers[i][0], towers[i][1]);
      d.ctx.lineTo(towers[j][0], towers[j][1]);
      d.ctx.stroke();
    }
  }
  d.ctx.globalAlpha = 1;
  for (const [x, y] of towers) {
    drawSpire(d.ctx, x, y, 7 + d.rng() * 3, d.fill, d.ink);
  }
}

function drawEldritchMirrorLake(d: DecorContext): void {
  // Concentric ripples + a few mirror-glint sparkles on the surface.
  drawConcentricRings(d.ctx, d.centroid, Math.min(60, d.scale * 0.42), 6, d.ink, 0.6);
  scatterShapesAcrossCluster(d, 6, 10, (x, y) => {
    fillCircle(d.ctx, x, y, 1.4, '#ffffff');
  });
}

// ─── Entertainment ─────────────────────────────────────────────────────────

function drawGrandColosseum(d: DecorContext): void {
  // Concentric elliptical tiers — outer wall, mid tier, inner arena.
  const [cx, cy] = d.centroid;
  const rx = Math.min(80, d.scale * 0.45);
  const ry = rx * 0.7;
  d.ctx.strokeStyle = d.ink;
  for (let i = 3; i >= 1; i--) {
    const f = i / 3;
    d.ctx.lineWidth = 1.5;
    d.ctx.beginPath();
    d.ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
    d.ctx.stroke();
  }
  // Inner arena fill.
  d.ctx.fillStyle = d.fill;
  d.ctx.beginPath();
  d.ctx.ellipse(cx, cy, rx * 0.28, ry * 0.28, 0, 0, Math.PI * 2);
  d.ctx.fill();
}

function drawPleasureGardens(d: DecorContext): void {
  // Flower-petal rosettes scattered as ornamental beds.
  scatterShapesAcrossCluster(d, 5, 10, (x, y) => {
    drawFlowerRosette(d.ctx, x, y, 3.5 + d.rng() * 2, d.fill, d.ink);
  });
  // A few hedge curves drawn as short arcs.
  scatterShapesAcrossCluster(d, 3, 5, (x, y) => {
    d.ctx.strokeStyle = d.ink;
    d.ctx.lineWidth = 1;
    d.ctx.beginPath();
    d.ctx.arc(x, y, 6 + d.rng() * 4, d.rng() * Math.PI * 2, d.rng() * Math.PI * 2 + Math.PI);
    d.ctx.stroke();
  });
}

function drawCarnivalQuarter(d: DecorContext): void {
  // Festival-tent triangles scattered + flag dots on top.
  scatterShapesAcrossCluster(d, 6, 12, (x, y) => {
    drawTentShape(d.ctx, x, y, 6 + d.rng() * 3, d.fill, d.ink);
  });
}

function drawRoyalHippodrome(d: DecorContext): void {
  // One long elliptical racetrack along the cluster's major axis.
  const axis = computeClusterPCA(d.data.polygons, d.pids);
  if (!axis) return;
  const { cx, cy, ux, uy, length } = axis;
  const angle = Math.atan2(uy, ux);
  const rx = length * 0.42;
  const ry = rx * 0.32;
  d.ctx.save();
  d.ctx.translate(cx, cy);
  d.ctx.rotate(angle);
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.5;
  d.ctx.beginPath();
  d.ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  d.ctx.stroke();
  d.ctx.beginPath();
  d.ctx.ellipse(0, 0, rx * 0.7, ry * 0.55, 0, 0, Math.PI * 2);
  d.ctx.stroke();
  d.ctx.restore();
}

function drawOperaQuarter(d: DecorContext): void {
  // Central proscenium arch with flanking columns.
  const [cx, cy] = d.centroid;
  const w = Math.min(50, d.scale * 0.32);
  const h = w * 0.7;
  d.ctx.fillStyle = d.fill;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.2;
  // Arch.
  d.ctx.beginPath();
  d.ctx.moveTo(cx - w / 2, cy + h / 2);
  d.ctx.lineTo(cx - w / 2, cy);
  d.ctx.arc(cx, cy, w / 2, Math.PI, 0);
  d.ctx.lineTo(cx + w / 2, cy + h / 2);
  d.ctx.closePath();
  d.ctx.fill();
  d.ctx.stroke();
  // Flanking columns.
  const colW = w * 0.12;
  const colH = h * 1.1;
  d.ctx.fillRect(cx - w / 2 - colW * 1.4, cy + h / 2 - colH, colW, colH);
  d.ctx.fillRect(cx + w / 2 + colW * 0.4, cy + h / 2 - colH, colW, colH);
  d.ctx.strokeRect(cx - w / 2 - colW * 1.4, cy + h / 2 - colH, colW, colH);
  d.ctx.strokeRect(cx + w / 2 + colW * 0.4, cy + h / 2 - colH, colW, colH);
}

// ─── Religious ─────────────────────────────────────────────────────────────

function drawPilgrimageCathedral(d: DecorContext): void {
  // Cross-shaped cathedral floor plan: long nave + transept + apse.
  const [cx, cy] = d.centroid;
  const naveLen = Math.min(70, d.scale * 0.42);
  const naveW = naveLen * 0.22;
  const transeptLen = naveLen * 0.55;
  const transeptW = naveW;
  d.ctx.fillStyle = d.fill;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.2;
  // Nave.
  d.ctx.fillRect(cx - naveW / 2, cy - naveLen / 2, naveW, naveLen);
  d.ctx.strokeRect(cx - naveW / 2, cy - naveLen / 2, naveW, naveLen);
  // Transept.
  d.ctx.fillRect(cx - transeptLen / 2, cy - transeptW / 2, transeptLen, transeptW);
  d.ctx.strokeRect(cx - transeptLen / 2, cy - transeptW / 2, transeptLen, transeptW);
  // Apse circle at the top of the nave.
  d.ctx.beginPath();
  d.ctx.arc(cx, cy - naveLen / 2, naveW * 0.7, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  // Cross atop the apse.
  drawCrossMarker(d.ctx, cx, cy - naveLen / 2 - naveW * 1.1, naveW * 0.6, d.ink);
}

function drawNecropolisHill(d: DecorContext): void {
  // Tombstones scattered across the cluster, denser toward the centroid.
  scatterShapesAcrossCluster(d, 10, 20, (x, y) => {
    drawTombstoneShape(d.ctx, x, y, 4 + d.rng() * 2, d.fill, d.ink);
  });
}

function drawPantheonOfAllGods(d: DecorContext): void {
  // Central rotunda surrounded by a ring of small column-shrines.
  const [cx, cy] = d.centroid;
  const r = Math.min(28, d.scale * 0.22);
  d.ctx.fillStyle = d.fill;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.5;
  d.ctx.beginPath();
  d.ctx.arc(cx, cy, r, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  // Eight surrounding shrines.
  const shrineR = r * 1.7;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sx = cx + Math.cos(a) * shrineR;
    const sy = cy + Math.sin(a) * shrineR;
    drawColumnShape(d.ctx, sx, sy, r * 0.4, d.fill, d.ink);
  }
}

function drawShrineLabyrinth(d: DecorContext): void {
  // Concentric rectangle "maze" centered on the centroid.
  const [cx, cy] = d.centroid;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.2;
  const max = Math.min(70, d.scale * 0.42);
  for (let r = max; r > 6; r -= 5) {
    d.ctx.strokeRect(cx - r / 2, cy - r / 2, r, r);
  }
}

function drawWorldTreePillar(d: DecorContext): void {
  // Massive central tree silhouette: large canopy circle + trunk + roots.
  const [cx, cy] = d.centroid;
  const r = Math.min(60, d.scale * 0.4);
  // Trunk.
  d.ctx.fillStyle = d.ink;
  d.ctx.fillRect(cx - r * 0.12, cy - r * 0.1, r * 0.24, r * 0.6);
  // Canopy.
  d.ctx.fillStyle = d.fill;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.5;
  d.ctx.beginPath();
  d.ctx.arc(cx, cy - r * 0.2, r * 0.7, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  // Smaller surrounding canopies.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    d.ctx.beginPath();
    d.ctx.arc(cx + Math.cos(a) * r * 0.55, cy - r * 0.2 + Math.sin(a) * r * 0.45, r * 0.28, 0, Math.PI * 2);
    d.ctx.fill();
    d.ctx.stroke();
  }
}

// ─── Extraordinary ─────────────────────────────────────────────────────────

function drawMeteorCrater(d: DecorContext): void {
  // Concentric impact rings around the centroid + scattered meteor shards.
  paintCentralPolygons(d, 0.18, '#080404', 0.95);
  drawConcentricRings(d.ctx, d.centroid, Math.min(60, d.scale * 0.4), 4, d.fill, 0.8);
  scatterShapesAcrossCluster(d, 6, 12, (x, y) => {
    drawShard(d.ctx, x, y, 3 + d.rng() * 2, d.fill, d.ink, d.rng() * Math.PI);
  });
}

function drawPetrifiedTitan(d: DecorContext): void {
  // Skeletal silhouette stretched along the cluster's major axis: skull at
  // one end, ribcage, pelvis at the other.
  const axis = computeClusterPCA(d.data.polygons, d.pids);
  if (!axis) return;
  const { cx, cy, ux, uy, length } = axis;
  const angle = Math.atan2(uy, ux);
  d.ctx.save();
  d.ctx.translate(cx, cy);
  d.ctx.rotate(angle);
  const half = length * 0.42;
  d.ctx.fillStyle = d.fill;
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 1.5;
  // Skull.
  d.ctx.beginPath();
  d.ctx.arc(-half, 0, half * 0.18, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  // Spine.
  d.ctx.beginPath();
  d.ctx.moveTo(-half + half * 0.15, 0);
  d.ctx.lineTo(half * 0.7, 0);
  d.ctx.lineWidth = 3;
  d.ctx.stroke();
  // Ribs (5 arcs above and below the spine).
  d.ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    const x = -half * 0.5 + (i / 4) * half * 0.9;
    const ribH = half * 0.25;
    d.ctx.beginPath();
    d.ctx.ellipse(x, 0, half * 0.07, ribH, 0, 0, Math.PI * 2);
    d.ctx.stroke();
  }
  // Pelvis circle.
  d.ctx.beginPath();
  d.ctx.arc(half * 0.78, 0, half * 0.14, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  d.ctx.restore();
}

function drawCrystalBloom(d: DecorContext): void {
  // Dense scatter of diamond/rhombus crystals at varied sizes and angles.
  for (const pid of d.pids) {
    const poly = d.data.polygons[pid];
    if (!poly || poly.vertices.length < 3) continue;
    const count = 3 + Math.floor(d.rng() * 4);
    const spread = Math.sqrt(poly.area) * 0.32;
    for (let i = 0; i < count; i++) {
      const [x, y] = scatterInside(poly, d.rng, spread);
      const sz = 3 + d.rng() * 5;
      const angle = d.rng() * Math.PI;
      drawDiamondShape(d.ctx, x, y, sz, sz * (1.2 + d.rng() * 0.6), angle, d.fill, d.ink);
    }
  }
}

function drawAncientPortalRuin(d: DecorContext): void {
  // Central oval portal with golden glow ring + ruined stone fragments.
  const [cx, cy] = d.centroid;
  const r = Math.min(28, d.scale * 0.22);
  // Glow.
  d.ctx.fillStyle = d.fill;
  d.ctx.globalAlpha = 0.55;
  d.ctx.beginPath();
  d.ctx.ellipse(cx, cy, r * 1.3, r * 1.5, 0, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.globalAlpha = 1;
  // Portal.
  d.ctx.fillStyle = '#000';
  d.ctx.strokeStyle = d.ink;
  d.ctx.lineWidth = 2;
  d.ctx.beginPath();
  d.ctx.ellipse(cx, cy, r * 0.7, r, 0, 0, Math.PI * 2);
  d.ctx.fill();
  d.ctx.stroke();
  // Ruin fragments.
  scatterShapesAcrossCluster(d, 6, 10, (x, y) => {
    drawShard(d.ctx, x, y, 2 + d.rng() * 2, d.fill, d.ink, d.rng() * Math.PI);
  });
}

function drawTimeFrozenQuarter(d: DecorContext): void {
  // Hourglass scatter + a few crystalline shimmer dots.
  scatterShapesAcrossCluster(d, 5, 10, (x, y) => {
    drawHourglassShape(d.ctx, x, y, 5 + d.rng() * 3, d.fill, d.ink);
  });
  scatterShapesAcrossCluster(d, 5, 10, (x, y) => {
    fillCircle(d.ctx, x, y, 1.2, '#ffffff');
  });
}

// ─── Shared primitives ─────────────────────────────────────────────────────

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawCircleStroked(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, ink: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawTreeIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, ink: string,
): void {
  drawCircleStroked(ctx, x, y, r, fill, ink);
}

function drawCrossMarker(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, ink: string,
): void {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, size * 0.25);
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size * 0.3);
  ctx.moveTo(x - size * 0.6, y - size * 0.4);
  ctx.lineTo(x + size * 0.6, y - size * 0.4);
  ctx.stroke();
}

function drawTombstoneShape(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number,
  fill: string, ink: string,
): void {
  const w = size * 1.2;
  const h = size * 1.6;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + h / 2);
  ctx.lineTo(x - w / 2, y - h / 2 + w / 2);
  ctx.arc(x, y - h / 2 + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawTowerSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  const w = size * 0.55;
  const h = size;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  // Crenellated top.
  ctx.fillStyle = ink;
  const notches = 3;
  const notchW = w / (notches * 2 - 1);
  for (let i = 0; i < notches; i++) {
    const nx = cx - w / 2 + i * 2 * notchW;
    ctx.fillRect(nx, cy - h / 2 - notchW * 0.6, notchW, notchW * 0.6);
  }
}

function drawSpire(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  const w = size * 0.4;
  const h = size;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  // Body.
  ctx.fillRect(cx - w / 2, cy - h / 2 + w * 0.5, w, h - w * 0.5);
  ctx.strokeRect(cx - w / 2, cy - h / 2 + w * 0.5, w, h - w * 0.5);
  // Pointed roof.
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.7, cy - h / 2 + w * 0.5);
  ctx.lineTo(cx, cy - h / 2 - w * 0.5);
  ctx.lineTo(cx + w * 0.7, cy - h / 2 + w * 0.5);
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.fill();
}

function drawArchShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  const w = size * 1.1;
  const h = size;
  const legW = w * 0.18;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy - h / 2 + w * 0.45);
  ctx.arc(cx, cy - h / 2 + w * 0.45, w / 2, Math.PI, 0);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx + w / 2 - legW, cy + h / 2);
  ctx.lineTo(cx + w / 2 - legW, cy - h / 2 + w * 0.45 + legW * 0.3);
  ctx.arc(cx, cy - h / 2 + w * 0.45 + legW * 0.3, w / 2 - legW, 0, Math.PI, true);
  ctx.lineTo(cx - w / 2 + legW, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawTentShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy + size * 0.6);
  ctx.lineTo(cx, cy - size * 0.9);
  ctx.lineTo(cx + size, cy + size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Flag dot at the apex.
  fillCircle(ctx, cx, cy - size * 0.9, 1.2, ink);
}

function drawHourglassShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.7, cy - size);
  ctx.lineTo(cx + size * 0.7, cy - size);
  ctx.lineTo(cx - size * 0.7, cy + size);
  ctx.lineTo(cx + size * 0.7, cy + size);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDiamondShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  rx: number, ry: number,
  angle: number,
  fill: string, ink: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(rx, 0);
  ctx.lineTo(0, ry);
  ctx.lineTo(-rx, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawShard(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string, angle: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.5, size * 0.7);
  ctx.lineTo(-size * 0.6, size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlume(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.45, cy + size * 0.5);
  ctx.lineTo(cx - size * 0.45, cy + size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Steam ring at the base.
  fillCircle(ctx, cx, cy + size * 0.6, size * 0.35, fill);
}

function drawColumnShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  const w = size * 0.5;
  const h = size * 1.3;
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.7;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
}

function drawFlowerRosette(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, ink: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * size * 0.5, cy + Math.sin(a) * size * 0.5, size * 0.45, size * 0.25, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  fillCircle(ctx, cx, cy, size * 0.25, ink);
}

function drawConcentricRings(
  ctx: CanvasRenderingContext2D,
  centroid: [number, number],
  maxRadius: number,
  count: number,
  ink: string,
  alpha: number,
): void {
  const [cx, cy] = centroid;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha;
  for (let i = 1; i <= count; i++) {
    const r = (i / count) * maxRadius;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRayBurst(
  ctx: CanvasRenderingContext2D,
  centroid: [number, number],
  count: number,
  length: number,
  ink: string,
  width: number,
): void {
  const [cx, cy] = centroid;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * length, cy + Math.sin(a) * length);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Cluster geometry helpers ──────────────────────────────────────────────

function computeClusterCentroid(
  polygons: CityPolygon[], pids: number[],
): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  for (const pid of pids) {
    const p = polygons[pid];
    if (!p) continue;
    sx += p.site[0];
    sy += p.site[1];
    n++;
  }
  if (n === 0) return null;
  return [sx / n, sy / n];
}

function computeClusterArea(polygons: CityPolygon[], pids: number[]): number {
  let total = 0;
  for (const pid of pids) {
    const p = polygons[pid];
    if (p) total += p.area;
  }
  return total;
}

/**
 * Principal-component axis of the cluster's polygon sites. Returns the
 * centroid, unit major-axis vector, and the cluster's principal length
 * (max-min projected coordinate). `null` when the cluster is degenerate.
 */
function computeClusterPCA(polygons: CityPolygon[], pids: number[]): {
  cx: number; cy: number; ux: number; uy: number; length: number;
} | null {
  const centroid = computeClusterCentroid(polygons, pids);
  if (!centroid) return null;
  const [cx, cy] = centroid;
  let sxx = 0, syy = 0, sxy = 0;
  for (const pid of pids) {
    const p = polygons[pid];
    if (!p) continue;
    const dx = p.site[0] - cx;
    const dy = p.site[1] - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // 2x2 covariance matrix → principal eigenvector.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const lam = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  let ux = sxy;
  let uy = lam - sxx;
  let len = Math.hypot(ux, uy);
  if (len < 1e-6) {
    ux = 1; uy = 0; len = 1;
  }
  ux /= len; uy /= len;
  // Cluster extent along the axis.
  let minP = Infinity, maxP = -Infinity;
  for (const pid of pids) {
    const p = polygons[pid];
    if (!p) continue;
    const proj = (p.site[0] - cx) * ux + (p.site[1] - cy) * uy;
    if (proj < minP) minP = proj;
    if (proj > maxP) maxP = proj;
  }
  return { cx, cy, ux, uy, length: Math.max(20, maxP - minP) };
}

/**
 * Repaint the polygons closest to the cluster centroid with a stronger fill,
 * giving features like calderas / craters / cenotes a darker bowl at their
 * heart. `frac` is the fraction of cluster polygons to repaint (closest first).
 */
function paintCentralPolygons(
  d: DecorContext, frac: number, color: string, alpha: number,
): void {
  const [cx, cy] = d.centroid;
  const sorted = [...d.pids].sort((a, b) => {
    const pa = d.data.polygons[a];
    const pb = d.data.polygons[b];
    if (!pa || !pb) return 0;
    return Math.hypot(pa.site[0] - cx, pa.site[1] - cy)
         - Math.hypot(pb.site[0] - cx, pb.site[1] - cy);
  });
  const count = Math.max(1, Math.floor(sorted.length * frac));
  d.ctx.save();
  d.ctx.globalAlpha = alpha;
  d.ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const poly = d.data.polygons[sorted[i]];
    if (!poly || poly.vertices.length < 3) continue;
    d.ctx.beginPath();
    const [vx0, vy0] = poly.vertices[0];
    d.ctx.moveTo(vx0, vy0);
    for (let j = 1; j < poly.vertices.length; j++) {
      const [vx, vy] = poly.vertices[j];
      d.ctx.lineTo(vx, vy);
    }
    d.ctx.closePath();
    d.ctx.fill();
  }
  d.ctx.restore();
}

/**
 * Diagonal-line hatching across the cluster bounding box. `count` is the
 * number of stroke lines, `angle` is in radians, `lineWidth` is the stroke
 * width. Lines are clipped to the cluster polygon union via per-polygon
 * trace + clip.
 */
function drawHatchAcrossCluster(
  d: DecorContext,
  count: number,
  angle: number,
  lineWidth: number,
  ink: string,
  alpha: number,
): void {
  const ctx = d.ctx;
  // Build cluster bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pid of d.pids) {
    const p = d.data.polygons[pid];
    if (!p) continue;
    for (const [vx, vy] of p.vertices) {
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
    }
  }
  if (!isFinite(minX)) return;

  ctx.save();
  // Clip to cluster polygon union.
  ctx.beginPath();
  for (const pid of d.pids) {
    const p = d.data.polygons[pid];
    if (!p || p.vertices.length < 3) continue;
    const [vx0, vy0] = p.vertices[0];
    ctx.moveTo(vx0, vy0);
    for (let j = 1; j < p.vertices.length; j++) {
      const [vx, vy] = p.vertices[j];
      ctx.lineTo(vx, vy);
    }
    ctx.closePath();
  }
  ctx.clip();

  // Draw `count` parallel lines spanning the bounding box at the given angle.
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // Perpendicular direction: -uy, ux.
  const px = -uy;
  const py = ux;
  const halfDiag = Math.hypot(maxX - minX, maxY - minY);
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1) - 0.5) * 2 * halfDiag * 0.5;
    const sx = cx + px * t;
    const sy = cy + py * t;
    ctx.beginPath();
    ctx.moveTo(sx - ux * halfDiag, sy - uy * halfDiag);
    ctx.lineTo(sx + ux * halfDiag, sy + uy * halfDiag);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Stroke a polygon ring inset slightly from the original — used to draw
 * cliff shadows along plateau edges.
 */
function drawPolygonInsetStroke(
  ctx: CanvasRenderingContext2D,
  poly: CityPolygon,
  offsetPx: number,
  ink: string,
  alpha: number,
): void {
  // Compute polygon centroid for inset direction.
  let scx = 0, scy = 0;
  for (const [vx, vy] of poly.vertices) { scx += vx; scy += vy; }
  scx /= poly.vertices.length;
  scy /= poly.vertices.length;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < poly.vertices.length; i++) {
    const [vx, vy] = poly.vertices[i];
    const dx = scx - vx;
    const dy = scy - vy;
    const len = Math.hypot(dx, dy);
    const ix = len > 0 ? vx + (dx / len) * offsetPx : vx;
    const iy = len > 0 ? vy + (dy / len) * offsetPx : vy;
    if (i === 0) ctx.moveTo(ix, iy);
    else ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Repeat a per-shape callback at random points across the cluster polygons,
 * with the count uniformly drawn from [min, max] per polygon.
 */
function scatterShapesAcrossCluster(
  d: DecorContext,
  min: number,
  max: number,
  draw: (x: number, y: number) => void,
): void {
  for (const pid of d.pids) {
    const poly = d.data.polygons[pid];
    if (!poly || poly.vertices.length < 3) continue;
    const count = min + Math.floor(d.rng() * (max - min + 1));
    const spread = Math.sqrt(poly.area) * 0.32;
    for (let i = 0; i < count; i++) {
      const [x, y] = scatterInside(poly, d.rng, spread);
      draw(x, y);
    }
  }
}

/**
 * Random point inside a polygon — Gaussian-ish offset from `polygon.site`
 * clamped to the polygon's bbox. Mirrors the renderer's
 * `scatterInsidePolygon` so we don't pull a circular dependency.
 */
function scatterInside(
  poly: CityPolygon, rng: () => number, spread: number,
): [number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [vx, vy] of poly.vertices) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }
  const [sx, sy] = poly.site;
  // Box-Muller-ish Gaussian via two uniform draws.
  const u1 = Math.max(1e-6, rng());
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1)) * 0.45;
  const a = u2 * Math.PI * 2;
  const x = Math.max(minX, Math.min(maxX, sx + Math.cos(a) * r * spread));
  const y = Math.max(minY, Math.min(maxY, sy + Math.sin(a) * r * spread));
  return [x, y];
}
