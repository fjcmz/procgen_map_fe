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
  /** The SURFACE cell this resource is spatially attached to. For surface
   *  resources, the cell where the deposit lives. For underground resources,
   *  the surface cell whose region the underground cavern projects into
   *  (so country trade / exploitation logic, which is surface-cell keyed,
   *  finds it). */
  cellIndex: number;
  readonly type: ResourceType;
  readonly original: number;
  available: number;
  /** Tech field the owning country must invest in to unlock this resource for trade. */
  readonly requiredTechField: TechField;
  /** Minimum level of `requiredTechField` required to unlock this resource. 0 = available at year 0. */
  readonly requiredTechLevel: number;
  /** True if this deposit lives in the underground map (cavern/tunnel) rather
   *  than on the surface. Drives the underground renderer overlay and a UI
   *  marker in the DetailsTab country resource list. */
  readonly subterranean: boolean;
  /** When `subterranean` is true, the index into `UndergroundMap.cells` for
   *  the cavern cell the deposit lives in. Used by the underground renderer
   *  to position the resource icon. Undefined for surface resources. */
  readonly undergroundCellIndex: number | undefined;

  constructor(
    cellIndex: number,
    type: ResourceType,
    rng: () => number,
    abundance: AbundanceDice,
    subterranean: boolean = false,
    undergroundCellIndex: number | undefined = undefined,
  ) {
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
    this.subterranean = subterranean;
    this.undergroundCellIndex = undergroundCellIndex;
  }
}
