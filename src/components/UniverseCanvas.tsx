import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { UniverseData, SolarSystemData, PlanetData } from '../lib/universe/types';
import {
  drawGalaxyScene,
  drawSystemScene,
  drawPlanetScene,
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
}

interface UniverseCanvasProps {
  data: UniverseData | null;
  onSceneChange?: (state: UniverseSceneState) => void;
  onEntityClick?: (entity: PopupEntity) => void;
}

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

    // Keep the latest onEntityClick callback in a ref so the click handler
    // effect doesn't need to re-register on every render.
    const onEntityClickRef = useRef(onEntityClick);
    onEntityClickRef.current = onEntityClick;

    useEffect(() => {
      onSceneChange?.(sceneState);
    }, [sceneState, onSceneChange]);

    useEffect(() => {
      if (!data) return;
      setSceneState({ scene: 'galaxy', systemId: null, planetId: null });
      transitionRef.current = null;
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
      },
      back() {
        setSceneState(prev => {
          if (prev.scene === 'planet') {
            transitionRef.current = { start: performance.now() / 1000, from: 'planet', to: 'system' };
            return { scene: 'system', systemId: prev.systemId, planetId: null };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
            return { scene: 'galaxy', systemId: null, planetId: null };
          }
          return prev;
        });
      },
      navigateTo(scene: UniverseScene, systemId?: string, planetId?: string) {
        setSceneState(prev => {
          transitionRef.current = { start: performance.now() / 1000, from: prev.scene, to: scene };
          return {
            scene,
            systemId: systemId ?? null,
            planetId: planetId ?? null,
          };
        });
      },
    }), []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !data) return;
      let rafId: number | null = null;
      const startTs = performance.now() / 1000;

      const tick = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        const now = performance.now() / 1000;
        const time = now - startTs;
        const stars = starsRef.current;
        const vw = canvas.width;
        const vh = canvas.height;
        const d = dataRef.current;
        if (!d) {
          rafId = requestAnimationFrame(tick);
          return;
        }

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

        let activeHit: HitCircle[] = [];
        if (state.scene === 'galaxy') {
          const res = drawGalaxyScene(ctx, d, vw, vh, stars, 1);
          activeHit = res.hit;
        } else if (state.scene === 'system' && system) {
          const res = drawSystemScene(ctx, system, vw, vh, stars, time);
          activeHit = res.hit;
        } else if (state.scene === 'planet' && planet) {
          const res = drawPlanetScene(ctx, planet, vw, vh, stars, time);
          activeHit = res.hit;
        }

        if (tr && tElapsed < 1) {
          ctx.fillStyle = `rgba(5, 3, 13, ${(1 - tEase) * 0.55})`;
          ctx.fillRect(0, 0, vw, vh);
        }

        lastHitRef.current = activeHit;
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, [data]);

    // Click → open entity popup (no direct navigation)
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onClick = (e: MouseEvent) => {
        if (e.button !== 0) return;
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

    // Escape → back (only when no popup is open; popup intercepts Escape first)
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        setSceneState(prev => {
          if (prev.scene === 'planet') {
            transitionRef.current = { start: performance.now() / 1000, from: 'planet', to: 'system' };
            return { scene: 'system', systemId: prev.systemId, planetId: null };
          }
          if (prev.scene === 'system') {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'galaxy' };
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
          cursor: 'pointer',
        }}
      />
    );
  },
);
