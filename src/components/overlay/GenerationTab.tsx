import type { ChangeEvent } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, Season, ResourceRarityMode } from '../../lib/types';
import { SEASON_LABELS } from '../../lib/terrain/biomes';
import { PROFILE_WATER_RATIOS } from '../../lib/terrain';

export interface GenerationTabProps {
  seed: string;
  onSeedChange: (s: string) => void;
  numCells: number;
  onNumCellsChange: (n: number) => void;
  waterRatio: number;
  onWaterRatioChange: (r: number) => void;
  profileName: string;
  onProfileChange: (name: string) => void;
  shapeName: string;
  onShapeChange: (name: string) => void;
  mapView: MapView;
  onMapViewChange: (view: MapView) => void;
  politicalMode: PoliticalMode;
  onPoliticalModeChange: (mode: PoliticalMode) => void;
  season: Season;
  onSeasonChange: (s: Season) => void;
  layers: LayerVisibility;
  onLayerToggle: (key: keyof LayerVisibility) => void;
  generateHistory: boolean;
  onGenerateHistoryToggle: () => void;
  convertYears: boolean;
  onConvertYearsToggle: () => void;
  numSimYears: number;
  onNumSimYearsChange: (n: number) => void;
  resourceRarityMode: ResourceRarityMode;
  onResourceRarityModeChange: (mode: ResourceRarityMode) => void;
  onGenerate: () => void;
  onGenerateHistory: () => void;
  canGenerateHistory: boolean;
  generating: boolean;
  progress: { step: string; pct: number } | null;
  mapData: MapData | null;
  onExportWorld: () => void;
  exporting: boolean;
}

const CELL_OPTIONS = [10000, 20000, 50000, 100000, 200000];

const PROFILE_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Default (Earth-like)' },
  { value: 'desert', label: 'Desert Planet' },
  { value: 'ice', label: 'Ice World' },
  { value: 'forest', label: 'Forest Planet' },
  { value: 'swamp', label: 'Swamp World' },
  { value: 'mountains', label: 'Mountain World' },
  { value: 'ocean', label: 'Ocean World' },
];

const SHAPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Default (from biome)' },
  { value: 'pangaea', label: 'Pangaea' },
  { value: 'continents', label: 'Continents' },
  { value: 'islands', label: 'Islands' },
  { value: 'archipelago', label: 'Archipelago' },
];

const PROFILE_BADGE_COLORS: Record<string, string> = {
  desert: '#c4842d',
  ice: '#5b8fa8',
  forest: '#3a7a3a',
  swamp: '#5a7a4a',
  mountains: '#6a5a4a',
  ocean: '#2a6a9a',
};

const LAYER_LABELS: Record<keyof LayerVisibility, string> = {
  rivers: 'Rivers',
  roads: 'Roads',
  borders: 'Borders',
  icons: 'Icons',
  labels: 'Labels',
  legend: 'Legend',
  regions: 'Regions',
  resources: 'Resources',
  eventOverlay: 'Events',
  tradeRoutes: 'Trades',
  wonderMarkers: 'Wonders',
  religionMarkers: 'Religions',
  minimap: 'Minimap',
  hillshading: 'Relief',
  seasonalIce: 'Seasons',
  cityIcons: 'City Icons',
};

