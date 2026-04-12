import type { RegionBiome } from './Region';
import type { TechField } from '../timeline/Tech';

/**
 * ResourceCatalog — declarative habitat-aware resource taxonomy.
 *
 * Pure const module: no runtime state, no RNG, safe to import from
 * simulation and renderer alike. See `specs/resources.md` (or the plan
 * file that produced this module) for the design rationale.
 *
 * Key design points:
 *  - 47 resource types in 12 fine-grained categories.
 *  - Each spec declares a `HabitatSpec` (biome whitelist + optional
 *    hydrology flags + optional soft-trapezoid climate ranges) and a
 *    `rarity` tier that drives both spawn probability and stockpile size.
 *  - `ResourceDomain[]` is a flavor facet (industry / trade / science /
 *    religion / art / military / food / luxury) — no consumer yet, but
 *    free for future features to read.
 *  - `getLegacyCategory` folds the 12 categories back onto the existing
 *    `strategic | agricultural | luxury` icon buckets used by the
 *    renderer so that `drawResources` in `renderer.ts` needs zero new art.
 *  - `selectPrimary` picks the most *distinctive* resource in a region
 *    (rarity rank + luxury/religion/art bonus) so the UI icon reflects
 *    the region's signature resource, not the first roll.
 */

// ---------------------------------------------------------------------------
// Type unions
// ---------------------------------------------------------------------------

export type ResourceType =
  // metals (8)
  | 'copper' | 'iron' | 'tin' | 'lead' | 'aluminium'
  | 'gold' | 'silver' | 'platinum'
  // energy (5)
  | 'coal' | 'oil' | 'natural_gas' | 'uranium' | 'peat'
  // stone (4)
  | 'marble' | 'granite' | 'limestone' | 'obsidian'
  // gems (4)
  | 'diamonds' | 'rubies' | 'sapphires' | 'jade'
  // livestock (4)
  | 'cattle' | 'sheep' | 'horses' | 'yak'
  // crops (5)
  | 'wheat' | 'rice' | 'maize' | 'barley' | 'dates'
  // cashCrops (5)
  | 'cotton' | 'tea' | 'coffee' | 'sugar' | 'tobacco'
  // forestry (3)
  | 'timber' | 'hardwood' | 'amber'
  // marine (3)
  | 'fish' | 'whales' | 'pearls'
  // spices (2)
  | 'pepper' | 'saffron'
  // textiles (1)
  | 'silk'
  // exotic (3)
  | 'ivory' | 'incense' | 'furs';

export type ResourceCategory =
  | 'metals'
  | 'energy'
  | 'stone'
  | 'gems'
  | 'livestock'
  | 'crops'
  | 'cashCrops'
  | 'forestry'
  | 'marine'
  | 'spices'
  | 'textiles'
  | 'exotic';

export type ResourceDomain =
  | 'industry'
  | 'trade'
  | 'science'
  | 'religion'
  | 'art'
  | 'military'
  | 'food'
  | 'luxury';

export type ResourceRarity = 'common' | 'uncommon' | 'rare' | 'veryRare';

/** Legacy 3-bucket category used by the renderer's existing icon code. */
export type LegacyResourceCategory = 'strategic' | 'agricultural' | 'luxury';

// ---------------------------------------------------------------------------
// Habitat / spec shape
// ---------------------------------------------------------------------------

/**
 * Soft trapezoid range. Two forms:
 *   [min, max]          → hard reject outside; flat 1.0 inside.
 *   [min, max, pMin, pMax] → hard reject outside [min,max]; flat 1.0 inside
 *                             [pMin, pMax]; linear ramp 0.25→1.0 on the
 *                             shoulders [min, pMin] and [pMax, max].
 */
export type ClimateRange =
  | readonly [number, number]
  | readonly [number, number, number, number];

