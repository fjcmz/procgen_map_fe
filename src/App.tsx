import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, WorkerMessage, Season, SelectedEntity, ResourceRarityMode, BodyKind } from './lib/types';
import { MapCanvas } from './components/MapCanvas';
import type { MapCanvasHandle, Transform } from './components/MapCanvas';
import { UnifiedOverlay } from './components/UnifiedOverlay';
import { ZoomControls } from './components/ZoomControls';
import { Timeline } from './components/Timeline';
import { Legend } from './components/Legend';
import { Minimap } from './components/Minimap';
import { LandingScreen } from './components/LandingScreen';
import { UniverseScreen } from './components/UniverseScreen';
import { getOwnershipAtYear, getExpansionFlagsAtYear, getEmpiresAtYear } from './lib/history';
import { exportWorld } from './lib/export/exportWorld';
import type { UniverseData, PlanetData, SatelliteData, SolarSystemData, LifeLevel } from './lib/universe/types';
import { planetToGenSpec, satelliteToGenSpec } from './lib/universe/bodyToProfile';

const DEFAULT_SEED = 'fantasy';
const DEFAULT_CELLS = 100000;
const DEFAULT_WATER_RATIO = 0.62;

const DEFAULT_LAYERS: LayerVisibility = {
  rivers: true,
  roads: true,
  borders: true,
  icons: false,
  labels: true,
  legend: false,
  regions: true,
  resources: true,
  eventOverlay: true,
  tradeRoutes: true,
  wonderMarkers: true,
  religionMarkers: true,
  minimap: false,
  hillshading: true,
  seasonalIce: true,
  cityIcons: true,
  // Default on so gas-giant maps get the wind overlay automatically.
  // Hidden in the Layers list when bodyKind !== 'gas-giant'.
  windOverlay: true,
  // Off by default — only meaningful when the current world has an underground.
  undergroundConnections: false,
};

type Screen = 'landing' | 'planet' | 'universe';

const SCREEN_LEAVE_PROMPT = 'Return to the start screen?';

/**
 * Captured when the user enters the planet flow from a universe planet
 * (the "Generate World" button on a rock+life planet). Drives:
 *  - locked generation params in the GenerationTab
 *  - the "← Back to system" button in the GenerationTab
 *  - the systemId we navigate the universe canvas to on return
 */
export interface WorldOrigin {
  universeSeed: string;
  systemId: string;
  systemName: string;
  planetId: string;
  planetName: string;
  /** Coarse classification of the source body. Drives the GenerationTab
   *  history-controls visibility and the canvas banner copy. */
  bodyKind: BodyKind;
  /** True for any non-life body — history simulation makes no sense on
   *  lava / gas / cratered worlds. UI hides the history checkbox when set. */
  disableHistory: boolean;
  /** True iff `body.life` was true. Used by the canvas banner to phrase
   *  the message ("physical map only — no civilizational history"). */
  isLifeBody: boolean;
}

/**
 * Map a planet's radius (1–31 in the generator) to a sensible cell count
 * inside the world generator's [500..100_000] range. We pick a small,
 * monotonic bucket set rather than free-form so the locked UI stays honest
 * about what the user is getting.
 */
