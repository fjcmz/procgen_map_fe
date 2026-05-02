import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { UniverseData, SolarSystemData, PlanetData } from '../lib/universe/types';
import {
  drawGalaxyScene,
  drawSystemScene,
  drawPlanetScene,
  drawBackground,
  createStarField,
  type HitCircle,
  type BackgroundStar,
  type ViewBounds,
} from '../lib/universe/renderer';
import { pickHit } from '../lib/universe/hitTest';

export type UniverseScene = 'galaxy' | 'system' | 'planet';

export interface UniverseSceneState {
  scene: UniverseScene;
  systemId: string | null;
  planetId: string | null;
  /**
   * Optional galaxy focus. When non-null in the `galaxy` scene the renderer
   * displays only that galaxy centered (legacy single-spiral look) instead
   * of the multi-galaxy world layout. Null = multi-galaxy overview (or the
   * single legacy view when `data.galaxies.length === 1`). Other scenes
   * ignore this field.
   */
  galaxyId: string | null;
}

export type PopupEntity =
  | { kind: 'galaxy'; galaxyId: string }
  | { kind: 'system'; systemId: string }
  | { kind: 'star'; systemId: string; starId: string }
  | { kind: 'planet'; systemId: string; planetId: string }
  | { kind: 'satellite'; systemId: string; planetId: string; satelliteId: string };

