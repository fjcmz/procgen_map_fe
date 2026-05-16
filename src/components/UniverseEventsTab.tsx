import { useMemo } from 'react';
import type {
  CivilisationData,
  UniverseData,
  UniverseHistoryEvent,
  PlanetData,
  SatelliteData,
  SolarSystemData,
} from '../lib/universe/types';
import type { PopupEntity } from './UniverseCanvas';
import { LIFE_LEVEL_LABEL } from './UniverseEntityPopup';

interface UniverseEventsTabProps {
  data: UniverseData;
  selectedStep: number;
  onSelectBody: (entity: PopupEntity) => void;
}

interface BodyLookup {
  planet?: { planet: PlanetData; system: SolarSystemData };
  satellite?: { satellite: SatelliteData; planet: PlanetData; system: SolarSystemData };
}

/**
 * Universe-history events feed. Mirrors the world-map `EventsTab` shape
 * (per-event row, click-to-focus). Today the feed surfaces life-evolution
 * milestones — `LIFE_APPEARED` (unicellular spawn) and `LIFE_ADVANCED`
 * (each life-tier promotion). Future event categories can extend the
 * discriminated union without restructuring this component.
 *
 * Click handler navigates the canvas to the body's parent scene + opens its
 * details popup via the same `onTreeEntitySelect` path used by `UniverseTreeTab`.
 */
export function UniverseEventsTab({ data, selectedStep, onSelectBody }: UniverseEventsTabProps) {
  // Build a single id → location index so per-event resolution is O(1)
  // regardless of universe size. Recomputed only when `data` changes.
  const bodyById = useMemo(() => {
    const m = new Map<string, BodyLookup>();
    for (const sys of data.solarSystems) {
      for (const planet of sys.planets) {
        m.set(planet.id, { planet: { planet, system: sys } });
        for (const sat of planet.satellites) {
          m.set(sat.id, { satellite: { satellite: sat, planet, system: sys } });
        }
      }
    }
    return m;
  }, [data]);

  const civById = useMemo(() => {
    const m = new Map<string, CivilisationData>();
    if (data.history) {
      for (const c of data.history.civilisations) m.set(c.id, c);
    }
    return m;
  }, [data.history]);

  const history = data.history;
  if (!history) {
    return (
      <div style={styles.empty}>
        <span style={styles.dim}>No universe history. Re-generate with "Generate History" enabled to populate this tab.</span>
      </div>
    );
  }

  const events = history.events;
  const totalEvents = events.length;
  const eventsUpToNow = events.filter(e => e.step <= selectedStep);

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span>Events</span>
        <span style={styles.headerCount}>
          {eventsUpToNow.length} / {totalEvents} &middot; step {selectedStep}
        </span>
      </div>
      <div style={styles.list}>
        {eventsUpToNow.length === 0 && (
          <div style={styles.empty}>
            <span style={styles.dim}>No events yet at this point in time.</span>
          </div>
        )}
        {eventsUpToNow.slice().reverse().map((event, i) => (
          <EventRow
            key={`${event.step}-${event.bodyId}-${i}`}
            event={event}
            bodyById={bodyById}
            civById={civById}
            onSelectBody={onSelectBody}
          />
        ))}
      </div>
    </div>
  );
}