export interface HabitatSpec {
  /** Hard gate — region's dominant biome must be in this list. */
  biomes?: readonly RegionBiome[];
  /** Soft trapezoid on `profile.meanTemperature` (0..1). */
  temperature?: ClimateRange;
  /** Soft trapezoid on `profile.meanMoisture` (0..1). */
  moisture?: ClimateRange;
  /** Soft trapezoid on `profile.maxElevation` (0..1). */
  elevation?: ClimateRange;
  /** Hard gate — region must have at least one coastal cell. */
  requiresCoast?: boolean;
  /** Hard gate — region must have at least one river cell (riverFlow > 4). */
  requiresRiver?: boolean;
  /** Hard gate — region must have at least one cell with elevation > 0.72. */
  requiresMountain?: boolean;
  /** Hard gate — region must have at least one inland lake cell. */
  requiresLake?: boolean;
  /** Hard gate — region's mountain fraction must be below 0.15. */
  forbidsMountain?: boolean;
}

export interface AbundanceDice {
  count: number;
  sides: number;
  bonus: number;
}

export interface ResourceSpec {
  type: ResourceType;
  category: ResourceCategory;
  domains: readonly ResourceDomain[];
  habitat: HabitatSpec;
  rarity: ResourceRarity;
  abundance: AbundanceDice;
}

// ---------------------------------------------------------------------------
// Rarity tables (weight + abundance dice)
// ---------------------------------------------------------------------------

/**
 * Three named presets for resource spawn probability.
 * The canonical type is `ResourceRarityMode` in `types.ts`.
 * Keeping the Record key as a plain string union here avoids a circular
 * import through Region.ts → types.ts.
 */
export const RARITY_WEIGHTS_BY_MODE: Record<'scarce' | 'natural' | 'abundant', Record<ResourceRarity, number>> = {
  /** Rare resources spawn infrequently — a challenging world. */
  scarce:   { common: 100, uncommon: 40, rare: 15,  veryRare: 8  },
  /** Doubles the spawn chance of rare/veryRare vs. scarce. Default. */
  natural:  { common: 100, uncommon: 40, rare: 30,  veryRare: 16 },
  /** All tiers spawn more freely — a resource-rich world. */
  abundant: { common: 120, uncommon: 60, rare: 25,  veryRare: 15 },
};

/** Convenience alias: the scarce-mode weights (used as the fallback default). */
export const RARITY_WEIGHTS: Record<ResourceRarity, number> = RARITY_WEIGHTS_BY_MODE.scarce;

/**
 * Abundance dice shared by every rarity tier. Matches the legacy
 * `10d10+20` roll (range 30..120, mean ~75) one-for-one so the RNG
 * consumption pattern of resource generation is byte-identical to the
 * pre-refactor code. Rarity still influences *which* resource types
 * spawn (via `RARITY_WEIGHTS`), but not *how much* stockpile they start
 * with — keeping the sweep within the Phase 4 quality gates.
 */
const STANDARD_ABUNDANCE: AbundanceDice = { count: 10, sides: 10, bonus: 20 };

const ABUNDANCE_BY_RARITY: Record<ResourceRarity, AbundanceDice> = {
  common: STANDARD_ABUNDANCE,
  uncommon: STANDARD_ABUNDANCE,
  rare: STANDARD_ABUNDANCE,
  veryRare: STANDARD_ABUNDANCE,
};

// ---------------------------------------------------------------------------
// The catalog (47 entries)
// ---------------------------------------------------------------------------

/**
 * Compact builder — fills in `abundance` from the rarity tier so each
 * entry focuses on category/domains/habitat/rarity, which is where the
 * design choices live.
 */
function spec(
  type: ResourceType,
  category: ResourceCategory,
  domains: readonly ResourceDomain[],
  habitat: HabitatSpec,
  rarity: ResourceRarity,
): ResourceSpec {
  return { type, category, domains, habitat, rarity, abundance: ABUNDANCE_BY_RARITY[rarity] };
}

