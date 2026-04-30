/**
 * Procedural name generators for universe entities.
 *
 * Two naming layers per entity:
 *   scientific — catalog-style designations (NGC, HD, HIP, GJ, KOI, Roman numerals)
 *   human      — distinctive proper names with a distinct phonetic feel per tier
 *
 * Each entity gets an isolated PRNG sub-stream derived from
 * `${universe.seed}_<tier>name_<entityId>` so name generation never perturbs
 * the main physics RNG.  Deduplication within a generation run is handled by
 * the per-tier `usedNames: Set<string>` that callers pass in and that lives on
 * the `Universe` instance.
 */

import { seededPRNG } from '../terrain/noise';

// ── Shared helpers ────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1] as const;
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'] as const;
  let result = '';
  let rem = n;
  for (let i = 0; i < vals.length; i++) {
    while (rem >= vals[i]) { result += syms[i]; rem -= vals[i]; }
  }
  return result || 'I';
}

// ── Galaxy / Universe ─────────────────────────────────────────────────────

// Grand, flowing, 3–4 syllable names: Andromeda / Velarion / Orysseia feel.
const GALAXY_ONSETS = [
  'Vel', 'And', 'Thi', 'Aur', 'Mes', 'Cir', 'Pax', 'Elys',
  'Vor', 'Lyr', 'Cass', 'Per', 'Aeg', 'Hyp', 'Oph', 'Sig',
  'Del', 'Pho', 'Crux', 'Ara', 'Sag', 'Vex',
] as const;
const GALAXY_MIDDLES = [
  'ar', 'el', 'an', 'oth', 'iss', 'ion', 'enn', 'ald',
  'orn', 'yr', 'inn', 'ell', 'or', 'ul', 'em', 'on', 'al',
] as const;
const GALAXY_ENDINGS = [
  'ia', 'on', 'ax', 'uma', 'ara', 'eus', 'eda', 'ula',
  'oma', 'ix', 'os', 'a', 'is', 'era',
] as const;

function makeGalaxyHumanName(rng: () => number): string {
  return pick(GALAXY_ONSETS, rng) + pick(GALAXY_MIDDLES, rng) + pick(GALAXY_ENDINGS, rng);
}

/**
 * Galaxy names are universe-scoped singletons — no `usedNames` dedup needed.
 * Scientific: NGC-XXXX (4 uppercase hex digits).
 * Human: grand 3-part syllable composition.
 */
