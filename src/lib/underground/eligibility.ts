/**
 * Underground-map eligibility lookup. Returns the probability (0–1) that a
 * world of the given (bodyKind, subtype) has an underground map.
 *
 * Bounds: gas worlds always return 0. Every other return value sits in
 * [0.30, 0.60] per the original feature spec. See `underground_map.md`.
 */

import type { BodyKind } from '../types';

/** Default chance when no body context is available (direct world-map landing). */
export const DEFAULT_UNDERGROUND_CHANCE = 0.45;

export function undergroundChance(bodyKind: BodyKind, subtype?: string): number {
  if (bodyKind === 'gas-giant') return 0;
  if (bodyKind === 'ice-shell') return 0.30;
  if (bodyKind === 'rocky-life') return 0.45;
  // rocky-barren — subtype-driven
  switch (subtype) {
    case 'volcanic':    return 0.60;
    case 'lava':        return 0.55;
    case 'terrestrial':
    case 'cratered':
    case 'desert':
    case 'desert_moon':
    case 'carbon':      return 0.45;
    case 'iron':
    case 'iron_rich':   return 0.40;
    case 'ice_rock':    return 0.35;
    case 'ocean':       return 0.30;
    default:            return DEFAULT_UNDERGROUND_CHANCE;
  }
}
