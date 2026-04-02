import { IdUtil } from '../IdUtil';

export const TRADE_MIN = 10;
export const TRADE_USE = 5;

export const RESOURCE_WEIGHTS = {
  copper: 40, iron: 30, aluminium: 20, uranium: 3, oil: 20, gas: 30, coal: 40,
  cattle: 20, wheat: 30, rice: 30, sheep: 20, fruit: 15,
  silver: 30, gold: 10, diamonds: 3, silk: 20, incense: 15,
} as const;

export type ResourceType = keyof typeof RESOURCE_WEIGHTS;

export const RESOURCE_TOTAL_WEIGHT = (Object.values(RESOURCE_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

export const STRATEGIC_RESOURCES = new Set<ResourceType>(['copper', 'iron', 'aluminium', 'uranium', 'oil', 'gas', 'coal']);
export const AGRICULTURAL_RESOURCES = new Set<ResourceType>(['cattle', 'wheat', 'rice', 'sheep', 'fruit']);
export const LUXURY_RESOURCES = new Set<ResourceType>(['silver', 'gold', 'diamonds', 'silk', 'incense']);

export type ResourceCategory = 'strategic' | 'agricultural' | 'luxury';

export function getResourceCategory(type: ResourceType): ResourceCategory {
  if (STRATEGIC_RESOURCES.has(type)) return 'strategic';
  if (AGRICULTURAL_RESOURCES.has(type)) return 'agricultural';
  return 'luxury';
}

export function pickResourceType(rng: () => number): ResourceType {
  let roll = rng() * RESOURCE_TOTAL_WEIGHT;
  for (const [type, w] of Object.entries(RESOURCE_WEIGHTS) as [ResourceType, number][]) {
    roll -= w;
    if (roll <= 0) return type;
  }
  return 'copper';
}

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

  constructor(type: ResourceType, rng: () => number) {
    this.id = IdUtil.id('resource', type, rngHex(rng)) ?? 'resource_unknown';
    this.type = type;
    this.original = rollDice(rng, 10, 10) + 20;
    this.available = this.original;
  }
}