export interface UniverseCanvasHandle {
  reset: () => void;
  back: () => void;
  navigateTo: (scene: UniverseScene, systemId?: string, planetId?: string, galaxyId?: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

interface UniverseCanvasProps {
  data: UniverseData | null;
  onSceneChange?: (state: UniverseSceneState) => void;
  onEntityClick?: (entity: PopupEntity) => void;
}

// ── Zoom/pan transform helpers ────────────────────────────────────────────────
// Transform maps canvas point (x,y) → screen point (x*scale + tx, y*scale + ty).
// Default { scale:1, tx:0, ty:0 } = identity (scene center stays at viewport center).

interface ViewTransform { scale: number; tx: number; ty: number }

const MIN_SCALE = 0.15;
const MAX_SCALE = 2000;

function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

function zoomAround(t: ViewTransform, cx: number, cy: number, factor: number): ViewTransform {
  const newScale = clampScale(t.scale * factor);
  const contentX = (cx - t.tx) / t.scale;
  const contentY = (cy - t.ty) / t.scale;
  return { scale: newScale, tx: cx - contentX * newScale, ty: cy - contentY * newScale };
}

function transformHit(hit: HitCircle[], t: ViewTransform): HitCircle[] {
  return hit.map(h => ({
    ...h,
    x: h.x * t.scale + t.tx,
    y: h.y * t.scale + t.ty,
    r: h.r * t.scale,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

const TRANSITION_DUR = 0.55;

function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

export const UniverseCanvas = forwardRef<UniverseCanvasHandle, UniverseCanvasProps>(
  function UniverseCanvas({ data, onSceneChange, onEntityClick }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [sceneState, setSceneState] = useState<UniverseSceneState>({
      scene: 'galaxy',
      systemId: null,
      planetId: null,
      galaxyId: null,
    });
    const sceneStateRef = useRef(sceneState);
    sceneStateRef.current = sceneState;

    const transitionRef = useRef<{ start: number; from: UniverseScene; to: UniverseScene } | null>(null);
    const lastHitRef = useRef<HitCircle[]>([]);
    const starsRef = useRef<BackgroundStar[]>([]);
    const dataRef = useRef<UniverseData | null>(data);
    dataRef.current = data;

    // Unified zoom/pan transform — written by interaction handlers, read by the RAF loop.
    const transformRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });

    // Touch tracking for pinch-zoom (two fingers) and pan (one finger).
    const lastTouchDistRef = useRef(0);
    const lastTouchMidRef = useRef({ x: 0, y: 0 });
    // Tap candidate (single finger that hasn't moved) — used to fire entity
    // click on touchend, since preventDefault() on touchstart suppresses the
    // browser's synthesized click event.
    const tapCandidateRef = useRef<{ x: number; y: number } | null>(null);
    // Mouse drag tracking (desktop pan).
    const isMouseDraggingRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const hasDraggedRef = useRef(false);

    // Keep the latest onEntityClick callback in a ref so the click handler
    // effect doesn't need to re-register on every render.
    const onEntityClickRef = useRef(onEntityClick);
    onEntityClickRef.current = onEntityClick;

    useEffect(() => {
      onSceneChange?.(sceneState);
    }, [sceneState, onSceneChange]);

    // Reset scene + zoom when new universe data arrives.
    useEffect(() => {
      if (!data) return;
      setSceneState({ scene: 'galaxy', systemId: null, planetId: null, galaxyId: null });
      transitionRef.current = null;
      transformRef.current = { scale: 1, tx: 0, ty: 0 };
    }, [data]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onResize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        starsRef.current = createStarField(window.innerWidth, window.innerHeight);
      };
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    useImperativeHandle(ref, () => ({
      reset() {
        setSceneState({ scene: 'galaxy', systemId: null, planetId: null, galaxyId: null });
        transformRef.current = { scale: 1, tx: 0, ty: 0 };
      },
      back() {
        setSceneState(prev => {
          if (prev.scene === 'planet') {
            transitionRef.current = { start: performance.now() / 1000, from: 'planet', to: 'system' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'system', systemId: prev.systemId, planetId: null, galaxyId: prev.galaxyId };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            // Returning from a system view drops back into the galaxy that
            // contained it (preserves focus mode if it was set when entering).
            return { scene: 'galaxy', systemId: null, planetId: null, galaxyId: prev.galaxyId };
          }
          if (prev.scene === 'galaxy' && prev.galaxyId) {
            // Exit galaxy focus mode → multi-galaxy overview.
            transitionRef.current = { start: performance.now() / 1000, from: 'galaxy', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'galaxy', systemId: null, planetId: null, galaxyId: null };
          }
          return prev;
        });
      },
      navigateTo(scene: UniverseScene, systemId?: string, planetId?: string, galaxyId?: string) {
        setSceneState(prev => {
          transitionRef.current = { start: performance.now() / 1000, from: prev.scene, to: scene };
          transformRef.current = { scale: 1, tx: 0, ty: 0 };
          return {
            scene,
            systemId: systemId ?? null,
            planetId: planetId ?? null,
            // Galaxy focus only applies to the 'galaxy' scene; deeper scenes
            // remember their parent so `back()` can pop back into focus mode.
            galaxyId: galaxyId ?? (scene === 'galaxy' ? null : prev.galaxyId),
          };
        });
      },
      zoomIn() {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        transformRef.current = zoomAround(transformRef.current, cx, cy, 1.5);
      },
      zoomOut() {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        transformRef.current = zoomAround(transformRef.current, cx, cy, 1 / 1.5);
      },
      resetZoom() {
        transformRef.current = { scale: 1, tx: 0, ty: 0 };
      },
    }), []);

    // ── RAF render loop ───────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !data) return;
      let rafId: number | null = null;
      const startTs = performance.now() / 1000;

      const tick = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) { rafId = requestAnimationFrame(tick); return; }

        const now = performance.now() / 1000;
        const time = now - startTs;
        const stars = starsRef.current;
        const vw = canvas.width;
        const vh = canvas.height;
        const d = dataRef.current;
        if (!d) { rafId = requestAnimationFrame(tick); return; }

        const state = sceneStateRef.current;
        const system: SolarSystemData | null = state.systemId
          ? d.solarSystems.find(ss => ss.id === state.systemId) ?? null
          : null;
        const planet: PlanetData | null = system && state.planetId
          ? system.planets.find(p => p.id === state.planetId) ?? null
          : null;

        const tr = transitionRef.current;
        const tElapsed = tr ? Math.min(1, (now - tr.start) / TRANSITION_DUR) : 1;
        const tEase = ease(tElapsed);
        if (tr && tElapsed >= 1) transitionRef.current = null;

        const { scale, tx, ty } = transformRef.current;

        // Viewport bounds in canvas content-space, used for frustum culling.
        const viewBounds: ViewBounds = {
          x0: -tx / scale,
          y0: -ty / scale,
          x1: (vw - tx) / scale,
          y1: (vh - ty) / scale,
        };

        // 1. Background — always full-viewport, no transform applied.
        drawBackground(ctx, vw, vh, stars);

        // 2. Scene content under the zoom/pan transform.
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, tx, ty);

        let rawHit: HitCircle[] = [];
        if (state.scene === 'galaxy') {
          rawHit = drawGalaxyScene(ctx, d, vw, vh, stars, 1, true, scale, time, state.galaxyId, viewBounds).hit;
        } else if (state.scene === 'system' && system) {
          rawHit = drawSystemScene(ctx, system, vw, vh, stars, time, true, scale).hit;
        } else if (state.scene === 'planet' && planet) {
          rawHit = drawPlanetScene(ctx, planet, vw, vh, stars, time, true, scale).hit;
        }

        ctx.restore();

        // 3. Transition fade overlay — full-viewport, no transform.
        if (tr && tElapsed < 1) {
          ctx.fillStyle = `rgba(5, 3, 13, ${(1 - tEase) * 0.55})`;
          ctx.fillRect(0, 0, vw, vh);
        }

        // Transform hit circles from canvas space → screen space.
        lastHitRef.current = transformHit(rawHit, { scale, tx, ty });
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
      return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
    }, [data]);

    // ── Wheel zoom (desktop) ──────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let rafId: number | null = null;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          transformRef.current = zoomAround(transformRef.current, e.clientX, e.clientY, factor);
        });
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        canvas.removeEventListener('wheel', onWheel);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, []);

    // ── Touch drag + pinch-zoom (mobile) ──────────────────────────────────────
    // Uses native TouchEvent (not PointerEvent) with `{ passive: false }` and
    // explicit `preventDefault()` so iOS/Android Safari/Chrome reliably hand
    // gestures to the canvas instead of firing native scroll/pinch. Mirrors
    // the proven pattern in `MapCanvas.tsx`.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const getDist = (a: Touch, b: Touch) =>
        Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const getMid = (a: Touch, b: Touch) => ({
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      });

      const onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        hasDraggedRef.current = false;
        if (e.touches.length === 2) {
          lastTouchDistRef.current = getDist(e.touches[0], e.touches[1]);
          lastTouchMidRef.current = getMid(e.touches[0], e.touches[1]);
          // Two fingers down — never a tap.
          tapCandidateRef.current = null;
        } else if (e.touches.length === 1) {
          lastTouchMidRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          tapCandidateRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 2) {
          const newDist = getDist(e.touches[0], e.touches[1]);
          const newMid = getMid(e.touches[0], e.touches[1]);
          const oldDist = lastTouchDistRef.current || newDist;
          const oldMid = lastTouchMidRef.current;
          const factor = newDist / oldDist;
          const t = transformRef.current;
          const newScale = clampScale(t.scale * factor);
          const contentX = (oldMid.x - t.tx) / t.scale;
          const contentY = (oldMid.y - t.ty) / t.scale;
          transformRef.current = {
            scale: newScale,
            tx: oldMid.x - contentX * newScale + (newMid.x - oldMid.x),
            ty: oldMid.y - contentY * newScale + (newMid.y - oldMid.y),
          };
          lastTouchDistRef.current = newDist;
          lastTouchMidRef.current = newMid;
          hasDraggedRef.current = true;
        } else if (e.touches.length === 1) {
          const tx = e.touches[0].clientX;
          const ty = e.touches[0].clientY;
          const dx = tx - lastTouchMidRef.current.x;
          const dy = ty - lastTouchMidRef.current.y;
          if (!hasDraggedRef.current && Math.hypot(dx, dy) > 4) {
            hasDraggedRef.current = true;
            tapCandidateRef.current = null;
          }
          transformRef.current = {
            ...transformRef.current,
            tx: transformRef.current.tx + dx,
            ty: transformRef.current.ty + dy,
          };
          lastTouchMidRef.current = { x: tx, y: ty };
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          // Pinch ended but one finger remains — re-anchor pan.
          lastTouchMidRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          tapCandidateRef.current = null;
          return;
        }
        if (e.touches.length !== 0) return;
        // All fingers lifted. If this was a stationary single-finger tap,
        // run the same hit-test as the desktop click handler — preventDefault
        // on touchstart suppresses the browser's synthesized click event.
        const tap = tapCandidateRef.current;
        tapCandidateRef.current = null;
        if (!tap || hasDraggedRef.current) return;
        const rect = canvas.getBoundingClientRect();
        const px = tap.x - rect.left;
        const py = tap.y - rect.top;
        const hit = pickHit(lastHitRef.current, px, py);
        if (!hit) return;
        const state = sceneStateRef.current;
        if (hit.kind === 'galaxy') {
          onEntityClickRef.current?.({ kind: 'galaxy', galaxyId: hit.id });
        } else if (hit.kind === 'system') {
          onEntityClickRef.current?.({ kind: 'system', systemId: hit.id });
        } else if (hit.kind === 'planet') {
          onEntityClickRef.current?.({
            kind: 'planet',
            systemId: state.systemId!,
            planetId: hit.id,
          });
        } else if (hit.kind === 'satellite') {
          onEntityClickRef.current?.({
            kind: 'satellite',
            systemId: state.systemId!,
            planetId: state.planetId!,
            satelliteId: hit.id,
          });
        }
      };

      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);
      canvas.addEventListener('touchcancel', onTouchEnd);
      return () => {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);
      };
    }, []);

    // ── Mouse drag (desktop pan) ──────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        isMouseDraggingRef.current = true;
        hasDraggedRef.current = false;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isMouseDraggingRef.current) return;
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        if (!hasDraggedRef.current && Math.hypot(dx, dy) > 4) hasDraggedRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        transformRef.current = {
          ...transformRef.current,
          tx: transformRef.current.tx + dx,
          ty: transformRef.current.ty + dy,
        };
      };

      const onMouseUp = () => {
        if (!isMouseDraggingRef.current) return;
        isMouseDraggingRef.current = false;
        canvas.style.cursor = 'grab';
      };

      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }, []);

    // ── Click → open entity popup ─────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onClick = (e: MouseEvent) => {
        if (e.button !== 0) return;
        // Suppress click that was actually a pan gesture.
        if (hasDraggedRef.current) { hasDraggedRef.current = false; return; }
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const hit = pickHit(lastHitRef.current, px, py);
        if (!hit) return;
        const state = sceneStateRef.current;
        if (hit.kind === 'galaxy') {
          onEntityClickRef.current?.({ kind: 'galaxy', galaxyId: hit.id });
        } else if (hit.kind === 'system') {
          onEntityClickRef.current?.({ kind: 'system', systemId: hit.id });
        } else if (hit.kind === 'planet') {
          onEntityClickRef.current?.({
            kind: 'planet',
            systemId: state.systemId!,
            planetId: hit.id,
          });
        } else if (hit.kind === 'satellite') {
          onEntityClickRef.current?.({
            kind: 'satellite',
            systemId: state.systemId!,
            planetId: state.planetId!,
            satelliteId: hit.id,
          });
        }
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    }, []);

    // ── Escape → back ─────────────────────────────────────────────────────────
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        setSceneState(prev => {
          if (prev.scene === 'planet') {
            transitionRef.current = { start: performance.now() / 1000, from: 'planet', to: 'system' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'system', systemId: prev.systemId, planetId: null, galaxyId: prev.galaxyId };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'galaxy', systemId: null, planetId: null, galaxyId: prev.galaxyId };
          }
          if (prev.scene === 'galaxy' && prev.galaxyId) {
            transitionRef.current = { start: performance.now() / 1000, from: 'galaxy', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'galaxy', systemId: null, planetId: null, galaxyId: null };
          }
          return prev;
        });
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          display: 'block',
          touchAction: 'none',
          cursor: 'grab',
        }}
      />
    );
  },
);
