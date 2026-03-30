import { useState, useRef, useCallback, useEffect } from 'react';
import type { MapData, LayerVisibility, WorkerMessage } from './lib/types';
import { MapCanvas } from './components/MapCanvas';
import type { MapCanvasHandle } from './components/MapCanvas';
import { Controls } from './components/Controls';
import { ZoomControls } from './components/ZoomControls';

const DEFAULT_SEED = 'fantasy';
const DEFAULT_CELLS = 2000;
const DEFAULT_WATER_RATIO = 0.4;

const DEFAULT_LAYERS: LayerVisibility = {
  rivers: true,
  roads: true,
  borders: true,
  icons: true,
  labels: true,
  legend: true,
};

export default function App() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numCells, setNumCells] = useState(DEFAULT_CELLS);
  const [waterRatio, setWaterRatio] = useState(DEFAULT_WATER_RATIO);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const mapCanvasRef = useRef<MapCanvasHandle>(null);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleGenerate = useCallback(() => {
    if (generating) return;

    // Terminate previous worker if running
    workerRef.current?.terminate();

    const worker = new Worker(
      new URL('./workers/mapgen.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    const width = window.innerWidth;
    const height = window.innerHeight;

    setGenerating(true);
    setProgress({ step: 'Starting…', pct: 0 });

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'PROGRESS') {
        setProgress({ step: msg.step, pct: msg.pct });
      } else if (msg.type === 'DONE') {
        setMapData(msg.data);
        setGenerating(false);
        setProgress(null);
        worker.terminate();
      } else if (msg.type === 'ERROR') {
        console.error('Map generation error:', msg.message);
        setGenerating(false);
        setProgress(null);
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      console.error('Worker error:', err);
      setGenerating(false);
      setProgress(null);
    };

    worker.postMessage({ type: 'GENERATE', seed, numCells, width, height, waterRatio });
  }, [generating, seed, numCells, waterRatio]);

  const handleLayerToggle = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <>
      <MapCanvas ref={mapCanvasRef} mapData={mapData} layers={layers} seed={seed} />
      <ZoomControls
        onZoomIn={() => mapCanvasRef.current?.zoomIn()}
        onZoomOut={() => mapCanvasRef.current?.zoomOut()}
        onReset={() => mapCanvasRef.current?.reset()}
      />
      <Controls
        seed={seed}
        onSeedChange={setSeed}
        numCells={numCells}
        onNumCellsChange={setNumCells}
        waterRatio={waterRatio}
        onWaterRatioChange={setWaterRatio}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        onGenerate={handleGenerate}
        generating={generating}
        progress={progress}
      />
    </>
  );
}
