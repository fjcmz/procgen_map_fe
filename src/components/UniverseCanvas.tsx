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
} from '../lib/universe/renderer';
import { pickHit } from '../lib/universe/hitTest';

export type UniverseScene = 'galaxy' | 'system' | 'planet';

export interface UniverseSceneState {
  scene: UniverseScene;
  systemId: string | null;
  planetId: string | null;
}

export type PopupEntity =
  | { kind: 'system'; systemId: string }
  | { kind: 'planet'; systemId: string; planetId: string }
  | { kind: 'satellite'; systemId: string; planetId: string; satelliteId: string };

export interface UniverseCanvasHandle {
  reset: () => void;
  back: () => void;
  navigateTo: (scene: UniverseScene, systemId?: string, planetId?: string) => void;
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
const MAX_SCALE = 12;

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

    // Per-pointer tracking for drag (single) and pinch-zoom (two fingers).
    const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const dragOriginRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);
    const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);
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
      setSceneState({ scene: 'galaxy', systemId: null, planetId: null });
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
        setSceneState({ scene: 'galaxy', systemId: null, planetId: null });
        transformRef.current = { scale: 1, tx: 0, ty: 0 };
      },
      back() {
        setSceneState(prev => {
          if (prev.scene === 'planet') {
            transitionRef.current = { start: performance.now() / 1000, from: 'planet', to: 'system' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'system', systemId: prev.systemId, planetId: null };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'galaxy', systemId: null, planetId: null };
          }
          return prev;
        });
      },
      navigateTo(scene: UniverseScene, systemId?: string, planetId?: string) {
        setSceneState(prev => {
          transitionRef.current = { start: performance.now() / 1000, from: prev.scene, to: scene };
          transformRef.current = { scale: 1, tx: 0, ty: 0 };
          return {
            scene,
            systemId: systemId ?? null,
            planetId: planetId ?? null,
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

        // 1. Background — always full-viewport, no transform applied.
        drawBackground(ctx, vw, vh, stars);

        // 2. Scene content under the zoom/pan transform.
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, tx, ty);

        let rawHit: HitCircle[] = [];
        if (state.scene === 'galaxy') {
          rawHit = drawGalaxyScene(ctx, d, vw, vh, stars, 1, true, scale).hit;
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

    // ── Pointer drag + pinch-zoom (mouse & touch via Pointer Events) ──────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const onPointerDown = (e: PointerEvent) => {
        if (e.button > 0) return; // left / touch only
        canvas.setPointerCapture(e.pointerId);
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointersRef.current.size === 2) {
          // Two pointers → enter pinch mode; cancel any drag.
          dragOriginRef.current = null;
          const pts = [...activePointersRef.current.values()];
          pinchRef.current = {
            dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
            mx: (pts[0].x + pts[1].x) / 2,
            my: (pts[0].y + pts[1].y) / 2,
          };
        } else if (activePointersRef.current.size === 1) {
          // Single pointer → drag mode.
          dragOriginRef.current = {
            px: e.clientX,
            py: e.clientY,
            tx: transformRef.current.tx,
            ty: transformRef.current.ty,
          };
          hasDraggedRef.current = false;
          pinchRef.current = null;
          canvas.style.cursor = 'grabbing';
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointersRef.current.size >= 2 && pinchRef.current) {
          const pts = [...activePointersRef.current.values()];
          const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const newMx = (pts[0].x + pts[1].x) / 2;
          const newMy = (pts[0].y + pts[1].y) / 2;
          const factor = newDist / pinchRef.current.dist;
          const t = transformRef.current;
          const newScale = clampScale(t.scale * factor);
          const contentX = (pinchRef.current.mx - t.tx) / t.scale;
          const contentY = (pinchRef.current.my - t.ty) / t.scale;
          transformRef.current = {
            scale: newScale,
            tx: pinchRef.current.mx - contentX * newScale + (newMx - pinchRef.current.mx),
            ty: pinchRef.current.my - contentY * newScale + (newMy - pinchRef.current.my),
          };
          pinchRef.current = { dist: newDist, mx: newMx, my: newMy };
        } else if (activePointersRef.current.size === 1 && dragOriginRef.current) {
          const dx = e.clientX - dragOriginRef.current.px;
          const dy = e.clientY - dragOriginRef.current.py;
          if (!hasDraggedRef.current && Math.hypot(dx, dy) > 4) hasDraggedRef.current = true;
          transformRef.current = {
            ...transformRef.current,
            tx: dragOriginRef.current.tx + dx,
            ty: dragOriginRef.current.ty + dy,
          };
        }
      };

      const onPointerUp = (e: PointerEvent) => {
        activePointersRef.current.delete(e.pointerId);
        if (activePointersRef.current.size < 2) pinchRef.current = null;
        if (activePointersRef.current.size === 0) {
          dragOriginRef.current = null;
          canvas.style.cursor = 'grab';
        }
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      return () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
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
        if (hit.kind === 'system') {
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
            return { scene: 'system', systemId: prev.systemId, planetId: null };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
            transformRef.current = { scale: 1, tx: 0, ty: 0 };
            return { scene: 'galaxy', systemId: null, planetId: null };
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
