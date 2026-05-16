import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UniverseCanvas } from './UniverseCanvas';
import type { UniverseCanvasHandle, UniverseSceneState, PopupEntity } from './UniverseCanvas';
import { UniverseOverlay } from './UniverseOverlay';
import { UniverseEntityPopup } from './UniverseEntityPopup';
import { UniverseTimeline } from './UniverseTimeline';
import { getBodyStateAtStep } from '../lib/universe/habitability';
import type { BodyStateAtStep } from '../lib/universe/habitability';
import type {
  UniverseData,
  PlanetData,
  SatelliteData,
  SolarSystemData,
  LifeLevel,
  UniverseGenerateRequest,
  UniverseWorkerMessage,
} from '../lib/universe/types';

const DEFAULT_SEED = 'cosmos';
const DEFAULT_SOLAR_SYSTEMS = 500;
const DEFAULT_NUM_HISTORY_STEPS = 5000;

interface UniverseScreenProps {
  /** Lifted to App so the universe survives a round-trip through the planet flow. */
  data: UniverseData | null;
  onDataChange: (data: UniverseData | null) => void;
  /**
   * When set, the canvas navigates to this scene on mount (used by the
   * "Back to system" return path from the planet flow).
   */
  returnTo?: { systemId: string; planetId?: string } | null;
  /** Called once after `returnTo` has been consumed by canvas navigation. */
  onReturnToConsumed?: () => void;
  /**
   * Called when the user presses "Generate World" in a planet popup.
   * `stateAtStep` is the step-derived body snapshot (life + biome +
   * subtype + composition + terraform flags) — overrides the body's
   * static fields when the universe carries history. Lets the world-map
   * hand-off respect terraformed planets' new habitable biome at
   * post-completion steps, and the original lifeless visual at earlier
   * steps.
   */
  onGenerateWorldFromPlanet?: (
    planet: PlanetData,
    system: SolarSystemData,
    universe: UniverseData,
    stateAtStep: BodyStateAtStep,
  ) => void;
  /** Called when the user presses "Generate World" in a satellite popup. */
  onGenerateWorldFromSatellite?: (
    satellite: SatelliteData,
    planet: PlanetData,
    system: SolarSystemData,
    universe: UniverseData,
    stateAtStep: BodyStateAtStep,
  ) => void;
}

/**
 * Top-level screen for the universe flow. Owns:
 *  - the universegen Worker lifecycle (one worker per generation, terminated on DONE/ERROR)
 *  - generation form state (seed, numSolarSystems)
 *  - the most recent `UniverseData`
 *  - the current scene state (lifted from the canvas so the overlay can show
 *    a breadcrumb and back button)
 *  - popup state for entity detail popups (opened on canvas entity click)
 *
 * Mirrors the worker lifecycle in `App.tsx::handleGenerate` for the planet flow.
 */
