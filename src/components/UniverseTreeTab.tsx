import { useMemo, useState } from 'react';
import type {
  UniverseData,
  SolarSystemData,
  StarData,
  PlanetData,
  SatelliteData,
} from '../lib/universe/types';
import type { StarComposition } from '../lib/universe/Star';
import type { PlanetComposition } from '../lib/universe/Planet';
import type { SatelliteComposition } from '../lib/universe/Satellite';
import type { PopupEntity } from './UniverseCanvas';

interface UniverseTreeTabProps {
  data: UniverseData;
  onSelect: (entity: PopupEntity) => void;
}

type StarFilter = 'any' | StarComposition;
type PlanetFilter = 'any' | PlanetComposition;
type SatelliteFilter = 'any' | SatelliteComposition;

interface Filters {
  star: StarFilter;
  planet: PlanetFilter;
  satellite: SatelliteFilter;
  lifeOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  star: 'any',
  planet: 'any',
  satellite: 'any',
  lifeOnly: false,
};

function pluralize(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

/** "3 stars" when nothing was filtered out; "2/5 stars" when it was. */
function formatCount(visible: number, total: number, noun: string): string {
  if (visible === total) return `${total} ${pluralize(total, noun)}`;
  return `${visible}/${total} ${pluralize(total, noun)}`;
}

// ── Filter logic ──────────────────────────────────────────────────────────

function starMatches(star: StarData, f: Filters): boolean {
  if (f.star !== 'any' && star.composition !== f.star) return false;
  return true;
}

function satelliteMatches(sat: SatelliteData, f: Filters): boolean {
  if (f.satellite !== 'any' && sat.composition !== f.satellite) return false;
  return true;
}

function planetMatches(planet: PlanetData, f: Filters): boolean {
  if (f.planet !== 'any' && planet.composition !== f.planet) return false;
  if (f.lifeOnly && !planet.life) return false;
  return true;
}

/** A planet shows iff:
 *  - the planet itself passes (composition + life filters), AND
 *  - if the satellite filter is active, the planet has at least one matching
 *    satellite. (Inactive sat filter = planets without satellites still show.)
 *  This is the "hide parents without matching children" rule applied to
 *  planet → satellite. */
function planetPasses(planet: PlanetData, f: Filters): boolean {
  if (!planetMatches(planet, f)) return false;
  if (f.satellite !== 'any') {
    return planet.satellites.some(sat => satelliteMatches(sat, f));
  }
  return true;
}

/** A system shows iff at least one direct child (matching star or passing
 *  planet) is visible. Same "hide parents without matching children" rule. */
function systemPasses(system: SolarSystemData, f: Filters): boolean {
  if (system.stars.some(s => starMatches(s, f))) return true;
  if (system.planets.some(p => planetPasses(p, f))) return true;
  return false;
}

// ── Component ─────────────────────────────────────────────────────────────

export function UniverseTreeTab({ data, onSelect }: UniverseTreeTabProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleSystems = useMemo(
    () => data.solarSystems.filter(sys => systemPasses(sys, filters)),
    [data, filters],
  );

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters(f => ({ ...f, [key]: value }));

  return (
    <div style={s.body}>
      {/* Filters */}
      <div style={s.filterBlock}>
        <div style={s.filterTitle}>Filters</div>
        <FilterRow
          label="Star"
          value={filters.star}
          options={[
            ['any', 'Any'],
            ['MATTER', 'Matter'],
            ['ANTIMATTER', 'Antimatter'],
          ]}
          onChange={v => setFilter('star', v as StarFilter)}
        />
        <FilterRow
          label="Planet"
          value={filters.planet}
          options={[
            ['any', 'Any'],
            ['ROCK', 'Rock'],
            ['GAS', 'Gas'],
          ]}
          onChange={v => setFilter('planet', v as PlanetFilter)}
        />
        <FilterRow
          label="Satellite"
          value={filters.satellite}
          options={[
            ['any', 'Any'],
            ['ROCK', 'Rock'],
            ['ICE', 'Ice'],
          ]}
          onChange={v => setFilter('satellite', v as SatelliteFilter)}
        />
        <label style={s.lifeRow}>
          <input
            type="checkbox"
            checked={filters.lifeOnly}
            onChange={e => setFilter('lifeOnly', e.target.checked)}
          />
          <span>Life only</span>
        </label>
      </div>

      {/* Tree */}
      <div style={s.treeWrap}>
        <div style={s.treeHeader}>
          {formatCount(visibleSystems.length, data.solarSystems.length, 'system')}
        </div>
        {visibleSystems.length === 0 && (
          <div style={s.empty}>No systems match the active filters.</div>
        )}
        {visibleSystems.map(system => (
          <SystemNode
            key={system.id}
            system={system}
            filters={filters}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tree nodes ────────────────────────────────────────────────────────────

function SystemNode({
  system, filters, expanded, onToggle, onSelect,
}: {
  system: SolarSystemData;
  filters: Filters;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (entity: PopupEntity) => void;
}) {
  const key = `sys:${system.id}`;
  const isOpen = expanded.has(key);
  const visibleStars = system.stars.filter(st => starMatches(st, filters));
  const visiblePlanets = system.planets.filter(p => planetPasses(p, filters));
  const childCount = visibleStars.length + visiblePlanets.length;
  const starCountLabel = formatCount(visibleStars.length, system.stars.length, 'star');
  const planetCountLabel = formatCount(visiblePlanets.length, system.planets.length, 'planet');

  return (
    <div style={s.node}>
      <div style={s.row}>
        <Caret open={isOpen} hasChildren={childCount > 0} onClick={() => onToggle(key)} />
        <button
          style={s.label}
          onClick={() => onSelect({ kind: 'system', systemId: system.id })}
          title="Show details"
        >
          <span style={s.icon}>●</span>
          <span style={s.name}>{system.humanName}</span>
          <span style={s.sci}> ({system.scientificName})</span>
          <span style={s.dim}>
            {' '}— {system.composition.toLowerCase()}, {starCountLabel}, {planetCountLabel}
          </span>
        </button>
      </div>
      {isOpen && (
        <div style={s.children}>
          {visibleStars.map(star => (
            <StarNode
              key={star.id}
              star={star}
              system={system}
              onSelect={onSelect}
            />
          ))}
          {visiblePlanets.map(planet => (
            <PlanetNode
              key={planet.id}
              planet={planet}
              system={system}
              filters={filters}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
          {childCount === 0 && (
            <div style={s.emptyChild}>no matching children</div>
          )}
        </div>
      )}
    </div>
  );
}

function StarNode({
  star, system, onSelect,
}: {
  star: StarData;
  system: SolarSystemData;
  onSelect: (entity: PopupEntity) => void;
}) {
  return (
    <div style={s.node}>
      <div style={s.row}>
        <Caret open={false} hasChildren={false} />
        <button
          style={s.label}
          onClick={() => onSelect({ kind: 'star', systemId: system.id, starId: star.id })}
          title="Show details"
        >
          <span style={s.icon}>★</span>
          <span style={s.name}>{star.humanName}</span>
          <span style={s.sci}> ({star.scientificName})</span>
          <span style={s.dim}>
            {' '}— {star.composition.toLowerCase()}, r={star.radius.toFixed(1)}, brightness={star.brightness.toFixed(0)}
          </span>
        </button>
      </div>
    </div>
  );
}

function PlanetNode({
  planet, system, filters, expanded, onToggle, onSelect,
}: {
  planet: PlanetData;
  system: SolarSystemData;
  filters: Filters;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (entity: PopupEntity) => void;
}) {
  const key = `pl:${system.id}:${planet.id}`;
  const isOpen = expanded.has(key);
  const visibleSats = planet.satellites.filter(sat => satelliteMatches(sat, filters));
  const hasChildren = planet.satellites.length > 0;
  const satCountLabel = hasChildren
    ? formatCount(visibleSats.length, planet.satellites.length, 'sat')
    : '';

  return (
    <div style={s.node}>
      <div style={s.row}>
        <Caret open={isOpen} hasChildren={hasChildren} onClick={hasChildren ? () => onToggle(key) : undefined} />
        <button
          style={s.label}
          onClick={() => onSelect({ kind: 'planet', systemId: system.id, planetId: planet.id })}
          title="Show details"
        >
          <span style={s.icon}>◉</span>
          <span style={s.name}>{planet.humanName}</span>
          <span style={s.sci}> ({planet.scientificName})</span>
          <span style={s.dim}>
            {' '}— {planet.composition.toLowerCase()}
          </span>
          {planet.life && <span style={s.life}> ★life</span>}
          <span style={s.dim}>
            {hasChildren && `, ${satCountLabel}`}
          </span>
        </button>
      </div>
      {isOpen && hasChildren && (
        <div style={s.children}>
          {visibleSats.map(sat => (
            <SatelliteNode
              key={sat.id}
              satellite={sat}
              planet={planet}
              system={system}
              onSelect={onSelect}
            />
          ))}
          {visibleSats.length === 0 && (
            <div style={s.emptyChild}>no matching satellites</div>
          )}
        </div>
      )}
    </div>
  );
}

function SatelliteNode({
  satellite, planet, system, onSelect,
}: {
  satellite: SatelliteData;
  planet: PlanetData;
  system: SolarSystemData;
  onSelect: (entity: PopupEntity) => void;
}) {
  return (
    <div style={s.node}>
      <div style={s.row}>
        <Caret open={false} hasChildren={false} />
        <button
          style={s.label}
          onClick={() => onSelect({
            kind: 'satellite',
            systemId: system.id,
            planetId: planet.id,
            satelliteId: satellite.id,
          })}
          title="Show details"
        >
          <span style={s.icon}>◌</span>
          <span style={s.name}>{satellite.humanName}</span>
          <span style={s.sci}> ({satellite.scientificName})</span>
          <span style={s.dim}>
            {' '}— {satellite.composition.toLowerCase()}, r={satellite.radius.toFixed(2)}
          </span>
        </button>
      </div>
    </div>
  );
}

// ── Atoms ─────────────────────────────────────────────────────────────────

function Caret({
  open, hasChildren, onClick,
}: { open: boolean; hasChildren: boolean; onClick?: () => void }) {
  if (!hasChildren) return <span style={s.caretSpacer} />;
  return (
    <button
      type="button"
      onClick={onClick}
      style={s.caretBtn}
      aria-label={open ? 'Collapse' : 'Expand'}
      aria-expanded={open}
    >
      {open ? '▾' : '▸'}
    </button>
  );
}

function FilterRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div style={s.filterRow}>
      <span style={s.filterLabel}>{label}</span>
      <div style={s.filterChips}>
        {options.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              ...s.chip,
              ...(v === value ? s.chipActive : {}),
            }}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: 'calc(100vh - 180px)',
    overflowY: 'auto',
  },
  filterBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 10px',
    background: 'rgba(108,122,184,0.10)',
    border: '1px solid rgba(108,122,184,0.3)',
    borderRadius: 5,
  },
  filterTitle: {
    fontSize: 10,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  filterLabel: {
    minWidth: 64,
    fontSize: 11,
    color: '#dde0ff',
  },
  filterChips: {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
  },
  chip: {
    padding: '2px 8px',
    border: '1px solid #4a5080',
    borderRadius: 10,
    background: '#1a1830',
    fontFamily: 'Georgia, serif',
    fontSize: 10,
    color: '#a0a8d0',
    cursor: 'pointer',
    letterSpacing: 0.3,
  },
  chipActive: {
    background: '#5a68a8',
    color: '#fff',
    border: '1px solid #7a88c8',
    fontWeight: 'bold',
  },
  lifeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: '#dde0ff',
    cursor: 'pointer',
  },
  treeWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  treeHeader: {
    fontSize: 10,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
    paddingBottom: 4,
    borderBottom: '1px solid rgba(108,122,184,0.2)',
    marginBottom: 4,
  },
  empty: {
    fontStyle: 'italic',
    color: '#a0a8d0',
    fontSize: 11,
    padding: '6px 0',
  },
  emptyChild: {
    fontStyle: 'italic',
    color: '#7a82a8',
    fontSize: 10,
    paddingLeft: 8,
  },
  node: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minHeight: 22,
  },
  children: {
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: 14,
    borderLeft: '1px dashed rgba(108,122,184,0.3)',
    marginLeft: 8,
  },
  caretBtn: {
    background: 'none',
    border: 'none',
    color: '#a0a8d0',
    cursor: 'pointer',
    padding: 0,
    width: 16,
    height: 16,
    fontSize: 11,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caretSpacer: {
    display: 'inline-block',
    width: 16,
    height: 16,
  },
  label: {
    flex: 1,
    minWidth: 0,
    background: 'none',
    border: 'none',
    padding: '2px 4px',
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#e8e8ff',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    borderRadius: 3,
  },
  icon: {
    color: '#c8d0ff',
    marginRight: 4,
    fontSize: 11,
  },
  name: {
    color: '#c8d0ff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  sci: {
    color: '#6a72a8',
    fontStyle: 'italic',
    fontSize: 11,
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
    fontSize: 11,
  },
  life: {
    color: '#5fa86a',
    fontWeight: 'bold',
    fontSize: 11,
  },
};
