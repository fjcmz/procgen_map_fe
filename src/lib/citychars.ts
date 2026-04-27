/**
 * Client-side per-city character roster generator.
 *
 * The worker simulates the world (cities, countries, religions) and ships
 * `Country.raceBias` + `ReligionDetail.deity / alignment` + `cityReligions`
 * across the postMessage boundary; this module turns those biases into a
 * deterministic D&D 3.5e PC roster the moment a city is opened in the
 * Details tab. No worker round-trip, no `HistoryStats` impact, no temporal
 * scrubbing — characters are a static seed-stable roll keyed on
 * `${worldSeed}_chars_${cellIndex}` so the same city always shows the same
 * roster within one generation run.
 *
 * Sizing per spec:
 *   small        → 3 chars, locked race / deity / alignment, narrow class mix
 *   medium       → 6 chars, 70% dominant
 *   large        → 12 chars, 50% dominant
 *   metropolis   → 24 chars, 30% dominant
 *   megalopolis  → 48 chars, 15% dominant
 *
 * "Dominant" pulls from the country's `raceBias.primary` and the city's
 * dominant religion's deity. The biased pool fills the rest using
 * `generatePcCharBiased` weight overrides.
 *
 * MUST NOT be imported from the worker — it depends on render-layer types
 * (`City`, `Country`, `ReligionDetail`) and rolls fresh PRNGs. Worker imports
 * would defeat the lazy-on-open design and balloon the postMessage payload.
 */

import { seededPRNG } from './terrain/noise';
import { generatePcCharBiased } from './fantasy/PcCharGenerator';
import { generateIllustrateName } from './history/nameGenerator';
import { DEITY_SPECS } from './fantasy/Deity';
import type { Deity } from './fantasy/Deity';
import type { RaceType } from './fantasy/RaceType';
import type { AlignmentType } from './fantasy/AlignmentType';
import type { Ability } from './fantasy/Ability';
import type { PcClassType } from './fantasy/PcClassType';
import type { City, Country, ReligionDetail } from './types';

/**
 * Display-friendly snapshot of one rolled character. Captures enough to render
 * a roster row plus a hover tooltip; intentionally a plain JSON-safe shape so
 * the UI doesn't need to import `PcChar` (a class with a `Map`).
 */
export interface CityCharacter {
  name: string;
  race: RaceType;
  pcClass: PcClassType;
  level: number;
  alignment: AlignmentType;
  /** Display name, matches `DEITY_SPECS[d].name` or 'none'. */
  deity: string;
  hitPoints: number;
  abilities: Record<Ability, number>;
  age: { currentAge: number; middleAge: number; oldAge: number; venerableAge: number; maxAge: number };
  height: number;
  weight: number;
  wealth: number;
}

interface SizeProfile {
  count: number;
  /** Inclusive range for level rolls (rng-uniform). */
  minLevel: number;
  maxLevel: number;
  /**
   * Probability that any given character is a "dominant" pick (race ×
   * heavy multiplier, deity ×heavy multiplier toward city/country
   * defaults). The remainder are filled from a broader pool.
   */
  dominantBias: number;
}

const SIZE_PROFILES: Record<City['size'], SizeProfile> = {
  small:       { count: 3,  minLevel: 1, maxLevel: 3,  dominantBias: 1.0  },
  medium:      { count: 6,  minLevel: 1, maxLevel: 5,  dominantBias: 0.7  },
  large:       { count: 12, minLevel: 1, maxLevel: 7,  dominantBias: 0.5  },
  metropolis:  { count: 24, minLevel: 1, maxLevel: 12, dominantBias: 0.3  },
  megalopolis: { count: 48, minLevel: 1, maxLevel: 15, dominantBias: 0.15 },
};

/** How heavily to weight the "dominant" race / deity above their base prob. */
const DOMINANT_RACE_MULT = 12;
const SECONDARY_RACE_MULT = 4;
const DOMINANT_DEITY_MULT = 8;

/**
 * Pretty-print an `AlignmentType` enum value as the conventional 2-letter
 * D&D abbreviation (LG, NG, CG, LN, NN, CN, LE, NE, CE).
 */
export function alignmentBadge(a: AlignmentType): string {
  switch (a) {
    case 'lawful_good':     return 'LG';
    case 'neutral_good':    return 'NG';
    case 'chaotic_good':    return 'CG';
    case 'lawful_neutral':  return 'LN';
    case 'neutral_neutral': return 'TN';
    case 'chaotic_neutral': return 'CN';
    case 'lawful_evil':     return 'LE';
    case 'neutral_evil':    return 'NE';
    case 'chaotic_evil':    return 'CE';
  }
}

