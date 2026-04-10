import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, WorkerMessage, Season, SelectedEntity } from './lib/types';
import { MapCanvas } from './components/MapCanvas';
import type { MapCanvasHandle, Transform } from './components/MapCanvas';
import { UnifiedOverlay } from './components/UnifiedOverlay';
import { ZoomControls } from './components/ZoomControls';
import { Timeline } from './components/Timeline';
import { Legend } from './components/Legend';
import { Minimap } from './components/Minimap';
import { getOwnershipAtYear, getExpansionFlagsAtYear } from './lib/history';

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
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const mapCanvasRef = useRef<MapCanvasHandle>(null);

  // Pre-compute ownership array for the current year (shared by renderer and HierarchyTab)
  const ownershipAtYear = useMemo(() => {
    if (!mapData?.history || selectedYear === undefined) return undefined;
    return getOwnershipAtYear(mapData.history, selectedYear);
  }, [mapData?.history, selectedYear]);

  // Pre-compute city sizes at the current year from snapshots
  const citySizesAtYear = useMemo(() => {
    if (!mapData?.history?.citySizeSnapshots) return undefined;
    const snapKey = Math.floor(selectedYear / 20) * 20;
    return mapData.history.citySizeSnapshots[snapKey] ?? undefined;
  }, [mapData?.history?.citySizeSnapshots, selectedYear]);

  // Pre-compute expansion flags at the current year from snapshots
  const expansionFlagsAtYear = useMemo(() => {
    if (!mapData?.history || selectedYear === undefined) return undefined;
    return getExpansionFlagsAtYear(mapData.history, selectedYear);
  }, [mapData?.history, selectedYear]);

  const handleEntityNavigate = useCallback((cellIndices: number[], centerCellIndex: number) => {
    const cell = mapData?.cells[centerCellIndex];
    if (!cell) return;
    mapCanvasRef.current?.navigateTo(cell.x, cell.y);
    setHighlightCells(cellIndices);
  }, [mapData]);

  const handleMapInteraction = useCallback(() => {
    setHighlightCells(null);
    setSelectedEntity(null);
  }, []);

  /** Resolve a clicked cell index into the best entity (city > country > nothing). */
  const handleCellClick = useCallback((cellIndex: number) => {
    if (!mapData) return;
    const cell = mapData.cells[cellIndex];
    if (!cell) return;

    // No history → just clear
    if (!mapData.history || !ownershipAtYear) {
      setHighlightCells(null);
      setSelectedEntity(null);
      return;
    }

    // Check if a city sits on this cell
    const city = mapData.cities.find(c => c.cellIndex === cellIndex);
    if (city) {
      setSelectedEntity({ type: 'city', cellIndex: city.cellIndex });
      setHighlightCells([city.cellIndex]);
      return;
    }

    // Check country ownership
    const countryId = ownershipAtYear[cellIndex];
    if (countryId >= 0) {
      setSelectedEntity({ type: 'country', countryIndex: countryId });
      // Highlight all cells owned by this country
      const cells: number[] = [];
      for (let i = 0; i < ownershipAtYear.length; i++) {
        if (ownershipAtYear[i] === countryId) cells.push(i);
      }
      setHighlightCells(cells);
      return;
    }

    // Clicked water or unclaimed land → clear
    setHighlightCells(null);
    setSelectedEntity(null);
  }, [mapData, ownershipAtYear]);

  /** Select an entity programmatically (from overlay tabs). */
  const handleSelectEntity = useCallback((entity: SelectedEntity | null) => {
    setSelectedEntity(entity);
    if (!entity || !mapData) {
      setHighlightCells(null);
      return;
    }
    if (entity.type === 'city') {
      const city = mapData.cities.find(c => c.cellIndex === entity.cellIndex);
      if (city) {
        setHighlightCells([city.cellIndex]);
        const cell = mapData.cells[city.cellIndex];
        if (cell) mapCanvasRef.current?.navigateTo(cell.x, cell.y);
      }
    } else if (entity.type === 'country') {
      if (!ownershipAtYear) return;
      const cells: number[] = [];
      for (let i = 0; i < ownershipAtYear.length; i++) {
        if (ownershipAtYear[i] === entity.countryIndex) cells.push(i);
      }
      setHighlightCells(cells);
      const country = mapData.history?.countries[entity.countryIndex];
      if (country) {
        const cell = mapData.cells[country.capitalCellIndex];
        if (cell) mapCanvasRef.current?.navigateTo(cell.x, cell.y);
      }
    } else if (entity.type === 'empire') {
      if (!mapData.history || !ownershipAtYear) return;
      // Find empire snapshot to get member countries
      const snapYear = entity.snapshotYear;
      const empSnap = mapData.history.empireSnapshots[snapYear];
      const empEntry = empSnap?.find(e => e.empireId === entity.empireId);
      if (!empEntry) return;
      const memberSet = new Set(empEntry.memberCountryIndices);
      const cells: number[] = [];
      for (let i = 0; i < ownershipAtYear.length; i++) {
        if (memberSet.has(ownershipAtYear[i])) cells.push(i);
      }
      setHighlightCells(cells);
      const founderCountry = mapData.history.countries[empEntry.founderCountryIndex];
      if (founderCountry) {
        const cell = mapData.cells[founderCountry.capitalCellIndex];
        if (cell) mapCanvasRef.current?.navigateTo(cell.x, cell.y);
      }
    }
  }, [mapData, ownershipAtYear]);

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
    setSelectedEntity(null);
    setHighlightCells(null);

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
        citySizesAtYear={citySizesAtYear}
        expansionFlags={expansionFlagsAtYear}
        onTransformChange={setViewTransform}
        onCellClick={handleCellClick}
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
        citySizesAtYear={citySizesAtYear}
        onEntityNavigate={handleEntityNavigate}
        selectedEntity={selectedEntity}
        onSelectEntity={handleSelectEntity}
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
