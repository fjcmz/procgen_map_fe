import type { TechField } from './Tech';

/**
 * Spec stretch §3 — Named Techs.
 *
 * Static flavor names for each tech level, one row per field. Purely
 * cosmetic: resolved at serialization time inside `HistoryGenerator.ts`
 * and stamped onto TECH / CONQUEST event payloads so the event log can
 * render `Avaloria discovers Astronomy (science L4)` instead of
 * `Avaloria discovers science level 4`.
 *
 * IMPORTANT: This table is flavor metadata, never simulation state.
 * Import it only from `HistoryGenerator.ts`. Never from `Tech.ts`,
 * `Cataclysm.ts`, `Trade.ts`, or any other mutation site — coupling
 * balance changes to text edits would be a footgun.
 */
export const TECH_NAMES: Record<TechField, string[]> = {
  science: [
    'Astronomy', 'Optics', 'Calculus', 'Chemistry',
    'Electromagnetism', 'Relativity', 'Quantum Theory',
  ],
  military: [
    'Bronze Forging', 'Cavalry Doctrine', 'Crossbows',
    'Gunpowder', 'Rifled Barrels', 'Mechanized Warfare',
    'Strategic Bombing',
  ],
  industry: [
    'The Wheel', 'Sailing', 'Watermills',
    'Steam Power', 'Assembly Line', 'Automation', 'Robotics',
  ],
  energy: [
    'Firekeeping', 'Charcoal', 'Coal Mining',
    'Steam Engines', 'Electricity', 'Atomic Power', 'Fusion',
  ],
  growth: [
    'Hand Tilling', 'Crop Rotation', 'Selective Breeding',
    'Steel Plows', 'Synthetic Fertilizer', 'Mechanized Farming',
    'Vertical Farming',
  ],
  exploration: [
    'Star Maps', 'Lateen Sails', 'Compass',
    'Sextant', 'Steam Vessels', 'Aeronautics', 'Long-Range Rocketry',
  ],
  biology: [
    'Herbalism', 'Anatomy', 'Vaccination',
    'Antibiotics', 'Genetics', 'Gene Editing', 'Synthetic Biology',
  ],
  art: [
    'Cave Painting', 'Frescoes', 'Perspective',
    'Printing Press', 'Photography', 'Cinema', 'Generative Art',
  ],
  government: [
    'Tribal Council', 'Codified Law', 'Bureaucracy',
    'Constitutionalism', 'Central Banking', 'Welfare State',
    'Algorithmic Governance',
  ],
};

/**
 * Resolve the display name for a field+level pair. Levels are 1-indexed.
 * Levels beyond the table length reuse the last entry with a roman-numeral
 * suffix (e.g. `Vertical Farming II`, `Vertical Farming III`).
 *
 * Defensive: out-of-range or missing entries fall back to `${field} L${level}`
 * so callers never crash on unexpected input.
 */
export function nameForLevel(field: TechField, level: number): string {
  const list = TECH_NAMES[field];
  if (!list || list.length === 0 || level < 1) return `${field} L${level}`;
  if (level <= list.length) return list[level - 1];
  const overflow = level - list.length + 1; // II at first overflow, III next, etc.
  return `${list[list.length - 1]} ${roman(overflow)}`;
}

function roman(n: number): string {
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let v = n;
  for (const [val, sym] of map) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out || 'I';
}
