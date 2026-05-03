import type { TerrainProfile } from '../types';
import { DEFAULT_PROFILE } from '../terrain/profiles';
import {
  PACK_SCHEMA_VERSION,
  type ExtensionPack,
  type PackedPalette,
  type PackedRollRule,
  type PackedSubtype,
  type ValidationResult,
} from './types';

const TERRAIN_PROFILE_KEYS = Object.keys(DEFAULT_PROFILE) as (keyof TerrainProfile)[];
const TERRAIN_KEY_SET = new Set<string>(TERRAIN_PROFILE_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s);
}

function validatePalette(p: unknown, where: string, errors: string[]): p is PackedPalette {
  if (!isPlainObject(p)) {
    errors.push(`${where}: expected an object`);
    return false;
  }
  let ok = true;
  for (const k of ['base', 'accent', 'shadow'] as const) {
    if (!isHexColor(p[k])) {
      errors.push(`${where}.${k}: expected hex color string`);
      ok = false;
    }
  }
  if (p.bands !== undefined) {
    if (!Array.isArray(p.bands) || !p.bands.every(isHexColor)) {
      errors.push(`${where}.bands: expected array of hex color strings`);
      ok = false;
    }
  }
  if (p.hot !== undefined && !isHexColor(p.hot)) {
    errors.push(`${where}.hot: expected hex color string`);
    ok = false;
  }
  return ok;
}

function validateSubtype(s: unknown, where: string, errors: string[]): s is PackedSubtype {
  if (!isPlainObject(s)) { errors.push(`${where}: expected an object`); return false; }
  let ok = true;
  if (typeof s.id !== 'string' || s.id.length === 0) {
    errors.push(`${where}.id: expected non-empty string`); ok = false;
  }
  if (typeof s.composition !== 'string' || s.composition.length === 0) {
    errors.push(`${where}.composition: expected non-empty string`); ok = false;
  }
  if (!validatePalette(s.palette, `${where}.palette`, errors)) ok = false;
  return ok;
}

function validateRule(r: unknown, where: string, errors: string[]): r is PackedRollRule {
  if (!isPlainObject(r)) { errors.push(`${where}: expected an object`); return false; }
  let ok = true;
  if (!isPlainObject(r.match)) {
    errors.push(`${where}.match: expected an object`); ok = false;
  }
  if (!isPlainObject(r.pick)) {
    errors.push(`${where}.pick: expected an object`); ok = false;
    return false;
  }
  const kind = (r.pick as Record<string, unknown>).kind;
  if (kind === 'fixed') {
    if (typeof (r.pick as Record<string, unknown>).subtype !== 'string') {
      errors.push(`${where}.pick.subtype: expected string`); ok = false;
    }
  } else if (kind === 'thresholds') {
    const t = (r.pick as Record<string, unknown>).thresholds;
    if (!Array.isArray(t) || t.length === 0) {
      errors.push(`${where}.pick.thresholds: expected non-empty array`); ok = false;
    } else {
      for (let i = 0; i < t.length; i++) {
        const e = t[i];
        if (!isPlainObject(e) || typeof e.until !== 'number' || typeof e.subtype !== 'string') {
          errors.push(`${where}.pick.thresholds[${i}]: expected { until: number, subtype: string }`);
          ok = false;
        }
      }
    }
  } else if (kind === 'uniform') {
    const subs = (r.pick as Record<string, unknown>).subtypes;
    if (!Array.isArray(subs) || subs.length === 0 || !subs.every(s => typeof s === 'string')) {
      errors.push(`${where}.pick.subtypes: expected non-empty array of strings`); ok = false;
    }
  } else {
    errors.push(`${where}.pick.kind: expected one of "fixed" | "thresholds" | "uniform"`);
    ok = false;
  }
  return ok;
}

function validateTerrainProfile(p: unknown, where: string, errors: string[]): boolean {
  if (!isPlainObject(p)) { errors.push(`${where}: expected an object`); return false; }
  let ok = true;
  for (const key of Object.keys(p)) {
    if (!TERRAIN_KEY_SET.has(key)) {
      errors.push(`${where}.${key}: unknown TerrainProfile field`);
      ok = false;
    }
  }
  // Light type check on the values that ARE recognised — TerrainProfile is all
  // numbers + a couple of booleans. We validate types by matching against the
  // default profile's runtime types so adding a new field to TerrainProfile
  // automatically extends validation coverage.
  for (const k of Object.keys(p)) {
    if (!TERRAIN_KEY_SET.has(k)) continue;
    const expected = typeof DEFAULT_PROFILE[k as keyof TerrainProfile];
    const actual = typeof (p as Record<string, unknown>)[k];
    if (expected !== actual) {
      errors.push(`${where}.${k}: expected ${expected}, got ${actual}`);
      ok = false;
    }
  }
  return ok;
}

