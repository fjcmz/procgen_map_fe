import { useState, useRef, useCallback, useEffect } from 'react';
import type { MapData, MapView, LayerVisibility, WorkerMessage } from './lib/types';
import { MapCanvas } from './components/MapCanvas';
import type { MapCanvasHandle } from './components/MapCanvas';
import { Controls } from './components/Controls';
import { ZoomControls } from './components/ZoomControls';
import { Timeline } from './components/Timeline';
import { Legend } from './components/Legend';

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
  regions: false,
  resources: false,
  eventOverlay: true,
  tradeRoutes: true,
  wonderMarkers: true,
  religionMarkers: true,
};

export default function App() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numCells, setNumCells] = useState(DEFAULT_CELLS);
  const [waterRatio, setWaterRatio] = useState(DEFAULT_WATER_RATIO);
  const [mapView, setMapView] = useState<MapView>('terrain');
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [generateHistory, setGenerateHistory] = useState(false);
  const [numSimYears, setNumSimYears] = useState(5000);
  const [selectedYear, setSelectedYear] = useState(0);

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

    const height = window.innerHeight;
    const width = Math.max(window.innerWidth, height * 2);

    setGenerating(true);
    setProgress({ step: 'Starting…', pct: 0 });

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'PROGRESS') {
        setProgress({ step: msg.step, pct: msg.pct });
      } else if (msg.type === 'DONE') {
        setMapData(msg.data);
        if (msg.data.history) {
          setSelectedYear(0);
        }
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

    worker.postMessage({
      type: 'GENERATE',
      seed,
      numCells,
      width,
      height,
      waterRatio,
      generateHistory,
      numSimYears,
    });
  }, [generating, seed, numCells, waterRatio, generateHistory, numSimYears]);

  const handleLayerToggle = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <>
      <MapCanvas
        ref={mapCanvasRef}
        mapData={mapData}
        layers={layers}
        seed={seed}
        selectedYear={mapData?.history ? selectedYear : undefined}
        mapView={mapView}
      />
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
        mapView={mapView}
        onMapViewChange={setMapView}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        generateHistory={generateHistory}
        onGenerateHistoryToggle={() => setGenerateHistory(v => !v)}
        numSimYears={numSimYears}
        onNumSimYearsChange={setNumSimYears}
        onGenerate={handleGenerate}
        generating={generating}
        progress={progress}
      />
      {mapData && layers.legend && (
        <Legend mapData={mapData} />
      )}
      {mapData?.history && (
        <Timeline
          historyData={mapData.history}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
        />
      )}
    </>
  );
}
