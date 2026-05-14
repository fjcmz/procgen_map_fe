import { useMemo } from 'react';
import type { UniverseData, LifeLevel } from '../lib/universe/types';
import { LIFE_LEVELS } from '../lib/universe/types';
import { SYSTEM_KIND_INFO, isStandaloneKind } from '../lib/universe/SystemKindInfo';
import type { SystemKind, StarSubtype } from '../lib/universe/SystemKind';
import type { StarComposition } from '../lib/universe/Star';
import type {
  PlanetComposition,
  PlanetSubtype,
  PlanetBiome,
} from '../lib/universe/Planet';
import type { SatelliteComposition, SatelliteSubtype } from '../lib/universe/Satellite';

interface UniverseStatsTabProps {
  data: UniverseData;
}

interface UniverseStats {
  totals: {
    galaxies: number;
    sectors: number;
    systems: number;
    stars: number;
    planets: number;
    satellites: number;
    wormholes: number;
  };
  systems: {
    planetary: number;
    standalone: number;
    byKind: Record<SystemKind, number>;
    avgStarsPerSystem: number;
    avgPlanetsPerPlanetary: number;
  };
  stars: {
    byComposition: Record<StarComposition, number>;
    bySubtype: Record<StarSubtype, number>;
    avgRadius: number;
    avgBrightness: number;
  };
  planets: {
    byComposition: Record<PlanetComposition, number>;
    bySubtype: Record<PlanetSubtype, number>;
    byBiome: Record<PlanetBiome, number>;
    withLife: number;
    byLifeLevel: Record<LifeLevel, number>;
    avgSatellitesPerPlanet: number;
  };
  satellites: {
    byComposition: Record<SatelliteComposition, number>;
    bySubtype: Record<SatelliteSubtype, number>;
    byBiome: Record<PlanetBiome, number>;
    withLife: number;
    byLifeLevel: Record<LifeLevel, number>;
  };
  wormholes: {
    paired: number;
    unpaired: number;
    sameGalaxy: number;
    crossGalaxy: number;
  };
}

const LIFE_LEVEL_LABELS: Record<LifeLevel, string> = {
  unicellular: 'Unicellular',
  vegetation: 'Vegetation',
  small_animals: 'Small animals',
  large_animals: 'Large animals',
  intelligent_animals: 'Intelligent',
};

const PLANET_COMPOSITION_LABELS: Record<PlanetComposition, string> = {
  ROCK: 'Rock',
  GAS: 'Gas',
};

const SATELLITE_COMPOSITION_LABELS: Record<SatelliteComposition, string> = {
  ROCK: 'Rock',
  ICE: 'Ice',
};