export const RESOURCE_SPECS: readonly ResourceSpec[] = [
  // ---------------- metals ----------------
  spec('copper', 'metals', ['industry', 'military'],
    { biomes: ['temperate', 'arid', 'tropical'], requiresMountain: true }, 'common'),
  spec('iron', 'metals', ['industry', 'military'],
    { biomes: ['temperate', 'arid', 'tundra'], requiresMountain: true }, 'common'),
  spec('tin', 'metals', ['industry', 'military'],
    { biomes: ['temperate', 'arid'], requiresMountain: true }, 'uncommon'),
  spec('lead', 'metals', ['industry'],
    { biomes: ['temperate', 'arid'], requiresMountain: true }, 'uncommon'),
  spec('aluminium', 'metals', ['industry'],
    { biomes: ['tropical', 'arid'], requiresMountain: true }, 'rare'),
  spec('gold', 'metals', ['luxury', 'trade', 'art'],
    { biomes: ['arid', 'tropical', 'temperate'] }, 'rare'),
  spec('silver', 'metals', ['luxury', 'trade'],
    { biomes: ['arid', 'temperate'], requiresMountain: true }, 'uncommon'),
  spec('platinum', 'metals', ['luxury', 'industry', 'science'],
    { biomes: ['temperate', 'tundra'], requiresMountain: true, temperature: [0, 0.5] }, 'veryRare'),

  // ---------------- energy ----------------
  spec('coal', 'energy', ['industry', 'military'],
    { biomes: ['temperate', 'tundra'] }, 'common'),
  spec('oil', 'energy', ['industry', 'military', 'trade'],
    { biomes: ['arid', 'desert', 'tundra'], moisture: [0, 0.5] }, 'uncommon'),
  spec('natural_gas', 'energy', ['industry'],
    { biomes: ['arid', 'desert', 'tundra'] }, 'uncommon'),
  spec('uranium', 'energy', ['science', 'military'],
    { biomes: ['tundra', 'arid'], requiresMountain: true }, 'veryRare'),
  spec('peat', 'energy', ['industry'],
    { biomes: ['swamp', 'tundra'], moisture: [0.55, 1] }, 'uncommon'),

  // ---------------- stone ----------------
  spec('marble', 'stone', ['art', 'religion', 'trade'],
    { biomes: ['temperate', 'arid'], requiresMountain: true }, 'uncommon'),
  spec('granite', 'stone', ['industry'],
    { biomes: ['temperate', 'tundra'], requiresMountain: true }, 'common'),
  spec('limestone', 'stone', ['industry', 'religion'],
    { biomes: ['temperate', 'arid'] }, 'common'),
  spec('obsidian', 'stone', ['military', 'art', 'religion'],
    { biomes: ['arid', 'desert', 'temperate'], requiresMountain: true, temperature: [0.45, 1] }, 'rare'),

  // ---------------- gems ----------------
  spec('diamonds', 'gems', ['luxury', 'trade', 'science'],
    { biomes: ['tropical', 'temperate'], requiresMountain: true }, 'veryRare'),
  spec('rubies', 'gems', ['luxury', 'art', 'religion'],
    { biomes: ['tropical'], requiresMountain: true }, 'rare'),
  spec('sapphires', 'gems', ['luxury', 'art'],
    { biomes: ['temperate', 'tropical'], requiresMountain: true }, 'rare'),
  spec('jade', 'gems', ['luxury', 'art', 'religion'],
    { biomes: ['tropical', 'temperate'], requiresMountain: true }, 'uncommon'),

  // ---------------- livestock ----------------
  spec('cattle', 'livestock', ['food', 'trade'],
    { biomes: ['temperate', 'arid'], moisture: [0.25, 1, 0.35, 0.85], temperature: [0.3, 0.85, 0.4, 0.75] }, 'common'),
  spec('sheep', 'livestock', ['food', 'trade'],
    { biomes: ['temperate', 'arid', 'tundra'], temperature: [0.1, 0.75, 0.2, 0.65] }, 'common'),
  spec('horses', 'livestock', ['military', 'trade'],
    { biomes: ['temperate', 'arid'], moisture: [0.2, 0.8, 0.3, 0.7] }, 'uncommon'),
  spec('yak', 'livestock', ['food'],
    { biomes: ['tundra', 'temperate'], requiresMountain: true, temperature: [0, 0.45] }, 'rare'),

  // ---------------- crops ----------------
  spec('wheat', 'crops', ['food', 'trade'],
    { biomes: ['temperate', 'arid'], moisture: [0.3, 0.9, 0.4, 0.8], temperature: [0.3, 0.8, 0.4, 0.7] }, 'common'),
  spec('rice', 'crops', ['food', 'trade'],
    { biomes: ['tropical', 'swamp', 'temperate'], moisture: [0.55, 1, 0.7, 1], requiresRiver: true }, 'common'),
  spec('maize', 'crops', ['food', 'trade'],
    { biomes: ['temperate', 'tropical', 'arid'], moisture: [0.25, 0.9, 0.35, 0.8] }, 'common'),
  spec('barley', 'crops', ['food'],
    { biomes: ['temperate', 'tundra'], temperature: [0.1, 0.65, 0.2, 0.55] }, 'common'),
  spec('dates', 'crops', ['food', 'trade'],
    { biomes: ['desert', 'arid'], requiresRiver: true, temperature: [0.6, 1, 0.75, 1] }, 'uncommon'),

  // ---------------- cashCrops ----------------
  spec('cotton', 'cashCrops', ['trade', 'industry'],
    { biomes: ['arid', 'tropical'], temperature: [0.5, 1, 0.6, 0.9], moisture: [0.25, 0.85, 0.35, 0.75] }, 'uncommon'),
  spec('tea', 'cashCrops', ['trade', 'luxury', 'art'],
    { biomes: ['tropical', 'temperate'], requiresMountain: true, moisture: [0.55, 1, 0.65, 0.95] }, 'uncommon'),
  spec('coffee', 'cashCrops', ['trade', 'luxury'],
    { biomes: ['tropical'], requiresMountain: true, temperature: [0.5, 0.95, 0.6, 0.9] }, 'uncommon'),
  spec('sugar', 'cashCrops', ['trade', 'food', 'luxury'],
    { biomes: ['tropical', 'swamp'], moisture: [0.5, 1, 0.6, 0.95] }, 'uncommon'),
  spec('tobacco', 'cashCrops', ['trade', 'luxury'],
    { biomes: ['temperate', 'tropical'], moisture: [0.35, 0.9, 0.45, 0.8] }, 'uncommon'),

  // ---------------- forestry ----------------
  spec('timber', 'forestry', ['industry', 'trade'],
    { biomes: ['temperate', 'tropical', 'tundra'], moisture: [0.35, 1, 0.5, 1] }, 'common'),
  spec('hardwood', 'forestry', ['industry', 'art', 'trade'],
    { biomes: ['tropical'], moisture: [0.6, 1, 0.7, 1], temperature: [0.55, 1, 0.7, 1] }, 'uncommon'),
  spec('amber', 'forestry', ['luxury', 'art', 'religion'],
    { biomes: ['temperate', 'tundra'], temperature: [0, 0.55, 0.1, 0.45], requiresCoast: true }, 'rare'),

  // ---------------- marine ----------------
  spec('fish', 'marine', ['food', 'trade'],
    { requiresCoast: true }, 'common'),
  spec('whales', 'marine', ['industry', 'trade'],
    { biomes: ['tundra', 'temperate'], requiresCoast: true, temperature: [0, 0.55, 0.05, 0.4] }, 'uncommon'),
  spec('pearls', 'marine', ['luxury', 'art', 'religion'],
    { biomes: ['tropical'], requiresCoast: true, temperature: [0.6, 1, 0.7, 1] }, 'rare'),

  // ---------------- spices ----------------
  spec('pepper', 'spices', ['trade', 'luxury', 'food'],
    { biomes: ['tropical'], moisture: [0.55, 1, 0.7, 1] }, 'uncommon'),
  spec('saffron', 'spices', ['trade', 'luxury', 'art'],
    { biomes: ['arid', 'temperate'], temperature: [0.4, 0.85, 0.5, 0.75], moisture: [0.15, 0.6, 0.25, 0.5] }, 'veryRare'),

  // ---------------- textiles ----------------
  spec('silk', 'textiles', ['luxury', 'trade', 'art'],
    { biomes: ['temperate', 'tropical'], moisture: [0.4, 0.95, 0.55, 0.85], temperature: [0.4, 0.9, 0.5, 0.8] }, 'rare'),

  // ---------------- exotic ----------------
  spec('ivory', 'exotic', ['luxury', 'art', 'religion', 'trade'],
    { biomes: ['tropical', 'arid'] }, 'rare'),
  spec('incense', 'exotic', ['religion', 'luxury', 'trade'],
    { biomes: ['desert', 'arid'], moisture: [0, 0.45] }, 'rare'),
  spec('furs', 'exotic', ['luxury', 'trade'],
    { biomes: ['tundra', 'temperate'], temperature: [0, 0.5, 0.05, 0.4], moisture: [0.25, 1] }, 'uncommon'),
];

