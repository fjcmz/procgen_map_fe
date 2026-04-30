import { useCallback, useEffect, useRef, useState } from 'react';
import { UniverseCanvas } from './UniverseCanvas';
import type { UniverseCanvasHandle, UniverseSceneState } from './UniverseCanvas';
import { UniverseOverlay } from './UniverseOverlay';
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

  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<UniverseCanvasHandle>(null);

  // Cleanup any in-flight worker on unmount (e.g. user goes back to landing
  // mid-generation).
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleGenerate = useCallback(() => {
    if (generating) return;

    // Tear down any prior worker before starting a new generation
    workerRef.current?.terminate();

    const worker = new Worker(
      new URL('../workers/universegen.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    setGenerating(true);
    setProgress({ step: 'Starting…', pct: 0 });
    // Don't blank previous data — leaves the prior universe visible until
    // the new one paints.

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

  return (
    <>
      <UniverseCanvas
        ref={canvasRef}
        data={data}
        onSceneChange={setSceneState}
      />
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
      />
      {!data && !generating && (
        <div style={styles.emptyHint}>
          Set a seed and a solar-system count, then press <strong>Generate Universe</strong>.
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