const STAR_COMPOSITION_LABELS: Record<StarComposition, string> = {
  MATTER: 'Matter',
  ANTIMATTER: 'Antimatter',
};

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function computeStats(data: UniverseData): UniverseStats {
  const stats: UniverseStats = {
    totals: {
      galaxies: data.galaxies.length,
      sectors: 0,
      systems: data.solarSystems.length,
      stars: 0,
      planets: 0,
      satellites: 0,
      wormholes: 0,
    },
    systems: {
      planetary: 0,
      standalone: 0,
      byKind: {} as Record<SystemKind, number>,
      avgStarsPerSystem: 0,
      avgPlanetsPerPlanetary: 0,
    },
    stars: {
      byComposition: { MATTER: 0, ANTIMATTER: 0 },
      bySubtype: {} as Record<StarSubtype, number>,
      avgRadius: 0,
      avgBrightness: 0,
    },
    planets: {
      byComposition: { ROCK: 0, GAS: 0 },
      bySubtype: {} as Record<PlanetSubtype, number>,
      byBiome: {} as Record<PlanetBiome, number>,
      withLife: 0,
      byLifeLevel: {
        unicellular: 0,
        vegetation: 0,
        small_animals: 0,
        large_animals: 0,
        intelligent_animals: 0,
      },
      avgSatellitesPerPlanet: 0,
    },
    satellites: {
      byComposition: { ROCK: 0, ICE: 0 },
      bySubtype: {} as Record<SatelliteSubtype, number>,
      byBiome: {} as Record<PlanetBiome, number>,
      withLife: 0,
      byLifeLevel: {
        unicellular: 0,
        vegetation: 0,
        small_animals: 0,
        large_animals: 0,
        intelligent_animals: 0,
      },
    },
    wormholes: { paired: 0, unpaired: 0, sameGalaxy: 0, crossGalaxy: 0 },
  };

  for (const g of data.galaxies) stats.totals.sectors += g.sectors.length;

  let totalRadius = 0;
  let totalBrightness = 0;
  let planetaryPlanetCount = 0;

  const galaxyOfSystem = new Map<string, string>();
  for (const g of data.galaxies) {
    for (const sid of g.systemIds) galaxyOfSystem.set(sid, g.id);
  }

  for (const sys of data.solarSystems) {
    const kind = sys.kind;
    stats.systems.byKind[kind] = (stats.systems.byKind[kind] ?? 0) + 1;
    const standalone = isStandaloneKind(kind);
    if (standalone) stats.systems.standalone += 1;
    else stats.systems.planetary += 1;

    stats.totals.stars += sys.stars.length;
    if (!standalone) {
      planetaryPlanetCount += sys.planets.length;
    }

    for (const star of sys.stars) {
      stats.stars.byComposition[star.composition] += 1;
      stats.stars.bySubtype[star.subtype] = (stats.stars.bySubtype[star.subtype] ?? 0) + 1;
      totalRadius += star.radius;
      totalBrightness += star.brightness;
    }

    for (const planet of sys.planets) {
      stats.totals.planets += 1;
      stats.planets.byComposition[planet.composition] += 1;
      stats.planets.bySubtype[planet.subtype] =
        (stats.planets.bySubtype[planet.subtype] ?? 0) + 1;
      if (planet.biome) {
        stats.planets.byBiome[planet.biome] =
          (stats.planets.byBiome[planet.biome] ?? 0) + 1;
      }
      if (planet.life) {
        stats.planets.withLife += 1;
        if (planet.lifeLevel) stats.planets.byLifeLevel[planet.lifeLevel] += 1;
      }

      for (const sat of planet.satellites) {
        stats.totals.satellites += 1;
        stats.satellites.byComposition[sat.composition] += 1;
        stats.satellites.bySubtype[sat.subtype] =
          (stats.satellites.bySubtype[sat.subtype] ?? 0) + 1;
        if (sat.biome) {
          stats.satellites.byBiome[sat.biome] =
            (stats.satellites.byBiome[sat.biome] ?? 0) + 1;
        }
        if (sat.life) {
          stats.satellites.withLife += 1;
          if (sat.lifeLevel) stats.satellites.byLifeLevel[sat.lifeLevel] += 1;
        }
      }
    }

    for (const wh of sys.wormholes) {
      stats.totals.wormholes += 1;
      if (wh.partnerId === null) {
        stats.wormholes.unpaired += 1;
      } else {
        stats.wormholes.paired += 1;
      }
    }
  }

  // Cross-galaxy pairing — only count each pair once.
  const wormholeById = new Map<string, { systemId: string; galaxyId: string; partnerId: string | null }>();
  for (const sys of data.solarSystems) {
    for (const wh of sys.wormholes) {
      wormholeById.set(wh.id, {
        systemId: wh.systemId,
        galaxyId: wh.galaxyId,
        partnerId: wh.partnerId,
      });
    }
  }
  const counted = new Set<string>();
  for (const [id, wh] of wormholeById) {
    if (counted.has(id) || wh.partnerId === null) continue;
    const partner = wormholeById.get(wh.partnerId);
    if (!partner) continue;
    counted.add(id);
    counted.add(wh.partnerId);
    if (wh.galaxyId === partner.galaxyId) stats.wormholes.sameGalaxy += 1;
    else stats.wormholes.crossGalaxy += 1;
  }

  stats.systems.avgStarsPerSystem =
    stats.totals.systems > 0 ? stats.totals.stars / stats.totals.systems : 0;
  stats.systems.avgPlanetsPerPlanetary =
    stats.systems.planetary > 0 ? planetaryPlanetCount / stats.systems.planetary : 0;
  stats.stars.avgRadius =
    stats.totals.stars > 0 ? totalRadius / stats.totals.stars : 0;
  stats.stars.avgBrightness =
    stats.totals.stars > 0 ? totalBrightness / stats.totals.stars : 0;
  stats.planets.avgSatellitesPerPlanet =
    stats.totals.planets > 0 ? stats.totals.satellites / stats.totals.planets : 0;

  return stats;
}

