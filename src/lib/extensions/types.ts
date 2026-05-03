import type { TerrainProfile } from '../types';

/**
 * Public schema for a procgen extension pack — a JSON document users can drop
 * in to add new flavours (planet subtypes, terrain profiles, landmass shapes)
 * without writing code. Every section is optional; a pack can scope itself to
 * just one layer.
 *
 * Two `mode`s control how a loaded pack composes with the built-in defaults:
 *  - `extend`  — entries are added on top of the built-ins; collisions overwrite.
 *  - `replace` — the loaded pack is the only source for the sections it
 *                supplies (built-ins for those sections are dropped). Useful
 *                for total-conversion packs.
 *
 * IMPORTANT: packs are pure data. The validator rejects fields it doesn't
 * recognise so packs can never inject code, regex, or template strings.
 */
export const PACK_SCHEMA_VERSION = 'procgen-pack/v1';

export type PackMode = 'extend' | 'replace';

/** Visual palette for a body. Mirrors `BodyPalette` in `lib/universe/renderer.ts`. */
export interface PackedPalette {
  base: string;
  accent: string;
  shadow: string;
  /** Optional per-band stripe colors (gas giants only). */
  bands?: string[];
  /** Optional hot-spot accent (lava / volcanic bodies). */
  hot?: string;
}

/**
 * Match clause for a roll rule. All listed fields must match for the rule to
 * fire. Ranges are half-open `[min, max)` — `orbitMax: 6` means orbit < 6.
 * Fields left unset are wildcards.
 */
export interface PackedRollMatch {
  composition?: string;
  /** Match life flag (true / false / unset). */
  life?: boolean;
  /** Match exact biome string; rule won't match if the body has no biome. */
  biome?: string;
  orbitMin?: number;
  orbitMax?: number;
  parentOrbitMin?: number;
  parentOrbitMax?: number;
}

/** Pick a fixed subtype (no rng() consumed). */
export interface PackedFixedPick {
  kind: 'fixed';
  subtype: string;
}

/**
 * Threshold pick — consume one rng() draw, compare to ascending `until`
 * thresholds, return the first subtype whose threshold the draw is < than.
 * The last threshold should be ≥ 1.0 to act as a catch-all.
 */
export interface PackedThresholdPick {
  kind: 'thresholds';
  thresholds: { until: number; subtype: string }[];
}

/** Uniform pick — consume one rng() draw, return `subtypes[floor(r * n)]`. */
export interface PackedUniformPick {
  kind: 'uniform';
  subtypes: string[];
}

export type PackedPick = PackedFixedPick | PackedThresholdPick | PackedUniformPick;

export interface PackedRollRule {
  /** Optional debug name; carried through but not used by the picker. */
  name?: string;
  match: PackedRollMatch;
  pick: PackedPick;
}

/** Per-subtype catalogue entry. Composition and palette are required so the
 *  renderer can draw the body without falling back to a generic color. */
export interface PackedSubtype {
  id: string;
  composition: string;
  palette: PackedPalette;
}

/** Universe scope: planet / satellite catalogues + roll rules + biome data. */
export interface PackedUniverseScope {
  planet?: {
    /** Replace or extend the subtype catalogue. */
    subtypes?: PackedSubtype[];
    /** Roll rules; first match wins. Ignored if absent and `mode = extend`. */
    rollRules?: PackedRollRule[];
    /** Biome → rock subtype map for life-bearing rock planets. */
    biomeMap?: Record<string, string>;
    /**
     * Biome weights for life-bearing rock planets — one rng() draw, threshold-
     * compared. Same shape as `PackedThresholdPick.thresholds`. If absent and
     * `mode = extend`, the built-in 0.40/0.10×6 distribution is used.
     */
    biomeWeights?: { until: number; biome: string }[];
  };
  satellite?: {
    subtypes?: PackedSubtype[];
    rollRules?: PackedRollRule[];
    biomeMap?: Record<string, string>;
    biomeWeights?: { until: number; biome: string }[];
  };
  /** Biome palettes for life-bearing rock bodies (planets + satellites share). */
  biomePalettes?: Record<string, PackedPalette>;
}

/** World-map scope: terrain profiles + landmass shapes + recommended water ratios. */
export interface PackedWorldScope {
  /** Full `TerrainProfile` objects, keyed by profile name. */
  terrainProfiles?: Record<string, TerrainProfile>;
  /** `Partial<TerrainProfile>` overlays, keyed by shape name. */
  terrainShapes?: Record<string, Partial<TerrainProfile>>;
  /** Recommended water ratio per profile name (UI snaps to it on selection). */
  profileWaterRatios?: Record<string, number>;
  /**
   * Biome → terrain profile name map. Used by the universe → world-map
   * hand-off (`App.tsx` reads this when generating a world from a planet).
   */
  biomeToProfile?: Record<string, string>;
  /** Optional human labels for the GenerationTab dropdowns. */
  profileLabels?: Record<string, string>;
  shapeLabels?: Record<string, string>;
  /** Optional badge colors for the profile-name pill in the GenerationTab. */
  profileBadgeColors?: Record<string, string>;
}

export interface ExtensionPack {
  /** Format version. Validators reject anything that isn't `procgen-pack/v1`. */
  $schema: string;
  id: string;
  name: string;
  version: string;
  mode: PackMode;
  /** Optional human description rendered in the ExtensionsTab. */
  description?: string;
  universe?: PackedUniverseScope;
  world?: PackedWorldScope;
}

/** Result of `validatePack`. */
export type ValidationResult =
  | { ok: true; pack: ExtensionPack }
  | { ok: false; errors: string[] };
