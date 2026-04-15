import { useState, useEffect } from 'react';
import type { MapData, MapView, PoliticalMode, LayerVisibility, Season, SelectedEntity, ResourceRarityMode } from '../lib/types';
import { Draggable } from './Draggable';
import { GenerationTab } from './overlay/GenerationTab';
import { EventsTab } from './overlay/EventsTab';
import { HierarchyTab } from './overlay/HierarchyTab';
import { TechTab } from './overlay/TechTab';
import { DetailsTab } from './overlay/DetailsTab';
import { IllustratesTab } from './overlay/IllustratesTab';

export type OverlayTab = 'generation' | 'events' | 'details' | 'hierarchy' | 'illustrates' | 'tech';

const VALID_TABS: readonly OverlayTab[] = ['generation', 'events', 'details', 'hierarchy', 'illustrates', 'tech'];

interface UnifiedOverlayProps {
  // Generation tab — same shape as the old ControlsProps
  seed: string;
  onSeedChange: (s: string) => void;
  numCells: number;
  onNumCellsChange: (n: number) => void;
  waterRatio: number;
  onWaterRatioChange: (r: number) => void;
  profileName: string;
  onProfileChange: (name: string) => void;
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
  generating: boolean;
  progress: { step: string; pct: number } | null;
  onExportWorld: () => void;
  exporting: boolean;

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

/** Fixed overlay width — wide enough for the widest tab (Events at 560 px). */
const OVERLAY_WIDTH = 560;

const TAB_LABELS: Record<OverlayTab, string> = {
  generation: 'Gen',
  events: 'Events',
  details: 'Details',
  hierarchy: 'Realm',
  illustrates: 'Figures',
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
    illustrates: hasHistory && (props.mapData?.history?.illustrateDetails ?? []).length > 0,
    tech: hasTechTimeline,
  };

  // Keyboard nav: Alt+1..4 to switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
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

  return (
    <Draggable
      defaultPosition={{ top: 16, right: 16 }}
      style={{ ...styles.panel, width: OVERLAY_WIDTH }}
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
                profileName={props.profileName}
                onProfileChange={props.onProfileChange}
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
                convertYears={props.convertYears}
                onConvertYearsToggle={props.onConvertYearsToggle}
                numSimYears={props.numSimYears}
                onNumSimYearsChange={props.onNumSimYearsChange}
                resourceRarityMode={props.resourceRarityMode}
                onResourceRarityModeChange={props.onResourceRarityModeChange}
                onGenerate={props.onGenerate}
                generating={props.generating}
                progress={props.progress}
                mapData={props.mapData}
                onExportWorld={props.onExportWorld}
                exporting={props.exporting}
              />
            )}
            {activeTab === 'events' && props.mapData?.history && (
              <EventsTab
                historyData={props.mapData.history}
                selectedYear={props.selectedYear}
                convertYears={props.convertYears}
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
                convertYears={props.convertYears}
                ownershipAtYear={props.ownershipAtYear}
                citySizesAtYear={props.citySizesAtYear}
                seed={props.seed}
                onSelectEntity={props.onSelectEntity}
                onNavigate={props.onEntityNavigate}
              />
            )}
            {activeTab === 'hierarchy' && props.mapData?.history && (
              <HierarchyTab
                historyData={props.mapData.history}
                cities={props.mapData.cities}
                selectedYear={props.selectedYear}
                convertYears={props.convertYears}
                ownershipAtYear={props.ownershipAtYear}
                citySizesAtYear={props.citySizesAtYear}
                onNavigate={props.onEntityNavigate}
                onSelectEntity={props.onSelectEntity}
              />
            )}
            {activeTab === 'illustrates' && props.mapData?.history && (
              <IllustratesTab
                historyData={props.mapData.history}
                selectedYear={props.selectedYear}
                convertYears={props.convertYears}
                onNavigate={props.onEntityNavigate}
              />
            )}
            {activeTab === 'tech' && props.mapData?.history?.techTimeline && (
              <TechTab
                historyData={props.mapData.history}
                selectedYear={props.selectedYear}
                convertYears={props.convertYears}
                onNavigate={props.onEntityNavigate}
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
