import { useMemo } from 'react';
import { BIOME_INFO } from '../lib/terrain';
import type { MapData } from '../lib/types';
import { Draggable } from './Draggable';

interface LegendProps {
  mapData: MapData;
}

export function Legend({ mapData }: LegendProps) {
  const entries = useMemo(() => {
    const shownBiomes = new Set(mapData.cells.map(c => c.biome));
    return (Object.entries(BIOME_INFO) as [string, { fillColor: string; label: string }][])
      .filter(([k]) => shownBiomes.has(k as never))
      .slice(0, 14);
  }, [mapData.cells]);

  return (
    <Draggable
      defaultPosition={{ bottom: 16, left: 16 }}
      style={{ zIndex: 10 }}
    >
      <div style={styles.panel}>
        <div style={styles.header} data-drag-handle>
          <span style={styles.title}>Biomes</span>
        </div>
        <div style={styles.list}>
          {entries.map(([key, info]) => (
            <div key={key} style={styles.entry}>
              <span
                style={{
                  ...styles.swatch,
                  background: info.fillColor,
                }}
              />
              <span style={styles.label}>{info.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Draggable>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 140,
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 6,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#2a1a00',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    userSelect: 'none',
  },
  header: {
    padding: '8px 10px 4px',
    cursor: 'grab',
  },
  title: {
    fontWeight: 'bold',
    fontSize: 10,
    color: '#2a1a00',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: {
    padding: '2px 10px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  entry: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 16,
  },
  swatch: {
    display: 'inline-block',
    width: 12,
    height: 10,
    border: '0.5px solid #8b6040',
    borderRadius: 1,
    flexShrink: 0,
  },
  label: {
    fontSize: 9,
    color: '#2a1a00',
  },
};
