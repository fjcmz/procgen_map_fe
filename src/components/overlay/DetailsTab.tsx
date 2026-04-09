import { useMemo } from 'react';
import type { MapData, SelectedEntity, HistoryEvent, Country, EmpireSnapshotEntry } from '../../lib/types';
import type { TechField } from '../../lib/history/timeline/Tech';
import { TECH_FIELD_COLORS, TECH_FIELD_LABELS, EVENT_ICONS, EVENT_COLORS } from './eventStyles';

interface DetailsTabProps {
  selectedEntity: SelectedEntity | null;
  mapData: MapData;
  selectedYear: number;
  ownershipAtYear?: Int16Array;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

/** Look up the empire snapshot at or before the given year. */
function lookupEmpireSnapshot(
  snapshots: Record<number, EmpireSnapshotEntry[]>,
  numYears: number,
  year: number,
): EmpireSnapshotEntry[] {
  if (year >= numYears && snapshots[numYears]) return snapshots[numYears];
  const floored = Math.max(0, Math.floor(year / 20) * 20);
  for (let y = floored; y >= 0; y -= 20) {
    if (snapshots[y]) return snapshots[y];
  }
  return [];
}

/** Find the empire a country belongs to (if any). */
function findEmpireForCountry(
  empireSnap: EmpireSnapshotEntry[],
  countryIndex: number,
): EmpireSnapshotEntry | undefined {
  return empireSnap.find(e => e.memberCountryIndices.includes(countryIndex));
}

/** Collect events related to a country index (as initiator or target). */
function getCountryEvents(
  years: { year: number; events: HistoryEvent[] }[],
  countryIndex: number,
  upToYear: number,
): HistoryEvent[] {
  const result: HistoryEvent[] = [];
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.initiatorId === countryIndex || ev.targetId === countryIndex) {
        result.push(ev);
      }
    }
  }
  return result;
}

/** Collect events related to a specific cell (as location or target location). */
function getCellEvents(
  years: { year: number; events: HistoryEvent[] }[],
  cellIndex: number,
  upToYear: number,
): HistoryEvent[] {
  const result: HistoryEvent[] = [];
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.locationCellIndex === cellIndex || ev.targetCellIndex === cellIndex) {
        result.push(ev);
      }
    }
  }
  return result;
}

/** Compute max tech levels for a country from TECH events. */
function getCountryTechLevels(
  years: { year: number; events: HistoryEvent[] }[],
  countryIndex: number,
  upToYear: number,
): Map<string, number> {
  const techs = new Map<string, number>();
  for (const yd of years) {
    if (yd.year > upToYear) break;
    for (const ev of yd.events) {
      if (ev.type === 'TECH' && ev.initiatorId === countryIndex && ev.field && ev.level != null) {
        const cur = techs.get(ev.field) ?? 0;
        if (ev.level > cur) techs.set(ev.field, ev.level);
      }
    }
  }
  return techs;
}

export function DetailsTab({
  selectedEntity,
  mapData,
  selectedYear,
  ownershipAtYear,
  onSelectEntity,
  onNavigate,
}: DetailsTabProps) {
  const history = mapData.history!;

  const empireSnap = useMemo(
    () => lookupEmpireSnapshot(history.empireSnapshots, history.numYears, selectedYear),
    [history, selectedYear],
  );

  // Compute the nearest 20-year snap key for empire selection
  const snapKey = useMemo(() => {
    if (selectedYear >= history.numYears && history.empireSnapshots[history.numYears]) return history.numYears;
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.empireSnapshots[y]) return y;
    }
    return 0;
  }, [history, selectedYear]);

  if (!selectedEntity) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Details</span>
        </div>
        <div style={styles.placeholder}>
          Click an entity on the map or in the Realm tab to view details.
        </div>
      </div>
    );
  }

  if (selectedEntity.type === 'city') {
    return (
      <CityDetails
        cellIndex={selectedEntity.cellIndex}
        mapData={mapData}
        history={history}
        selectedYear={selectedYear}
        empireSnap={empireSnap}
        snapKey={snapKey}
        ownershipAtYear={ownershipAtYear}
        onSelectEntity={onSelectEntity}
        onNavigate={onNavigate}
      />
    );
  }

  if (selectedEntity.type === 'country') {
    return (
      <CountryDetails
        countryIndex={selectedEntity.countryIndex}
        mapData={mapData}
        history={history}
        selectedYear={selectedYear}
        empireSnap={empireSnap}
        snapKey={snapKey}
        ownershipAtYear={ownershipAtYear}
        onSelectEntity={onSelectEntity}
        onNavigate={onNavigate}
      />
    );
  }

  // Empire
  return (
    <EmpireDetails
      empireId={selectedEntity.empireId}
      mapData={mapData}
      history={history}
      selectedYear={selectedYear}
      empireSnap={empireSnap}
      snapKey={snapKey}
      ownershipAtYear={ownershipAtYear}
      onSelectEntity={onSelectEntity}
      onNavigate={onNavigate}
    />
  );
}

