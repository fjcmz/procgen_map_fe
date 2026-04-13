import type { TechField } from './Tech';

/**
 * Technology progression names — 30 named technologies per field.
 *
 * Each field has 30 entries (20 based on real historical technologies,
 * 10 based on speculative / science-fiction technologies). Each named
 * technology spans 3 simulation levels, sub-numbered with Roman numerals
 * I / II / III. So reaching name #10 requires level 30 (3 x 10), and the
 * full table covers 90 levels before overflow.
 *
 * Purely cosmetic: resolved at serialization time inside `HistoryGenerator.ts`
 * and stamped onto TECH / CONQUEST event payloads so the event log can
 * render `Avaloria discovers Astronomy II (science L8)` instead of
 * `Avaloria discovers science level 8`.
 *
 * IMPORTANT: This table is flavor metadata, never simulation state.
 * Import it only from `HistoryGenerator.ts`. Never from `Tech.ts`,
 * `Cataclysm.ts`, `Trade.ts`, or any other mutation site — coupling
 * balance changes to text edits would be a footgun.
 */
export const TECH_NAMES: Record<TechField, string[]> = {
  science: [
    // Historical (20)
    'Fire Making', 'Counting', 'Astronomy', 'Geometry',
    'Optics', 'Alchemy', 'Cartography', 'Scientific Method',
    'Calculus', 'Mechanics', 'Chemistry', 'Thermodynamics',
    'Electromagnetism', 'Periodic Table', 'Relativity', 'Quantum Theory',
    'Nuclear Physics', 'Information Theory', 'Semiconductor Physics', 'Particle Physics',
    // Future (10)
    'Quantum Computing', 'Nanotechnology', 'Unified Field Theory', 'Dark Matter Physics',
    'Antimatter Science', 'Temporal Mechanics', 'Dimensional Theory', 'Reality Engineering',
    'Universal Simulation', 'Omega Point Theory',
  ],
  military: [
    // Historical (20)
    'Stone Weapons', 'Bronze Forging', 'Phalanx Formation', 'Iron Working',
    'Cavalry Doctrine', 'Siege Engines', 'Crossbows', 'Plate Armor',
    'Gunpowder', 'Naval Artillery', 'Rifled Barrels', 'Ironclads',
    'Trench Warfare', 'Mechanized Warfare', 'Strategic Bombing', 'Jet Fighters',
    'Guided Missiles', 'Stealth Technology', 'Drone Warfare', 'Cyber Warfare',
    // Future (10)
    'Autonomous Swarms', 'Railgun Artillery', 'Powered Exoskeletons', 'Directed Energy',
    'Orbital Bombardment', 'Plasma Weapons', 'Kinetic Barriers', 'Antimatter Warheads',
    'Gravity Weapons', 'Stellar Weaponry',
  ],
  industry: [
    // Historical (20)
    'Stone Tools', 'Pottery', 'The Wheel', 'Bronze Casting',
    'Sailing', 'Aqueducts', 'Watermills', 'Blast Furnace',
    'Mechanical Clock', 'Printing Press', 'Steam Power', 'Telegraph',
    'Steel Production', 'Assembly Line', 'Electrification', 'Plastics',
    'Automation', 'Containerization', 'Robotics', 'Additive Manufacturing',
    // Future (10)
    'Smart Materials', 'Nanofabrication', 'Self-Replicating Factories', 'Orbital Industry',
    'Asteroid Mining', 'Matter Compiler', 'Programmable Matter', 'Megastructures',
    'Stellar Forges', 'Universal Constructor',
  ],
  energy: [
    // Historical (20)
    'Firekeeping', 'Charcoal', 'Animal Power', 'Windmills',
    'Coal Mining', 'Peat Harvesting', 'Steam Engines', 'Gas Lighting',
    'Electricity', 'Hydroelectric Dams', 'Oil Refining', 'Diesel Engines',
    'Atomic Power', 'Solar Cells', 'Wind Turbines', 'Geothermal Tapping',
    'Fuel Cells', 'Fusion', 'Thorium Reactors', 'Superconductors',
    // Future (10)
    'Antimatter Reactors', 'Zero-Point Energy', 'Dyson Collectors', 'Stellar Tapping',
    'Quantum Vacuum', 'Dark Energy Harvesting', 'Singularity Engines', 'Cosmic String Taps',
    'Entropy Reversal', 'Omega Energy',
  ],
  growth: [
    // Historical (20)
    'Foraging', 'Hand Tilling', 'Irrigation', 'Crop Rotation',
    'Terrace Farming', 'Selective Breeding', 'Animal Husbandry', 'Steel Plows',
    'Seed Drills', 'Crop Science', 'Synthetic Fertilizer', 'Refrigeration',
    'Pesticides', 'Mechanized Farming', 'Green Revolution', 'Drip Irrigation',
    'Hydroponics', 'Vertical Farming', 'Precision Agriculture', 'Lab-Grown Meat',
    // Future (10)
    'Synthetic Photosynthesis', 'Atmospheric Harvesting', 'Desert Reclamation', 'Ocean Farming',
    'Cellular Agriculture', 'Terraforming', 'Ecosystem Engineering', 'Molecular Food Synthesis',
    'Universal Nutrition', 'Planetary Abundance',
  ],
  exploration: [
    // Historical (20)
    'Trail Blazing', 'Star Maps', 'Dugout Canoes', 'Lateen Sails',
    'Compass', 'Astrolabe', 'Sextant', 'Chronometer',
    'Hot Air Balloons', 'Steam Vessels', 'Submarines', 'Oceanic Cables',
    'Aeronautics', 'Sonar', 'Radar', 'Jet Aviation',
    'Satellites', 'Long-Range Rocketry', 'Deep Sea Probes', 'Space Stations',
    // Future (10)
    'Interplanetary Travel', 'Warp Theory', 'Generation Ships', 'Hyperspace Navigation',
    'Wormhole Mapping', 'Faster-Than-Light', 'Galactic Cartography', 'Intergalactic Probes',
    'Dimensional Exploration', 'Omniscient Cartography',
  ],
  biology: [
    // Historical (20)
    'Herbalism', 'Bone Setting', 'Anatomy', 'Blood Circulation',
    'Microscopy', 'Taxonomy', 'Vaccination', 'Anesthesia',
    'Antiseptics', 'Pasteurization', 'Antibiotics', 'X-Ray Imaging',
    'Blood Typing', 'DNA Discovery', 'Organ Transplants', 'Genetics',
    'Immunotherapy', 'Gene Editing', 'Stem Cells', 'Synthetic Biology',
    // Future (10)
    'Bioprinting', 'Neural Interfaces', 'Age Reversal', 'Genetic Resequencing',
    'Consciousness Transfer', 'Xenobiology', 'Hive Mind Integration', 'Biological Singularity',
    'Species Synthesis', 'Universal Genome',
  ],
  art: [
    // Historical (20)
    'Cave Painting', 'Oral Tradition', 'Cuneiform', 'Sculpture',
    'Frescoes', 'Epic Poetry', 'Mosaic Art', 'Perspective',
    'Oil Painting', 'Theater', 'Opera', 'The Novel',
    'Photography', 'Impressionism', 'Cinema', 'Jazz',
    'Abstract Art', 'Television', 'Digital Art', 'Generative Art',
    // Future (10)
    'Virtual Reality Art', 'Neural Composition', 'Synesthetic Media', 'Dream Recording',
    'Living Architecture', 'Consciousness Art', 'Reality Sculpting', 'Temporal Art',
    'Dimensional Expression', 'Cosmic Symphony',
  ],
  government: [
    // Historical (20)
    'Tribal Council', 'Chieftainship', 'Codified Law', 'Monarchy',
    'Senate', 'Bureaucracy', 'Feudal Charter', 'Common Law',
    'Parliament', 'Constitutionalism', 'Civil Service', 'Central Banking',
    'Universal Suffrage', 'Labor Rights', 'Welfare State', 'International Law',
    'Digital Governance', 'Algorithmic Governance', 'Open Data', 'Smart Contracts',
    // Future (10)
    'Decentralized Governance', 'AI Arbitration', 'Predictive Legislation', 'Neural Democracy',
    'Collective Intelligence', 'Quantum Consensus', 'Temporal Governance', 'Galactic Federation',
    'Universal Law', 'Omega Governance',
  ],
};