function EventRow({
  event, bodyById, civById, onSelectBody,
}: {
  event: UniverseHistoryEvent;
  bodyById: Map<string, BodyLookup>;
  civById: Map<string, CivilisationData>;
  onSelectBody: (entity: PopupEntity) => void;
}) {
  const lookup = bodyById.get(event.bodyId);
  let label = event.bodyId;
  let entity: PopupEntity | null = null;
  if (lookup?.planet) {
    const { planet, system } = lookup.planet;
    label = `${planet.humanName} (planet of ${system.humanName})`;
    entity = { kind: 'planet', systemId: system.id, planetId: planet.id };
  } else if (lookup?.satellite) {
    const { satellite, planet, system } = lookup.satellite;
    label = `${satellite.humanName} (moon of ${planet.humanName}, ${system.humanName})`;
    entity = { kind: 'satellite', systemId: system.id, planetId: planet.id, satelliteId: satellite.id };
  }
  const civ = event.type !== 'LIFE_APPEARED' && event.type !== 'LIFE_ADVANCED'
    ? civById.get(event.civId) ?? null
    : null;
  const click = entity ? () => onSelectBody(entity) : undefined;
  const { icon, text } = formatEvent(event, label, civ);
  return (
    <button
      type="button"
      style={{ ...styles.row, ...(click ? styles.rowClickable : styles.rowDisabled) }}
      onClick={click}
      disabled={!click}
      title={click ? 'Focus this body on the canvas' : 'Body no longer present'}
    >
      <span style={styles.rowStep}>{event.step} My</span>
      <span style={styles.rowIcon}>{icon}</span>
      <span style={styles.rowText}>{text}</span>
    </button>
  );
}

function CivName({ civ }: { civ: CivilisationData | null }) {
  if (!civ) return <strong>an unknown people</strong>;
  return (
    <strong style={{ color: civ.color }}>{civ.name}</strong>
  );
}

function formatEvent(
  event: UniverseHistoryEvent,
  bodyLabel: string,
  civ: CivilisationData | null,
): { icon: string; text: React.ReactNode } {
  switch (event.type) {
    case 'LIFE_APPEARED':
      return {
        icon: '🌱',
        text: (
          <>
            Unicellular life appears on <strong>{bodyLabel}</strong>
          </>
        ),
      };
    case 'LIFE_ADVANCED':
      return {
        icon: '🧬',
        text: (
          <>
            <strong>{bodyLabel}</strong> evolves to{' '}
            <strong>{LIFE_LEVEL_LABEL[event.toLevel]}</strong>
          </>
        ),
      };
    case 'CIV_FOUNDED':
      return {
        icon: '✦',
        text: (
          <>
            <CivName civ={civ} /> rises on <strong>{bodyLabel}</strong>
          </>
        ),
      };
    case 'OUTPOST_ESTABLISHED':
      return {
        icon: '◆',
        text: (
          <>
            <CivName civ={civ} /> establishes an outpost on <strong>{bodyLabel}</strong>
          </>
        ),
      };
    case 'COLONY_FOUNDED':
      return {
        icon: '⌂',
        text: (
          <>
            <CivName civ={civ} /> colonises <strong>{bodyLabel}</strong>
          </>
        ),
      };
    case 'TERRAFORM_STARTED':
      return {
        icon: '⚙',
        text: (
          <>
            <CivName civ={civ} /> begins terraforming <strong>{bodyLabel}</strong> (completes step {event.completeStep})
          </>
        ),
      };
    case 'TERRAFORM_COMPLETED':
      return {
        icon: '✿',
        text: (
          <>
            <CivName civ={civ} /> completes terraforming of <strong>{bodyLabel}</strong>{' '}
            (new biome: <em>{event.newBiome}</em>)
          </>
        ),
      };
  }
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: '50vh',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  headerCount: {
    fontSize: 10,
    color: '#7a82a8',
    textTransform: 'none',
    letterSpacing: 0,
    fontWeight: 'normal',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
    maxHeight: '46vh',
    paddingRight: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '5px 8px',
    background: 'rgba(108,122,184,0.10)',
    border: '1px solid rgba(108,122,184,0.25)',
    borderRadius: 4,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#dde0ff',
    textAlign: 'left',
    cursor: 'pointer',
  },
  rowClickable: {},
  rowDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  rowStep: {
    flexShrink: 0,
    minWidth: 56,
    fontSize: 11,
    color: '#a0a8d0',
    fontWeight: 'bold',
  },
  rowIcon: {
    flexShrink: 0,
    fontSize: 14,
  },
  rowText: {
    flex: 1,
    color: '#e8e8ff',
    lineHeight: 1.4,
  },
  empty: {
    padding: '10px 4px',
    fontSize: 12,
    color: '#a0a8d0',
    fontStyle: 'italic',
  },
  dim: {
    color: '#a0a8d0',
  },
};
