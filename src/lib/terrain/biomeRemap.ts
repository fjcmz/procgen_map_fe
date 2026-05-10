import type { Cell, BiomeType, BiomeRemapRule, TerrainProfile } from '../types';

/**
 * Post-`assignBiomes` rewrite that substitutes Earth-Whittaker biomes with the
 * non-life vocabulary appropriate for the body's subtype (lava, iron,
 * cratered, ice variants, etc.). Lives as a separate pass so the existing
 * Whittaker assignment stays untouched and the byte-identity invariant for
 * habitable rocky bodies holds.
 *
 * Each rule consumes the cell's existing classification (isWater + elevation
 * band) and emits a single non-life biome. There's no PRNG draw — the rewrite
 * is purely deterministic from the assigned-biome state.
 */
export function remapBiomesForSubtype(cells: Cell[], profile: TerrainProfile): void {
  const rule = profile.biomeRemap;
  if (!rule) return;
  for (const cell of cells) {
    cell.biome = remapOne(rule, cell);
  }
}

function remapOne(rule: BiomeRemapRule, cell: Cell): BiomeType {
  const e = cell.elevation;
  switch (rule) {
    case 'lava': {
      // No real water — the "water" cells are molten flows. Land splits
      // BASALT (mid) / VOLCANIC_ASH (high).
      if (cell.isWater) return 'LAVA';
      if (e < 0.55) return 'BASALT';
      return 'VOLCANIC_ASH';
    }
    case 'volcanic': {
      // Mostly cooled basalt + ash plains, with lava in the deepest basins.
      if (cell.isWater) return 'LAVA';
      if (e < 0.40) return 'VOLCANIC_ASH';
      if (e < 0.70) return 'BASALT';
      return 'CRATER_FIELD';
    }
    case 'iron': {
      if (cell.isWater) return 'METALLIC_PLAIN';
      if (e < 0.65) return 'METALLIC_PLAIN';
      return 'CRATER_FIELD';
    }
    case 'carbon': {
      if (cell.isWater) return 'CARBON_PLAIN';
      if (e < 0.70) return 'CARBON_PLAIN';
      return 'REGOLITH';
    }
    case 'cratered': {
      if (cell.isWater) return 'REGOLITH';
      if (e < 0.50) return 'REGOLITH';
      return 'CRATER_FIELD';
    }
    case 'ice_rock': {
      if (cell.isWater) return 'ICE_SHELF';
      if (e < 0.60) return 'ICE_SHELF';
      return 'REGOLITH';
    }
    case 'desert_moon': {
      if (cell.isWater) return 'REGOLITH';
      if (e < 0.30) return 'SULFUR_FLAT';
      if (e < 0.70) return 'REGOLITH';
      return 'CRATER_FIELD';
    }
    case 'methane_ice': {
      if (cell.isWater) return 'ICE_SHELF';
      if (e < 0.65) return 'ICE_SHELF';
      return 'REGOLITH';
    }
    case 'sulfur_ice': {
      if (cell.isWater) return 'SULFUR_FLAT';
      if (e < 0.50) return 'SULFUR_FLAT';
      if (e < 0.80) return 'ICE_SHELF';
      return 'REGOLITH';
    }
    case 'nitrogen_ice': {
      if (cell.isWater) return 'ICE_SHELF';
      return 'ICE_SHELF';
    }
    case 'dirty_ice': {
      if (cell.isWater) return 'DIRTY_ICE_FIELD';
      if (e < 0.65) return 'DIRTY_ICE_FIELD';
      return 'REGOLITH';
    }
  }
}
