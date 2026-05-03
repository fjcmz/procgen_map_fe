import { PROFILES, SHAPE_PROFILES, PROFILE_WATER_RATIOS } from '../terrain/profiles';
import {
  PACK_SCHEMA_VERSION,
  type ExtensionPack,
  type PackedPalette,
  type PackedRollRule,
} from './types';

/**
 * The built-in catalogue, encoded in the pack format. The registry seeds itself
 * from this object so loaded packs and built-ins compose through one code path.
 *
 * IMPORTANT: this data MUST reproduce the existing hardcoded behaviour byte-
 * identically. The roll rules below mirror the original `pickPlanetSubtype` /
 * `pickSatelliteSubtype` / `pickBiome` branches exactly: same conditions, same
 * thresholds, same per-branch rng() count. A self-test in the universe worker
 * verifies this on startup.
 */

const PLANET_PALETTES: Record<string, PackedPalette> = {
  // ROCK
  terrestrial: { base: '#4a8ab8', accent: '#9ad0c8', shadow: '#1f3850' },
  desert:      { base: '#d4a06a', accent: '#f0c890', shadow: '#5a3818' },
  volcanic:    { base: '#3a2418', accent: '#7a4830', shadow: '#100804', hot: '#e84818' },
  lava:        { base: '#c83a18', accent: '#ffb040', shadow: '#400808', hot: '#ffd060' },
  iron:        { base: '#a05538', accent: '#d08868', shadow: '#3a1808' },
  carbon:      { base: '#2c2a2a', accent: '#5a5858', shadow: '#0c0c0c' },
  ocean:       { base: '#2a6aa8', accent: '#6ac0e8', shadow: '#0a2848' },
  ice_rock:    { base: '#a8c0d0', accent: '#e8f4fc', shadow: '#506878' },
  // GAS
  jovian:        { base: '#c89a64', accent: '#f0d4a0', shadow: '#583820',
                   bands: ['#e8c898', '#a87848', '#d4a878', '#8a5828', '#e0bc88'] },
  hot_jupiter:   { base: '#b8401c', accent: '#ffa050', shadow: '#380808',
                   bands: ['#e88840', '#982818', '#d8602c', '#601808', '#f09858'] },
  ice_giant:     { base: '#7ab8d0', accent: '#ccecf8', shadow: '#1a4858',
                   bands: ['#bce0ec', '#5a98b8', '#9acce0', '#3878a0', '#a8d8e8'] },
  methane_giant: { base: '#3868b8', accent: '#90b8e8', shadow: '#08183f',
                   bands: ['#7aa8e0', '#1848a0', '#5888d0', '#0a2870', '#88b0e0'] },
  ammonia_giant: { base: '#e8d8a0', accent: '#fff4c8', shadow: '#604818',
                   bands: ['#fff0c0', '#c8b878', '#f0e0a8', '#a89848', '#fff8d0'] },
};

const SATELLITE_PALETTES: Record<string, PackedPalette> = {
  water_ice:    { base: '#dde8f0', accent: '#fafdff', shadow: '#90a0b0' },
  methane_ice:  { base: '#e8c0c0', accent: '#fadcdc', shadow: '#806060' },
  sulfur_ice:   { base: '#f0e088', accent: '#fff8c0', shadow: '#807038' },
  nitrogen_ice: { base: '#c0d0d8', accent: '#e8f0f4', shadow: '#607080' },
  dirty_ice:    { base: '#b8b0a0', accent: '#d8d0c0', shadow: '#605850' },
  terrestrial:  { base: '#9a8e80', accent: '#c8bcaa', shadow: '#403828' },
  cratered:     { base: '#7a7470', accent: '#a8a098', shadow: '#302820' },
  volcanic:     { base: '#3c2c20', accent: '#785838', shadow: '#100804', hot: '#d04018' },
  iron_rich:    { base: '#a06848', accent: '#c89070', shadow: '#402010' },
  desert_moon:  { base: '#c89868', accent: '#e8bc88', shadow: '#604018' },
};

const BIOME_PALETTES: Record<string, PackedPalette> = {
  default:   { base: '#5fa86a', accent: '#a0e0a8', shadow: '#1a3820' },
  forest:    { base: '#3a7a3c', accent: '#7ac870', shadow: '#0a2810' },
  ocean:     { base: '#2a6aa8', accent: '#6ac0e8', shadow: '#0a2848' },
  desert:    { base: '#d4a06a', accent: '#f0c890', shadow: '#5a3818' },
  swamp:     { base: '#5a6a3a', accent: '#90a868', shadow: '#1a2010' },
  ice:       { base: '#a8c0d0', accent: '#e8f4fc', shadow: '#506878' },
  mountains: { base: '#8a8478', accent: '#c0baa8', shadow: '#403830' },
};

