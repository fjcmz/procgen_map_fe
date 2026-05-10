import type { BodyKind } from '../types';
import type { PlanetData, SatelliteData } from './types';
import type { PlanetSubtype, GasPlanetSubtype } from './Planet';
import { PROFILE_WATER_RATIOS } from '../terrain/profiles';

/**
 * Resolved generation spec for a body. Drives the App-side state setters
 * (`setProfileName`, `setWaterRatio`, etc.) and is then mirrored onto the
 * worker request as `bodyKind`/`disableHistory`/`paletteOverride`.
 *
 * Life-bearing rocky bodies reproduce today's behavior exactly so the
 * existing flow + sweep stay byte-identical.
 */
export interface BodyGenSpec {
  profileName: string;
  shapeName: string;
  waterRatio: number;
  bodyKind: BodyKind;
  /** Force-off the history simulation. True for every non-life body. */
  disableHistory: boolean;
  /** Sparse `BiomeType → hex` overrides. Used by gas giants to repaint
   *  their cloud-band biomes per-subtype (jovian beige, ice_giant cyan,
   *  etc.) without forking the renderer. */
  paletteOverride?: Record<string, string>;
}

/**
 * Per-gas-subtype palette overrides. Source of truth: `PLANET_PALETTES.bands`
 * in `universe/renderer.ts` — duplicated here as a lightweight copy to avoid
 * pulling the renderer into the worker boundary. Order matches the universe
 * disk: lighter zone → dark belt → light → dark belt → polar haze.
 *
 * The five gas-band biome members each get one slot. `GAS_STORM` is a
 * derived hue (a darker, redder variant of the dark band) that reads as a
 * vortex / great-spot regardless of subtype.
 */
const GAS_PALETTES: Record<GasPlanetSubtype, Record<string, string>> = {
  jovian: {
    GAS_BAND_LIGHT: '#e8c898',
    GAS_BAND_DARK:  '#a87848',
    GAS_BAND_HOT:   '#7a4820',
    GAS_HAZE:       '#e0bc88',
    GAS_STORM:      '#a82820',
  },
  hot_jupiter: {
    GAS_BAND_LIGHT: '#e88840',
    GAS_BAND_DARK:  '#982818',
    GAS_BAND_HOT:   '#601808',
    GAS_HAZE:       '#f09858',
    GAS_STORM:      '#400404',
  },
  ice_giant: {
    GAS_BAND_LIGHT: '#bce0ec',
    GAS_BAND_DARK:  '#5a98b8',
    GAS_BAND_HOT:   '#3878a0',
    GAS_HAZE:       '#a8d8e8',
    GAS_STORM:      '#205070',
  },
  methane_giant: {
    GAS_BAND_LIGHT: '#7aa8e0',
    GAS_BAND_DARK:  '#1848a0',
    GAS_BAND_HOT:   '#0a2870',
    GAS_HAZE:       '#88b0e0',
    GAS_STORM:      '#06184a',
  },
  ammonia_giant: {
    GAS_BAND_LIGHT: '#fff0c0',
    GAS_BAND_DARK:  '#c8b878',
    GAS_BAND_HOT:   '#a89848',
    GAS_HAZE:       '#fff8d0',
    GAS_STORM:      '#9a4818',
  },
};

export function gasPaletteFor(subtype: GasPlanetSubtype): Record<string, string> {
  return GAS_PALETTES[subtype];
}

/**
 * Master subtype → spec mapping. Exhaustive over PlanetSubtype; the compiler
 * will flag any future addition.
 */
function rockPlanetSpec(planet: PlanetData): BodyGenSpec {
  // Life-bearing rocky bodies → existing biome-driven flow (byte-identical).
  if (planet.life) {
    const biome = planet.biome ?? 'default';
    return {
      profileName: biome,
      shapeName: 'default',
      waterRatio: PROFILE_WATER_RATIOS[biome] ?? 0.40,
      bodyKind: 'rocky-life',
      disableHistory: false,
    };
  }
  return rockSpecForSubtype(planet.subtype);
}

/**
 * Lifeless rocky subtype → (profile, water, shape). Shared between planets
 * (terrestrial / desert / volcanic / lava / iron / carbon / ocean / ice_rock)
 * and rock satellites (terrestrial / cratered / volcanic / iron_rich /
 * desert_moon) — `iron_rich` collapses to the planet `iron` profile.
 */
function rockSpecForSubtype(subtype: PlanetSubtype | 'cratered' | 'iron_rich' | 'desert_moon'): BodyGenSpec {
  const base = (profileName: string, waterRatio?: number, shapeName: string = 'default'): BodyGenSpec => ({
    profileName,
    shapeName,
    waterRatio: waterRatio ?? PROFILE_WATER_RATIOS[profileName] ?? 0.40,
    bodyKind: 'rocky-barren',
    disableHistory: true,
  });
  switch (subtype) {
    case 'terrestrial': return base('default', 0.40);
    case 'desert':      return base('desert');
    case 'volcanic':    return { ...base('volcanic', 0, 'pangaea') };
    case 'lava':        return base('lava');
    case 'iron':        return base('iron');
    case 'iron_rich':   return base('iron');     // satellite alias
    case 'carbon':      return base('carbon');
    case 'ocean':       return base('ocean', 0.98);
    case 'ice_rock':    return base('ice_rock');
    case 'cratered':    return base('cratered', 0, 'islands');
    case 'desert_moon': return base('desert_moon');
    // Gas subtypes never reach here (they're handled in planetToGenSpec).
    default: return base('default', 0.40);
  }
}

export function planetToGenSpec(planet: PlanetData): BodyGenSpec {
  if (planet.composition === 'GAS') {
    return {
      profileName: 'gas_giant',
      shapeName: 'default',
      waterRatio: 0,
      bodyKind: 'gas-giant',
      disableHistory: true,
      paletteOverride: gasPaletteFor(planet.subtype as GasPlanetSubtype),
    };
  }
  return rockPlanetSpec(planet);
}

export function satelliteToGenSpec(satellite: SatelliteData): BodyGenSpec {
  // Life-bearing rocky satellites → existing biome flow.
  if (satellite.life && satellite.composition === 'ROCK') {
    const biome = satellite.biome ?? 'default';
    return {
      profileName: biome,
      shapeName: 'default',
      waterRatio: PROFILE_WATER_RATIOS[biome] ?? 0.40,
      bodyKind: 'rocky-life',
      disableHistory: false,
    };
  }
  // ICE composition — use the per-subtype ice profile.
  if (satellite.composition === 'ICE') {
    const profileName = satellite.subtype; // water_ice, methane_ice, sulfur_ice, nitrogen_ice, dirty_ice
    const profile = profileName === 'water_ice' ? 'ice' : profileName;
    return {
      profileName: profile,
      shapeName: 'default',
      waterRatio: PROFILE_WATER_RATIOS[profile] ?? 0.55,
      bodyKind: 'ice-shell',
      disableHistory: true,
    };
  }
  // ROCK satellite without life — same logic as a barren rocky planet.
  return rockSpecForSubtype(satellite.subtype as 'terrestrial' | 'cratered' | 'volcanic' | 'iron_rich' | 'desert_moon');
}
