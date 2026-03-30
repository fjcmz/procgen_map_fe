import { type ChangeEvent } from 'react';
import type { LayerVisibility } from '../lib/types';

interface ControlsProps {
  seed: string;
  onSeedChange: (s: string) => void;
  numCells: number;
  onNumCellsChange: (n: number) => void;
  waterRatio: number;
  onWaterRatioChange: (r: number) => void;
  layers: LayerVisibility;
  onLayerToggle: (key: keyof LayerVisibility) => void;
  onGenerate: () => void;
  generating: boolean;
  progress: { step: string; pct: number } | null;
}

const CELL_OPTIONS = [500, 1000, 2000, 4000, 10000, 50000, 100000];

const LAYER_LABELS: Record<keyof LayerVisibility, string> = {
  rivers: 'Rivers',
  roads: 'Roads',
  borders: 'Borders',
  icons: 'Icons',
  labels: 'Labels',
};

export function Controls({
  seed,
  onSeedChange,
  numCells,
  onNumCellsChange,
  waterRatio,
  onWaterRatioChange,
  layers,
  onLayerToggle,
  onGenerate,
  generating,
  progress,
}: ControlsProps) {
  return (
    <div style={styles.panel}>
      <h2 style={styles.title}>Fantasy Map Generator</h2>

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

      <div style={styles.label}>
        Layers
        <div style={styles.toggleRow}>
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
      </div>

      <button
        style={{ ...styles.generateBtn, ...(generating ? styles.generateBtnDisabled : {}) }}
        onClick={onGenerate}
        disabled={generating}
      >
        {generating ? 'Generating…' : 'Generate Map'}
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
  panel: {
    position: 'fixed',
    top: 16,
    right: 16,
    width: 220,
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 8,
    padding: '14px 16px',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#2a1a00',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    userSelect: 'none',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#3a1a00',
    textAlign: 'center',
    letterSpacing: 0.5,
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
};
