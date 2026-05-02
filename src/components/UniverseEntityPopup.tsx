import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UniverseData, SolarSystemData, PlanetData, SatelliteData, StarData, GalaxyData } from '../lib/universe/types';
import type { PopupEntity } from './UniverseCanvas';

interface Props {
  entity: PopupEntity;
  data: UniverseData;
  onClose: () => void;
  onNavigateUp: () => void;
  onNavigateDown?: () => void;
  /**
   * When provided, rock+life planets show a "Generate World" button that
   * hands off to the planet/world generator with locked, planet-derived
   * params. The popup just forwards the planet + its parent system id.
   */
  onGenerateWorld?: (planet: PlanetData, systemId: string) => void;
  /**
   * When provided, rock+life satellites show a "Generate World" button
   * similar to planets. Forwards satellite + parent planet + system id.
   */
  onGenerateSatelliteWorld?: (satellite: SatelliteData, planet: PlanetData, systemId: string) => void;
  /**
   * When provided, system rows inside a Galaxy popup are clickable and
   * navigate to that system. The popup forwards just the system id; the
   * screen handler resolves the rest.
   */
  onSelectEntity?: (entity: PopupEntity) => void;
}

export function UniverseEntityPopup({ entity, data, onClose, onNavigateUp, onNavigateDown, onGenerateWorld, onGenerateSatelliteWorld, onSelectEntity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Galaxy-aware lookup: a system entity carries only `systemId`, but to label
  // the "↑ Galaxy" button correctly we also need to find which galaxy
  // contains it. `galaxyOf(systemId)` is the only place the popup reads
  // `data.galaxies` directly.
  const galaxyBySystem = useMemo(() => {
    const m = new Map<string, GalaxyData>();
    for (const g of data.galaxies) {
      for (const sid of g.systemIds) m.set(sid, g);
    }
    return m;
  }, [data.galaxies]);

  const galaxy: GalaxyData | null =
    entity.kind === 'galaxy'
      ? data.galaxies.find(g => g.id === entity.galaxyId) ?? null
      : null;
  const system: SolarSystemData | null =
    entity.kind !== 'galaxy'
      ? data.solarSystems.find(s => s.id === entity.systemId) ?? null
      : null;
  const star: StarData | null =
    entity.kind === 'star' && system
      ? system.stars.find(st => st.id === entity.starId) ?? null
      : null;
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

  const grouped = data.galaxies.length > 1;
  const upLabel =
    entity.kind === 'galaxy' ? '↑ Universe' :
    entity.kind === 'system' ? (grouped ? '↑ Galaxy' : '↑ Galaxy') :
    entity.kind === 'star' ? '↑ System' :
    entity.kind === 'planet' ? '↑ System' :
    '↑ Planet';

  const downLabel =
    entity.kind === 'galaxy' ? '↓ Enter Galaxy' :
    entity.kind === 'system' ? '↓ Enter System' :
    entity.kind === 'planet' ? '↓ Enter Planet' :
    null;

  const canGenerateWorld =
    !!onGenerateWorld &&
    entity.kind === 'planet' &&
    !!planet &&
    planet.composition === 'ROCK' &&
    planet.life;

  const canGenerateSatelliteWorld =
    !!onGenerateSatelliteWorld &&
    entity.kind === 'satellite' &&
    !!satellite &&
    !!planet &&
    satellite.life;

  const headerTitle =
    entity.kind === 'galaxy' && galaxy ? galaxy.humanName :
    entity.kind === 'system' && system ? system.humanName :
    entity.kind === 'star' && star ? star.humanName :
    entity.kind === 'planet' && planet ? planet.humanName :
    entity.kind === 'satellite' && satellite ? satellite.humanName :
    entity.kind === 'galaxy' ? 'Galaxy' :
    entity.kind === 'system' ? 'Solar System' :
    entity.kind === 'star' ? 'Star' :
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
          {entity.kind === 'galaxy' && galaxy && (
            <GalaxyDetails
              galaxy={galaxy}
              data={data}
              onSelectSystem={onSelectEntity ? (sid) => onSelectEntity({ kind: 'system', systemId: sid }) : undefined}
            />
          )}
          {entity.kind === 'system' && system && (
            <SystemDetails
              system={system}
              parentGalaxy={grouped ? galaxyBySystem.get(system.id) ?? null : null}
            />
          )}
          {entity.kind === 'star' && star && system && (
            <StarDetails star={star} parentSystem={system} />
          )}
          {entity.kind === 'planet' && planet && system && (
            <PlanetDetails planet={planet} parentSystem={system} />
          )}
          {entity.kind === 'satellite' && satellite && planet && system && (
            <SatelliteDetails satellite={satellite} parentPlanet={planet} parentSystem={system} />
          )}
        </div>

        <div style={s.navRow}>
          <button style={s.navBtn} onClick={onNavigateUp}>{upLabel}</button>
          {canGenerateWorld && planet && (
            <button
              style={{ ...s.navBtn, ...s.navBtnGenerate }}
              onClick={() => onGenerateWorld!(planet, entity.systemId)}
              title="Open the world generator with parameters derived from this planet"
            >
              ★ Generate World
            </button>
          )}
          {canGenerateSatelliteWorld && satellite && planet && (
            <button
              style={{ ...s.navBtn, ...s.navBtnGenerate }}
              onClick={() => onGenerateSatelliteWorld!(satellite, planet, entity.systemId)}
              title="Open the world generator with parameters derived from this moon"
            >
              ★ Generate World
            </button>
          )}
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

function GalaxyDetails({
  galaxy, data, onSelectSystem,
}: {
  galaxy: GalaxyData;
  data: UniverseData;
  onSelectSystem?: (systemId: string) => void;
}) {
  const systems = galaxy.systemIds
    .map(id => data.solarSystems.find(s => s.id === id))
    .filter((s): s is SolarSystemData => !!s);
  let matterCount = 0;
  let antimatterCount = 0;
  let totalStars = 0;
  let totalPlanets = 0;
  for (const sys of systems) {
    totalStars += sys.stars.length;
    totalPlanets += sys.planets.length;
    const dominant = sys.stars[0];
    if (!dominant) continue;
    if (dominant.composition === 'ANTIMATTER') antimatterCount += 1;
    else matterCount += 1;
  }
  const avgStars = systems.length ? (totalStars / systems.length).toFixed(1) : '0';

  return (
    <>
      <NameRow humanName={galaxy.humanName} scientificName={galaxy.scientificName} />
      <Row label="Systems">{systems.length}</Row>
      <Row label="Composition">
        {matterCount} matter
        {antimatterCount > 0 && (
          <>, <span style={s.biome}>{antimatterCount} antimatter</span></>
        )}
      </Row>
      <Row label="Total stars">{totalStars}</Row>
      <Row label="Avg stars / system">{avgStars}</Row>
      <Row label="Total planets">{totalPlanets}</Row>

      <CollapsibleSection title="Solar Systems" count={systems.length}>
        {systems.map(sys => (
          <Item key={sys.id}>
            {onSelectSystem ? (
              <button
                type="button"
                style={s.linkBtn}
                onClick={() => onSelectSystem(sys.id)}
                title="Open system"
              >
                <EntityLabel humanName={sys.humanName} scientificName={sys.scientificName} />
              </button>
            ) : (
              <EntityLabel humanName={sys.humanName} scientificName={sys.scientificName} />
            )}
            <span style={s.dim}> — {sys.composition.toLowerCase()}, {sys.stars.length} star{sys.stars.length === 1 ? '' : 's'}, {sys.planets.length} planet{sys.planets.length === 1 ? '' : 's'}</span>
          </Item>
        ))}
        {systems.length === 0 && <Item><span style={s.dim}>none</span></Item>}
      </CollapsibleSection>
    </>
  );
}

function SystemDetails({
  system, parentGalaxy,
}: {
  system: SolarSystemData;
  parentGalaxy: GalaxyData | null;
}) {
  return (
    <>
      <NameRow humanName={system.humanName} scientificName={system.scientificName} />
      <Row label="Type">{system.composition.toLowerCase()}</Row>

      {parentGalaxy && (
        <Section title="Parent Galaxy">
          <Item>
            <EntityLabel humanName={parentGalaxy.humanName} scientificName={parentGalaxy.scientificName} />
            <span style={s.dim}> ({parentGalaxy.systemIds.length} systems)</span>
          </Item>
        </Section>
      )}

      <CollapsibleSection title="Stars" count={system.stars.length}>
        {system.stars.map(star => (
          <Item key={star.id}>
            <EntityLabel humanName={star.humanName} scientificName={star.scientificName} />
            <span style={s.dim}> — {star.composition.toLowerCase()}, r={star.radius.toFixed(1)}, brightness={star.brightness.toFixed(0)}</span>
          </Item>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Planets" count={system.planets.length}>
        {system.planets.map(planet => (
          <Item key={planet.id}>
            <EntityLabel humanName={planet.humanName} scientificName={planet.scientificName} />
            <span style={s.dim}> — {planet.composition.toLowerCase()}</span>
            {planet.life && <span style={s.life}> ★life</span>}
            {planet.biome && <span style={s.biome}> [{planet.biome}]</span>}
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

function StarDetails({ star, parentSystem }: { star: StarData; parentSystem: SolarSystemData }) {
  return (
    <>
      <NameRow humanName={star.humanName} scientificName={star.scientificName} />
      <Row label="Composition">{star.composition.toLowerCase()}</Row>
      <Row label="Radius">{star.radius.toFixed(2)}</Row>
      <Row label="Brightness">{star.brightness.toFixed(0)}</Row>

      <Section title="Parent System">
        <Item>
          <EntityLabel humanName={parentSystem.humanName} scientificName={parentSystem.scientificName} />
          <span style={s.dim}> ({parentSystem.composition.toLowerCase()}, {parentSystem.stars.length} star{parentSystem.stars.length !== 1 ? 's' : ''})</span>
        </Item>
      </Section>
    </>
  );
}

function PlanetDetails({ planet, parentSystem }: { planet: PlanetData; parentSystem: SolarSystemData }) {
  return (
    <>
      <NameRow humanName={planet.humanName} scientificName={planet.scientificName} />
      <Row label="Composition">{planet.composition.toLowerCase()} ({planet.subtype.replace(/_/g, ' ')})</Row>
      <Row label="Life">{planet.life ? <span style={s.life}>yes ★</span> : 'no'}</Row>
      {planet.biome && (
        <Row label="Biome"><span style={s.biome}>{planet.biome}</span></Row>
      )}
      <Row label="Radius">{planet.radius.toFixed(2)}</Row>
      <Row label="Orbit">{planet.orbit.toFixed(2)}</Row>

      <Section title="Parent System">
        <Item>
          <EntityLabel humanName={parentSystem.humanName} scientificName={parentSystem.scientificName} />
          <span style={s.dim}> ({parentSystem.composition.toLowerCase()}, {parentSystem.stars.length} star{parentSystem.stars.length !== 1 ? 's' : ''})</span>
        </Item>
      </Section>

      <CollapsibleSection title="Satellites" count={planet.satellites.length}>
        {planet.satellites.map(sat => (
          <Item key={sat.id}>
            <EntityLabel humanName={sat.humanName} scientificName={sat.scientificName} />
            <span style={s.dim}> — {sat.composition.toLowerCase()}, r={sat.radius.toFixed(2)}</span>
            {sat.life && <span style={s.life}> ★life</span>}
            {sat.biome && <span style={s.biome}> [{sat.biome}]</span>}
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
      <NameRow humanName={satellite.humanName} scientificName={satellite.scientificName} />
      <Row label="Composition">{satellite.composition.toLowerCase()} ({satellite.subtype.replace(/_/g, ' ')})</Row>
      <Row label="Life">{satellite.life ? <span style={s.life}>yes ★</span> : 'no'}</Row>
      {satellite.biome && (
        <Row label="Biome"><span style={s.biome}>{satellite.biome}</span></Row>
      )}
      <Row label="Radius">{satellite.radius.toFixed(2)}</Row>

      <Section title="Parent Planet">
        <Item>
          <EntityLabel humanName={parentPlanet.humanName} scientificName={parentPlanet.scientificName} />
          <span style={s.dim}> — {parentPlanet.composition.toLowerCase()}</span>
          {parentPlanet.life && <span style={s.life}> ★life</span>}
          {parentPlanet.biome && <span style={s.biome}> [{parentPlanet.biome}]</span>}
        </Item>
      </Section>

      <Section title="Parent System">
        <Item>
          <EntityLabel humanName={parentSystem.humanName} scientificName={parentSystem.scientificName} />
          <span style={s.dim}> ({parentSystem.composition.toLowerCase()})</span>
        </Item>
      </Section>
    </>
  );
}

// ── Name display helpers ──────────────────────────────────────────────────

function NameRow({ humanName, scientificName }: { humanName: string; scientificName: string }) {
  return (
    <div style={s.nameRow}>
      <span style={s.humanName}>{humanName}</span>
      <span style={s.scientificName}>({scientificName})</span>
    </div>
  );
}

function EntityLabel({ humanName, scientificName }: { humanName: string; scientificName: string }) {
  return (
    <>
      <span style={s.entityHumanName}>{humanName}</span>
      <span style={s.entityScientificName}> ({scientificName})</span>
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
  nameRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  humanName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#dde0ff',
    letterSpacing: 0.3,
  },
  scientificName: {
    fontSize: 12,
    color: '#7a82a8',
    fontStyle: 'italic',
  },
  entityHumanName: {
    color: '#c8d0ff',
    fontWeight: 'bold',
  },
  entityScientificName: {
    color: '#7a82a8',
    fontStyle: 'italic',
    fontSize: 11,
  },
  dim: {
    color: '#a0a8d0',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: 'inherit',
    textAlign: 'left',
  },
  life: {
    color: '#5fa86a',
    fontWeight: 'bold',
  },
  biome: {
    color: '#c8a04a',
    fontStyle: 'italic',
    fontSize: 11,
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
  navBtnGenerate: {
    background: '#3a6a3a',
    border: '1px solid #5fa86a',
    color: '#e8ffe8',
    fontWeight: 'bold',
  },
};