export function GenerationTab({
  seed,
  onSeedChange,
  numCells,
  onNumCellsChange,
  waterRatio,
  onWaterRatioChange,
  profileName,
  onProfileChange,
  shapeName,
  onShapeChange,
  mapView,
  onMapViewChange,
  politicalMode,
  onPoliticalModeChange,
  season,
  onSeasonChange,
  layers,
  onLayerToggle,
  generateHistory,
  onGenerateHistoryToggle,
  convertYears,
  onConvertYearsToggle,
  numSimYears,
  onNumSimYearsChange,
  resourceRarityMode,
  onResourceRarityModeChange,
  onGenerate,
  onGenerateHistory,
  canGenerateHistory,
  generating,
  progress,
  mapData,
  onExportWorld,
  exporting,
}: GenerationTabProps) {
  return (
    <div style={styles.body}>
      <label style={styles.label}>
        Seed
        <input
          style={styles.input}
          type="text"
          value={seed}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onSeedChange(e.target.value)}
          placeholder="e.g. fantasy"
          disabled={generating}
        />
      </label>

      {profileName !== 'default' && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 8px',
          borderRadius: 10,
          background: `${PROFILE_BADGE_COLORS[profileName] ?? '#8b4513'}22`,
          border: `1px solid ${PROFILE_BADGE_COLORS[profileName] ?? '#8b4513'}`,
          fontSize: 11,
          fontWeight: 'bold',
          color: PROFILE_BADGE_COLORS[profileName] ?? '#8b4513',
          fontFamily: 'Georgia, serif',
          letterSpacing: 0.3,
        }}>
          {PROFILE_OPTIONS.find(p => p.value === profileName)?.label ?? profileName}
        </div>
      )}

      <label style={styles.label}>
        Detail ({numCells.toLocaleString()} cells)
        <div style={styles.cellBtns}>
          {CELL_OPTIONS.map(n => (
            <button
              key={n}
              style={{
                ...styles.cellBtn,
                ...(numCells === n ? styles.cellBtnActive : {}),
              }}
              onClick={() => onNumCellsChange(n)}
              disabled={generating}
            >
              {n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
      </label>

      <label style={styles.label}>
        Water ({Math.round(waterRatio * 100)}%)
        <input
          style={styles.slider}
          type="range"
          min={0}
          max={100}
          value={Math.round(waterRatio * 100)}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onWaterRatioChange(Number(e.target.value) / 100)
          }
          disabled={generating}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ ...styles.label, flex: 1, minWidth: 0 }}>
          Terrain
          <select
            style={styles.input}
            value={profileName}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const name = e.target.value;
              onProfileChange(name);
              if (name in PROFILE_WATER_RATIOS) {
                onWaterRatioChange(PROFILE_WATER_RATIOS[name]);
              }
            }}
            disabled={generating}
          >
            {PROFILE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ ...styles.label, flex: 1, minWidth: 0 }}>
          Shape
          <select
            style={styles.input}
            value={shapeName}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onShapeChange(e.target.value)}
            disabled={generating}
          >
            {SHAPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={styles.label}>
        Resources
        <div style={styles.viewToggleRow}>
          {([
            ['scarce', 'Scarce'],
            ['natural', 'Natural'],
            ['abundant', 'Abundant'],
          ] as [ResourceRarityMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              style={{
                ...styles.viewBtn,
                ...(resourceRarityMode === mode ? styles.viewBtnActive : {}),
              }}
              onClick={() => onResourceRarityModeChange(mode)}
              disabled={generating}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ ...styles.toggle, fontWeight: 'bold', fontSize: 11, color: '#5a3a10', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <input
            type="checkbox"
            checked={generateHistory}
            onChange={onGenerateHistoryToggle}
            disabled={generating}
          />
          Generate History
        </label>

        {generateHistory && (
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={convertYears}
              onChange={onConvertYearsToggle}
            />
            Convert years (BC/AD)
          </label>
        )}
      </div>

      {generateHistory && (
        <label style={styles.label}>
          Sim Years ({numSimYears})
          <input
            style={styles.slider}
            type="range"
            min={50}
            max={5000}
            step={50}
            value={numSimYears}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onNumSimYearsChange(Number(e.target.value))
            }
            disabled={generating}
          />
        </label>
      )}

      <div style={styles.label}>
        Map View
        <div style={styles.viewToggleRow}>
          <button
            style={{
              ...styles.viewBtn,
              ...(mapView === 'terrain' ? styles.viewBtnActive : {}),
            }}
            onClick={() => onMapViewChange('terrain')}
          >
            Terrain
          </button>
          <button
            style={{
              ...styles.viewBtn,
              ...(mapView === 'political' ? styles.viewBtnActive : {}),
            }}
            onClick={() => onMapViewChange('political')}
          >
            Political
          </button>
        </div>
        {mapView === 'political' && (
          <div style={{ ...styles.viewToggleRow, marginTop: 4 }}>
            <button
              style={{
                ...styles.viewBtn,
                ...(politicalMode === 'countries' ? styles.viewBtnActive : {}),
              }}
              onClick={() => onPoliticalModeChange('countries')}
            >
              Countries
            </button>
            <button
              style={{
                ...styles.viewBtn,
                ...(politicalMode === 'empires' ? styles.viewBtnActive : {}),
              }}
              onClick={() => onPoliticalModeChange('empires')}
            >
              Empires
            </button>
          </div>
        )}
      </div>

      <div style={styles.label}>
        Season
        <div style={styles.viewToggleRow}>
          {SEASON_LABELS.map((label, i) => (
            <button
              key={label}
              style={{
                ...styles.viewBtn,
                ...(season === i ? styles.viewBtnActive : {}),
              }}
              onClick={() => onSeasonChange(i as Season)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <details style={styles.details}>
        <summary style={styles.detailsSummary}>Layers</summary>
        <div style={{ ...styles.toggleRow, marginTop: 6 }}>
          {(Object.keys(LAYER_LABELS) as (keyof LayerVisibility)[]).map(key => (
            <label key={key} style={styles.toggle}>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onLayerToggle(key)}
              />
              {LAYER_LABELS[key]}
            </label>
          ))}
        </div>
      </details>

      {generateHistory ? (
        <button
          style={{ ...styles.generateBtn, ...(generating ? styles.generateBtnDisabled : {}) }}
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Generate Map and History'}
        </button>
      ) : (
        <div style={styles.splitGenerateRow}>
          <button
            style={{ ...styles.generateBtnSplit, ...(generating ? styles.generateBtnDisabled : {}) }}
            onClick={onGenerate}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Generate Map'}
          </button>
          <button
            style={{
              ...styles.generateBtnSplit,
              ...(!canGenerateHistory ? styles.generateBtnDisabled : {}),
            }}
            onClick={onGenerateHistory}
            disabled={!canGenerateHistory}
            title={
              !mapData
                ? 'Generate a map first'
                : mapData.history
                  ? 'History already generated'
                  : 'Generate the history timeline on the existing map'
            }
          >
            {generating && mapData && !mapData.history ? 'Generating…' : 'Generate History'}
          </button>
        </div>
      )}

      <button
        style={{
          ...styles.exportBtn,
          ...(!mapData || generating || exporting ? styles.exportBtnDisabled : {}),
        }}
        onClick={onExportWorld}
        disabled={!mapData || generating || exporting}
        title="Download the current map and history as a zipped JSON file"
      >
        {exporting ? 'Exporting…' : 'Export World'}
      </button>

      {progress && (
        <div style={styles.progressWrap}>
          <div style={styles.progressBar}>
            <div
              style={{ ...styles.progressFill, width: `${progress.pct}%` }}
            />
          </div>
          <span style={styles.progressLabel}>{progress.step}</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontWeight: 'bold',
    fontSize: 11,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #c0a070',
    background: '#fffef5',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#2a1a00',
    outline: 'none',
  },
  slider: {
    width: '100%',
    accentColor: '#8b4513',
    cursor: 'pointer',
  },
  cellBtns: {
    display: 'flex',
    gap: 4,
  },
  cellBtn: {
    flex: 1,
    padding: '4px 0',
    border: '1px solid #c0a070',
    borderRadius: 4,
    background: '#fffef5',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#5a3a10',
    cursor: 'pointer',
  },
  cellBtnActive: {
    background: '#c0902a',
    color: '#fff',
    border: '1px solid #a07020',
    fontWeight: 'bold',
  },
  viewToggleRow: {
    display: 'flex',
    gap: 0,
  },
  viewBtn: {
    flex: 1,
    padding: '5px 0',
    border: '1px solid #c0a070',
    background: '#fffef5',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#5a3a10',
    cursor: 'pointer',
    fontWeight: 'normal',
  },
  viewBtnActive: {
    background: '#c0902a',
    color: '#fff',
    border: '1px solid #a07020',
    fontWeight: 'bold',
  },
  toggleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px 8px',
  },
  toggle: {
    fontWeight: 'normal',
    fontSize: 12,
    color: '#2a1a00',
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    cursor: 'pointer',
    textTransform: 'none',
    letterSpacing: 0,
  },
  generateBtn: {
    padding: '8px 0',
    background: '#8b4513',
    color: '#fff5e0',
    border: 'none',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 0.5,
    boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
  },
  generateBtnDisabled: {
    background: '#b0906a',
    cursor: 'not-allowed',
  },
  splitGenerateRow: {
    display: 'flex',
    gap: 8,
  },
  generateBtnSplit: {
    flex: 1,
    padding: '8px 0',
    background: '#8b4513',
    color: '#fff5e0',
    border: 'none',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 0.5,
    boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
  },
  exportBtn: {
    padding: '7px 0',
    background: '#fffef5',
    color: '#5a3a10',
    border: '1px solid #8b4513',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
  exportBtnDisabled: {
    color: '#a8906a',
    border: '1px solid #c0a070',
    background: '#f5eedc',
    cursor: 'not-allowed',
  },
  progressWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  progressBar: {
    height: 8,
    background: '#d4c090',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#8b4513',
    borderRadius: 4,
    transition: 'width 0.2s ease',
  },
  progressLabel: {
    fontSize: 10,
    color: '#5a3a10',
    textAlign: 'center',
  },
  details: {
    border: '1px solid #c0a070',
    borderRadius: 4,
    padding: '4px 8px',
    background: '#faf6ee',
  },
  detailsSummary: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#5a3a10',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    cursor: 'pointer',
    userSelect: 'none' as const,
    listStyle: 'none',
  },
};
