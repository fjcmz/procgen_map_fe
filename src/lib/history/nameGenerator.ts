/**
 * Procedural name generators for cities, countries, and empires.
 * All randomness goes through the seeded `rng` for deterministic output.
 */

// ── City Name Generator ─────────────────────────────────────────────────────

const ONSETS = [
  'b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w',
  'br', 'cr', 'dr', 'fr', 'gr', 'kr', 'pr', 'tr', 'vr',
  'bl', 'cl', 'fl', 'gl', 'pl', 'sl',
  'ch', 'sh', 'th', 'sk', 'sp', 'st', 'sw', 'kh', 'zh',
];

const VOWELS = [
  'a', 'e', 'i', 'o', 'u',
  'ae', 'ai', 'au', 'ei', 'ou',
  'al', 'ar', 'an', 'en', 'or', 'ir', 'ur', 'ol', 'el', 'un',
];

const CODAS = [
  'n', 'r', 'm', 'l', 's', 'x', 'd', 'th', 'k',
  'nd', 'rk', 'lm', 'rd', 'st', 'nt', 'ng', 'rn', 'rm', 'lt', 'ld',
  'ns', 'rs', 'nk', 'lk', 'rt',
];

/** Optional fantasy suffixes that can replace the final syllable's coda. */
const CITY_SUFFIXES = [
  'vale', 'holm', 'gate', 'ford', 'bury', 'fell', 'keep', 'watch',
  'haven', 'crest', 'reach', 'mire', 'moor', 'dale', 'mere', 'spire',
  'wall', 'hold', 'mark', 'wood', 'wick', 'ton', 'stead', 'helm',
  'rock', 'peak', 'port', 'bridge', 'well', 'stone',
];

function generateSyllable(rng: () => number): string {
  const onset = ONSETS[Math.floor(rng() * ONSETS.length)];
  const vowel = VOWELS[Math.floor(rng() * VOWELS.length)];
  const coda = CODAS[Math.floor(rng() * CODAS.length)];
  return onset + vowel + coda;
}

function generateRawCityName(rng: () => number): string {
  const r = rng();
  // 70% two-syllable, 30% three-syllable
  const syllableCount = r < 0.7 ? 2 : 3;

  // 35% chance the final element is a fantasy suffix instead of a full syllable
  const useSuffix = rng() < 0.35;

  const parts: string[] = [];
  const syllablesToGenerate = useSuffix ? syllableCount - 1 : syllableCount;

  for (let i = 0; i < syllablesToGenerate; i++) {
    parts.push(generateSyllable(rng));
  }

  if (useSuffix) {
    parts.push(CITY_SUFFIXES[Math.floor(rng() * CITY_SUFFIXES.length)]);
  }

  const name = parts.join('');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Generate a unique city name using syllable combination.
 * Checks against `usedNames` set and retries up to 50 times.
 * Falls back to a numeric suffix if all retries fail.
 */
export function generateCityName(rng: () => number, usedNames: Set<string>): string {
  let name = generateRawCityName(rng);
  let attempts = 0;
  while (usedNames.has(name) && attempts < 50) {
    name = generateRawCityName(rng);
    attempts++;
  }
  if (usedNames.has(name)) {
    // Extremely unlikely fallback: append a number
    let suffix = 2;
    while (usedNames.has(`${name} ${suffix}`)) suffix++;
    name = `${name} ${suffix}`;
  }
  usedNames.add(name);
  return name;
}

// ── Country Name Generator ──────────────────────────────────────────────────

const COUNTRY_ROOTS = [
  'Vald', 'Keth', 'Morn', 'Dral', 'Fen', 'Gal', 'Hyr', 'Lor', 'Thal',
  'Bren', 'Cor', 'Eld', 'Arn', 'Sar', 'Quel', 'Rav', 'Dun', 'Vel',
  'Ash', 'Cael', 'Gor', 'Mal', 'Nor', 'Tar', 'Zeph', 'Ith', 'Ur',
  'Syl', 'Bor', 'Dorn', 'Fal', 'Grim', 'Hal', 'Kal', 'Myr', 'Ost',
  'Pyr', 'Sel', 'Tyr', 'Var', 'Wyr', 'Xen', 'Ael', 'Cyr', 'Esk',
  'Orm', 'Ral', 'Sul', 'Vol', 'Zan',
];

const COUNTRY_SUFFIXES = [
  'eria', 'heim', 'land', 'ar', 'os', 'ia', 'ium', 'ath',
  'orn', 'an', 'mark', 'wen', 'dale', 'or', 'is', 'un',
  'eth', 'ond', 'ire', 'ael', 'ur', 'avar', 'oth', 'enn',
];

function generateRawCountryName(rng: () => number): string {
  const root = COUNTRY_ROOTS[Math.floor(rng() * COUNTRY_ROOTS.length)];
  const suffix = COUNTRY_SUFFIXES[Math.floor(rng() * COUNTRY_SUFFIXES.length)];
  return root + suffix;
}

/**
 * Generate a unique country name using root + suffix combination.
 * Checks against `usedNames` set and retries up to 50 times.
 */
export function generateCountryName(rng: () => number, usedNames: Set<string>): string {
  let name = generateRawCountryName(rng);
  let attempts = 0;
  while (usedNames.has(name) && attempts < 50) {
    name = generateRawCountryName(rng);
    attempts++;
  }
  usedNames.add(name);
  return name;
}

// ── Empire Name Generator ───────────────────────────────────────────────────

const EMPIRE_TEMPLATES = [
  'Kingdom of {name}',
  'Empire of {name}',
  'The {name} Dominion',
  'Grand Duchy of {name}',
  '{name} Confederation',
  'Holy {name} Empire',
  'The {name} Accord',
  'United {name}',
  '{name} Commonwealth',
  'The {name} Realm',
  'Sovereignty of {name}',
  'The {name} Hegemony',
  '{name} Protectorate',
  'The {name} Alliance',
  'Republic of {name}',
  '{name} Federation',
  'The {name} Covenant',
  'Principality of {name}',
  'The {name} Imperium',
  '{name} Dynasty',
  'The {name} Dominance',
  'League of {name}',
  'The {name} Regency',
  '{name} Khanate',
  'The {name} Compact',
  'Sultanate of {name}',
  '{name} Triumvirate',
  'The {name} Sovereignty',
  'Caliphate of {name}',
  '{name} Collective',
  'The {name} Pact',
  'Shogunate of {name}',
  '{name} Hegemony',
  'The {name} Consortium',
  'Archduchy of {name}',
  '{name} Ascendancy',
  'The {name} Concord',
  'Mandate of {name}',
  '{name} Suzerainty',
  'The {name} Order',
  'Viceroyalty of {name}',
  '{name} Oligarchy',
  'The {name} Hierarchy',
  'Emirate of {name}',
  '{name} Dominion',
  'The {name} Tribunal',
  'Theocracy of {name}',
  '{name} Syndicate',
  'The {name} Union',
  'Protectorate of {name}',
  'Exarchate of {name}',
  '{name} Autocracy',
  'The {name} Crown',
  'Regency of {name}',
];

/**
 * Generate an empire name from a template and the founder country's name.
 * Each empire should cache its name on first generation (caller responsibility).
 */
export function generateEmpireName(rng: () => number, founderCountryName: string): string {
  const template = EMPIRE_TEMPLATES[Math.floor(rng() * EMPIRE_TEMPLATES.length)];
  return template.replace('{name}', founderCountryName);
}
