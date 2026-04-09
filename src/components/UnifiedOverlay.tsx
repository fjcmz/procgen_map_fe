import { useState } from 'react';
import type { MapData, MapView, LayerVisibility, Season } from '../lib/types';
import { Draggable } from './Draggable';
import { GenerationTab } from './overlay/GenerationTab';
import { EventsTab } from './overlay/EventsTab';
import { TechTab } from './overlay/TechTab';

export type OverlayTab = 'generation' | 'events' | 'hierarchy' | 'tech';

interface UnifiedOverlayProps {
  // Generation tab — same shape as the old ControlsProps
  seed: string;
  onSeedChange: (s: string) => void;
  numCells: number;
  onNumCellsChange: (n: number) => void;
  waterRatio: number;
  onWaterRatioChange: (r: number) => void;
  mapView: MapView;
  onMapViewChange: (view: MapView) => void;
  season: Season;
  onSeasonChange: (s: Season) => void;
  layers: LayerVisibility;
  onLayerToggle: (key: keyof LayerVisibility) => void;
  generateHistory: boolean;
  onGenerateHistoryToggle: () => void;
  numSimYears: number;
  onNumSimYearsChange: (n: number) => void;
  onGenerate: () => void;
  generating: boolean;
  progress: { step: string; pct: number } | null;

  // Shared — used by the shell to enable/disable history-dependent tabs
  // and will feed data into EventsTab / HierarchyTab / TechTab in later phases.
  mapData: MapData | null;
  selectedYear: number;
}

/**
 * Per-tab width constants. All four tabs currently render at the same width,
 * but the constant is centralized here so Phase 5 can introduce per-tab widths
 * without churning every consumer.
 */
const OVERLAY_WIDTHS: Record<OverlayTab, number> = {
  generation: 280,
  // Phase 3: the tech chart moved out of EventsTab into its own tab, so
  // events can shrink back to the default. The Tech tab gets the wider
  // real estate the chart was cramped for under the parked layout —
  // `TechTab.tsx` uses a ResizeObserver to fill whatever width is given.
  events: 280,
  hierarchy: 280,
  tech: 360,
};

const TAB_LABELS: Record<OverlayTab, string> = {
  generation: 'Gen',
  events: 'Events',
  hierarchy: 'Realm',
  tech: 'Tech',
};

export function UnifiedOverlay(props: UnifiedOverlayProps) {
  const [activeTab, setActiveTab] = useState<OverlayTab>('generation');
  const [collapsed, setCollapsed] = useState(false);

  const hasHistory = props.mapData?.history != null;
  const hasTechTimeline = props.mapData?.history?.techTimeline != null;
  const tabEnabled: Record<OverlayTab, boolean> = {
    generation: true,
    events: hasHistory,
    hierarchy: hasHistory,
    // Gate specifically on techTimeline presence — a truncated or
    // country-less history can have `history` set without the per-field
    // timeline, and Phase 3 acceptance requires the tab to be inert then.
    tech: hasTechTimeline,
  };

  const width = OVERLAY_WIDTHS[activeTab];

  return (
    <Draggable
      defaultPosition={{ top: 16, right: 16 }}
      style={{ ...styles.panel, width }}
    >
      <div style={styles.titleRow} data-drag-handle>
        <h2 style={styles.title}>Fantasy Map Generator</h2>
        <button
          style={styles.collapseBtn}
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div style={styles.tabBar} data-drag-handle>
            {(Object.keys(TAB_LABELS) as OverlayTab[]).map(tab => {
              const isActive = activeTab === tab;
              const isEnabled = tabEnabled[tab];
              return (
                <button
                  key={tab}
                  style={{
                    ...styles.tabBtn,
                    ...(isActive ? styles.tabBtnActive : {}),
                    ...(!isEnabled ? styles.tabBtnDisabled : {}),
                  }}
                  onClick={() => isEnabled && setActiveTab(tab)}
                  disabled={!isEnabled}
                  title={!isEnabled ? 'Generate history to enable' : TAB_LABELS[tab]}
                >
                  {TAB_LABELS[tab]}
                </button>
              );
            })}
          </div>

          <div style={styles.tabContent}>
            {activeTab === 'generation' && (
              <GenerationTab
                seed={props.seed}
                onSeedChange={props.onSeedChange}
                numCells={props.numCells}
                onNumCellsChange={props.onNumCellsChange}
                waterRatio={props.waterRatio}
                onWaterRatioChange={props.onWaterRatioChange}
                mapView={props.mapView}
                onMapViewChange={props.onMapViewChange}
                season={props.season}
                onSeasonChange={props.onSeasonChange}
                layers={props.layers}
                onLayerToggle={props.onLayerToggle}
                generateHistory={props.generateHistory}
                onGenerateHistoryToggle={props.onGenerateHistoryToggle}
                numSimYears={props.numSimYears}
                onNumSimYearsChange={props.onNumSimYearsChange}
                onGenerate={props.onGenerate}
                generating={props.generating}
                progress={props.progress}
              />
            )}
            {activeTab === 'events' && props.mapData?.history && (
              <EventsTab
                historyData={props.mapData.history}
                selectedYear={props.selectedYear}
              />
            )}
            {activeTab === 'hierarchy' && <div style={styles.placeholder}>Coming soon</div>}
            {activeTab === 'tech' && props.mapData?.history?.techTimeline && (
              <TechTab
                historyData={props.mapData.history}
                selectedYear={props.selectedYear}
              />
            )}
          </div>
        </>
      )}
    </Draggable>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
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
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'move',
    touchAction: 'none',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#3a1a00',
    letterSpacing: 0.5,
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#5a3a10',
    padding: '0 2px',
    lineHeight: 1,
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid #c0a070',
    marginBottom: 2,
    cursor: 'move',
    touchAction: 'none',
  },
  tabBtn: {
    flex: 1,
    padding: '6px 0',
    border: '1px solid #c0a070',
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    background: '#e8d4a0',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#5a3a10',
    cursor: 'pointer',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tabBtnActive: {
    background: '#fffef5',
    color: '#2a1a00',
    borderBottom: '1px solid #fffef5',
    position: 'relative',
    top: 1,
  },
  tabBtnDisabled: {
    background: '#d8c8a8',
    color: '#9a8668',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  placeholder: {
    padding: '24px 8px',
    textAlign: 'center',
    fontSize: 12,
    color: '#8a6a30',
    fontStyle: 'italic',
  },
};