// ---------------------------------------------------------------------------
// Lookup + helper functions
// ---------------------------------------------------------------------------

/** Built once at module load from the array. Iteration order = array order. */
export const RESOURCE_SPEC_BY_TYPE: ReadonlyMap<ResourceType, ResourceSpec> = (() => {
  const m = new Map<ResourceType, ResourceSpec>();
  for (const s of RESOURCE_SPECS) m.set(s.type, s);
  return m;
})();

export function getResourceSpec(type: ResourceType): ResourceSpec {
  const s = RESOURCE_SPEC_BY_TYPE.get(type);
  if (!s) throw new Error(`Unknown resource type: ${type}`);
  return s;
}

export function getResourceCategory(type: ResourceType): ResourceCategory {
  return getResourceSpec(type).category;
}

/**
 * Fold the 12 fine-grained categories onto the three icon buckets the
 * renderer already draws (strategic / agricultural / luxury). Keeps
 * `drawResources` in `renderer.ts` unchanged.
 */
export function getLegacyCategory(type: ResourceType): LegacyResourceCategory {
  const category = getResourceCategory(type);
  switch (category) {
    case 'metals':
    case 'energy':
    case 'stone':
      return 'strategic';
    case 'livestock':
    case 'crops':
    case 'cashCrops':
    case 'forestry':
    case 'marine':
      return 'agricultural';
    case 'gems':
    case 'spices':
    case 'textiles':
    case 'exotic':
      return 'luxury';
  }
}