/**
 * Roll rules encoding the original `pickPlanetSubtype`. Order matters — first
 * match wins. Rules consume 0 (fixed) or 1 (thresholds/uniform) rng() calls,
 * matching the original branch structure exactly.
 */
const PLANET_ROLL_RULES: PackedRollRule[] = [
  // ROCK + life: deterministic biome → subtype, no rng() consumed.
  { name: 'rock-life-default',   match: { composition: 'ROCK', life: true, biome: 'default' },   pick: { kind: 'fixed', subtype: 'terrestrial' } },
  { name: 'rock-life-forest',    match: { composition: 'ROCK', life: true, biome: 'forest' },    pick: { kind: 'fixed', subtype: 'terrestrial' } },
  { name: 'rock-life-ocean',     match: { composition: 'ROCK', life: true, biome: 'ocean' },     pick: { kind: 'fixed', subtype: 'ocean' } },
  { name: 'rock-life-desert',    match: { composition: 'ROCK', life: true, biome: 'desert' },    pick: { kind: 'fixed', subtype: 'desert' } },
  { name: 'rock-life-swamp',     match: { composition: 'ROCK', life: true, biome: 'swamp' },     pick: { kind: 'fixed', subtype: 'terrestrial' } },
  { name: 'rock-life-ice',       match: { composition: 'ROCK', life: true, biome: 'ice' },       pick: { kind: 'fixed', subtype: 'ice_rock' } },
  { name: 'rock-life-mountains', match: { composition: 'ROCK', life: true, biome: 'mountains' }, pick: { kind: 'fixed', subtype: 'terrestrial' } },
  // ROCK no-life or no-biome — orbit-banded, one rng() per branch.
  { name: 'rock-inner', match: { composition: 'ROCK', orbitMax: 6 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.45, subtype: 'lava' },
      { until: 0.75, subtype: 'volcanic' },
      { until: 0.90, subtype: 'iron' },
      { until: 1.0,  subtype: 'desert' },
    ] } },
  { name: 'rock-mid', match: { composition: 'ROCK', orbitMax: 12 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.30, subtype: 'desert' },
      { until: 0.50, subtype: 'terrestrial' },
      { until: 0.65, subtype: 'iron' },
      { until: 0.78, subtype: 'volcanic' },
      { until: 0.88, subtype: 'ocean' },
      { until: 0.95, subtype: 'carbon' },
      { until: 1.0,  subtype: 'ice_rock' },
    ] } },
  { name: 'rock-outer', match: { composition: 'ROCK' },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.45, subtype: 'ice_rock' },
      { until: 0.70, subtype: 'carbon' },
      { until: 0.85, subtype: 'iron' },
      { until: 0.95, subtype: 'desert' },
      { until: 1.0,  subtype: 'terrestrial' },
    ] } },
  // GAS — orbit-banded.
  { name: 'gas-inner', match: { composition: 'GAS', orbitMax: 12 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.55, subtype: 'hot_jupiter' },
      { until: 0.85, subtype: 'jovian' },
      { until: 1.0,  subtype: 'ammonia_giant' },
    ] } },
  { name: 'gas-mid', match: { composition: 'GAS', orbitMax: 18 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.45, subtype: 'jovian' },
      { until: 0.70, subtype: 'ammonia_giant' },
      { until: 0.88, subtype: 'methane_giant' },
      { until: 1.0,  subtype: 'ice_giant' },
    ] } },
  { name: 'gas-outer', match: { composition: 'GAS' },
    pick: { kind: 'uniform', subtypes: ['ice_giant', 'methane_giant', 'ammonia_giant'] } },
];