export function UniverseScreen({
  data,
  onDataChange,
  returnTo,
  onReturnToConsumed,
  onGenerateWorldFromPlanet,
  onGenerateWorldFromSatellite,
}: UniverseScreenProps) {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numSolarSystems, setNumSolarSystems] = useState(DEFAULT_SOLAR_SYSTEMS);
  const [generateHistory, setGenerateHistory] = useState(false);
  const [numHistorySteps, setNumHistorySteps] = useState(DEFAULT_NUM_HISTORY_STEPS);
  // `selectedStep` is only meaningful when `data.history` exists. We default
  // to the end-of-time (numSteps - 1) after each generation so the user lands
  // on the "final state" universe — re-scrub backwards to watch life appear.
  const [selectedStep, setSelectedStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [sceneState, setSceneState] = useState<UniverseSceneState>({
    scene: 'galaxy', systemId: null, planetId: null, galaxyId: null,
  });
  const [popupEntity, setPopupEntity] = useState<PopupEntity | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<UniverseCanvasHandle>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Return-from-planet-flow navigation: drive the canvas to the recorded
  // scene once data is ready, then signal App to drop the request so we
  // don't re-navigate on every sceneState change.
  useEffect(() => {
    if (!returnTo || !data) return;
    if (returnTo.planetId) {
      canvasRef.current?.navigateTo('planet', returnTo.systemId, returnTo.planetId);
    } else {
      canvasRef.current?.navigateTo('system', returnTo.systemId);
    }
    onReturnToConsumed?.();
  }, [returnTo, data, onReturnToConsumed]);

  const handleGenerate = useCallback(() => {
    if (generating) return;

    workerRef.current?.terminate();

    const worker = new Worker(
      new URL('../workers/universegen.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    setGenerating(true);
    setProgress({ step: 'Starting…', pct: 0 });
    setPopupEntity(null);

    worker.onmessage = (e: MessageEvent<UniverseWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'PROGRESS') {
        setProgress({ step: msg.step, pct: msg.pct });
      } else if (msg.type === 'DONE') {
        onDataChange(msg.data);
        // Snap the timeline to end-of-time so the user sees the "final"
        // universe by default. Clamp to 0 when history is off.
        const finalStep = msg.data.history ? Math.max(0, msg.data.history.numSteps - 1) : 0;
        setSelectedStep(finalStep);
        setGenerating(false);
        setProgress(null);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else if (msg.type === 'ERROR') {
        console.error('Universe generation failed:', msg.message);
        setGenerating(false);
        setProgress(null);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    const req: UniverseGenerateRequest = {
      type: 'GENERATE',
      seed,
      numSolarSystems,
      generateHistory,
      numHistorySteps,
    };
    worker.postMessage(req);
  }, [generating, seed, numSolarSystems, generateHistory, numHistorySteps, onDataChange]);

  /**
   * Bridge from the planet popup's "Generate World" button to App's
   * cross-screen handler. We resolve the system from the popup's
   * `systemId` so the handler gets a complete `(planet, system, universe)`
   * tuple without the popup needing to know about the lifted state.
   */
  const handleGenerateWorldFromPopup = useCallback(
    (planet: PlanetData, systemId: string) => {
      if (!data || !onGenerateWorldFromPlanet) return;
      const system = data.solarSystems.find(s => s.id === systemId);
      if (!system) return;
      const state = getBodyStateAtStep(planet, selectedStep, data.history);
      onGenerateWorldFromPlanet(planet, system, data, state);
    },
    [data, onGenerateWorldFromPlanet, selectedStep],
  );

  const handleGenerateSatelliteWorldFromPopup = useCallback(
    (satellite: SatelliteData, planet: PlanetData, systemId: string) => {
      if (!data || !onGenerateWorldFromSatellite) return;
      const system = data.solarSystems.find(s => s.id === systemId);
      if (!system) return;
      const state = getBodyStateAtStep(satellite, selectedStep, data.history);
      onGenerateWorldFromSatellite(satellite, planet, system, data, state);
    },
    [data, onGenerateWorldFromSatellite, selectedStep],
  );

  const handleBack = useCallback(() => {
    canvasRef.current?.back();
  }, []);

  // Called by the canvas when the user clicks a renderable entity.
  const handleEntityClick = useCallback((entity: PopupEntity) => {
    setPopupEntity(entity);
  }, []);

  const handlePopupClose = useCallback(() => {
    setPopupEntity(null);
  }, []);

  // Resolve the parent galaxy id of a system. Used by Up navigation so that
  // exiting a system inside a grouped universe drops back into its galaxy
  // (focus mode), not the multi-galaxy overview. Returns null in single-
  // galaxy universes — focus mode there would render byte-identically to the
  // legacy view but adds a confusing "Back" affordance to the overlay.
  const galaxyIdOfSystem = useCallback((systemId: string): string | null => {
    if (!data || data.galaxies.length <= 1) return null;
    for (const g of data.galaxies) {
      if (g.systemIds.includes(systemId)) return g.id;
    }
    return null;
  }, [data]);

  // Navigate one scene level up from the current view and close the popup.
  //
  // Hierarchy: Universe → Galaxy → System → Planet.
  // planet → system (preserve galaxyId), system → its parent galaxy view,
  // galaxy view → universe overview, universe → no-op.
  //
  // The popup decides WHETHER to show the Up button (only when this scene
  // parent equals the selected entity's parent scene). The action below is
  // always "scene-level back" regardless of the entity kind.
  const handlePopupNavigateUp = useCallback(() => {
    if (!popupEntity) return;
    setPopupEntity(null);
    const s = sceneState;
    if (s.scene === 'planet' && s.systemId) {
      canvasRef.current?.navigateTo('system', s.systemId);
    } else if (s.scene === 'system') {
      // Up from a system view → its parent galaxy view. galaxyId is
      // preserved on the scene state when entering from galaxy view; fall
      // back to lookup if it's somehow missing.
      const galId = s.galaxyId ?? (s.systemId ? galaxyIdOfSystem(s.systemId) : null);
      canvasRef.current?.navigateTo('galaxy', undefined, undefined, galId ?? undefined);
    } else if (s.scene === 'galaxy' && s.galaxyId) {
      canvasRef.current?.navigateTo('galaxy', undefined, undefined, undefined);
    }
  }, [popupEntity, sceneState, galaxyIdOfSystem]);

  // Navigate into the entity's child scene and close the popup.
  const handlePopupNavigateDown = useCallback(() => {
    if (!popupEntity) return;
    if (popupEntity.kind === 'galaxy') {
      // ↓ Enter Galaxy → galaxy focus mode (single-spiral view of just this
      // galaxy, mirrors legacy single-galaxy rendering).
      setPopupEntity(null);
      canvasRef.current?.navigateTo('galaxy', undefined, undefined, popupEntity.galaxyId);
    } else if (popupEntity.kind === 'system') {
      setPopupEntity(null);
      canvasRef.current?.navigateTo('system', popupEntity.systemId);
    } else if (popupEntity.kind === 'planet') {
      setPopupEntity(null);
      canvasRef.current?.navigateTo('planet', popupEntity.systemId, popupEntity.planetId);
    } else if (popupEntity.kind === 'wormhole') {
      // ↳ Jump to Connected System — resolve the wormhole's partner here so
      // the popup component stays stateless. If the connection is missing
      // (shouldn't happen for partnered wormholes, but guard anyway) we fall
      // back to closing the popup silently.
      if (!data) return;
      let partnerSystemId: string | null = null;
      outer: for (const sys of data.solarSystems) {
        if (!sys.wormholes) continue;
        for (const w of sys.wormholes) {
          if (w.id === popupEntity.wormholeId) {
            if (!w.partnerId) break outer;
            for (const sys2 of data.solarSystems) {
              if (!sys2.wormholes) continue;
              if (sys2.wormholes.some(p => p.id === w.partnerId)) {
                partnerSystemId = sys2.id;
                break outer;
              }
            }
          }
        }
      }
      setPopupEntity(null);
      if (partnerSystemId) {
        canvasRef.current?.navigateTo('system', partnerSystemId);
      }
    }
    // star + satellite are leaves — no down navigation
  }, [popupEntity, data]);

  // Step-derived life-level lookup — single allocation per (history, step)
  // change, consumed by both the canvas (passed into the renderer to gate
  // green halos + intelligent-life rings) and by future popup helpers.
  // Null when history is off so legacy renders stay byte-identical.
  const liveLifeLevels = useMemo<Map<string, LifeLevel> | null>(() => {
    const history = data?.history;
    if (!history) return null;
    const m = new Map<string, LifeLevel>();
    for (const id in history.lifeAdvancesByBody) {
      const entries = history.lifeAdvancesByBody[id];
      let current: LifeLevel | undefined;
      for (const entry of entries) {
        if (entry.step > selectedStep) break;
        current = entry.level;
      }
      if (current !== undefined) m.set(id, current);
    }
    return m;
  }, [data?.history, selectedStep]);

  // Tree / popup entity selection: navigate the canvas to the scene that
  // displays the entity, then open the details popup. Galaxy → galaxy focus
  // (or overview when single), system → its parent galaxy view (focus when
  // grouped), star/planet → system view, satellite → planet view.
  const handleTreeEntitySelect = useCallback((entity: PopupEntity) => {
    if (entity.kind === 'galaxy') {
      // Tree click on a galaxy: jump to focus on it so the popup opens with
      // the matching scene already visible behind the modal.
      canvasRef.current?.navigateTo('galaxy', undefined, undefined, entity.galaxyId);
    } else if (entity.kind === 'system') {
      canvasRef.current?.navigateTo('galaxy', undefined, undefined, galaxyIdOfSystem(entity.systemId) ?? undefined);
    } else if (entity.kind === 'star') {
      canvasRef.current?.navigateTo('system', entity.systemId);
    } else if (entity.kind === 'planet') {
      canvasRef.current?.navigateTo('system', entity.systemId);
    } else if (entity.kind === 'satellite') {
      canvasRef.current?.navigateTo('planet', entity.systemId, entity.planetId);
    } else if (entity.kind === 'wormhole') {
      canvasRef.current?.navigateTo('system', entity.systemId);
    }
    setPopupEntity(entity);
  }, [galaxyIdOfSystem]);

  return (
    <>
      <UniverseCanvas
        ref={canvasRef}
        data={data}
        onSceneChange={setSceneState}
        onEntityClick={handleEntityClick}
        liveLifeLevels={liveLifeLevels}
      />
      {/* Zoom controls — bottom-right, space-themed to match the dark UI */}
      <div style={styles.zoomWrap}>
        <button style={styles.zoomBtn} onClick={() => canvasRef.current?.zoomIn()} title="Zoom in">+</button>
        <button style={styles.zoomBtn} onClick={() => canvasRef.current?.resetZoom()} title="Reset zoom">⌂</button>
        <button style={styles.zoomBtn} onClick={() => canvasRef.current?.zoomOut()} title="Zoom out">−</button>
      </div>
      <UniverseOverlay
        seed={seed}
        onSeedChange={setSeed}
        numSolarSystems={numSolarSystems}
        onNumSolarSystemsChange={setNumSolarSystems}
        generateHistory={generateHistory}
        onGenerateHistoryChange={setGenerateHistory}
        numHistorySteps={numHistorySteps}
        onNumHistoryStepsChange={setNumHistorySteps}
        selectedStep={selectedStep}
        onGenerate={handleGenerate}
        generating={generating}
        progress={progress}
        data={data}
        sceneState={sceneState}
        onBack={handleBack}
        onTreeEntitySelect={handleTreeEntitySelect}
      />
      {data?.history && (
        <UniverseTimeline
          history={data.history}
          selectedStep={selectedStep}
          onStepChange={setSelectedStep}
        />
      )}
      {popupEntity && data && (
        <UniverseEntityPopup
          entity={popupEntity}
          data={data}
          sceneState={sceneState}
          selectedStep={selectedStep}
          onClose={handlePopupClose}
          onNavigateUp={handlePopupNavigateUp}
          onNavigateDown={
            popupEntity.kind === 'galaxy' || popupEntity.kind === 'system' || popupEntity.kind === 'planet' || popupEntity.kind === 'wormhole'
              ? handlePopupNavigateDown
              : undefined
          }
          onGenerateWorld={
            onGenerateWorldFromPlanet ? handleGenerateWorldFromPopup : undefined
          }
          onGenerateSatelliteWorld={
            onGenerateWorldFromSatellite ? handleGenerateSatelliteWorldFromPopup : undefined
          }
          onSelectEntity={handleTreeEntitySelect}
        />
      )}
      {!data && !generating && (
        <div style={styles.emptyHint}>
          Set a seed and a solar-system count, then press <strong>Generate Universe</strong>.
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  zoomWrap: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    zIndex: 10,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    background: 'rgba(20,18,40,0.92)',
    border: '1.5px solid #6c7ab8',
    borderRadius: 6,
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    color: '#dde0ff',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
  emptyHint: {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#a0a8d0',
    fontFamily: 'Georgia, serif',
    fontSize: 14,
    textAlign: 'center',
    pointerEvents: 'none',
    fontStyle: 'italic',
    background: 'rgba(20,18,40,0.6)',
    padding: '14px 20px',
    borderRadius: 8,
    border: '1px solid #4a5080',
    maxWidth: 360,
  },
};