// ---------------------------------------------------------------------------
// Primary-resource selection
// ---------------------------------------------------------------------------

const RARITY_RANK: Record<ResourceRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  veryRare: 4,
};

function domainFlairBonus(spec: ResourceSpec): number {
  if (spec.domains.includes('luxury')) return 2;
  if (spec.domains.includes('religion') || spec.domains.includes('art')) return 1;
  return 0;
}

function priorityScore(spec: ResourceSpec): number {
  return RARITY_RANK[spec.rarity] * 10 + domainFlairBonus(spec);
}

/**
 * Pick the most *distinctive* resource in a region to display as the
 * region's primary icon. Deterministic and pure — never consumes `rng()`.
 *
 * Uses rarity rank first (veryRare > rare > uncommon > common), then a
 * small domain-flair bonus (+2 for luxury, +1 for religion/art), then
 * falls back to `RESOURCE_SPECS` array order for a stable tie-break.
 *
 * Accepts a minimal structural type (`{ type: ResourceType }[]`) so this
 * module does not need to runtime-import the `Resource` class.
 */
export function selectPrimary(
  resources: ReadonlyArray<{ type: string }>,
): ResourceType | undefined {
  if (resources.length === 0) return undefined;
  let bestType: ResourceType | undefined;
  let bestScore = -Infinity;
  let bestOrder = Infinity;
  for (const r of resources) {
    const s = RESOURCE_SPEC_BY_TYPE.get(r.type as ResourceType);
    if (!s) continue;
    const score = priorityScore(s);
    const order = RESOURCE_SPECS.indexOf(s);
    if (score > bestScore || (score === bestScore && order < bestOrder)) {
      bestScore = score;
      bestOrder = order;
      bestType = s.type;
    }
  }
  return bestType;
}

// ---------------------------------------------------------------------------
// Tech-gated discovery requirements
// ---------------------------------------------------------------------------

/**
 * Minimum tech investment a country needs to "discover" (unlock for trade)
 * a resource of a given (category, rarity). Pure static lookup — no RNG,
 * resolved at `Resource` construction time and again at discovery ticks.
 *
 * Design: `exploration` gates most categories (the generic "we know what
 * this is and how to extract it" knob). `industry` gates rare/veryRare
 * metals and refined energy (oil, coal-advanced). `science` gates the
 * late-game luxuries — uranium, diamonds, platinum — that only make sense
 * once a civilization has invested in hard scientific knowledge.
 *
 * Every `common` entry must be level 0 so early-game trade is unaffected
 * (bootstrap in `history.ts` year-0 adds them to `discoveredResources`).
 * The `_assertRequirementTableComplete` check below enforces that rule.
 */