// ── Shared sub-props ──
interface SubProps {
  mapData: MapData;
  history: NonNullable<MapData['history']>;
  selectedYear: number;
  empireSnap: EmpireSnapshotEntry[];
  snapKey: number;
  ownershipAtYear?: Int16Array;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onNavigate?: (cellIndices: number[], centerCellIndex: number) => void;
}

// ── City Details ──
function CityDetails({ cellIndex, mapData, history, selectedYear, empireSnap, snapKey, ownershipAtYear, onSelectEntity }: SubProps & { cellIndex: number }) {
  const city = mapData.cities.find(c => c.cellIndex === cellIndex);
  const countryId = ownershipAtYear ? ownershipAtYear[cellIndex] : -1;
  const country = countryId >= 0 ? history.countries[countryId] : undefined;
  const empire = country ? findEmpireForCountry(empireSnap, country.id) : undefined;

  const wonderSnap = useMemo(() => {
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.wonderSnapshots[y]) return history.wonderSnapshots[y];
    }
    return [];
  }, [history, selectedYear]);

  const religionSnap = useMemo(() => {
    const floored = Math.max(0, Math.floor(selectedYear / 20) * 20);
    for (let y = floored; y >= 0; y -= 20) {
      if (history.religionSnapshots[y]) return history.religionSnapshots[y];
    }
    return [];
  }, [history, selectedYear]);

  const hasWonder = wonderSnap.includes(cellIndex);
  const hasReligion = religionSnap.includes(cellIndex);

  const events = useMemo(
    () => getCellEvents(history.years, cellIndex, selectedYear),
    [history.years, cellIndex, selectedYear],
  );

  const recentEvents = events.slice(-15);

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>City Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityName}>
          {city?.isCapital && <span title="Capital">{'\u2605'} </span>}
          {city?.name ?? `Cell #${cellIndex}`}
        </div>

        <div style={styles.infoGrid}>
          {city && <InfoRow label="Size" value={city.size} />}
          {city && <InfoRow label="Founded" value={`Year ${city.foundedYear}`} />}
          {country && (
            <InfoRow label="Country">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'country', countryIndex: country.id })}
              >
                {country.name}
              </button>
            </InfoRow>
          )}
          {empire && (
            <InfoRow label="Empire">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'empire', empireId: empire.empireId, snapshotYear: snapKey })}
              >
                {empire.name}
              </button>
            </InfoRow>
          )}
          {hasWonder && <InfoRow label="Wonder" value="Yes" />}
          {hasReligion && <InfoRow label="Religion" value="Present" />}
        </div>

        {recentEvents.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Recent Events ({events.length} total)</div>
            <div style={styles.eventList}>
              {recentEvents.map((ev, i) => (
                <EventRow key={i} event={ev} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Country Details ──
function CountryDetails({ countryIndex, mapData, history, selectedYear, empireSnap, snapKey, ownershipAtYear, onSelectEntity }: SubProps & { countryIndex: number }) {
  const country = history.countries[countryIndex];
  const empire = findEmpireForCountry(empireSnap, countryIndex);

  const cities = useMemo(
    () => mapData.cities.filter(c => c.kingdomId === countryIndex && c.foundedYear <= selectedYear),
    [mapData.cities, countryIndex, selectedYear],
  );

  const territorySize = useMemo(() => {
    if (!ownershipAtYear) return 0;
    let count = 0;
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (ownershipAtYear[i] === countryIndex) count++;
    }
    return count;
  }, [ownershipAtYear, countryIndex]);

  const techLevels = useMemo(
    () => getCountryTechLevels(history.years, countryIndex, selectedYear),
    [history.years, countryIndex, selectedYear],
  );

  const events = useMemo(
    () => getCountryEvents(history.years, countryIndex, selectedYear),
    [history.years, countryIndex, selectedYear],
  );

  const warCount = events.filter(e => e.type === 'WAR').length;
  const conquestCount = events.filter(e => e.type === 'CONQUEST' && e.initiatorId === countryIndex).length;
  const conqueredCount = events.filter(e => e.type === 'CONQUEST' && e.targetId === countryIndex).length;
  const techCount = events.filter(e => e.type === 'TECH').length;

  const recentEvents = events.slice(-15);

  if (!country) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Country Details</span>
          <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
        </div>
        <div style={styles.placeholder}>Country not found.</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Country Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityName}>
          {country.name}
          {!country.isAlive && <span style={styles.deadBadge}> (fallen)</span>}
        </div>

        <div style={styles.infoGrid}>
          <InfoRow label="Territory" value={`${territorySize} cells`} />
          <InfoRow label="Cities" value={String(cities.length)} />
          <InfoRow label="Wars" value={String(warCount)} />
          <InfoRow label="Conquests" value={`${conquestCount} won, ${conqueredCount} lost`} />
          <InfoRow label="Techs" value={String(techCount)} />
          {empire && (
            <InfoRow label="Empire">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'empire', empireId: empire.empireId, snapshotYear: snapKey })}
              >
                {empire.name}
              </button>
            </InfoRow>
          )}
        </div>

        {techLevels.size > 0 && (
          <>
            <div style={styles.sectionLabel}>Technology</div>
            <div style={styles.techGrid}>
              {Array.from(techLevels.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([field, level]) => (
                  <div key={field} style={styles.techRow}>
                    <span
                      style={{
                        ...styles.techDot,
                        background: TECH_FIELD_COLORS[field as TechField] ?? '#888',
                      }}
                    />
                    <span style={styles.techLabel}>
                      {TECH_FIELD_LABELS[field as TechField] ?? field}
                    </span>
                    <span style={styles.techLevel}>L{level}</span>
                  </div>
                ))}
            </div>
          </>
        )}

        {cities.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Cities</div>
            <div style={styles.cityList}>
              {cities.map(city => (
                <button
                  key={city.cellIndex}
                  style={styles.cityItem}
                  onClick={() => onSelectEntity({ type: 'city', cellIndex: city.cellIndex })}
                >
                  {city.isCapital ? '\u2605 ' : '\u2022 '}
                  {city.name}
                  <span style={styles.citySizeMeta}> ({city.size})</span>
                </button>
              ))}
            </div>
          </>
        )}

        {recentEvents.length > 0 && (
          <>
            <div style={styles.sectionLabel}>Recent Events ({events.length} total)</div>
            <div style={styles.eventList}>
              {recentEvents.map((ev, i) => (
                <EventRow key={i} event={ev} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Empire Details ──
function EmpireDetails({ empireId, history, mapData, selectedYear, empireSnap, ownershipAtYear, onSelectEntity }: SubProps & { empireId: string }) {
  const empEntry = empireSnap.find(e => e.empireId === empireId);

  const founderCountry = empEntry ? history.countries[empEntry.founderCountryIndex] : undefined;

  const memberCountries = useMemo(() => {
    if (!empEntry) return [];
    return empEntry.memberCountryIndices
      .map(idx => history.countries[idx])
      .filter(Boolean) as Country[];
  }, [empEntry, history.countries]);

  const totalTerritory = useMemo(() => {
    if (!ownershipAtYear || !empEntry) return 0;
    const memberSet = new Set(empEntry.memberCountryIndices);
    let count = 0;
    for (let i = 0; i < ownershipAtYear.length; i++) {
      if (memberSet.has(ownershipAtYear[i])) count++;
    }
    return count;
  }, [ownershipAtYear, empEntry]);

  const totalCities = useMemo(() => {
    if (!empEntry) return 0;
    const memberSet = new Set(empEntry.memberCountryIndices);
    return mapData.cities.filter(c => memberSet.has(c.kingdomId) && c.foundedYear <= selectedYear).length;
  }, [empEntry, mapData.cities, selectedYear]);

  if (!empEntry) {
    return (
      <div style={styles.root}>
        <div style={styles.miniHeader}>
          <span style={styles.miniTitle}>Empire Details</span>
          <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
        </div>
        <div style={styles.placeholder}>Empire not found at this year.</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.miniHeader}>
        <span style={styles.miniTitle}>Empire Details</span>
        <button style={styles.clearBtn} onClick={() => onSelectEntity(null)} title="Deselect">&times;</button>
      </div>

      <div style={styles.scrollArea}>
        <div style={styles.entityName}>{empEntry.name}</div>

        <div style={styles.infoGrid}>
          <InfoRow label="Territory" value={`${totalTerritory} cells`} />
          <InfoRow label="Cities" value={String(totalCities)} />
          <InfoRow label="Members" value={`${memberCountries.length} countries`} />
          {founderCountry && (
            <InfoRow label="Founder">
              <button
                style={styles.linkBtn}
                onClick={() => onSelectEntity({ type: 'country', countryIndex: founderCountry.id })}
              >
                {founderCountry.name}
              </button>
            </InfoRow>
          )}
        </div>

        <div style={styles.sectionLabel}>Member Countries</div>
        <div style={styles.cityList}>
          {memberCountries.map(c => (
            <button
              key={c.id}
              style={styles.cityItem}
              onClick={() => onSelectEntity({ type: 'country', countryIndex: c.id })}
            >
              {c.id === empEntry.founderCountryIndex ? '\u2605 ' : '\u2022 '}
              {c.name}
              {!c.isAlive && <span style={styles.deadBadge}> (fallen)</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared small components ──

function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{children ?? value}</span>
    </div>
  );
}

function EventRow({ event }: { event: HistoryEvent }) {
  const color = EVENT_COLORS[event.type] ?? '#888';
  const icon = EVENT_ICONS[event.type] ?? '\u2022';
  return (
    <div style={{ ...styles.eventRow, borderLeft: `3px solid ${color}` }}>
      <span style={styles.eventYear}>Y{event.year}</span>
      <span style={styles.eventIcon}>{icon}</span>
      <span style={styles.eventDesc}>{event.description}</span>
    </div>
  );
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100vh - 180px)',
    overflow: 'hidden',
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottom: '1px solid #d4b896',
    gap: 8,
  },
  miniTitle: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#3a1a00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    color: '#7a5a30',
    padding: '0 4px',
    lineHeight: 1,
    fontWeight: 'bold',
  },
  placeholder: {
    fontSize: 12,
    color: '#9a7a50',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingRight: 2,
  },
  entityName: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#2a1a00',
    padding: '2px 0',
  },
  deadBadge: {
    fontWeight: 'normal',
    fontSize: 11,
    color: '#8a6a50',
    fontStyle: 'italic',
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  infoRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
  },
  infoLabel: {
    flexShrink: 0,
    fontWeight: 'bold',
    color: '#5a3a10',
    minWidth: 60,
  },
  infoValue: {
    color: '#2a1a00',
    flex: 1,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#2060a0',
    textDecoration: 'underline',
    padding: 0,
    textAlign: 'left',
  },
  sectionLabel: {
    fontWeight: 'bold',
    fontSize: 10,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    paddingBottom: 2,
    borderBottom: '1px solid #e0d0b0',
  },
  techGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  techRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    padding: '1px 4px',
    background: '#f5ecd8',
    borderRadius: 3,
  },
  techDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  techLabel: {
    color: '#3a2a10',
  },
  techLevel: {
    fontWeight: 'bold',
    color: '#2a1a00',
  },
  cityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  cityItem: {
    display: 'block',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 11,
    color: '#2060a0',
    textDecoration: 'none',
    padding: '1px 4px',
    textAlign: 'left',
    borderRadius: 2,
  },
  citySizeMeta: {
    fontSize: 9,
    color: '#8a6a30',
    fontStyle: 'italic',
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  eventRow: {
    display: 'flex',
    gap: 5,
    alignItems: 'flex-start',
    fontSize: 10,
    color: '#2a1a00',
    lineHeight: 1.4,
    padding: '1px 4px 1px 5px',
    borderRadius: 2,
    background: 'rgba(0,0,0,0.03)',
  },
  eventYear: {
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 'bold',
    color: '#7a5a30',
    minWidth: 28,
  },
  eventIcon: {
    flexShrink: 0,
    fontSize: 10,
  },
  eventDesc: {
    flex: 1,
  },
};
