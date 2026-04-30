import { useCallback, useEffect, useRef, useState } from 'react';
import { UniverseCanvas } from './UniverseCanvas';
import type { UniverseCanvasHandle, UniverseSceneState, PopupEntity } from './UniverseCanvas';
import { UniverseOverlay } from './UniverseOverlay';
import { UniverseEntityPopup } from './UniverseEntityPopup';
import type {
  UniverseData,
  UniverseGenerateRequest,
  UniverseWorkerMessage,
} from '../lib/universe/types';

const DEFAULT_SEED = 'cosmos';
const DEFAULT_SOLAR_SYSTEMS = 80;

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
export function UniverseScreen() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numSolarSystems, setNumSolarSystems] = useState(DEFAULT_SOLAR_SYSTEMS);
  const [data, setData] = useState<UniverseData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [sceneState, setSceneState] = useState<UniverseSceneState>({
    scene: 'galaxy', systemId: null, planetId: null,
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
        setData(msg.data);
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
    };
    worker.postMessage(req);
  }, [generating, seed, numSolarSystems]);

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

  // Navigate to the entity's parent scene and close the popup.
  const handlePopupNavigateUp = useCallback(() => {
    if (!popupEntity) return;
    setPopupEntity(null);
    if (popupEntity.kind === 'system') {
      canvasRef.current?.navigateTo('galaxy');
    } else if (popupEntity.kind === 'star') {
      canvasRef.current?.navigateTo('galaxy');
    } else if (popupEntity.kind === 'planet') {
      canvasRef.current?.navigateTo('system', popupEntity.systemId);
    } else if (popupEntity.kind === 'satellite') {
      canvasRef.current?.navigateTo('planet', popupEntity.systemId, popupEntity.planetId);
    }
  }, [popupEntity]);

  // Navigate into the entity's child scene and close the popup.
  const handlePopupNavigateDown = useCallback(() => {
    if (!popupEntity) return;
    setPopupEntity(null);
    if (popupEntity.kind === 'system') {
      canvasRef.current?.navigateTo('system', popupEntity.systemId);
    } else if (popupEntity.kind === 'planet') {
      canvasRef.current?.navigateTo('planet', popupEntity.systemId, popupEntity.planetId);
    }
    // star + satellite are leaves — no down navigation
  }, [popupEntity]);

  // Tree entity selection: navigate the canvas to the scene that displays the
  // entity, then open the details popup. System → galaxy view, star/planet →
  // system view, satellite → planet view.
  const handleTreeEntitySelect = useCallback((entity: PopupEntity) => {
    if (entity.kind === 'system') {
      canvasRef.current?.navigateTo('galaxy');
    } else if (entity.kind === 'star') {
      canvasRef.current?.navigateTo('system', entity.systemId);
    } else if (entity.kind === 'planet') {
      canvasRef.current?.navigateTo('system', entity.systemId);
    } else if (entity.kind === 'satellite') {
      canvasRef.current?.navigateTo('planet', entity.systemId, entity.planetId);
    }
    setPopupEntity(entity);
  }, []);

  return (
    <>
      <UniverseCanvas
        ref={canvasRef}
        data={data}
        onSceneChange={setSceneState}
        onEntityClick={handleEntityClick}
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
        onGenerate={handleGenerate}
        generating={generating}
        progress={progress}
        data={data}
        sceneState={sceneState}
        onBack={handleBack}
        onTreeEntitySelect={handleTreeEntitySelect}
      />
      {popupEntity && data && (
        <UniverseEntityPopup
          entity={popupEntity}
          data={data}
          onClose={handlePopupClose}
          onNavigateUp={handlePopupNavigateUp}
          onNavigateDown={
            popupEntity.kind === 'system' || popupEntity.kind === 'planet'
              ? handlePopupNavigateDown
              : undefined
          }
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