export function UniverseStatsTab({ data }: UniverseStatsTabProps) {
  const stats = useMemo(() => computeStats(data), [data]);
  const grouped = data.galaxies.length > 1;

  return (
    <div style={s.body}>
      <Section title="Scale">
        <Row label="Galaxies" value={stats.totals.galaxies} hidden={!grouped} />
        <Row label="Sectors" value={stats.totals.sectors} />
        <Row label="Solar systems" value={stats.totals.systems} />
        <Row label="Stars" value={stats.totals.stars} />
        <Row label="Planets" value={stats.totals.planets} />
        <Row label="Satellites" value={stats.totals.satellites} />
        <Row label="Wormholes" value={stats.totals.wormholes} />
      </Section>

      <Section title="Systems">
        <Row
          label="Planetary"
          value={stats.systems.planetary}
          total={stats.totals.systems}
        />
        <Row
          label="Standalone"
          value={stats.systems.standalone}
          total={stats.totals.systems}
        />
        <Row
          label="Avg stars / system"
          value={formatDecimal(stats.systems.avgStarsPerSystem, 2)}
        />
        <Row
          label="Avg planets / planetary"
          value={formatDecimal(stats.systems.avgPlanetsPerPlanetary, 2)}
        />
        <SubHeading>By kind</SubHeading>
        {sortedEntries(stats.systems.byKind).map(([kind, count]) => (
          <Row
            key={kind}
            label={SYSTEM_KIND_INFO[kind as SystemKind]?.displayName ?? humanizeKey(kind)}
            value={count}
            total={stats.totals.systems}
          />
        ))}
      </Section>

      <Section title="Stars">
        <SubHeading>By composition</SubHeading>
        {(Object.keys(stats.stars.byComposition) as StarComposition[]).map(c => (
          <Row
            key={c}
            label={STAR_COMPOSITION_LABELS[c]}
            value={stats.stars.byComposition[c]}
            total={stats.totals.stars}
          />
        ))}
        <SubHeading>By subtype</SubHeading>
        {sortedEntries(stats.stars.bySubtype).map(([subtype, count]) => (
          <Row
            key={subtype}
            label={humanizeKey(subtype)}
            value={count}
            total={stats.totals.stars}
          />
        ))}
        <SubHeading>Averages</SubHeading>
        <Row label="Radius" value={formatDecimal(stats.stars.avgRadius, 1)} />
        <Row label="Brightness" value={formatDecimal(stats.stars.avgBrightness, 1)} />
      </Section>

      <Section title="Planets">
        <SubHeading>By composition</SubHeading>
        {(Object.keys(stats.planets.byComposition) as PlanetComposition[]).map(c => (
          <Row
            key={c}
            label={PLANET_COMPOSITION_LABELS[c]}
            value={stats.planets.byComposition[c]}
            total={stats.totals.planets}
          />
        ))}
        <SubHeading>By subtype</SubHeading>
        {sortedEntries(stats.planets.bySubtype).map(([subtype, count]) => (
          <Row
            key={subtype}
            label={humanizeKey(subtype)}
            value={count}
            total={stats.totals.planets}
          />
        ))}
        {Object.keys(stats.planets.byBiome).length > 0 && (
          <>
            <SubHeading>By biome</SubHeading>
            {sortedEntries(stats.planets.byBiome).map(([biome, count]) => (
              <Row
                key={biome}
                label={humanizeKey(biome)}
                value={count}
                total={stats.totals.planets}
              />
            ))}
          </>
        )}
        <SubHeading>Life</SubHeading>
        <Row
          label="With life"
          value={stats.planets.withLife}
          total={stats.totals.planets}
        />
        {LIFE_LEVELS.map(level => (
          <Row
            key={level}
            label={LIFE_LEVEL_LABELS[level]}
            value={stats.planets.byLifeLevel[level]}
            total={stats.planets.withLife}
            indent
          />
        ))}
        <SubHeading>Averages</SubHeading>
        <Row
          label="Avg satellites / planet"
          value={formatDecimal(stats.planets.avgSatellitesPerPlanet, 2)}
        />
      </Section>

      <Section title="Satellites">
        <SubHeading>By composition</SubHeading>
        {(Object.keys(stats.satellites.byComposition) as SatelliteComposition[]).map(c => (
          <Row
            key={c}
            label={SATELLITE_COMPOSITION_LABELS[c]}
            value={stats.satellites.byComposition[c]}
            total={stats.totals.satellites}
          />
        ))}
        <SubHeading>By subtype</SubHeading>
        {sortedEntries(stats.satellites.bySubtype).map(([subtype, count]) => (
          <Row
            key={subtype}
            label={humanizeKey(subtype)}
            value={count}
            total={stats.totals.satellites}
          />
        ))}
        {Object.keys(stats.satellites.byBiome).length > 0 && (
          <>
            <SubHeading>By biome</SubHeading>
            {sortedEntries(stats.satellites.byBiome).map(([biome, count]) => (
              <Row
                key={biome}
                label={humanizeKey(biome)}
                value={count}
                total={stats.totals.satellites}
              />
            ))}
          </>
        )}
        <SubHeading>Life</SubHeading>
        <Row
          label="With life"
          value={stats.satellites.withLife}
          total={stats.totals.satellites}
        />
        {LIFE_LEVELS.map(level => (
          <Row
            key={level}
            label={LIFE_LEVEL_LABELS[level]}
            value={stats.satellites.byLifeLevel[level]}
            total={stats.satellites.withLife}
            indent
          />
        ))}
      </Section>

      {stats.totals.wormholes > 0 && (
        <Section title="Wormholes">
          <Row
            label="Paired"
            value={stats.wormholes.paired}
            total={stats.totals.wormholes}
          />
          <Row
            label="Unpaired"
            value={stats.wormholes.unpaired}
            total={stats.totals.wormholes}
          />
          <SubHeading>Pairs by reach</SubHeading>
          <Row label="Same-galaxy pairs" value={stats.wormholes.sameGalaxy} />
          <Row label="Cross-galaxy pairs" value={stats.wormholes.crossGalaxy} />
        </Section>
      )}
    </div>
  );
}