/**
 * Validate a parsed JSON object as an extension pack. Returns the typed pack
 * if valid, or a list of human-readable errors otherwise.
 */
export function validatePack(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['root: expected an object'] };
  }
  if (input.$schema !== PACK_SCHEMA_VERSION) {
    errors.push(`$schema: expected "${PACK_SCHEMA_VERSION}"`);
  }
  for (const k of ['id', 'name', 'version'] as const) {
    if (typeof input[k] !== 'string' || (input[k] as string).length === 0) {
      errors.push(`${k}: expected non-empty string`);
    }
  }
  if (input.mode !== 'extend' && input.mode !== 'replace') {
    errors.push('mode: expected "extend" | "replace"');
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.push('description: expected string');
  }

  const u = input.universe;
  if (u !== undefined) {
    if (!isPlainObject(u)) {
      errors.push('universe: expected an object');
    } else {
      for (const tier of ['planet', 'satellite'] as const) {
        const scope = u[tier];
        if (scope === undefined) continue;
        if (!isPlainObject(scope)) {
          errors.push(`universe.${tier}: expected an object`);
          continue;
        }
        if (scope.subtypes !== undefined) {
          if (!Array.isArray(scope.subtypes)) {
            errors.push(`universe.${tier}.subtypes: expected array`);
          } else {
            scope.subtypes.forEach((s, i) =>
              validateSubtype(s, `universe.${tier}.subtypes[${i}]`, errors));
          }
        }
        if (scope.rollRules !== undefined) {
          if (!Array.isArray(scope.rollRules)) {
            errors.push(`universe.${tier}.rollRules: expected array`);
          } else {
            scope.rollRules.forEach((r, i) =>
              validateRule(r, `universe.${tier}.rollRules[${i}]`, errors));
          }
        }
        if (scope.biomeMap !== undefined && !isPlainObject(scope.biomeMap)) {
          errors.push(`universe.${tier}.biomeMap: expected an object`);
        }
        if (scope.biomeWeights !== undefined) {
          if (!Array.isArray(scope.biomeWeights)) {
            errors.push(`universe.${tier}.biomeWeights: expected array`);
          } else {
            scope.biomeWeights.forEach((e, i) => {
              if (!isPlainObject(e) || typeof e.until !== 'number' || typeof e.biome !== 'string') {
                errors.push(`universe.${tier}.biomeWeights[${i}]: expected { until: number, biome: string }`);
              }
            });
          }
        }
      }
      if (u.biomePalettes !== undefined) {
        if (!isPlainObject(u.biomePalettes)) {
          errors.push('universe.biomePalettes: expected an object');
        } else {
          for (const [name, pal] of Object.entries(u.biomePalettes)) {
            validatePalette(pal, `universe.biomePalettes.${name}`, errors);
          }
        }
      }
    }
  }

  const w = input.world;
  if (w !== undefined) {
    if (!isPlainObject(w)) {
      errors.push('world: expected an object');
    } else {
      if (w.terrainProfiles !== undefined) {
        if (!isPlainObject(w.terrainProfiles)) {
          errors.push('world.terrainProfiles: expected an object');
        } else {
          for (const [name, prof] of Object.entries(w.terrainProfiles)) {
            // Full profiles must contain every TerrainProfile field — otherwise
            // the worker would compose against undefined values.
            if (validateTerrainProfile(prof, `world.terrainProfiles.${name}`, errors)) {
              for (const k of TERRAIN_PROFILE_KEYS) {
                if ((prof as Record<string, unknown>)[k] === undefined) {
                  errors.push(`world.terrainProfiles.${name}.${k}: missing required field`);
                }
              }
            }
          }
        }
      }
      if (w.terrainShapes !== undefined) {
        if (!isPlainObject(w.terrainShapes)) {
          errors.push('world.terrainShapes: expected an object');
        } else {
          // Shapes are partial — only validate that every supplied key exists
          // on TerrainProfile.
          for (const [name, shape] of Object.entries(w.terrainShapes)) {
            validateTerrainProfile(shape, `world.terrainShapes.${name}`, errors);
          }
        }
      }
      for (const k of ['profileWaterRatios', 'biomeToProfile', 'profileLabels', 'shapeLabels', 'profileBadgeColors'] as const) {
        if (w[k] !== undefined && !isPlainObject(w[k])) {
          errors.push(`world.${k}: expected an object`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: input as unknown as ExtensionPack };
}