/** Encodes original `pickSatelliteSubtype`. */
const SATELLITE_ROLL_RULES: PackedRollRule[] = [
  // ROCK + life: deterministic. Order matters — desert rule first so it wins
  // over the generic life rule for desert-biome moons.
  { name: 'rock-life-desert', match: { composition: 'ROCK', life: true, biome: 'desert' }, pick: { kind: 'fixed', subtype: 'desert_moon' } },
  { name: 'rock-life',        match: { composition: 'ROCK', life: true },                  pick: { kind: 'fixed', subtype: 'terrestrial' } },
  // ROCK no-life — parent-orbit banded.
  { name: 'rock-inner', match: { composition: 'ROCK', parentOrbitMax: 8 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.40, subtype: 'volcanic' },
      { until: 0.65, subtype: 'iron_rich' },
      { until: 0.85, subtype: 'cratered' },
      { until: 1.0,  subtype: 'desert_moon' },
    ] } },
  { name: 'rock-outer', match: { composition: 'ROCK' },
    pick: { kind: 'uniform', subtypes: ['cratered', 'terrestrial', 'iron_rich', 'desert_moon'] } },
  // ICE — parent-orbit banded.
  { name: 'ice-inner', match: { composition: 'ICE', parentOrbitMax: 10 },
    pick: { kind: 'thresholds', thresholds: [
      { until: 0.45, subtype: 'water_ice' },
      { until: 0.70, subtype: 'sulfur_ice' },
      { until: 0.90, subtype: 'dirty_ice' },
      { until: 1.0,  subtype: 'methane_ice' },
    ] } },
  { name: 'ice-outer', match: { composition: 'ICE' },
    pick: { kind: 'uniform', subtypes: ['water_ice', 'methane_ice', 'nitrogen_ice', 'dirty_ice', 'sulfur_ice'] } },
];

/** Encodes the original `pickBiome` 40/10/10/10/10/10/10 distribution. */
const BIOME_WEIGHTS: { until: number; biome: string }[] = [
  { until: 0.40, biome: 'default' },
  { until: 0.50, biome: 'desert' },
  { until: 0.60, biome: 'ice' },
  { until: 0.70, biome: 'forest' },
  { until: 0.80, biome: 'swamp' },
  { until: 0.90, biome: 'mountains' },
  { until: 1.0,  biome: 'ocean' },
];

/**
 * The built-in default pack. `registry.ts` seeds itself from this so the
 * default behaviour is just "the registry with no user packs loaded".
 */
export const DEFAULT_PACK: ExtensionPack = {
  $schema: PACK_SCHEMA_VERSION,
  id: 'builtin-default',
  name: 'Built-in Defaults',
  version: '1.0.0',
  mode: 'extend',
  description: 'The built-in catalogue: 13 planet subtypes, 10 satellite subtypes, 7 biomes, 7 terrain profiles, 5 landmass shapes.',

  universe: {
    planet: {
      subtypes: Object.entries(PLANET_PALETTES).map(([id, palette]) => ({
        id,
        composition: ['terrestrial', 'desert', 'volcanic', 'lava', 'iron', 'carbon', 'ocean', 'ice_rock'].includes(id) ? 'ROCK' : 'GAS',
        palette,
      })),
      rollRules: PLANET_ROLL_RULES,
      biomeMap: {
        default: 'terrestrial',
        forest: 'terrestrial',
        ocean: 'ocean',
        desert: 'desert',
        swamp: 'terrestrial',
        ice: 'ice_rock',
        mountains: 'terrestrial',
      },
      biomeWeights: BIOME_WEIGHTS,
    },
    satellite: {
      subtypes: Object.entries(SATELLITE_PALETTES).map(([id, palette]) => ({
        id,
        composition: ['water_ice', 'methane_ice', 'sulfur_ice', 'nitrogen_ice', 'dirty_ice'].includes(id) ? 'ICE' : 'ROCK',
        palette,
      })),
      rollRules: SATELLITE_ROLL_RULES,
      // Satellite doesn't apply biomeMap directly (satellite picker uses the
      // life+biome rules above), but the field is present for completeness.
      biomeMap: {},
      biomeWeights: BIOME_WEIGHTS,
    },
    biomePalettes: { ...BIOME_PALETTES },
  },

  world: {
    terrainProfiles: { ...PROFILES },
    terrainShapes: { ...SHAPE_PROFILES },
    profileWaterRatios: { ...PROFILE_WATER_RATIOS },
    biomeToProfile: {
      default: 'default',
      desert: 'desert',
      ice: 'ice',
      forest: 'forest',
      swamp: 'swamp',
      mountains: 'mountains',
      ocean: 'ocean',
    },
    profileLabels: {
      default: 'Default (Earth-like)',
      desert: 'Desert Planet',
      ice: 'Ice World',
      forest: 'Forest Planet',
      swamp: 'Swamp World',
      mountains: 'Mountain World',
      ocean: 'Ocean World',
    },
    shapeLabels: {
      default: 'Default (from biome)',
      pangaea: 'Pangaea',
      continents: 'Continents',
      islands: 'Islands',
      archipelago: 'Archipelago',
    },
    profileBadgeColors: {
      desert: '#c4842d',
      ice: '#5b8fa8',
      forest: '#3a7a3a',
      swamp: '#5a7a4a',
      mountains: '#6a5a4a',
      ocean: '#2a6a9a',
    },
  },
};