// ── Atoms ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      <div style={s.sectionBody}>{children}</div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <div style={s.subHeading}>{children}</div>;
}

interface RowProps {
  label: string;
  value: number | string;
  total?: number;
  indent?: boolean;
  hidden?: boolean;
}

function Row({ label, value, total, indent, hidden }: RowProps) {
  if (hidden) return null;
  const pct =
    typeof value === 'number' && total !== undefined && total > 0
      ? (value / total) * 100
      : null;
  return (
    <div style={{ ...s.row, ...(indent ? s.rowIndent : {}) }}>
      <span style={s.rowLabel}>{label}</span>
      <span style={s.rowValue}>
        {value}
        {pct !== null && (
          <span style={s.rowPct}> ({pct.toFixed(pct >= 10 ? 0 : 1)}%)</span>
        )}
      </span>
    </div>
  );
}

function sortedEntries<T extends string>(rec: Record<T, number>): Array<[T, number]> {
  return (Object.entries(rec) as Array<[T, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

function formatDecimal(n: number, places: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(places);
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
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    background: 'rgba(108,122,184,0.10)',
    border: '1px solid rgba(108,122,184,0.3)',
    borderRadius: 5,
  },
  sectionTitle: {
    fontSize: 11,
    color: '#dde0ff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 'bold',
    paddingBottom: 4,
    borderBottom: '1px solid rgba(108,122,184,0.25)',
    marginBottom: 2,
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  subHeading: {
    fontSize: 10,
    color: '#a0a8d0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 16,
    fontSize: 12,
    color: '#e8e8ff',
    lineHeight: 1.3,
  },
  rowIndent: {
    paddingLeft: 10,
    fontSize: 11,
    color: '#c8ccea',
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValue: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    color: '#fff',
  },
  rowPct: {
    color: '#a0a8d0',
    fontSize: 10,
    marginLeft: 2,
  },
};