/** Pretty-print `RaceType` for UI rows ('half_elf' → 'Half-Elf'). */
export function raceLabel(r: RaceType): string {
  return r.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('-');
}

/**
 * Roll the character roster for a city. Pure function: deterministic given the
 * same `(worldSeed, city.cellIndex, city.size, country.raceBias, religions)`.
 *
 * `country` may be undefined for cities outside any current country (e.g. a
 * never-incorporated outpost) — the roster falls back to a neutral race pool.
 * `religions` may be empty — the roster falls back to the country's spirit-
 * derived alignment, then to true neutral.
 *
 * Returns [] on degenerate input (no worldSeed, ruined cities at the renderer
 * layer should already have skipped this call).
 */
export function generateCityCharacters(
  worldSeed: string,
  city: Pick<City, 'cellIndex' | 'size' | 'isRuin'>,
  country: Pick<Country, 'raceBias'> | undefined,
  religions: ReligionDetail[],
): CityCharacter[] {
  if (!worldSeed) return [];
  if (city.isRuin) return [];

  const profile = SIZE_PROFILES[city.size];
  const rng = seededPRNG(worldSeed + '_chars_' + city.cellIndex);
  const usedNames = new Set<string>();

  const dominantRace = country?.raceBias?.primary ?? 'human';
  const secondaryRace = country?.raceBias?.secondary;

  // The city's effective alignment: dominant religion's deity → that deity's
  // alignment; else neutral. Also record the dominant deity for weight bias.
  const dominantReligion = religions[0];
  const cityAlignment: AlignmentType = dominantReligion?.alignment ?? 'neutral_neutral';
  const dominantDeity: Deity | null = dominantReligion?.deity ?? null;
  // Build a deity-weight multiplier biased toward all hosted religions' deities,
  // dominant first. Each religion contributes proportionally less.
  const deityWeights: Partial<Record<Deity, number>> = {};
  religions.forEach((rel, idx) => {
    const mult = idx === 0
      ? DOMINANT_DEITY_MULT
      : Math.max(1.5, DOMINANT_DEITY_MULT / (idx + 1));
    deityWeights[rel.deity] = Math.max(deityWeights[rel.deity] ?? 0, mult);
  });

  const out: CityCharacter[] = [];
  for (let i = 0; i < profile.count; i++) {
    const isDominant = rng() < profile.dominantBias;
    const raceWeights: Partial<Record<RaceType, number>> = isDominant
      ? { [dominantRace]: DOMINANT_RACE_MULT, ...(secondaryRace ? { [secondaryRace]: SECONDARY_RACE_MULT } : {}) }
      : { [dominantRace]: 2, ...(secondaryRace ? { [secondaryRace]: 1.5 } : {}) };

    const level = profile.minLevel + Math.floor(rng() * (profile.maxLevel - profile.minLevel + 1));

    // Small cities lock the deity to the dominant religion's choice when one
    // exists. Bigger cities use the broader weighted pool.
    const effectiveDeityWeights: Partial<Record<Deity, number>> | undefined =
      city.size === 'small' && dominantDeity
        ? { [dominantDeity]: 100 }
        : (Object.keys(deityWeights).length > 0 ? deityWeights : undefined);

    const pc = generatePcCharBiased(level, cityAlignment, rng, {
      raceWeights,
      deityWeights: effectiveDeityWeights,
    });

    // Convert ability Map → plain Record for serializable display.
    const abilities = {} as Record<Ability, number>;
    pc.abilities.forEach((v, k) => { abilities[k] = v; });

    out.push({
      name: generateIllustrateName(rng, usedNames),
      race: pc.race,
      pcClass: pc.pcClass,
      level: pc.level,
      alignment: pc.alignment,
      deity: pc.deity,
      hitPoints: pc.hitPoints,
      abilities,
      age: pc.age,
      height: pc.height,
      weight: pc.weight,
      wealth: pc.wealth,
    });
  }
  return out;
}

/**
 * Resolve the city's effective alignment for header-badge display, mirroring
 * the rule used inside `generateCityCharacters`. UI calls this independently
 * so it can render the badge even before scrolling the roster table into view.
 */
export function deriveCityAlignment(religions: ReligionDetail[]): AlignmentType {
  return religions[0]?.alignment ?? 'neutral_neutral';
}

/** Look up the deity display name for a `Deity` enum value. */
export function deityDisplayName(d: Deity): string {
  return DEITY_SPECS[d].name;
}
