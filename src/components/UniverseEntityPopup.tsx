import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { UniverseData, SolarSystemData, PlanetData, SatelliteData } from '../lib/universe/types';
import type { PopupEntity } from './UniverseCanvas';

interface Props {
  entity: PopupEntity;
  data: UniverseData;
  onClose: () => void;
  onNavigateUp: () => void;
  onNavigateDown?: () => void;
}

export function UniverseEntityPopup({ entity, data, onClose, onNavigateUp, onNavigateDown }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const system: SolarSystemData | null =
    data.solarSystems.find(s => s.id === entity.systemId) ?? null;
  const planet: PlanetData | null =
    (entity.kind === 'planet' || entity.kind === 'satellite') && system
      ? system.planets.find(p => p.id === entity.planetId) ?? null
      : null;
  const satellite: SatelliteData | null =
    entity.kind === 'satellite' && planet
      ? planet.satellites.find(s => s.id === entity.satelliteId) ?? null
      : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const upLabel =
    entity.kind === 'system' ? '↑ Galaxy' :
    entity.kind === 'planet' ? '↑ System' :
    '↑ Planet';

  const downLabel =
    entity.kind === 'system' ? '↓ Enter System' :
    entity.kind === 'planet' ? '↓ Enter Planet' :
    null;

  const headerTitle =
    entity.kind === 'system' ? 'Solar System' :
    entity.kind === 'planet' ? 'Planet' :
    'Satellite';

  const content = (
    <div style={s.backdrop} onClick={onClose}>
      <div
        ref={containerRef}
        style={s.popup}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div style={s.header}>
          <span style={s.headerTitle}>{headerTitle}</span>
          <button style={s.closeBtn} onClick={onClose} title="Close (Esc)">×</button>
        </div>

        <div style={s.body}>
          {entity.kind === 'system' && system && <SystemDetails system={system} />}
          {entity.kind === 'planet' && planet && system && (
            <PlanetDetails planet={planet} parentSystem={system} />
          )}
          {entity.kind === 'satellite' && satellite && planet && system && (
            <SatelliteDetails satellite={satellite} parentPlanet={planet} parentSystem={system} />
          )}
        </div>

        <div style={s.navRow}>
          <button style={s.navBtn} onClick={onNavigateUp}>{upLabel}</button>
          {downLabel && onNavigateDown && (
            <button style={{ ...s.navBtn, ...s.navBtnPrimary }} onClick={onNavigateDown}>
              {downLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ── Sub-components ────────────────────────────────────────────────────────

function SystemDetails({ system }: { system: SolarSystemData }) {
  return (
    <>
      <Row label="ID"><code style={s.code}>{system.id}</code></Row>
      <Row label="Type">{system.composition.toLowerCase()}</Row>

      <CollapsibleSection title="Stars" count={system.stars.length}>
        {system.stars.map(star => (
          <Item key={star.id}>
            <code style={s.code}>{star.id}</code>
            <span style={s.dim}> — {star.composition.toLowerCase()}, r={star.radius.toFixed(1)}, brightness={star.brightness.toFixed(0)}</span>
          </Item>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Planets" count={system.planets.length}>
        {system.planets.map(planet => (
          <Item key={planet.id}>
            <code style={s.code}>{planet.id}</code>
            <span style={s.dim}> — {planet.composition.toLowerCase()}</span>
            {planet.life && <span style={s.life}> ★life</span>}
            <span style={s.dim}>, orbit={planet.orbit.toFixed(1)}</span>
            {planet.satellites.length > 0 && (
              <span style={s.dim}>, {planet.satellites.length} sat{planet.satellites.length > 1 ? 's' : ''}</span>
            )}
          </Item>
        ))}
        {system.planets.length === 0 && <Item><span style={s.dim}>none</span></Item>}
      </CollapsibleSection>
    </>
  );
}

function PlanetDetails({ planet, parentSystem }: { planet: PlanetData; parentSystem: SolarSystemData }) {
  return (
    <>
      <Row label="ID"><code style={s.code}>{planet.id}</code></Row>
      <Row label="Composition">{planet.composition.toLowerCase()}</Row>
      <Row label="Life">{planet.life ? <span style={s.life}>yes ★</span> : 'no'}</Row>
      <Row label="Radius">{planet.radius.toFixed(2)}</Row>
      <Row label="Orbit">{planet.orbit.toFixed(2)}</Row>

      <Section title="Parent System">
        <Item>
          <code style={s.code}>{parentSystem.id}</code>
          <span style={s.dim}> ({parentSystem.composition.toLowerCase()}, {parentSystem.stars.length} star{parentSystem.stars.length !== 1 ? 's' : ''})</span>
        </Item>
      </Section>

      <CollapsibleSection title="Satellites" count={planet.satellites.length}>
        {planet.satellites.map(sat => (
          <Item key={sat.id}>
            <code style={s.code}>{sat.id}</code>
            <span style={s.dim}> — {sat.composition.toLowerCase()}, r={sat.radius.toFixed(2)}</span>
          </Item>
        ))}
        {planet.satellites.length === 0 && <Item><span style={s.dim}>none</span></Item>}
      </CollapsibleSection>
    </>
  );
}

function SatelliteDetails({
  satellite, parentPlanet, parentSystem,
}: {
  satellite: SatelliteData;
  parentPlanet: PlanetData;
  parentSystem: SolarSystemData;
}) {
  return (
    <>
      <Row label="ID"><code style={s.code}>{satellite.id}</code></Row>
      <Row label="Composition">{satellite.composition.toLowerCase()}</Row>
      <Row label="Radius">{satellite.radius.toFixed(2)}</Row>

      <Section title="Parent Planet">
        <Item>
          <code style={s.code}>{parentPlanet.id}</code>
          <span style={s.dim}> — {parentPlanet.composition.toLowerCase()}</span>
          {parentPlanet.life && <span style={s.life}> ★life</span>}
        </Item>
      </Section>

      <Section title="Parent System">
        <Item>
          <code style={s.code}>{parentSystem.id}</code>
          <span style={s.dim}> ({parentSystem.composition.toLowerCase()})</span>
        </Item>
      </Section>
    </>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={s.rowValue}>{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      <div style={s.sectionBody}>{children}</div>
    </div>
  );
}

function CollapsibleSection({
  title, count, children,
}: { title: string; count: number; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={s.section}>
      <button
        type="button"
        style={s.collapsibleTitle}
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span style={s.caret}>{expanded ? '▾' : '▸'}</span>
        <span>{title} ({count})</span>
      </button>
      {expanded && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <div style={s.item}>{children}</div>;
}

// ── Styles ────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(5,3,13,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  popup: {
    background: 'rgba(16,14,36,0.97)',
    border: '1.5px solid #6c7ab8',
    borderRadius: 10,
    width: 400,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 80px)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#e8e8ff',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    outline: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px 10px',
    borderBottom: '1px solid rgba(108,122,184,0.3)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#dde0ff',
    letterSpacing: 0.5,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#a0a8d0',
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
    padding: '0 2px',
  },
  body: {
    overflowY: 'auto',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flexGrow: 1,
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  rowLabel: {
    fontSize: 11,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
    minWidth: 80,
    flexShrink: 0,
  },
  rowValue: {
    color: '#e8e8ff',
    fontSize: 13,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  collapsibleTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'left',
  },
  caret: {
    fontSize: 10,
    color: '#a0a8d0',
    width: 10,
    display: 'inline-block',
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingLeft: 8,
    borderLeft: '2px solid rgba(108,122,184,0.3)',
  },
  item: {
    fontSize: 12,
    lineHeight: 1.5,
    color: '#e8e8ff',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#c8d0ff',
    background: 'rgba(108,122,184,0.15)',
    padding: '1px 4px',
    borderRadius: 3,
  },
  dim: {
    color: '#a0a8d0',
  },
  life: {
    color: '#5fa86a',
    fontWeight: 'bold',
  },
  navRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 16px 14px',
    borderTop: '1px solid rgba(108,122,184,0.3)',
    flexShrink: 0,
    justifyContent: 'flex-end',
  },
  navBtn: {
    padding: '6px 14px',
    background: 'transparent',
    color: '#dde0ff',
    border: '1px solid #6c7ab8',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    cursor: 'pointer',
    letterSpacing: 0.3,
  },
  navBtnPrimary: {
    background: '#5a68a8',
    border: '1px solid #7a88c8',
    fontWeight: 'bold',
  },
};
