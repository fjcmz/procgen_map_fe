import { IdUtil } from '../IdUtil';
import type { AbundanceDice, ResourceType, ResourceCategory } from './ResourceCatalog';
import { getResourceCategory, getResourceTechRequirement } from './ResourceCatalog';
import type { TechField } from '../timeline/Tech';

export const TRADE_MIN = 10;
export const TRADE_USE = 5;

// Re-exported for backward compatibility with existing consumers
// (`renderer.ts` imports `getResourceCategory` from this path).
export type { ResourceType, ResourceCategory, TechField };
export { getResourceCategory };

function rollDice(rng: () => number, sides: number, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(rng() * sides) + 1;
  return total;
}

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

export class Resource {
  readonly id: string;
  /** The cell this resource is spatially attached to. */
  readonly cellIndex: number;
  readonly type: ResourceType;
  readonly original: number;
  available: number;
  /** Tech field the owning country must invest in to unlock this resource for trade. */
  readonly requiredTechField: TechField;
  /** Minimum level of `requiredTechField` required to unlock this resource. 0 = available at year 0. */
  readonly requiredTechLevel: number;

  constructor(cellIndex: number, type: ResourceType, rng: () => number, abundance: AbundanceDice) {
    this.id = IdUtil.id('resource', type, rngHex(rng)) ?? 'resource_unknown';
    this.cellIndex = cellIndex;
    this.type = type;
    this.original = rollDice(rng, abundance.sides, abundance.count) + abundance.bonus;
    this.available = this.original;
    // Pure static lookup — no RNG consumed, order-independent w.r.t. the
    // above rolls, so this preserves byte-for-byte RNG budget.
    const req = getResourceTechRequirement(type);
    this.requiredTechField = req.field;
    this.requiredTechLevel = req.level;
  }
}
