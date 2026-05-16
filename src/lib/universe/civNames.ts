import type { CivFlavor, PlanetData, SatelliteData, SolarSystemData } from './types';

/**
 * Per-flavor civilisation-name generator. Every draw consumes the civ's
 * isolated `${seed}_civname_${civId}` PRNG sub-stream, so the same civ
 * always produces the same name across re-runs.
 *
 * Names are intentionally short and evocative — the popup + events tab
 * render them inline ("Outpost of [Name] established on [body]").
 *
 * If the rare case of a name collision is observed in the same universe
 * the function still returns a candidate; consumers can dedupe themselves.
 * The collision rate at the universe scale is small enough not to be worth
 * a guarantee-loop here.
 */
export function generateCivName(
  flavor: CivFlavor,
  rng: () => number,
  origin: { body: PlanetData | SatelliteData; system: SolarSystemData },
): string {
  if (flavor === 'hardSF') return hardSFName(rng, origin);
  if (flavor === 'spaceOpera') return spaceOperaName(rng);
  return fantasyName(rng);
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

// ── Hard SF ───────────────────────────────────────────────────────────────
// Root in the civ's origin system: a corporate / federalist / technocratic
// label tied to the home star or system name.

const HARD_SF_SUFFIXES = [
  'Compact', 'Consortium', 'Reach', 'Authority', 'Initiative',
  'Polity', 'Concord', 'Foundation', 'Directive', 'Syndicate',
  'Network', 'Coalition',
] as const;

function hardSFName(
  rng: () => number,
  origin: { body: PlanetData | SatelliteData; system: SolarSystemData },
): string {
  const suffix = pick(rng, HARD_SF_SUFFIXES);
  // Prefer the body's own human name; fall back to the system if it's empty
  // (shouldn't happen, but worth the safety net).
  const root = origin.body.humanName || origin.system.humanName || 'Sol';
  // A small handful of templates so two civs sharing a root system don't
  // automatically collide.
  const template = Math.floor(rng() * 3);
  if (template === 0) return `${root} ${suffix}`;
  if (template === 1) return `The ${root} ${suffix}`;
  return `${suffix} of ${root}`;
}

// ── Space opera ───────────────────────────────────────────────────────────
// Invented dynastic names via syllable tables. Stable, varied, evocative.

const OPERA_PREFIXES = [
  'Imp', 'Cor', 'Ver', 'Sol', 'Lum', 'Tar', 'Mor', 'Kael',
  'Veth', 'Arn', 'Cyr', 'Dor', 'El', 'Fyr', 'Gar', 'Hel',
  'Ith', 'Jor', 'Khan', 'Lir',
] as const;
const OPERA_MIDDLES = [
  'a', 'i', 'o', 'u', 'e', 'ar', 'or', 'an', 'in', 'on',
  'al', 'el', 'il', 'ol', 'ul', 'ash', 'esh', 'ush', 'ax', 'ex',
] as const;
const OPERA_SUFFIXES = [
  'um', 'us', 'an', 'on', 'ar', 'or', 'ax', 'ex', 'iel', 'ion',
  'aris', 'oris', 'eron', 'aron', 'enth', 'anth', 'osh', 'esh',
] as const;
const OPERA_TITLES = [
  'Imperium', 'Reach', 'Dominion', 'Crown', 'Throne', 'Suzerainty',
  'Hegemony', 'Sovereignty', 'Compact', 'Ascendancy', 'Crimson Reach',
  'Iron Halo', 'Star Council',
] as const;

function operaWord(rng: () => number): string {
  return pick(rng, OPERA_PREFIXES) + pick(rng, OPERA_MIDDLES) + pick(rng, OPERA_SUFFIXES);
}

function spaceOperaName(rng: () => number): string {
  const template = Math.floor(rng() * 3);
  if (template === 0) return `${pick(rng, OPERA_TITLES)} of ${operaWord(rng)}`;
  if (template === 1) return `House of the ${pick(rng, OPERA_TITLES)}`;
  return `${operaWord(rng)} ${pick(rng, OPERA_TITLES)}`;
}

// ── Fantasy / mythic ──────────────────────────────────────────────────────
// Evocative phrasing borrowed from religious / mythic vocab. Loose theming
// only — no hard dependency on the `lib/fantasy/` deity tables.

const FANTASY_GROUPS = [
  'Children', 'Choir', 'Pilgrims', 'Heralds', 'Wardens',
  'Voices', 'Shepherds', 'Inheritors', 'Sons', 'Daughters',
  'Servants', 'Disciples', 'Keepers',
] as const;
const FANTASY_OBJECTS = [
  'First Light', 'Verdance', 'Eighth Name', 'Hollow Star', 'Silent Moon',
  'Bright Path', 'Verdant Word', 'Long Night', 'Inner Flame',
  'Threshold', 'Endless Garden', 'Singing Tide', 'Hidden Sun',
  'Burning Crown', 'Pale Sky', 'Sleeping Mountain',
] as const;

function fantasyName(rng: () => number): string {
  return `${pick(rng, FANTASY_GROUPS)} of the ${pick(rng, FANTASY_OBJECTS)}`;
}

// ── Flavor roll ───────────────────────────────────────────────────────────

const CIV_FLAVORS: readonly CivFlavor[] = ['hardSF', 'spaceOpera', 'fantasy'];

export function pickCivFlavor(rng: () => number): CivFlavor {
  return CIV_FLAVORS[Math.floor(rng() * CIV_FLAVORS.length) % CIV_FLAVORS.length];
}
