import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, WorkerMessage, Season } from './lib/types';
import { MapCanvas } from './components/MapCanvas';
import type { MapCanvasHandle, Transform } from './components/MapCanvas';
import { UnifiedOverlay } from './components/UnifiedOverlay';
import { ZoomControls } from './components/ZoomControls';
import { Timeline } from './components/Timeline';
import { Legend } from './components/Legend';
import { Minimap } from './components/Minimap';
import { getOwnershipAtYear } from './lib/history';

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
  minimap: true,
  hillshading: true,
  seasonalIce: true,
};

export default function App() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numCells, setNumCells] = useState(DEFAULT_CELLS);
  const [waterRatio, setWaterRatio] = useState(DEFAULT_WATER_RATIO);
  const [mapView, setMapView] = useState<MapView>('terrain');
  const [politicalMode, setPoliticalMode] = useState<PoliticalMode>('countries');
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [generateHistory, setGenerateHistory] = useState(false);
  const [numSimYears, setNumSimYears] = useState(5000);
  const [selectedYear, setSelectedYear] = useState(0);
  const [season, setSeason] = useState<Season>(0);
  const [viewTransform, setViewTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [highlightCells, setHighlightCells] = useState<number[] | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const mapCanvasRef = useRef<MapCanvasHandle>(null);

  // Pre-compute ownership array for the current year (shared by renderer and HierarchyTab)
  const ownershipAtYear = useMemo(() => {
    if (!mapData?.history || selectedYear === undefined) return undefined;
    return getOwnershipAtYear(mapData.history, selectedYear);
  }, [mapData?.history, selectedYear]);

  const handleEntityNavigate = useCallback((cellIndices: number[], centerCellIndex: number) => {
    const cell = mapData?.cells[centerCellIndex];
    if (!cell) return;
    mapCanvasRef.current?.navigateTo(cell.x, cell.y);
    setHighlightCells(cellIndices);
  }, [mapData]);

  const handleMapInteraction = useCallback(() => {
    setHighlightCells(null);
  }, []);

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
        politicalMode={politicalMode}
        season={season}
        highlightCells={highlightCells}
        onTransformChange={setViewTransform}
        onInteraction={handleMapInteraction}
      />
      <ZoomControls
        onZoomIn={() => mapCanvasRef.current?.zoomIn()}
        onZoomOut={() => mapCanvasRef.current?.zoomOut()}
        onReset={() => mapCanvasRef.current?.reset()}
      />
      <UnifiedOverlay
        seed={seed}
        onSeedChange={setSeed}
        numCells={numCells}
        onNumCellsChange={setNumCells}
        waterRatio={waterRatio}
        onWaterRatioChange={setWaterRatio}
        mapView={mapView}
        onMapViewChange={setMapView}
        politicalMode={politicalMode}
        onPoliticalModeChange={setPoliticalMode}
        season={season}
        onSeasonChange={setSeason}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        generateHistory={generateHistory}
        onGenerateHistoryToggle={() => setGenerateHistory(v => !v)}
        numSimYears={numSimYears}
        onNumSimYearsChange={setNumSimYears}
        onGenerate={handleGenerate}
        generating={generating}
        progress={progress}
        mapData={mapData}
        selectedYear={selectedYear}
        ownershipAtYear={ownershipAtYear}
        onEntityNavigate={handleEntityNavigate}
      />
      {mapData && layers.legend && (
        <Legend mapData={mapData} />
      )}
      {mapData && layers.minimap && (
        <Minimap
          mapData={mapData}
          layers={layers}
          seed={seed}
          selectedYear={mapData?.history ? selectedYear : undefined}
          mapView={mapView}
          season={season}
          viewTransform={viewTransform}
          onNavigate={(mapX, mapY) => mapCanvasRef.current?.navigateTo(mapX, mapY)}
        />
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