export interface ResourceTechRequirement {
  readonly field: TechField;
  readonly level: number;
}

const L0_EXPLORATION: ResourceTechRequirement = { field: 'exploration', level: 0 };

export const RESOURCE_TECH_REQUIREMENT: Record<ResourceCategory, Record<ResourceRarity, ResourceTechRequirement>> = {
  crops: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  livestock: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  forestry: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  marine: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 3 },
    veryRare: { field: 'exploration', level: 5 },
  },
  stone: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  metals: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'industry',    level: 2 },
    veryRare: { field: 'industry',    level: 4 },
  },
  energy: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'industry',    level: 3 },
    veryRare: { field: 'science',     level: 4 },
  },
  gems: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 3 },
    veryRare: { field: 'science',     level: 3 },
  },
  cashCrops: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  spices: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  textiles: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 2 },
    veryRare: { field: 'exploration', level: 4 },
  },
  exotic: {
    common:   L0_EXPLORATION,
    uncommon: L0_EXPLORATION,
    rare:     { field: 'exploration', level: 3 },
    veryRare: { field: 'exploration', level: 5 },
  },
};

/** Pure lookup: returns the tech requirement for a given resource type. */
export function getResourceTechRequirement(type: ResourceType): ResourceTechRequirement {
  const s = getResourceSpec(type);
  return RESOURCE_TECH_REQUIREMENT[s.category][s.rarity];
}

/**
 * True if the resource's requirement is exactly `exploration 0` — i.e. it is
 * available to every civilization from year 0 with no tech investment. Used
 * by `history.ts` to bootstrap `Region.discoveredResources` at world birth.
 */
export function isCommonUnlockedAtZero(type: ResourceType): boolean {
  const req = getResourceTechRequirement(type);
  return req.field === 'exploration' && req.level === 0;
}

// One-shot sanity check — mirrors the `_assertTechAdjacencySymmetric` pattern
// in `timeline/Tech.ts`. Asserts (a) the table covers every
// (category × rarity) pair, (b) levels are non-negative integers, and (c)
// rarity levels are monotonically non-decreasing within a category when they
// stay on the same field (a rare copper can't be easier to unlock than an
// uncommon copper). Different fields across rarities are allowed — see
// `metals` where uncommon is exploration-2 and rare jumps to industry-3.
// Common entries may be L0 or L1; the bootstrap in `history.ts` only treats
// true `exploration 0` entries as pre-discovered at year 0.
(function _assertRequirementTableComplete(): void {
  const categories: ResourceCategory[] = [
    'metals', 'energy', 'stone', 'gems', 'livestock', 'crops',
    'cashCrops', 'forestry', 'marine', 'spices', 'textiles', 'exotic',
  ];
  const rarities: ResourceRarity[] = ['common', 'uncommon', 'rare', 'veryRare'];
  for (const cat of categories) {
    const row = RESOURCE_TECH_REQUIREMENT[cat];
    if (!row) throw new Error(`RESOURCE_TECH_REQUIREMENT missing category: ${cat}`);
    let prev: ResourceTechRequirement | null = null;
    for (const rar of rarities) {
      const req = row[rar];
      if (!req) throw new Error(`RESOURCE_TECH_REQUIREMENT missing ${cat}/${rar}`);
      if (!Number.isInteger(req.level) || req.level < 0) {
        throw new Error(`RESOURCE_TECH_REQUIREMENT bad level for ${cat}/${rar}: ${req.level}`);
      }
      if (prev && prev.field === req.field && req.level < prev.level) {
        throw new Error(
          `RESOURCE_TECH_REQUIREMENT non-monotonic for ${cat}/${rar}: ` +
          `${req.field} ${req.level} < previous ${prev.field} ${prev.level}`,
        );
      }
      prev = req;
    }
  }
})();
