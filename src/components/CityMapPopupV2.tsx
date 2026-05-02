import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CityEnvironment, CityMapDataV2, DistrictType, LandmarkKind } from '../lib/citymap';
import { generateCityMapV2, renderCityMapV2 } from '../lib/citymap';
import type { CityCharacter } from '../lib/citychars';
import { alignmentBadge, raceLabel } from '../lib/citychars';
import type { NpcClassSummary, NpcPlace } from '../lib/cityNpcs';

interface CityMapPopupV2Props {
  isOpen: boolean;
  onClose: () => void;
  cityName: string;
  environment: CityEnvironment;
  seed: string;
  /**
   * Pre-computed city-map data — when provided, the popup skips its
   * internal `generateCityMapV2` call and uses this instance directly. The
   * DetailsTab uses this to share one map between the Quarters block-count
   * summary, the Characters affiliation pass, and the popup itself.
   */
  precomputedData?: CityMapDataV2;
  /**
   * Roster for this city, with `affiliation` populated against the same
   * `CityMapDataV2`. Drives the click-to-open district modal.
   */
  characters?: CityCharacter[];
  /**
   * Click-handler for individual characters inside the district modal. The
   * parent owns the `<CharacterPopup>` instance, so we just bubble the
   * selection back up.
   */
  onSelectCharacter?: (c: CityCharacter) => void;
  /**
   * Bulk NPC-class population keyed by place id (`landmark:<index>` /
   * `block:<index>`). The DistrictModal looks up the clicked district's
   * matching entry to render the class+level+count rows alongside the named
   * characters.
   */
  npcSummary?: NpcClassSummary;
}

const INTERNAL_SIZE = 1000;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_BUTTON_FACTOR = 1.5;
const WHEEL_FACTOR = 1.15;
const MIN_POPUP_WIDTH = 360;
const MIN_POPUP_HEIGHT = 360;
const POPUP_VIEWPORT_MARGIN = 8;
// Minimum visible portion of the popup that must remain on-screen during a
// drag-resize so the user can always recover from an over-aggressive resize.
const MIN_VISIBLE = 80;
// Approximate vertical chrome (header + footer + container border) so the
// initial popup rect can target a square-ish canvas area. The live canvas
// dimensions come from a ResizeObserver on the wrapper, so this is only
// used for the first-open size estimate.
const INITIAL_CHROME_V = 70;

// Pan is in CSS pixels of the canvas wrapper. baseScale (max(W,H)/INTERNAL_SIZE)
// is recomputed from the live canvas size whenever it's needed; the rendered
// map fit-COVERS the canvas at scale=1 so a non-square popup still fills both
// axes (the user pans along the smaller axis to see the cropped portion).
interface Transform { x: number; y: number; scale: number }

function baseScaleFor(displayW: number, displayH: number): number {
  return Math.max(displayW, displayH) / INTERNAL_SIZE;
}

function getTouchDist(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMid(t1: Touch, t2: Touch) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

// Keep the map fully covering the canvas: scale ∈ [1, MAX_SCALE]; pan ∈
// [displayDim - cover, 0] in CSS pixels, where cover = scale × max(W, H). At
// scale=1 the larger axis is locked (no pan); the smaller axis allows pan
// over the cropped overflow. At scale > 1, both axes pan within range.
function clampTransform(t: Transform, displayW: number, displayH: number): Transform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale));
  const cover = scale * Math.max(displayW, displayH);
  return {
    scale,
    x: Math.max(displayW - cover, Math.min(0, t.x)),
    y: Math.max(displayH - cover, Math.min(0, t.y)),
  };
}

