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

export interface UniverseCanvasHandle {
  reset: () => void;
  back: () => void;
}

interface UniverseCanvasProps {
  data: UniverseData | null;
  onSceneChange?: (state: UniverseSceneState) => void;
}

const TRANSITION_DUR = 0.55;

/** Cubic Hermite ease-in-out (smoothstep). Matches the reference repo. */
function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

export const UniverseCanvas = forwardRef<UniverseCanvasHandle, UniverseCanvasProps>(
  function UniverseCanvas({ data, onSceneChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [sceneState, setSceneState] = useState<UniverseSceneState>({
      scene: 'galaxy',
      systemId: null,
      planetId: null,
    });
    // Keep latest scene state in a ref so the animation loop reads it
    // without restarting every transition.
    const sceneStateRef = useRef(sceneState);
    sceneStateRef.current = sceneState;

    const transitionRef = useRef<{ start: number; from: UniverseScene; to: UniverseScene } | null>(null);
    const lastHitRef = useRef<HitCircle[]>([]);
    const starsRef = useRef<BackgroundStar[]>([]);
    const dataRef = useRef<UniverseData | null>(data);
    dataRef.current = data;

    // Notify parent on scene changes (used by overlay breadcrumb / back button)
    useEffect(() => {
      onSceneChange?.(sceneState);
    }, [sceneState, onSceneChange]);

    // Reset to galaxy whenever a new universe arrives
    useEffect(() => {
      if (!data) return;
      setSceneState({ scene: 'galaxy', systemId: null, planetId: null });
      transitionRef.current = null;
    }, [data]);

    // Resize + (re)build star field when viewport changes
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
    }), []);

    // requestAnimationFrame loop — always runs while data is present so the
    // orbit animations stay smooth in system/planet scenes. Galaxy scene is
    // static but the cost of a single fillRect + ~80 circles per frame is
    // negligible and lets camera transitions ease cleanly.
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

        // Resolve current entity refs from id (safe across re-renders)
        const state = sceneStateRef.current;
        const system: SolarSystemData | null = state.systemId
          ? d.solarSystems.find(ss => ss.id === state.systemId) ?? null
          : null;
        const planet: PlanetData | null = system && state.planetId
          ? system.planets.find(p => p.id === state.planetId) ?? null
          : null;

        // Camera transition: blend in/out via ease(t). For v1 we draw the
        // outgoing scene faded out and the incoming scene faded in on top.
        const tr = transitionRef.current;
        const tElapsed = tr ? Math.min(1, (now - tr.start) / TRANSITION_DUR) : 1;
        const tEase = ease(tElapsed);
        if (tr && tElapsed >= 1) transitionRef.current = null;

        // Draw the active (incoming) scene
        let activeHit: HitCircle[] = [];
        if (state.scene === 'galaxy') {
          const res = drawGalaxyScene(ctx, d, vw, vh, stars, 1);
          activeHit = res.hit;
        } else if (state.scene === 'system' && system) {
          const res = drawSystemScene(ctx, system, vw, vh, stars, time);
          activeHit = res.hit;
        } else if (state.scene === 'planet' && planet) {
          drawPlanetScene(ctx, planet, vw, vh, stars, time);
          activeHit = [];
        }

        // If transitioning, dim the incoming scene briefly to imply motion.
        // Cheap visual cue without needing a second offscreen canvas.
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

    // Click handler — drill down on hit
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
        if (hit.kind === 'system') {
          setSceneState(_ => {
            transitionRef.current = { start: performance.now() / 1000, from: 'galaxy', to: 'system' };
            return { scene: 'system', systemId: hit.id, planetId: null };
          });
        } else if (hit.kind === 'planet') {
          setSceneState(prev => {
            transitionRef.current = { start: performance.now() / 1000, from: 'system', to: 'planet' };
            return { scene: 'planet', systemId: prev.systemId, planetId: hit.id };
          });
        }
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    }, []);

    // Right-click or Escape → back. Browser back navigation is reserved for
    // the screen-level guard already wired in App.tsx.
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

    const cursor = sceneState.scene === 'planet' ? 'default' : 'pointer';

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          display: 'block',
          touchAction: 'none',
          cursor,
        }}
      />
    );
  },
);
