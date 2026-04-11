import { IdUtil } from '../IdUtil';
import type { AbundanceDice, ResourceType, ResourceCategory } from './ResourceCatalog';
import { getResourceCategory } from './ResourceCatalog';

export const TRADE_MIN = 10;
export const TRADE_USE = 5;

// Re-exported for backward compatibility with existing consumers
// (`renderer.ts` imports `getResourceCategory` from this path).
export type { ResourceType, ResourceCategory };
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
  readonly type: ResourceType;
  readonly original: number;
  available: number;

  constructor(type: ResourceType, rng: () => number, abundance: AbundanceDice) {
    this.id = IdUtil.id('resource', type, rngHex(rng)) ?? 'resource_unknown';
    this.type = type;
    this.original = rollDice(rng, abundance.sides, abundance.count) + abundance.bonus;
    this.available = this.original;
  }
}