// Zoom around an anchor point given in CSS pixels relative to the canvas
// origin. The world point under the anchor must stay under the anchor after
// the zoom: screenCss = scale × baseScale × world + pan → world fixed across
// zoom requires recomputing pan for the new scale.
function zoomAround(
  prev: Transform,
  anchorX: number,
  anchorY: number,
  factor: number,
  displayW: number,
  displayH: number,
): Transform {
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
  const ratio = newScale / prev.scale;
  return clampTransform({
    scale: newScale,
    x: anchorX - ratio * (anchorX - prev.x),
    y: anchorY - ratio * (anchorY - prev.y),
  }, displayW, displayH);
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PopupRect { left: number; top: number; width: number; height: number }

// Emoji icon + human-readable label for every DistrictType. Exhaustive so
// the tooltip always has something to show for any block the user hovers.
const DISTRICT_ROLE_INFO: Record<DistrictType, { icon: string; label: string }> = {
  civic:               { icon: '🏛',  label: 'Civic Centre' },
  market:              { icon: '🛒',  label: 'Market' },
  harbor:              { icon: '⚓',  label: 'Harbour' },
  residential_high:    { icon: '🏘',  label: 'Wealthy Residential' },
  residential_medium:  { icon: '🏠',  label: 'Residential' },
  residential_low:     { icon: '🏚',  label: 'Poor Residential' },
  agricultural:        { icon: '🌾',  label: 'Fields' },
  slum:                { icon: '🏚',  label: 'Slums' },
  dock:                { icon: '⛵',  label: 'Docks' },
  industry:            { icon: '⚒️',  label: 'Industry Quarter' },
  education_faith:     { icon: '⛪',  label: 'Education & Faith' },
  military:            { icon: '⚔️',  label: 'Military Quarter' },
  trade:               { icon: '💰',  label: 'Trade Quarter' },
  entertainment:       { icon: '🎭',  label: 'Entertainment Quarter' },
  excluded:            { icon: '⚖️',  label: 'Excluded Zone' },
};

// Emoji icon + human-readable label for every LandmarkKind. Exhaustive so
// hovering a polygon that hosts a specific quarter (forge, barracks, etc.)
// shows the landmark-specific identity instead of the coarser parent block.
const LANDMARK_KIND_INFO: Record<LandmarkKind, { icon: string; label: string }> = {
  // Phase 3 — named structural
  wonder:          { icon: '🗿', label: 'Wonder' },
  palace:          { icon: '👑', label: 'Palace' },
  castle:          { icon: '🏰', label: 'Castle' },
  civic_square:    { icon: '🏛', label: 'Civic Square' },
  temple:          { icon: '⛪', label: 'Temple' },
  market:          { icon: '🛒', label: 'Market' },
  park:            { icon: '🌳', label: 'Park' },
  // Phase 4 — industrial
  forge:           { icon: '🔨', label: 'Forge' },
  tannery:         { icon: '🛡', label: 'Tannery' },
  textile:         { icon: '🧵', label: 'Textile Quarter' },
  potters:         { icon: '🏺', label: 'Potters Quarter' },
  mill:            { icon: '⚙',  label: 'Mill' },
  // Phase 4 — military
  barracks:        { icon: '⚔',  label: 'Barracks' },
  citadel:         { icon: '🏯', label: 'Citadel' },
  arsenal:         { icon: '⚒',  label: 'Arsenal' },
  watchmen:        { icon: '👁', label: 'Watchmen Precinct' },
  // Phase 4 — faith / scholarship
  temple_quarter:  { icon: '⛩',  label: 'Temple Quarter' },
  necropolis:      { icon: '⚰',  label: 'Necropolis' },
  plague_ward:     { icon: '⚕',  label: 'Plague Ward' },
  academia:        { icon: '📚', label: 'Academia' },
  archive:         { icon: '📜', label: 'Archive' },
  // Phase 4 — entertainment
  theater:         { icon: '🎭', label: 'Theatre District' },
  bathhouse:       { icon: '🛁', label: 'Bathhouse Quarter' },
  pleasure:        { icon: '🎪', label: 'Pleasure Quarter' },
  festival:        { icon: '🎊', label: 'Festival Grounds' },
  // Phase 4 — trade & finance
  foreign_quarter: { icon: '🏴', label: 'Foreign Quarter' },
  caravanserai:    { icon: '🐪', label: 'Caravanserai' },
  bankers_row:     { icon: '💰', label: "Bankers' Row" },
  warehouse:       { icon: '📦', label: 'Warehouse Row' },
  // Phase 4 — excluded
  gallows:         { icon: '☠',  label: 'Gallows Hill' },
  workhouse:       { icon: '⛓',  label: 'Workhouse' },
  ghetto_marker:   { icon: '🔒', label: 'Ghetto' },
};

interface PolygonHit {
  name: string;
  icon: string;
  label: string;
}

// Identity of the district the user clicked. Encodes whether it's a generic
// block cluster or a single-polygon landmark, plus the index inside the
// matching `CityMapDataV2.blocks` / `CityMapDataV2.landmarks` array. Used as
// the key into the polygonId → district lookup AND as the React state key
// for the district modal.
type DistrictKey =
  | { kind: 'block'; index: number }
  | { kind: 'landmark'; index: number };

// Threshold (squared px) for treating a mousedown→mouseup or touchstart→
// touchend as a click instead of a pan. Loose on touch because fingers
// jitter; tight on mouse so a tiny drag-to-pan still pans rather than
// opening the district modal.
const CLICK_MOVE_TOLERANCE_MOUSE_SQ = 25;   // 5 px
const CLICK_MOVE_TOLERANCE_TOUCH_SQ = 100;  // 10 px

// Ray-casting point-in-polygon (unclosed ring, matching CityPolygon contract).
function pointInPolygon(px: number, py: number, verts: [number, number][]): boolean {
  let inside = false;
  const n = verts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function CityMapPopupV2({ isOpen, onClose, cityName, environment, seed, precomputedData, characters, onSelectCharacter, npcSummary }: CityMapPopupV2Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const mapDataRef = useRef<CityMapDataV2 | null>(null);
  // polygonId → resolved tooltip info. Landmarks (forge, barracks, …) take
  // priority over the parent block so each special-quarter polygon shows its
  // own name + icon + type instead of the coarser block role.
  const polygonToHitRef = useRef(new Map<number, PolygonHit>());
  // polygonId → district identity for click-to-modal navigation. Same
  // landmark-wins-over-block precedence as `polygonToHitRef`, but stored
  // as structured DistrictKey so the modal can look up the canonical block /
  // landmark from `mapDataRef.current` instead of stringly-matching names.
  const polygonToDistrictRef = useRef(new Map<number, DistrictKey>());
  const [showIcons, setShowIcons] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [tooltip, setTooltip] = useState<(PolygonHit & { x: number; y: number }) | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictKey | null>(null);
  // Mousedown / touchstart anchor for click-vs-pan detection. Reset on
  // pointer up; cleared on cancel / leave so a half-finished gesture never
  // fires a click.
  const mouseDownStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Group the roster by the district they're affiliated with, keyed on
  // `${kind}:${index}` so the modal can do an O(1) lookup. Characters
  // missing affiliation (city had no map data when their roster was rolled)
  // fall through silently and just don't appear in any district.
  const charactersByDistrict = useMemo(() => {
    const map = new Map<string, CityCharacter[]>();
    if (!characters) return map;
    for (const c of characters) {
      const a = c.affiliation;
      if (!a) continue;
      const key = `${a.kind}:${a.index}`;
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    // Sort each district's characters by level descending so the modal
    // surfaces leaders / veterans first, with name as the stable tiebreaker.
    for (const list of map.values()) {
      list.sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    }
    return map;
  }, [characters]);

  // Popup rect — computed lazily on first mount so the canvas is always
  // mounted with real dimensions on the first render (no double-render race
  // with the data-generation effect). Persists across close/reopen so the
  // user's resized dimensions are remembered for the rest of the session.
  const [popupRect, setPopupRect] = useState<PopupRect>(() => {
    if (typeof window === 'undefined') {
      return { left: 12, top: 12, width: INTERNAL_SIZE + 4, height: INTERNAL_SIZE + INITIAL_CHROME_V };
    }
    const availableW = window.innerWidth - 24;
    const availableH = window.innerHeight - 24;
    const target = Math.max(320, Math.min(INTERNAL_SIZE, availableW - 4, availableH - INITIAL_CHROME_V));
    const width = target + 4;
    const height = target + INITIAL_CHROME_V;
    return {
      left: Math.max(12, Math.round((window.innerWidth - width) / 2)),
      top: Math.max(12, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
    };
  });
  // Canvas display dimensions in CSS pixels — kept in sync with the canvas
  // wrapper via a ResizeObserver. Non-square is allowed (and expected when
  // the user resizes the popup to a non-square rect); the renderer fit-COVERS
  // the map across both axes so empty bands never appear.
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: INTERNAL_SIZE, h: INTERNAL_SIZE });
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;
  const activeResizeDirRef = useRef<ResizeDirection | null>(null);
  const [resizing, setResizing] = useState(false);

  const wheelRafRef = useRef<number | null>(null);
  const isPinchingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastTouchDistRef = useRef(0);
  const lastTouchMidRef = useRef({ x: 0, y: 0 });
  const lastPanRef = useRef({ x: 0, y: 0 });
  const isMouseDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // One-shot CSS for hover affordance on the resize handles. Inline styles
  // can't express :hover, so we inject a tiny global stylesheet keyed on
  // dedicated class names. Idempotent across multiple popup instances via the
  // id check.
  useEffect(() => {
    const STYLE_ID = 'city-map-popup-v2-resize-styles';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cmp-resize-edge > span,
      .cmp-resize-corner > span {
        transition: background-color 120ms ease-out, opacity 120ms ease-out;
      }
      .cmp-resize-edge:hover > span,
      .cmp-resize-corner:hover > span {
        background-color: #5a3a10;
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Re-clamp the popup rect to the viewport when the window resizes so the
  // popup never ends up partially or fully off-screen after a browser resize.
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      setPopupRect(prev => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.max(MIN_POPUP_WIDTH, Math.min(prev.width, vw - 2 * POPUP_VIEWPORT_MARGIN));
        const height = Math.max(MIN_POPUP_HEIGHT, Math.min(prev.height, vh - 2 * POPUP_VIEWPORT_MARGIN));
        const left = Math.max(MIN_VISIBLE - width, Math.min(vw - MIN_VISIBLE, prev.left));
        const top = Math.max(0, Math.min(vh - MIN_VISIBLE, prev.top));
        return { left, top, width, height };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  // Track the canvas wrapper's inner size (CSS pixels). Non-square is allowed
  // — the map renders fit-COVER so it always fills both axes.
  useEffect(() => {
    if (!isOpen) return;
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const w = Math.max(200, wrapper.clientWidth);
      const h = Math.max(200, wrapper.clientHeight);
      setCanvasSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [isOpen]);

  // Re-clamp the transform whenever the canvas size changes — the pan range
  // depends on display dimensions, so growing the popup (while zoomed in) may
  // unstick a pan that was previously at the boundary.
  useEffect(() => {
    setTransform(prev => clampTransform(prev, canvasSize.w, canvasSize.h));
  }, [canvasSize.w, canvasSize.h]);

  // Apply the canvas display size + matching internal resolution whenever it
  // changes. Decoupled from data generation so the canvas isn't cleared and
  // the map isn't re-generated on every drag-tick (setting canvas.width wipes
  // pixel state). The render effect below redraws right after.
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.w * dpr);
    canvas.height = Math.round(canvasSize.h * dpr);
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
  }, [isOpen, canvasSize.w, canvasSize.h]);

  // Generate map data when the source inputs change. Internal pixel
  // resolution follows the live canvas size (set by the effect above) so the
  // map stays sharp at any popup dimension. When the parent passes
  // `precomputedData` (DetailsTab generates one map and shares it across
  // the Quarters / Characters / Map panels), reuse that instance verbatim
  // — the generator is deterministic from `(seed, cityName, environment)`
  // so the result is byte-identical anyway, but reusing the reference saves
  // ~50ms of redundant work on megalopolis-tier cities.
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const data = precomputedData ?? generateCityMapV2(seed, cityName, environment);
    mapDataRef.current = data;

    // Build polygon → tooltip-info index AND polygon → district-key index
    // in the same two-pass walk so the click handler and the hover tooltip
    // never disagree about which block / landmark owns a given polygon.
    //   1. Block fallback for every interior polygon (any DistrictType, no
    //      role filter) so non-landmark polygons still get a tooltip /
    //      modal target.
    //   2. Landmark overlay — overwrites the block entry on each polygon a
    //      LandmarkV2 covers (single polygon, or every id in `polygonIds`
    //      for park clusters) so the user sees the specific landmark's
    //      name, icon, and quarter type instead of the coarser parent
    //      block role. Unnamed Phase 4 quarters (forge / barracks / …)
    //      inherit the parent block's procedural name; named landmarks
    //      (castle / palace / wonder / …) keep their own `lm.name`.
    const polygonToBlock = new Map<number, { name: string; role: DistrictType; blockIndex: number }>();
    for (let bi = 0; bi < data.blocks.length; bi++) {
      const block = data.blocks[bi];
      const entry = { name: block.name, role: block.role, blockIndex: bi };
      for (const pid of block.polygonIds) polygonToBlock.set(pid, entry);
    }

    const pMap = new Map<number, PolygonHit>();
    const dMap = new Map<number, DistrictKey>();
    for (const [pid, block] of polygonToBlock) {
      const info = DISTRICT_ROLE_INFO[block.role];
      pMap.set(pid, { name: block.name, icon: info.icon, label: info.label });
      dMap.set(pid, { kind: 'block', index: block.blockIndex });
    }
    for (let li = 0; li < data.landmarks.length; li++) {
      const lm = data.landmarks[li];
      const kindInfo = LANDMARK_KIND_INFO[lm.kind];
      if (!kindInfo) continue;
      const pids = lm.polygonIds ?? [lm.polygonId];
      for (const pid of pids) {
        const block = polygonToBlock.get(pid);
        const name = lm.name ?? block?.name ?? kindInfo.label;
        pMap.set(pid, { name, icon: kindInfo.icon, label: kindInfo.label });
        dMap.set(pid, { kind: 'landmark', index: li });
      }
    }
    polygonToHitRef.current = pMap;
    polygonToDistrictRef.current = dMap;

    // Reset zoom whenever a fresh map is generated.
    setTransform(prev =>
      (prev.x === 0 && prev.y === 0 && prev.scale === 1) ? prev : { x: 0, y: 0, scale: 1 }
    );
  }, [isOpen, seed, cityName, environment, precomputedData]);

  // Re-render whenever the transform, canvas size, or render-time toggles
  // change. Cheap because no regeneration runs — just renderCityMapV2 over
  // cached data. Effective draw scale = baseScale × user scale, applied
  // uniformly so the map never distorts; pan is in CSS pixels.
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !mapDataRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const base = baseScaleFor(canvasSize.w, canvasSize.h);
    const k = dpr * base * transform.scale;
    ctx.setTransform(k, 0, 0, k, dpr * transform.x, dpr * transform.y);
    renderCityMapV2(ctx, mapDataRef.current, environment, seed, cityName, showIcons, showLabels);
  }, [isOpen, transform, canvasSize.w, canvasSize.h, showIcons, showLabels, environment, seed, cityName]);

  // Clear tooltip when labels are turned on or popup closes.
  useEffect(() => {
    if (showLabels || !isOpen) {
      setTooltip(null);
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    }
  }, [showLabels, isOpen]);

  // Closing the popup must also dismiss the district modal — otherwise the
  // user can re-open the city-map popup (or a different city's popup) with
  // a stale modal still floating from the previous session.
  useEffect(() => {
    if (!isOpen) setSelectedDistrict(null);
  }, [isOpen]);

  // Keyboard escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Convert viewport client coords → map internal coords (0..INTERNAL_SIZE),
  // accounting for the current transform AND baseScale so hit-testing works
  // at any zoom level and any popup aspect ratio.
  const toMapCoords = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const t = transformRef.current;
    const base = baseScaleFor(canvasSizeRef.current.w, canvasSizeRef.current.h);
    const denom = t.scale * base;
    return [(cssX - t.x) / denom, (cssY - t.y) / denom];
  }, []);

  // Return the resolved tooltip info under the given client position, or null.
  const hitTest = useCallback((clientX: number, clientY: number): PolygonHit | null => {
    const coords = toMapCoords(clientX, clientY);
    if (!coords) return null;
    const data = mapDataRef.current;
    if (!data) return null;
    const [cx, cy] = coords;
    for (const polygon of data.polygons) {
      if (pointInPolygon(cx, cy, polygon.vertices)) {
        return polygonToHitRef.current.get(polygon.id) ?? null;
      }
    }
    return null;
  }, [toMapCoords]);

  // Hit-test for click-to-open-district. Mirrors `hitTest` but returns the
  // structured DistrictKey from `polygonToDistrictRef` so the modal can look
  // up the canonical block / landmark. Returns null when the click lands on
  // a polygon outside any block (water / mountain / unallocated edge cells).
  const districtHitTest = useCallback((clientX: number, clientY: number): DistrictKey | null => {
    const coords = toMapCoords(clientX, clientY);
    if (!coords) return null;
    const data = mapDataRef.current;
    if (!data) return null;
    const [cx, cy] = coords;
    for (const polygon of data.polygons) {
      if (pointInPolygon(cx, cy, polygon.vertices)) {
        return polygonToDistrictRef.current.get(polygon.id) ?? null;
      }
    }
    return null;
  }, [toMapCoords]);

  const handleCanvasClick = useCallback((clientX: number, clientY: number) => {
    const dk = districtHitTest(clientX, clientY);
    if (dk) {
      setSelectedDistrict(dk);
      setTooltip(null);
    }
  }, [districtHitTest]);

  // Convert client (x, y) → CSS-pixel coords relative to the canvas origin.
  const clientToCanvasCss = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }, []);

  // Wheel zoom around cursor. Non-passive listener so we can preventDefault to
  // suppress browser-level page scroll while the cursor is over the map.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const anchor = clientToCanvasCss(e.clientX, e.clientY);
        if (!anchor) return;
        const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
        const { w, h } = canvasSizeRef.current;
        setTransform(prev => zoomAround(prev, anchor[0], anchor[1], factor, w, h));
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [isOpen, clientToCanvasCss]);

  // Touch: pinch-to-zoom (two fingers), single-finger pan when zoomed in.
  // Non-passive so we can preventDefault and override browser pinch zoom.
  // Also rolls in the tooltip behavior so the React handlers don't double-fire.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;

    const showTooltipFor = (clientX: number, clientY: number) => {
      if (showLabelsRef.current) return;
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
      const hit = hitTest(clientX, clientY);
      setTooltip(hit ? { ...hit, x: clientX, y: clientY - 68 } : null);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        isPinchingRef.current = true;
        isPanningRef.current = false;
        lastTouchDistRef.current = getTouchDist(e.touches[0], e.touches[1]);
        lastTouchMidRef.current = getTouchMid(e.touches[0], e.touches[1]);
        setTooltip(null);
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current);
          tooltipTimerRef.current = null;
        }
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        const { w, h } = canvasSizeRef.current;
        // Pan available when zoomed in OR when the canvas isn't square (the
        // map fit-COVERS so the smaller axis has cropped overflow to scroll).
        const canPan = transformRef.current.scale > MIN_SCALE || w !== h;
        if (canPan) {
          isPanningRef.current = true;
          lastPanRef.current = { x: touch.clientX, y: touch.clientY };
        }
        // Tap-to-open-district uses the same start position as the panning
        // anchor; touchend compares the final touch against this start to
        // decide tap vs pan, with a looser tolerance than mouse clicks.
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        showTooltipFor(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { w, h } = canvasSizeRef.current;
      if (e.touches.length === 2 && isPinchingRef.current) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const newMid = getTouchMid(e.touches[0], e.touches[1]);
        const factor = newDist / (lastTouchDistRef.current || newDist);
        const anchorCssX = lastTouchMidRef.current.x - rect.left;
        const anchorCssY = lastTouchMidRef.current.y - rect.top;
        const dxCss = newMid.x - lastTouchMidRef.current.x;
        const dyCss = newMid.y - lastTouchMidRef.current.y;
        setTransform(prev => {
          const zoomed = zoomAround(prev, anchorCssX, anchorCssY, factor, w, h);
          return clampTransform({
            scale: zoomed.scale,
            x: zoomed.x + dxCss,
            y: zoomed.y + dyCss,
          }, w, h);
        });
        lastTouchDistRef.current = newDist;
        lastTouchMidRef.current = newMid;
      } else if (e.touches.length === 1 && isPanningRef.current) {
        e.preventDefault();
        const touch = e.touches[0];
        const dxCss = touch.clientX - lastPanRef.current.x;
        const dyCss = touch.clientY - lastPanRef.current.y;
        lastPanRef.current = { x: touch.clientX, y: touch.clientY };
        setTransform(prev => clampTransform({
          scale: prev.scale,
          x: prev.x + dxCss,
          y: prev.y + dyCss,
        }, w, h));
        // Suppress tooltip while actively dragging.
        setTooltip(null);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isPinchingRef.current = false;
        isPanningRef.current = false;
        // Detect tap → open district modal. `changedTouches` carries the
        // finger that just lifted; if it stayed within the tap tolerance
        // of the start anchor we treat the gesture as a click.
        const start = touchStartRef.current;
        touchStartRef.current = null;
        if (start && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (dx * dx + dy * dy <= CLICK_MOVE_TOLERANCE_TOUCH_SQ) {
            handleCanvasClick(t.clientX, t.clientY);
          }
        }
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = setTimeout(() => setTooltip(null), 2000);
      } else if (e.touches.length === 1 && isPinchingRef.current) {
        // Pinch → potential pan as the second finger lifts.
        isPinchingRef.current = false;
        const { w, h } = canvasSizeRef.current;
        if (transformRef.current.scale > MIN_SCALE || w !== h) {
          isPanningRef.current = true;
          lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        // Pinch-then-pan is not a tap; drop the start anchor.
        touchStartRef.current = null;
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isOpen, hitTest, handleCanvasClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDraggingRef.current) {
      const dxCss = e.clientX - lastMouseRef.current.x;
      const dyCss = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      const { w, h } = canvasSizeRef.current;
      setTransform(prev => clampTransform({
        scale: prev.scale,
        x: prev.x + dxCss,
        y: prev.y + dyCss,
      }, w, h));
      return;
    }
    if (showLabels) return;
    const hit = hitTest(e.clientX, e.clientY);
    setTooltip(hit ? { ...hit, x: e.clientX, y: e.clientY - 44 } : null);
  }, [showLabels, hitTest]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { w, h } = canvasSizeRef.current;
    const canPan = transformRef.current.scale > MIN_SCALE || w !== h;
    // Track every left-button mousedown for click-vs-pan resolution on
    // mouseup. Middle-click is reserved for pan and never opens a modal.
    if (e.button === 0) {
      mouseDownStartRef.current = { x: e.clientX, y: e.clientY };
    }
    // Left-click drag pans when there's pannable space; middle-click always pans.
    if (e.button === 1 || (e.button === 0 && canPan)) {
      e.preventDefault();
      isMouseDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setTooltip(null);
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isMouseDraggingRef.current = false;
    // If the mouse barely moved between down and up, treat it as a click and
    // open the district modal. Otherwise the user was panning — leave the
    // transform where they dragged it to.
    const start = mouseDownStartRef.current;
    mouseDownStartRef.current = null;
    if (e.button !== 0 || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy <= CLICK_MOVE_TOLERANCE_MOUSE_SQ) {
      handleCanvasClick(e.clientX, e.clientY);
    }
  }, [handleCanvasClick]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    isMouseDraggingRef.current = false;
    // Drop the click anchor so a mousedown-then-leave-then-up-elsewhere can't
    // synthesize a bogus click on the next entry.
    mouseDownStartRef.current = null;
  }, []);

  const handleZoomIn = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    setTransform(prev => zoomAround(prev, w / 2, h / 2, ZOOM_BUTTON_FACTOR, w, h));
  }, []);

  const handleZoomOut = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    setTransform(prev => zoomAround(prev, w / 2, h / 2, 1 / ZOOM_BUTTON_FACTOR, w, h));
  }, []);

  const handleZoomReset = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Pointer-based resize: each handle reports a direction string. The handle
  // captures the pointer on down so movements outside the handle still update
  // the popup rect; we always work from a snapshot of the rect at down-time so
  // jitter from React state updates can't drift the geometry.
  const handleResizeStart = useCallback((dir: ResizeDirection) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const start = popupRect;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    try { target.setPointerCapture(e.pointerId); } catch {}
    activeResizeDirRef.current = dir;
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let { left, top, width, height } = start;

      if (dir.includes('e')) {
        // Drag right edge: clamp width so the popup doesn't push past the
        // viewport's right margin.
        width = Math.max(MIN_POPUP_WIDTH, Math.min(start.width + dx, vw - start.left - POPUP_VIEWPORT_MARGIN));
      }
      if (dir.includes('w')) {
        // Drag left edge: opposite (right) edge stays anchored, so width
        // changes by -dx and left compensates so right = start.left + start.width.
        const desiredW = Math.max(MIN_POPUP_WIDTH, Math.min(start.width - dx, start.left + start.width - POPUP_VIEWPORT_MARGIN));
        width = desiredW;
        left = start.left + start.width - width;
      }
      if (dir.includes('s')) {
        height = Math.max(MIN_POPUP_HEIGHT, Math.min(start.height + dy, vh - start.top - POPUP_VIEWPORT_MARGIN));
      }
      if (dir.includes('n')) {
        const desiredH = Math.max(MIN_POPUP_HEIGHT, Math.min(start.height - dy, start.top + start.height - POPUP_VIEWPORT_MARGIN));
        height = desiredH;
        top = start.top + start.height - height;
      }

      // Hard guard: keep at least a sliver visible (matters when the popup
      // started near a viewport edge and the user yanks the handle far past).
      left = Math.max(MIN_VISIBLE - width, Math.min(vw - MIN_VISIBLE, left));
      top = Math.max(0, Math.min(vh - MIN_VISIBLE, top));

      setPopupRect({ left, top, width, height });
    };

    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      activeResizeDirRef.current = null;
      setResizing(false);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [popupRect]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div style={styles.backdrop} onClick={handleBackdropClick}>
        <div
          style={{
            ...styles.container,
            left: popupRect.left,
            top: popupRect.top,
            width: popupRect.width,
            height: popupRect.height,
            // Suppress text selection mid-resize.
            userSelect: resizing ? 'none' : undefined,
          }}
        >
          {/* Resize handles — 4 edges + 4 corners. Each edge handle has a
              slim always-on hint bar centered in the strip; each corner has
              a small visible chevron-style grip. Hover styling lives in the
              one-shot CSS injected by `useResizeHandleStyles`. */}
          <div className="cmp-resize-edge cmp-resize-edge-n" style={styles.resizeEdgeN} onPointerDown={handleResizeStart('n')}>
            <span style={styles.resizeEdgeHintH} />
          </div>
          <div className="cmp-resize-edge cmp-resize-edge-s" style={styles.resizeEdgeS} onPointerDown={handleResizeStart('s')}>
            <span style={styles.resizeEdgeHintH} />
          </div>
          <div className="cmp-resize-edge cmp-resize-edge-e" style={styles.resizeEdgeE} onPointerDown={handleResizeStart('e')}>
            <span style={styles.resizeEdgeHintV} />
          </div>
          <div className="cmp-resize-edge cmp-resize-edge-w" style={styles.resizeEdgeW} onPointerDown={handleResizeStart('w')}>
            <span style={styles.resizeEdgeHintV} />
          </div>
          <div className="cmp-resize-corner" style={styles.resizeCornerNE} onPointerDown={handleResizeStart('ne')}>
            <span style={styles.resizeCornerNEGrip} />
          </div>
          <div className="cmp-resize-corner" style={styles.resizeCornerNW} onPointerDown={handleResizeStart('nw')}>
            <span style={styles.resizeCornerNWGrip} />
          </div>
          <div className="cmp-resize-corner" style={styles.resizeCornerSE} onPointerDown={handleResizeStart('se')}>
            <span style={styles.resizeCornerSEGrip} />
          </div>
          <div className="cmp-resize-corner" style={styles.resizeCornerSW} onPointerDown={handleResizeStart('sw')}>
            <span style={styles.resizeCornerSWGrip} />
          </div>
          <div style={styles.header}>
            <span style={styles.title}>{cityName}</span>
            <div style={styles.headerControls}>
              <label style={styles.iconToggle}>
                <input
                  type="checkbox"
                  checked={showIcons}
                  onChange={e => setShowIcons(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.iconToggleText}>Icons</span>
              </label>
              <label style={styles.iconToggle}>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={e => setShowLabels(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.iconToggleText}>Labels</span>
              </label>
              <button style={styles.closeBtn} onClick={onClose} title="Close">&times;</button>
            </div>
          </div>
          <div ref={canvasWrapperRef} style={styles.canvasWrapper}>
            <div style={styles.canvasFrame}>
              <canvas
                ref={canvasRef}
                style={{
                  ...styles.canvas,
                  cursor: (transform.scale > MIN_SCALE || canvasSize.w !== canvasSize.h)
                    ? (isMouseDraggingRef.current ? 'grabbing' : 'grab')
                    : 'default',
                }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
              <div style={styles.zoomControls}>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomIn}
                  disabled={transform.scale >= MAX_SCALE}
                  title="Zoom in"
                >+</button>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomReset}
                  disabled={transform.scale === 1 && transform.x === 0 && transform.y === 0}
                  title="Reset zoom"
                >⌂</button>
                <button
                  type="button"
                  style={styles.zoomBtn}
                  onClick={handleZoomOut}
                  disabled={transform.scale <= MIN_SCALE}
                  title="Zoom out"
                >−</button>
              </div>
            </div>
          </div>
          <div style={styles.footer}>
            <span style={styles.footerText}>
              {environment.size.charAt(0).toUpperCase() + environment.size.slice(1)}
              {environment.isCapital ? ' • Capital' : ''}
              {environment.isCoastal ? ' • Coastal' : ''}
              {environment.hasRiver ? ' • River' : ''}
              {environment.isRuin ? ' • Ruins' : ''}
            </span>
          </div>
        </div>
      </div>
      {!showLabels && tooltip && (
        <div style={{ ...styles.tooltip, left: tooltip.x, top: tooltip.y }}>
          <div style={styles.tooltipName}>{tooltip.name}</div>
          <div style={styles.tooltipRole}>{tooltip.icon} {tooltip.label}</div>
        </div>
      )}
      {selectedDistrict && mapDataRef.current && (
        <DistrictModal
          districtKey={selectedDistrict}
          data={mapDataRef.current}
          characters={charactersByDistrict.get(`${selectedDistrict.kind}:${selectedDistrict.index}`) ?? []}
          npcPlace={npcSummary?.placesById.get(`${selectedDistrict.kind}:${selectedDistrict.index}`)}
          onClose={() => setSelectedDistrict(null)}
          onSelectCharacter={onSelectCharacter}
        />
      )}
    </>,
    document.body,
  );
}

