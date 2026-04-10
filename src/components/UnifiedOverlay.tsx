import { useState, useEffect } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, Season, SelectedEntity } from '../lib/types';
import { Draggable } from './Draggable';
import { GenerationTab } from './overlay/GenerationTab';
import { EventsTab } from './overlay/EventsTab';
import { HierarchyTab } from './overlay/HierarchyTab';
import { TechTab } from './overlay/TechTab';
import { DetailsTab } from './overlay/DetailsTab';

export type OverlayTab = 'generation' | 'events' | 'details' | 'hierarchy' | 'tech';

const VALID_TABS: readonly OverlayTab[] = ['generation', 'events', 'details', 'hierarchy', 'tech'];

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
  politicalMode: PoliticalMode;
  onPoliticalModeChange: (mode: PoliticalMode) => void;
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
  ownershipAtYear?: Int16Array;
  citySizesAtYear?: Uint8Array;
  onEntityNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
  selectedEntity: SelectedEntity | null;
  onSelectEntity: (entity: SelectedEntity | null) => void;
}

/**
 * Per-tab width constants. The Tech tab gets wider to give the polyline chart
 * more horizontal room; the other tabs share a narrower default.
 */
const OVERLAY_WIDTHS: Record<OverlayTab, number> = {
  generation: 280,
  events: 560,
  details: 320,
  hierarchy: 280,
  tech: 360,
};

const TAB_LABELS: Record<OverlayTab, string> = {
  generation: 'Gen',
  events: 'Events',
  details: 'Details',
  hierarchy: 'Realm',
  tech: 'Tech',
};

// ── Focus-ring injection ──────────────────────────────────────────────
// Inline styles can't express :focus-visible, so inject a one-shot <style>
// block scoped to our tab buttons.
let focusStyleInjected = false;
function ensureFocusStyle() {
  if (focusStyleInjected) return;
  focusStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `button[role="tab"]:focus-visible { outline: 2px solid #8b6040; outline-offset: 2px; }`;
  document.head.appendChild(style);
}

/** Read a persisted tab key from localStorage, validated against the union. */
function readStoredTab(): OverlayTab {
  try {
    const raw = localStorage.getItem('overlay.activeTab');
    if (raw && (VALID_TABS as readonly string[]).includes(raw)) return raw as OverlayTab;
  } catch { /* private-browsing or corrupt — fall through */ }
  return 'generation';
}

export function UnifiedOverlay(props: UnifiedOverlayProps) {
  const [activeTab, setActiveTab] = useState<OverlayTab>(readStoredTab);
  const [collapsed, setCollapsed] = useState(false);

  // Inject the focus-visible style on first render
  useEffect(ensureFocusStyle, []);

  // Persist active tab to localStorage
  useEffect(() => {
    try { localStorage.setItem('overlay.activeTab', activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  const hasHistory = props.mapData?.history != null;
  const hasTechTimeline = props.mapData?.history?.techTimeline != null;

  // Auto-switch to details tab when an entity is selected
  useEffect(() => {
    if (props.selectedEntity && hasHistory) {
      setActiveTab('details');
      setCollapsed(false);
    }
  }, [props.selectedEntity, hasHistory]);
  const tabEnabled: Record<OverlayTab, boolean> = {
    generation: true,
    events: hasHistory,
    details: hasHistory,
    hierarchy: hasHistory,
    tech: hasTechTimeline,
  };

  // Keyboard nav: Alt+1..4 to switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (idx === -1) return;
      const target = VALID_TABS[idx];
      if (!tabEnabled[target]) return;
      e.preventDefault();
      setActiveTab(target);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // tabEnabled is derived from props and rebuilds every render, so we
  // intentionally omit it from deps to avoid re-subscribing every render.
  // The handler closure always sees the latest tabEnabled because the
  // effect re-runs when hasHistory/hasTechTimeline change (which is when
  // tabEnabled actually changes).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHistory, hasTechTimeline]);

  const width = OVERLAY_WIDTHS[activeTab];

  return (
    <Draggable
      defaultPosition={{ top: 16, right: 16 }}
      style={{ ...styles.panel, width }}
      storageKey="overlay.position"
      responsiveDock={{ breakpoint: 600 }}
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
          <div style={styles.tabBar} data-drag-handle role="tablist" aria-label="Overlay sections">
            {(Object.keys(TAB_LABELS) as OverlayTab[]).map(tab => {
              const isActive = activeTab === tab;
              const isEnabled = tabEnabled[tab];
              return (
                <button
                  key={tab}
                  role="tab"
                  id={`overlay-tab-${tab}`}
                  aria-selected={isActive}
                  aria-controls={`overlay-panel-${tab}`}
                  tabIndex={isActive ? 0 : -1}
                  style={{
                    ...styles.tabBtn,
                    ...(isActive ? styles.tabBtnActive : {}),
                    ...(!isEnabled ? styles.tabBtnDisabled : {}),
                  }}
                  onClick={() => isEnabled && setActiveTab(tab)}
                  disabled={!isEnabled}
                  title={!isEnabled ? 'Generate history to enable' : `${TAB_LABELS[tab]} (Alt+${VALID_TABS.indexOf(tab) + 1})`}
                >
                  {TAB_LABELS[tab]}
                </button>
              );
            })}
          </div>

          <div
            style={styles.tabContent}
            role="tabpanel"
            id={`overlay-panel-${activeTab}`}
            aria-labelledby={`overlay-tab-${activeTab}`}
          >
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
                politicalMode={props.politicalMode}
                onPoliticalModeChange={props.onPoliticalModeChange}
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
                onNavigate={props.onEntityNavigate}
                selectedEntity={props.selectedEntity}
                onSelectEntity={props.onSelectEntity}
              />
            )}
            {activeTab === 'details' && props.mapData?.history && (
              <DetailsTab
                selectedEntity={props.selectedEntity}
                mapData={props.mapData}
                selectedYear={props.selectedYear}
                ownershipAtYear={props.ownershipAtYear}
                citySizesAtYear={props.citySizesAtYear}
                onSelectEntity={props.onSelectEntity}
                onNavigate={props.onEntityNavigate}
              />
            )}
            {activeTab === 'hierarchy' && props.mapData?.history && (
              <HierarchyTab
                historyData={props.mapData.history}
                cities={props.mapData.cities}
                selectedYear={props.selectedYear}
                ownershipAtYear={props.ownershipAtYear}
                citySizesAtYear={props.citySizesAtYear}
                onNavigate={props.onEntityNavigate}
                onSelectEntity={props.onSelectEntity}
              />
            )}
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
    transition: 'width 180ms ease-out',
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
