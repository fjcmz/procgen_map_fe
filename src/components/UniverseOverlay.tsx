import { useEffect, useState } from 'react';
import { Draggable } from './Draggable';
import type { UniverseData } from '../lib/universe/types';
import type { UniverseSceneState, PopupEntity } from './UniverseCanvas';
import { UniverseTreeTab } from './UniverseTreeTab';

interface UniverseOverlayProps {
  seed: string;
  onSeedChange: (s: string) => void;
  numSolarSystems: number;
  onNumSolarSystemsChange: (n: number) => void;
  onGenerate: () => void;
  generating: boolean;
  progress: { step: string; pct: number } | null;
  data: UniverseData | null;
  sceneState: UniverseSceneState;
  onBack: () => void;
  onTreeEntitySelect: (entity: PopupEntity) => void;
}

type OverlayTab = 'generation' | 'tree';

const TAB_LABELS: Record<OverlayTab, string> = {
  generation: 'Gen',
  tree: 'Tree',
};

const VALID_TABS: readonly OverlayTab[] = ['generation', 'tree'];

const TAB_WIDTHS: Record<OverlayTab, number> = {
  generation: 320,
  tree: 360,
};
const SYSTEM_OPTIONS = [10, 30, 80, 200, 500];

// ── Focus-ring injection ──────────────────────────────────────────────────
// Mirrors the world generation overlay (`UnifiedOverlay`) — :focus-visible
// can't be expressed inline, so inject a one-shot <style> block scoped to
// the universe overlay's tab buttons.
let focusStyleInjected = false;
function ensureFocusStyle() {
  if (focusStyleInjected) return;
  focusStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `button[role="tab"][data-overlay="universe"]:focus-visible { outline: 2px solid #7a88c8; outline-offset: 2px; }`;
  document.head.appendChild(style);
}

export function UniverseOverlay(props: UniverseOverlayProps) {
  const {
    seed, onSeedChange,
    numSolarSystems, onNumSolarSystemsChange,
    onGenerate, generating, progress,
    data, sceneState, onBack,
    onTreeEntitySelect,
  } = props;

  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<OverlayTab>('generation');
  const treeEnabled = !!data;
  const effectiveTab: OverlayTab = activeTab === 'tree' && !treeEnabled ? 'generation' : activeTab;

  useEffect(ensureFocusStyle, []);

  const tabEnabled: Record<OverlayTab, boolean> = {
    generation: true,
    tree: treeEnabled,
  };

  return (
    <Draggable
      defaultPosition={{ top: 16, right: 16 }}
      style={{ ...styles.panel, width: TAB_WIDTHS[effectiveTab] }}
      storageKey="universe.overlay.position"
      responsiveDock={{ breakpoint: 600 }}
    >
      <div style={styles.titleRow} data-drag-handle>
        <h2 style={styles.title}>Universe Generator</h2>
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
          <div style={styles.tabBar} role="tablist" data-drag-handle aria-label="Universe overlay sections">
            {VALID_TABS.map(tab => {
              const isActive = effectiveTab === tab;
              const isEnabled = tabEnabled[tab];
              return (
                <button
                  key={tab}
                  role="tab"
                  data-overlay="universe"
                  id={`universe-tab-${tab}`}
                  aria-selected={isActive}
                  aria-controls={`universe-panel-${tab}`}
                  tabIndex={isActive ? 0 : -1}
                  style={{
                    ...styles.tabBtn,
                    ...(isActive ? styles.tabBtnActive : {}),
                    ...(!isEnabled ? styles.tabBtnDisabled : {}),
                  }}
                  onClick={() => isEnabled && setActiveTab(tab)}
                  disabled={!isEnabled}
                  title={!isEnabled ? 'Generate a universe to enable' : TAB_LABELS[tab]}
                >
                  {TAB_LABELS[tab]}
                </button>
              );
            })}
          </div>

          <div
            style={styles.tabContent}
            role="tabpanel"
            id={`universe-panel-${effectiveTab}`}
            aria-labelledby={`universe-tab-${effectiveTab}`}
          >
            {effectiveTab === 'generation' && (
              <GenerationTabBody
                seed={seed}
                onSeedChange={onSeedChange}
                numSolarSystems={numSolarSystems}
                onNumSolarSystemsChange={onNumSolarSystemsChange}
                onGenerate={onGenerate}
                generating={generating}
                progress={progress}
                data={data}
                sceneState={sceneState}
                onBack={onBack}
              />
            )}
            {effectiveTab === 'tree' && data && (
              <UniverseTreeTab data={data} onSelect={onTreeEntitySelect} />
            )}
          </div>
        </>
      )}
    </Draggable>
  );
}