// ─── District modal ─────────────────────────────────────────────────────────
//
// Opened by clicking a polygon on the city map. Renders the district's
// display name, the underlying block role / landmark kind, and the list of
// roster characters the affiliation pass placed there. Clicking a character
// row bubbles back up via `onSelectCharacter` so the parent's
// `<CharacterPopup>` opens on top of this modal.

interface DistrictModalProps {
  districtKey: DistrictKey;
  data: CityMapDataV2;
  characters: CityCharacter[];
  /**
   * Bulk NPC-class population assigned to this place. Resolved by the parent
   * via `npcSummary.placesById.get(...)` against the same district key the
   * `characters` list was filtered by, so the totals always agree.
   */
  npcPlace?: NpcPlace;
  onClose: () => void;
  onSelectCharacter?: (c: CityCharacter) => void;
}

const NPC_CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', expert: 'Expert', adept: 'Adept', aristocrat: 'Aristocrat',
};

const NPC_CLASS_COLORS: Record<string, string> = {
  warrior: '#943030', expert: '#5a3a10', adept: '#1f6a55', aristocrat: '#8a6a00',
};

function DistrictModal({ districtKey, data, characters, npcPlace, onClose, onSelectCharacter }: DistrictModalProps) {
  // ESC-to-close. Keying it on `districtKey` rather than mount lets the user
  // jump from one district to another without remounting and re-binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Resolve display fields from the map data — block name + role, OR
  // landmark name (falling back to its containing block when the landmark
  // is one of the Phase 4 nameless quarter kinds) + landmark kind.
  let title = '';
  let subtitle = '';
  let icon = '';
  if (districtKey.kind === 'block') {
    const block = data.blocks[districtKey.index];
    if (!block) return null;
    title = block.name;
    const info = DISTRICT_ROLE_INFO[block.role];
    subtitle = info.label;
    icon = info.icon;
  } else {
    const lm = data.landmarks[districtKey.index];
    if (!lm) return null;
    const info = LANDMARK_KIND_INFO[lm.kind];
    if (lm.name) title = lm.name;
    else {
      const containing = data.blocks.find(b => b.polygonIds.includes(lm.polygonId));
      title = containing?.name ?? info.label;
    }
    subtitle = info.label;
    icon = info.icon;
  }

  return (
    <>
      <div style={styles.modalBackdrop} onClick={onClose} />
      <div
        style={styles.modalContainer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="district-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div style={styles.modalTitleBlock}>
            <span style={styles.modalIcon}>{icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span id="district-modal-title" style={styles.modalTitle}>{title}</span>
              <span style={styles.modalSubtitle}>{subtitle}</span>
            </div>
          </div>
          <button style={styles.modalCloseBtn} onClick={onClose} title="Close (Esc)">&times;</button>
        </div>
        <div style={styles.modalBody}>
          {characters.length === 0 && !npcPlace ? (
            <div style={styles.modalEmpty}>No notable inhabitants.</div>
          ) : (
            <>
              {characters.length > 0 && (
                <div style={styles.modalCharList}>
                  {characters.map((c, i) => {
                    const alignColor =
                      c.alignment.endsWith('_good') ? '#4a7a4a' :
                      c.alignment.endsWith('_evil') ? '#943030' :
                      '#5a3a10';
                    const tooltip = `HP ${c.hitPoints} | ${c.deity === 'none' ? 'No deity' : c.deity}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        style={styles.modalCharRow}
                        onClick={() => {
                          // Close the district modal first so the parent's
                          // CharacterPopup opens cleanly on top (no z-index war
                          // — both share the same modal stacking context).
                          onClose();
                          onSelectCharacter?.(c);
                        }}
                        disabled={!onSelectCharacter}
                        title={onSelectCharacter ? `Open ${c.name}'s sheet — ${tooltip}` : tooltip}
                      >
                        <span style={styles.modalCharName}>{c.name}</span>
                        <span style={styles.modalCharMeta}>
                          L{c.level} {raceLabel(c.race)}{' '}
                          <span style={{ textTransform: 'capitalize' }}>{c.pcClass}</span>
                        </span>
                        <span style={{ ...styles.modalCharAlign, color: alignColor }}>
                          {alignmentBadge(c.alignment)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {npcPlace && (
                <div style={styles.modalNpcSection}>
                  <div style={styles.modalNpcHeader}>
                    NPC Class Characters ({npcPlace.total})
                  </div>
                  <div style={styles.modalNpcList}>
                    {npcPlace.entries.map((entry, i) => (
                      <div key={i} style={styles.modalNpcRow}>
                        <span style={{ ...styles.modalNpcClass, color: NPC_CLASS_COLORS[entry.npcClass] }}>
                          {NPC_CLASS_LABELS[entry.npcClass]}
                        </span>
                        <span style={styles.modalNpcLevel}>L{entry.level}</span>
                        <span style={styles.modalNpcCount}>×{entry.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(30, 20, 10, 0.6)',
    zIndex: 10000,
  },
  container: {
    position: 'fixed',
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  // Each edge handle is a thin strip along the popup border. They sit OUTSIDE
  // the rounded border (negative offsets) so the visible hairline doesn't
  // clash with the container's brown frame, and they have an 8px hit-target
  // for easy grabbing.
  resizeEdgeN: {
    position: 'absolute',
    top: -4,
    left: 12,
    right: 12,
    height: 8,
    cursor: 'ns-resize',
    zIndex: 5,
    touchAction: 'none',
  },
  resizeEdgeS: {
    position: 'absolute',
    bottom: -4,
    left: 12,
    right: 12,
    height: 8,
    cursor: 'ns-resize',
    zIndex: 5,
    touchAction: 'none',
  },
  resizeEdgeE: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    right: -4,
    width: 8,
    cursor: 'ew-resize',
    zIndex: 5,
    touchAction: 'none',
  },
  resizeEdgeW: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    left: -4,
    width: 8,
    cursor: 'ew-resize',
    zIndex: 5,
    touchAction: 'none',
  },
  // Corner handles overlap the edge handles so diagonal resize wins at the
  // very corner. The SE corner additionally renders a small visible grip so
  // there's an obvious primary-resize affordance (matching the old default).
  resizeCornerNE: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    cursor: 'nesw-resize',
    zIndex: 6,
    touchAction: 'none',
  },
  resizeCornerNW: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 16,
    height: 16,
    cursor: 'nwse-resize',
    zIndex: 6,
    touchAction: 'none',
  },
  resizeCornerSE: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 18,
    height: 18,
    cursor: 'nwse-resize',
    zIndex: 6,
    touchAction: 'none',
  },
  resizeCornerSEGrip: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 9,
    height: 9,
    borderRight: '2px solid #8a6a3a',
    borderBottom: '2px solid #8a6a3a',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    opacity: 0.85,
  },
  resizeCornerSWGrip: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    width: 9,
    height: 9,
    borderLeft: '2px solid #8a6a3a',
    borderBottom: '2px solid #8a6a3a',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    opacity: 0.85,
  },
  resizeCornerNEGrip: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 9,
    height: 9,
    borderRight: '2px solid #8a6a3a',
    borderTop: '2px solid #8a6a3a',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    opacity: 0.85,
  },
  resizeCornerNWGrip: {
    position: 'absolute',
    left: 5,
    top: 5,
    width: 9,
    height: 9,
    borderLeft: '2px solid #8a6a3a',
    borderTop: '2px solid #8a6a3a',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    opacity: 0.85,
  },
  // Slim always-visible mid-line on each edge hinting "you can drag here";
  // the injected hover CSS darkens / opaques it on pointer-over.
  resizeEdgeHintH: {
    position: 'absolute',
    top: 3,
    left: '20%',
    right: '20%',
    height: 2,
    background: '#8a6a3a',
    borderRadius: 1,
    pointerEvents: 'none',
    opacity: 0.55,
  },
  resizeEdgeHintV: {
    position: 'absolute',
    left: 3,
    top: '20%',
    bottom: '20%',
    width: 2,
    background: '#8a6a3a',
    borderRadius: 1,
    pointerEvents: 'none',
    opacity: 0.55,
  },
  resizeCornerSW: {
    position: 'absolute',
    bottom: -6,
    left: -6,
    width: 16,
    height: 16,
    cursor: 'nesw-resize',
    zIndex: 6,
    touchAction: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #d4b896',
    background: '#ecdbb8',
    borderRadius: '6px 6px 0 0',
    flexShrink: 0,
    gap: 8,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 15,
    color: '#3a1a00',
    letterSpacing: 0.5,
    fontFamily: 'Georgia, serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 1,
    minWidth: 0,
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  iconToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    userSelect: 'none',
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #c4a070',
    background: 'rgba(255,255,255,0.35)',
    transition: 'background 0.15s',
  },
  checkbox: {
    cursor: 'pointer',
    accentColor: '#8a6a3a',
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  iconToggleText: {
    fontSize: 11,
    color: '#5a3a10',
    fontFamily: 'sans-serif',
    letterSpacing: 0.3,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    color: '#7a5a30',
    padding: '4px 8px',
    lineHeight: 1,
    fontWeight: 'bold',
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  canvasWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
  },
  canvasFrame: {
    position: 'relative',
    display: 'inline-block',
    lineHeight: 0,
  },
  canvas: {
    borderRadius: 3,
    display: 'block',
    touchAction: 'none',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    zIndex: 2,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 16,
    color: '#3a1a00',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    padding: 0,
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #d4b896',
    textAlign: 'center',
    flexShrink: 0,
  },
  footerText: {
    fontSize: 11,
    color: '#6a4a20',
    fontStyle: 'italic',
  },
  tooltip: {
    position: 'fixed',
    transform: 'translateX(-50%)',
    background: 'rgba(28, 18, 8, 0.93)',
    color: '#f0e0b8',
    fontFamily: "Georgia, 'Times New Roman', serif",
    padding: '6px 14px 8px',
    borderRadius: 5,
    border: '1px solid rgba(200, 155, 70, 0.55)',
    boxShadow: '0 3px 12px rgba(0,0,0,0.55)',
    pointerEvents: 'none',
    zIndex: 10001,
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 3,
  },
  tooltipRole: {
    fontSize: 11,
    color: '#c8a462',
    letterSpacing: 0.4,
  },
  // ─── District modal (opened by clicking a polygon on the city map) ──
  // Sits above the city-map popup (zIndex 10001) so it visually layers on
  // top, while leaving the parent's CharacterPopup (zIndex 10001 too,
  // rendered later in the DOM) free to stack above when a character row
  // is clicked.
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(20, 12, 4, 0.45)',
    zIndex: 10001,
  },
  modalContainer: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(440px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 64px)',
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 10002,
    fontFamily: 'inherit',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #c8a868',
    background: 'linear-gradient(180deg, #efe0b5 0%, #e6d5a3 100%)',
    gap: 10,
  },
  modalTitleBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  modalIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    letterSpacing: 0.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#7a5a30',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    lineHeight: 1,
    color: '#5a3a10',
    padding: '0 4px',
    flexShrink: 0,
  },
  modalBody: {
    padding: '10px 12px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  modalEmpty: {
    fontStyle: 'italic',
    color: '#7a5a30',
    padding: '16px 4px',
    textAlign: 'center',
  },
  modalCharList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  modalCharRow: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1.6fr 0.4fr',
    gap: 8,
    alignItems: 'baseline',
    padding: '6px 10px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
    color: '#2a1a00',
  },
  modalCharName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#2a1a00',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  modalCharMeta: {
    fontSize: 11,
    color: '#5a3a10',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  modalCharAlign: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: 'right',
  },
  modalNpcSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #c8a868',
  },
  modalNpcHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingLeft: 2,
  },
  modalNpcList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  modalNpcRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 0.4fr 0.5fr',
    gap: 8,
    padding: '3px 10px',
    fontSize: 12,
    color: '#2a1a00',
    background: '#f4ead0',
    border: '1px solid #d8c088',
    borderRadius: 3,
    alignItems: 'baseline',
  },
  modalNpcClass: {
    fontWeight: 600,
  },
  modalNpcLevel: {
    color: '#5a3a10',
  },
  modalNpcCount: {
    color: '#2a1a00',
    fontWeight: 600,
    textAlign: 'right',
  },
};