export function generateGalaxyName(seed: string): { human: string; scientific: string } {
  const rng = seededPRNG(`${seed}_galaxyname`);
  const hex = Math.floor(rng() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  const scientific = `NGC-${hex}`;
  const human = makeGalaxyHumanName(rng);
  return { human, scientific };
}

// ── Star ──────────────────────────────────────────────────────────────────

// Short, crisp, exotic 1–2 syllable names: Vega / Altair / Syrix / Kael feel.
const STAR_ONSETS = [
  'S', 'V', 'R', 'K', 'T', 'Z', 'Al', 'Bel', 'Syr', 'Kas',
  'Neb', 'Pyx', 'Lys', 'Arc', 'Tor', 'Ax', 'Ix', 'Vex', 'Zel',
  'Rig', 'Den', 'Mir', 'Aln', 'Sch',
] as const;
const STAR_VOWELS = [
  'i', 'a', 'e', 'o', 'ae', 'ei', 'au', 'ir', 'or', 'ia', 'al', 'el',
] as const;
const STAR_CODAS = [
  'x', 'r', 'n', 's', 'th', 'l', 'ur', 'ix', 'ax', 'ar', 'el', 'is', 'an',
] as const;

function makeStarHumanName(rng: () => number): string {
  const onset = pick(STAR_ONSETS, rng);
  const vowel = pick(STAR_VOWELS, rng);
  const coda = pick(STAR_CODAS, rng);
  // 30% chance of 2-syllable name
  if (rng() < 0.3) {
    const onset2 = pick(STAR_ONSETS, rng).toLowerCase();
    const vowel2 = pick(STAR_VOWELS, rng);
    const coda2 = pick(STAR_CODAS, rng);
    return onset + vowel + coda + onset2 + vowel2 + coda2;
  }
  return onset + vowel + coda;
}

function makeStarScientificName(rng: () => number): string {
  const r = rng();
  if (r < 0.40) {
    // HD: 4–6 digit number
    return `HD ${Math.floor(rng() * 199000) + 1000}`;
  } else if (r < 0.65) {
    // HIP: 6-digit padded
    return `HIP ${String(Math.floor(rng() * 99000) + 1000).padStart(6, '0')}`;
  } else if (r < 0.85) {
    // GJ: 3-digit number
    return `GJ ${Math.floor(rng() * 900) + 100}`;
  } else {
    // KOI: 4-digit number
    return `KOI-${Math.floor(rng() * 9000) + 1000}`;
  }
}

export function generateStarName(
  seed: string,
  starId: string,
  usedNames: Set<string>,
): { human: string; scientific: string } {
  const rng = seededPRNG(`${seed}_starname_${starId}`);
  const scientific = makeStarScientificName(rng);
  let human = makeStarHumanName(rng);
  for (let i = 0; i < 9 && usedNames.has(human); i++) {
    human = makeStarHumanName(rng);
  }
  usedNames.add(human);
  return { human, scientific };
}

// ── Planet ────────────────────────────────────────────────────────────────

// Divine / mythological 2–3 syllable names: Mars / Erelus / Davar / Orin feel.
const PLANET_ONSETS = [
  'Er', 'Dav', 'Or', 'Thal', 'Kep', 'Mor', 'Sol', 'Ves',
  'Hel', 'Cyr', 'Atr', 'Bor', 'Gal', 'Ith', 'Nar',
  'Rex', 'Pho', 'Ech', 'Val', 'Zor', 'Cor', 'Ast', 'Lun',
] as const;
const PLANET_MIDDLES = [
  'a', 'e', 'i', 'or', 'ar', 'en', 'al', 'is', 'ur', 'on',
] as const;
const PLANET_ENDINGS = [
  'us', 'is', 'ax', 'on', 'um', 'en', 'ia', 'a', 'os', 'ix', 'ur', 'id',
] as const;

function makePlanetHumanName(rng: () => number): string {
  const onset = pick(PLANET_ONSETS, rng);
  const ending = pick(PLANET_ENDINGS, rng);
  // 50% chance of 3-part (onset + middle + ending), 50% 2-part (onset + ending)
  if (rng() < 0.5) {
    return onset + pick(PLANET_MIDDLES, rng) + ending;
  }
  return onset + ending;
}

/**
 * Scientific name: `{primaryStarScientific} {Roman-numeral-orbit}` — e.g. "HD 149026 III".
 * `orbitIndex` is 0-based (first planet = 0 → "I").
 */
export function generatePlanetName(
  seed: string,
  planetId: string,
  starScientific: string,
  orbitIndex: number,
  usedNames: Set<string>,
): { human: string; scientific: string } {
  const rng = seededPRNG(`${seed}_planetname_${planetId}`);
  let human = makePlanetHumanName(rng);
  for (let i = 0; i < 9 && usedNames.has(human); i++) {
    human = makePlanetHumanName(rng);
  }
  usedNames.add(human);
  const scientific = `${starScientific} ${toRoman(orbitIndex + 1)}`;
  return { human, scientific };
}

// ── Satellite ─────────────────────────────────────────────────────────────

// Short mythological 1–2 syllable names: Io / Titan / Europa / Callisto feel.
const SAT_ONSETS = [
  'Ti', 'Eu', 'Ca', 'Ly', 'Rh', 'Ph', 'Ga', 'Ob', 'Tri',
  'Ner', 'La', 'De', 'Pro', 'Am', 'Hy', 'Mi', 'Cor', 'En',
  'Ari', 'Nym', 'Teth', 'Hel',
] as const;
const SAT_VOWELS = [
  'o', 'a', 'e', 'io', 'ia', 'ea', 'os', 'ae',
] as const;
const SAT_CODAS = [
  '', 's', 'n', 'x', 'e', 'a', 'is', 'ne', 'le', 'us',
] as const;

function makeSatelliteHumanName(rng: () => number): string {
  // 15% chance of short "Io"-style name
  if (rng() < 0.15) {
    return 'I' + pick(['o', 'a', 'ix', 'on', 'us', 'e'] as const, rng);
  }
  return pick(SAT_ONSETS, rng) + pick(SAT_VOWELS, rng) + pick(SAT_CODAS, rng);
}

/**
 * Scientific name: `{planetScientific}{moon-letter}` — e.g. "HD 149026 IIIa".
 * `moonIndex` is 0-based (first moon = 0 → 'a').
 */
export function generateSatelliteName(
  seed: string,
  satelliteId: string,
  planetScientific: string,
  moonIndex: number,
  usedNames: Set<string>,
): { human: string; scientific: string } {
  const rng = seededPRNG(`${seed}_satname_${satelliteId}`);
  let human = makeSatelliteHumanName(rng);
  for (let i = 0; i < 9 && usedNames.has(human); i++) {
    human = makeSatelliteHumanName(rng);
  }
  usedNames.add(human);
  const moonLetter = String.fromCharCode(97 + (moonIndex % 26));
  const scientific = `${planetScientific}${moonLetter}`;
  return { human, scientific };
}