/** Number of simulation levels each named technology spans. */
const LEVELS_PER_NAME = 3;

/**
 * Resolve the display name for a field+level pair. Levels are 1-indexed.
 *
 * Each named technology spans `LEVELS_PER_NAME` (3) levels, sub-numbered
 * with Roman numerals I / II / III:
 *   Level 1 → "Fire Making I",  Level 3 → "Fire Making III",
 *   Level 4 → "Counting I",     Level 90 → "Omega Point Theory III"
 *
 * Levels beyond `30 × 3 = 90` continue Roman numerals on the last name:
 *   Level 91 → "Omega Point Theory IV",  Level 178 → "Omega Point Theory XCI"
 *
 * Defensive: out-of-range or missing entries fall back to `${field} L${level}`
 * so callers never crash on unexpected input.
 */
export function nameForLevel(field: TechField, level: number): string {
  const list = TECH_NAMES[field];
  if (!list || list.length === 0 || level < 1) return `${field} L${level}`;

  const maxCovered = list.length * LEVELS_PER_NAME; // 30 × 3 = 90

  if (level <= maxCovered) {
    const nameIndex = Math.floor((level - 1) / LEVELS_PER_NAME); // 0..29
    const subLevel = ((level - 1) % LEVELS_PER_NAME) + 1;        // 1..3
    return `${list[nameIndex]} ${roman(subLevel)}`;
  }

  // Overflow: continue Roman numerals on the last name beyond III
  const overflow = level - maxCovered; // 1, 2, 3, ...
  return `${list[list.length - 1]} ${roman(LEVELS_PER_NAME + overflow)}`; // IV, V, VI, ...
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