interface GenerationTabBodyProps {
  seed: string;
  onSeedChange: (s: string) => void;
  numSolarSystems: number;
  onNumSolarSystemsChange: (n: number) => void;
  onGenerate: () => void;
  generating: boolean;
  progress: { step: string; pct: number } | null;
  data: UniverseData | null;
  sceneState: UniverseSceneState;
  onBack: () => void;
}

function GenerationTabBody({
  seed, onSeedChange,
  numSolarSystems, onNumSolarSystemsChange,
  onGenerate, generating, progress,
  data, sceneState, onBack,
}: GenerationTabBodyProps) {
  const grouped = !!data && data.galaxies.length > 1;
  // Top-of-tree label changes when grouping is active so the breadcrumb
  // matches the popup labels ("Universe" → "Galaxy" → "System" → "Planet").
  const top = grouped ? 'Universe' : 'Galaxy';
  const galaxyCrumb = grouped && sceneState.galaxyId
    ? `${top} › Galaxy`
    : top;
  const breadcrumb =
    sceneState.scene === 'galaxy' ? galaxyCrumb :
    sceneState.scene === 'system' ? `${galaxyCrumb} › System` :
    `${galaxyCrumb} › System › Planet`;

  const system = data && sceneState.systemId
    ? data.solarSystems.find(s => s.id === sceneState.systemId) ?? null
    : null;
  const planet = system && sceneState.planetId
    ? system.planets.find(p => p.id === sceneState.planetId) ?? null
    : null;
  const focusGalaxy = data && sceneState.galaxyId
    ? data.galaxies.find(g => g.id === sceneState.galaxyId) ?? null
    : null;

  return (
    <div style={styles.body}>
      <label style={styles.label}>
        Seed
        <input
          type="text"
          value={seed}
          onChange={(e) => onSeedChange(e.target.value)}
          style={styles.input}
          placeholder="cosmos"
        />
      </label>

      <label style={styles.label}>
        Solar systems: {numSolarSystems}
        <div style={styles.cellBtns}>
          {SYSTEM_OPTIONS.map(n => (
            <button
              key={n}
              style={{
                ...styles.cellBtn,
                ...(n === numSolarSystems ? styles.cellBtnActive : {}),
              }}
              onClick={() => onNumSolarSystemsChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={1}
          max={500}
          step={1}
          value={numSolarSystems}
          onChange={(e) => onNumSolarSystemsChange(Number(e.target.value))}
          style={styles.slider}
        />
      </label>

      <button
        style={{ ...styles.generateBtn, ...(generating ? styles.generateBtnDisabled : {}) }}
        onClick={onGenerate}
        disabled={generating}
      >
        {generating ? 'Generating…' : 'Generate Universe'}
      </button>

      {progress && (
        <div style={styles.progressWrap}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress.pct}%` }} />
          </div>
          <span style={styles.progressLabel}>{progress.step}</span>
        </div>
      )}

      {data && (
        <>
          <div style={styles.divider} />
          <div style={styles.sceneRow}>
            <span style={styles.breadcrumb}>{breadcrumb}</span>
            {(sceneState.scene !== 'galaxy' || sceneState.galaxyId) && (
              <button style={styles.backBtn} onClick={onBack} title="Back (Esc)">
                ◂ Back
              </button>
            )}
          </div>
          <div style={styles.stats}>
            {sceneState.scene === 'galaxy' && !focusGalaxy && (
              <>
                {grouped
                  ? <div>{data.galaxies.length} galaxies · {data.solarSystems.length} solar systems</div>
                  : <div>{data.solarSystems.length} solar systems</div>}
                <div style={styles.hint}>
                  {grouped ? 'Click a galaxy to drill in.' : 'Click a system to drill in.'}
                </div>
              </>
            )}
            {sceneState.scene === 'galaxy' && focusGalaxy && (
              <>
                <div>Galaxy: <em>{focusGalaxy.humanName}</em></div>
                <div>{focusGalaxy.systemIds.length} solar systems</div>
                <div style={styles.hint}>Click a system to drill in.</div>
              </>
            )}
            {sceneState.scene === 'system' && system && (
              <>
                <div>System: <em>{system.id}</em></div>
                <div>{system.stars.length} star{system.stars.length === 1 ? '' : 's'} · {system.planets.length} planet{system.planets.length === 1 ? '' : 's'}</div>
                <div>Type: {system.composition.toLowerCase()}</div>
                <div style={styles.hint}>Click a planet to drill in.</div>
              </>
            )}
            {sceneState.scene === 'planet' && planet && (
              <>
                <div>Planet: <em>{planet.id}</em></div>
                <div>Composition: {planet.composition.toLowerCase()}{planet.life ? ' · life' : ''}</div>
                <div>Radius: {planet.radius.toFixed(2)} · Orbit: {planet.orbit.toFixed(2)}</div>
                <div>{planet.satellites.length} satellite{planet.satellites.length === 1 ? '' : 's'}</div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'rgba(20,18,40,0.92)',
    border: '1.5px solid #6c7ab8',
    borderRadius: 8,
    padding: '14px 16px',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#e8e8ff',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
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
    color: '#dde0ff',
    letterSpacing: 0.5,
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#a0a8d0',
    padding: '0 2px',
    lineHeight: 1,
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid #4a5080',
    marginBottom: 2,
    cursor: 'move',
    touchAction: 'none',
  },
  tabBtn: {
    flex: 1,
    padding: '6px 0',
    border: '1px solid #4a5080',
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    background: '#2a2848',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#a0a8d0',
    cursor: 'pointer',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tabBtnActive: {
    background: 'rgba(20,18,40,0.92)',
    color: '#fff',
    borderBottom: '1px solid rgba(20,18,40,0.92)',
    position: 'relative',
    top: 1,
  },
  tabBtnDisabled: {
    background: '#1f1d3a',
    color: '#5a608a',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
  },
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
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #4a5080',
    background: '#1a1830',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#e8e8ff',
    outline: 'none',
  },
  slider: {
    width: '100%',
    accentColor: '#7a88c8',
    cursor: 'pointer',
  },
  cellBtns: {
    display: 'flex',
    gap: 4,
  },
  cellBtn: {
    flex: 1,
    padding: '4px 0',
    border: '1px solid #4a5080',
    borderRadius: 4,
    background: '#1a1830',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#a0a8d0',
    cursor: 'pointer',
  },
  cellBtnActive: {
    background: '#5a68a8',
    color: '#fff',
    border: '1px solid #7a88c8',
    fontWeight: 'bold',
  },
  generateBtn: {
    padding: '8px 0',
    background: '#5a68a8',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 0.5,
    boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
  },
  generateBtnDisabled: {
    background: '#3a4068',
    cursor: 'not-allowed',
  },
  progressWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  progressBar: {
    height: 8,
    background: '#2a2848',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#7a88c8',
    borderRadius: 4,
    transition: 'width 0.2s ease',
  },
  progressLabel: {
    fontSize: 10,
    color: '#a0a8d0',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    background: '#4a5080',
    opacity: 0.6,
    margin: '2px 0',
  },
  sceneRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  breadcrumb: {
    fontSize: 11,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  backBtn: {
    padding: '3px 8px',
    background: 'transparent',
    color: '#dde0ff',
    border: '1px solid #6c7ab8',
    borderRadius: 4,
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    cursor: 'pointer',
  },
  stats: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    fontSize: 12,
    color: '#dde0ff',
    lineHeight: 1.4,
  },
  hint: {
    fontStyle: 'italic',
    color: '#a0a8d0',
    fontSize: 11,
    marginTop: 4,
  },
};