function cellCountForPlanetRadius(radius: number): number {
  if (radius < 5) return 10000;
  if (radius < 12) return 20000;
  if (radius < 20) return 50000;
  return 100000;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [numCells, setNumCells] = useState(DEFAULT_CELLS);
  const [waterRatio, setWaterRatio] = useState(DEFAULT_WATER_RATIO);
  const [profileName, setProfileName] = useState('default');
  const [shapeName, setShapeName] = useState('default');
  const [mapView, setMapView] = useState<MapView>('terrain');
  const [politicalMode, setPoliticalMode] = useState<PoliticalMode>('countries');
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [generateHistory, setGenerateHistory] = useState(true);
  const [convertYears, setConvertYears] = useState(true);
  const [numSimYears, setNumSimYears] = useState(5000);
  const [resourceRarityMode, setResourceRarityMode] = useState<ResourceRarityMode>('natural');
  const [selectedYear, setSelectedYear] = useState(0);
  const [season, setSeason] = useState<Season>(0);
  const [viewTransform, setViewTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [highlightCells, setHighlightCells] = useState<number[] | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [exporting, setExporting] = useState(false);
  // Snapshot of the seed + rarity mode that produced the current `mapData`.
  // Used by `handleGenerateHistory` so a follow-up history run is consistent
  // with the map on screen even if the user has since edited the form.
  const [lastGenParams, setLastGenParams] = useState<
    { seed: string; resourceRarityMode: ResourceRarityMode } | null
  >(null);

  // Universe state lifted from `UniverseScreen` so it survives a
  // round-trip through the planet flow (Generate World → world generator →
  // Back to system). Without lifting, returning to the universe would
  // re-mount with empty state and lose the user's generated cosmos.
  const [universeData, setUniverseData] = useState<UniverseData | null>(null);
  // When non-null, the universe screen will navigate the canvas to the
  // recorded scene on mount (so "Back to system" lands you in the same
  // solar system you came from). Cleared after consumption.
  const [universeReturnTo, setUniverseReturnTo] = useState<
    { systemId: string; planetId?: string } | null
  >(null);
  // When non-null, the planet flow is in "from-universe" mode: predefined
  // generation params are locked and the GenerationTab shows a back button.
  const [worldOrigin, setWorldOrigin] = useState<WorldOrigin | null>(null);
  // Non-life-body fields threaded through to the worker request. Default to
  // 'rocky-life' / false / undefined so the existing rocky+life flow and the
  // sweep stay byte-identical when omitted.
  const [bodyKind, setBodyKind] = useState<BodyKind>('rocky-life');
  const [disableHistory, setDisableHistory] = useState(false);
  const [paletteOverride, setPaletteOverride] = useState<Record<string, string> | undefined>(undefined);
  // Worker-side underground eligibility. Resolved from the body spec when
  // entering via the universe handoff; defaults to the rocky-life value when
  // generating directly from the landing screen.
  const [undergroundChance, setUndergroundChance] = useState<number>(0.45);
  // UI-only: which view is shown for the current world. Only meaningful when
  // mapData.hasUnderground === true.
  const [worldView, setWorldView] = useState<'surface' | 'underground'>('surface');

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

  // Recalculate highlight cells when selectedYear changes while an entity is
  // Bind screen choice to browser back-button.
  // - Entering planet/universe pushes a history entry for the screen.
  // - popstate (back) prompts a confirm guard against misclicks; cancel
  //   re-pushes the entry so the user stays on the current screen.
  useEffect(() => {
    if (screen === 'landing') return;
    window.history.pushState({ screen }, '');
    const onPop = () => {
      if (window.confirm(SCREEN_LEAVE_PROMPT)) {
        // Browser-back returning to landing also resets the
        // universe-handoff context to avoid leaking stale origin
        // into a later "planet from landing" entry.
        setWorldOrigin(null);
        setUniverseReturnTo(null);
        setBodyKind('rocky-life');
        setDisableHistory(false);
        setPaletteOverride(undefined);
        setScreen('landing');
      } else {
        window.history.pushState({ screen }, '');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [screen]);

  // selected.  Territory boundaries shift over time, so the highlight must
  // track the entity's footprint at the *current* year — without re-centering
  // the viewport (that only happens on explicit entity selection).
  useEffect(() => {
    if (!selectedEntity || !mapData) return;

    if (selectedEntity.type === 'city') {
      const city = mapData.cities.find(c => c.cellIndex === selectedEntity.cellIndex);
      if (city) {
        const owned = city.ownedCells
          ?.filter(oc => oc.yearAdded <= selectedYear)
          .map(oc => oc.cellIndex) ?? [city.cellIndex];
        setHighlightCells(owned.length > 0 ? owned : [city.cellIndex]);
      }
    } else if (selectedEntity.type === 'country') {
      if (!ownershipAtYear) return;
      const cells: number[] = [];
      for (let i = 0; i < ownershipAtYear.length; i++) {
        if (ownershipAtYear[i] === selectedEntity.countryIndex) cells.push(i);
      }
      setHighlightCells(cells.length > 0 ? cells : null);
    } else if (selectedEntity.type === 'empire') {
      if (!mapData.history || !ownershipAtYear) return;
      const empireSnaps = getEmpiresAtYear(mapData.history, selectedYear);
      const empEntry = empireSnaps.find(e => e.empireId === selectedEntity.empireId);
      if (!empEntry) {
        setHighlightCells(null);
        return;
      }
      const memberSet = new Set(empEntry.memberCountryIndices);
      const cells: number[] = [];
      for (let i = 0; i < ownershipAtYear.length; i++) {
        if (memberSet.has(ownershipAtYear[i])) cells.push(i);
      }
      setHighlightCells(cells.length > 0 ? cells : null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, ownershipAtYear]);

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
        // Highlight city's owned cells at the selected year (territory view)
        const owned = city.ownedCells
          ?.filter(oc => oc.yearAdded <= selectedYear)
          .map(oc => oc.cellIndex) ?? [city.cellIndex];
        setHighlightCells(owned.length > 0 ? owned : [city.cellIndex]);
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
      // Replay empire membership to the exact selected year (snapshots only
      // exist at multiples of 20 + the final year, so a direct dictionary
      // lookup would miss inter-snapshot years).
      const empireSnaps = getEmpiresAtYear(mapData.history, selectedYear);
      const empEntry = empireSnaps.find(e => e.empireId === entity.empireId);
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
  }, [mapData, ownershipAtYear, selectedYear]);

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
    const width = Math.max(window.innerWidth, Math.round(height * 1.8));

    setGenerating(true);
    setProgress({ step: 'Starting…', pct: 0 });
    setSelectedEntity(null);
    setHighlightCells(null);

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'PROGRESS') {
        setProgress({ step: msg.step, pct: msg.pct });
      } else if (msg.type === 'TERRAIN_READY') {
        // Paint terrain now; history is still running in the worker.
        // Keep `generating` / `progress` / the worker ref untouched — the
        // full payload arrives with the final DONE message.
        setMapData({
          cells: msg.data.cells,
          rivers: msg.data.rivers,
          width: msg.data.width,
          height: msg.data.height,
          cities: [],
          roads: [],
          // regions / continents / history / historyStats intentionally
          // omitted — they arrive with DONE.
        });
      } else if (msg.type === 'DONE') {
        setMapData(msg.data);
        if (msg.data.history) {
          setSelectedYear(0);
        }
        setLastGenParams({ seed, resourceRarityMode });
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
      profileName,
      shapeName,
      generateHistory,
      numSimYears,
      resourceRarityMode,
      bodyKind,
      disableHistory,
      paletteOverride,
      undergroundChance,
    });
    setWorldView('surface');
  }, [generating, seed, numCells, waterRatio, profileName, shapeName, generateHistory, numSimYears, resourceRarityMode, bodyKind, disableHistory, paletteOverride, undergroundChance]);

  const handleGenerateHistory = useCallback(() => {
    if (generating) return;
    if (!mapData || mapData.history || !lastGenParams) return;

    workerRef.current?.terminate();

    const worker = new Worker(
      new URL('./workers/mapgen.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    setGenerating(true);
    setProgress({ step: 'Starting history…', pct: 0 });
    setSelectedEntity(null);
    setHighlightCells(null);

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'PROGRESS') {
        setProgress({ step: msg.step, pct: msg.pct });
      } else if (msg.type === 'DONE') {
        // History-only path: the worker echoes cells/rivers/width/height back
        // unchanged and adds the simulation outputs. Replace mapData with the
        // full payload — selectedYear resets to 0 like the combined path.
        // Underground was generated in the prior GENERATE call and isn't
        // re-emitted by the history path; preserve it from the snapshot.
        setMapData(prev => ({
          ...msg.data,
          hasUnderground: prev?.hasUnderground,
          underground: prev?.underground,
        }));
        if (msg.data.history) {
          setSelectedYear(0);
        }
        setGenerating(false);
        setProgress(null);
        worker.terminate();
      } else if (msg.type === 'ERROR') {
        console.error('History generation error:', msg.message);
        setGenerating(false);
        setProgress(null);
        worker.terminate();
      }
      // TERRAIN_READY is not posted by the GENERATE_HISTORY path.
    };

    worker.onerror = (err) => {
      console.error('Worker error:', err);
      setGenerating(false);
      setProgress(null);
    };

    worker.postMessage({
      type: 'GENERATE_HISTORY',
      seed: lastGenParams.seed,
      cells: mapData.cells,
      width: mapData.width,
      height: mapData.height,
      rivers: mapData.rivers,
      numSimYears,
      resourceRarityMode: lastGenParams.resourceRarityMode,
    });
  }, [generating, mapData, lastGenParams, numSimYears]);

  const canGenerateHistory = !!mapData && !mapData.history && !generating && !!lastGenParams;

  /**
   * Entry point for the "Generate World" button on a rock+life planet in
   * the universe popup. Sets the world generator's params to the locked
   * predefined values, captures the origin so the back button works, then
   * switches screens. The user still has to press "Generate Map" — this
   * just sets up the form.
   */
  const handleGenerateWorldFromPlanet = useCallback(
    (planet: PlanetData, system: SolarSystemData, universe: UniverseData, lifeLevelAtStep: LifeLevel | undefined) => {
      // Tear down any previous world state so the new screen starts clean.
      workerRef.current?.terminate();
      workerRef.current = null;
      setMapData(null);
      setLastGenParams(null);
      setSelectedEntity(null);
      setHighlightCells(null);
      setProgress(null);
      setGenerating(false);

      // Isolated PRNG sub-stream — same convention as the existing
      // `_racebias_<id>` / `_chars_<cellIndex>` streams in the codebase.
      const planetSeed = `${universe.seed}_${planet.id}`;
      // Body's serialized `.lifeLevel` reflects end-of-time when history is
      // on, but the user may have scrubbed back to before life appeared (or
      // before it reached intelligent_animals) — pass a patched view so
      // `planetToGenSpec` picks the rocky-no-life branch (or disables
      // civilizational history) at earlier steps.
      const stepBody: PlanetData = lifeLevelAtStep === planet.lifeLevel
        ? planet
        : {
            ...planet,
            life: lifeLevelAtStep !== undefined,
            lifeLevel: lifeLevelAtStep,
            biome: lifeLevelAtStep !== undefined ? planet.biome : undefined,
          };
      const spec = planetToGenSpec(stepBody);
      const isLifeBody = lifeLevelAtStep !== undefined;

      setSeed(planetSeed);
      setNumCells(cellCountForPlanetRadius(planet.radius));
      setWaterRatio(spec.waterRatio);
      setProfileName(spec.profileName);
      setShapeName(spec.shapeName);
      setResourceRarityMode('natural');
      // Default to off when arriving from any body (existing behavior). Non-life
      // bodies additionally hide the toggle entirely via worldOrigin.disableHistory.
      setGenerateHistory(false);
      setBodyKind(spec.bodyKind);
      setDisableHistory(spec.disableHistory);
      setPaletteOverride(spec.paletteOverride);
      setUndergroundChance(spec.undergroundChance);

      setWorldOrigin({
        universeSeed: universe.seed,
        systemId: system.id,
        systemName: system.humanName,
        planetId: planet.id,
        planetName: planet.humanName,
        bodyKind: spec.bodyKind,
        disableHistory: spec.disableHistory,
        isLifeBody,
      });
      // Remember which system to land on when the user clicks "Back".
      setUniverseReturnTo({ systemId: system.id, planetId: planet.id });
      setScreen('planet');
    },
    [],
  );

  const handleGenerateWorldFromSatellite = useCallback(
    (satellite: SatelliteData, planet: PlanetData, system: SolarSystemData, universe: UniverseData, lifeLevelAtStep: LifeLevel | undefined) => {
      workerRef.current?.terminate();
      workerRef.current = null;
      setMapData(null);
      setLastGenParams(null);
      setSelectedEntity(null);
      setHighlightCells(null);
      setProgress(null);
      setGenerating(false);

      const satelliteSeed = `${universe.seed}_${satellite.id}`;
      const stepSat: SatelliteData = lifeLevelAtStep === satellite.lifeLevel
        ? satellite
        : {
            ...satellite,
            life: lifeLevelAtStep !== undefined,
            lifeLevel: lifeLevelAtStep,
            biome: lifeLevelAtStep !== undefined ? satellite.biome : undefined,
          };
      const spec = satelliteToGenSpec(stepSat);
      const isLifeBody = lifeLevelAtStep !== undefined;

      setSeed(satelliteSeed);
      setNumCells(cellCountForPlanetRadius(satellite.radius));
      setWaterRatio(spec.waterRatio);
      setProfileName(spec.profileName);
      setShapeName(spec.shapeName);
      setResourceRarityMode('natural');
      setGenerateHistory(false);
      setBodyKind(spec.bodyKind);
      setDisableHistory(spec.disableHistory);
      setPaletteOverride(spec.paletteOverride);
      setUndergroundChance(spec.undergroundChance);

      setWorldOrigin({
        universeSeed: universe.seed,
        systemId: system.id,
        systemName: system.humanName,
        planetId: planet.id,
        planetName: `${planet.humanName} / ${satellite.humanName}`,
        bodyKind: spec.bodyKind,
        disableHistory: spec.disableHistory,
        isLifeBody,
      });
      setUniverseReturnTo({ systemId: system.id, planetId: planet.id });
      setScreen('planet');
    },
    [],
  );

  /**
   * Used by the GenerationTab's "← Back to system" button. Tears down the
   * worker and any in-flight map, then returns to the universe screen which
   * will navigate the canvas to the saved system via `universeReturnTo`.
   */
  const handleBackToSystem = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setMapData(null);
    setLastGenParams(null);
    setSelectedEntity(null);
    setHighlightCells(null);
    setProgress(null);
    setGenerating(false);
    // Clear non-life-body fields so a subsequent landing-screen entry into
    // the planet flow starts from defaults.
    setBodyKind('rocky-life');
    setDisableHistory(false);
    setPaletteOverride(undefined);
    setScreen('universe');
  }, []);

  const handleLayerToggle = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleExportWorld = useCallback(() => {
    if (!mapData || exporting) return;
    setExporting(true);
    // Defer the heavy JSON.stringify + zipSync work so the button's
    // "Exporting…" label paints before the main thread gets pegged.
    requestAnimationFrame(() => {
      try {
        exportWorld(mapData, {
          seed,
          numCells,
          waterRatio,
          profileName,
          shapeName,
          generateHistory,
          numSimYears,
        });
      } catch (err) {
        console.error('Export failed:', err);
        alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setExporting(false);
      }
    });
  }, [mapData, exporting, seed, numCells, waterRatio, profileName, shapeName, generateHistory, numSimYears]);

  if (screen === 'landing') {
    return (
      <LandingScreen
        onPick={(target) => {
          // Picking from the landing screen is always a "fresh" entry,
          // so clear any stale world-from-planet binding.
          setWorldOrigin(null);
          setUniverseReturnTo(null);
          setBodyKind('rocky-life');
          setDisableHistory(false);
          setPaletteOverride(undefined);
          setScreen(target);
        }}
      />
    );
  }

  if (screen === 'universe') {
    return (
      <UniverseScreen
        data={universeData}
        onDataChange={setUniverseData}
        returnTo={universeReturnTo}
        onReturnToConsumed={() => setUniverseReturnTo(null)}
        onGenerateWorldFromPlanet={handleGenerateWorldFromPlanet}
        onGenerateWorldFromSatellite={handleGenerateWorldFromSatellite}
      />
    );
  }

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
        worldView={mapData?.hasUnderground ? worldView : 'surface'}
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
        profileName={profileName}
        onProfileChange={setProfileName}
        shapeName={shapeName}
        onShapeChange={setShapeName}
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
        convertYears={convertYears}
        onConvertYearsToggle={() => setConvertYears(v => !v)}
        numSimYears={numSimYears}
        onNumSimYearsChange={setNumSimYears}
        resourceRarityMode={resourceRarityMode}
        onResourceRarityModeChange={setResourceRarityMode}
        onGenerate={handleGenerate}
        onGenerateHistory={handleGenerateHistory}
        canGenerateHistory={canGenerateHistory}
        generating={generating}
        progress={progress}
        onExportWorld={handleExportWorld}
        exporting={exporting}
        mapData={mapData}
        selectedYear={selectedYear}
        ownershipAtYear={ownershipAtYear}
        citySizesAtYear={citySizesAtYear}
        onEntityNavigate={handleEntityNavigate}
        selectedEntity={selectedEntity}
        onSelectEntity={handleSelectEntity}
        worldOrigin={worldOrigin}
        onBackToSystem={worldOrigin ? handleBackToSystem : undefined}
        worldView={worldView}
        onWorldViewChange={setWorldView}
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
          convertYears={convertYears}
        />
      )}
    </>
  );
}
