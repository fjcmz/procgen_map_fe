import type { Cell, City, Road, Country, HistoryEvent, HistoryYear, HistoryData } from '../types';
import { generateRoads } from './roads';

const MOUNTAIN_THRESHOLD = 0.72;

const NAME_PREFIXES = [
  'Iron', 'Ash', 'Storm', 'Riven', 'Cold', 'Ember', 'Thorn', 'Silver', 'Dusk', 'Bright',
  'Frost', 'Grim', 'Oak', 'Shadow', 'Gold', 'Wolf', 'Alden', 'Sun', 'Bleak', 'Copper',
  'Night', 'Dawn', 'Stone', 'Harrow', 'Steel', 'Dark', 'Green', 'Red', 'Black', 'White',
];

const NAME_SUFFIXES = [
  'hold', 'vale', 'gate', 'moor', 'haven', 'crest', 'wall', 'peak', 'wood', 'water',
  'mark', 'stone', 'dale', 'mere', 'spire', 'fen', 'ford', 'burg', 'reach', 'land',
];

function randomName(rng: () => number): string {
  const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  const suffix = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
  return prefix + suffix;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function scoreCell(cell: Cell): number {
  if (cell.isWater || cell.elevation > 0.75) return -Infinity;
  let score = 0;
  if (cell.isCoast) score += 3;
  if (cell.riverFlow > 5) score += 2;
  if (cell.riverFlow > 15) score += 2;
  score -= cell.elevation * 4;
  score += cell.moisture * 1.5;
  return score;
}

/** BFS territory fill from capital cell indices into the ownership array. */
function bfsTerritory(
  cells: Cell[],
  capitalCellIndices: number[],
  ownership: Int16Array
): void {
  const queue: number[] = [];
  for (let i = 0; i < capitalCellIndices.length; i++) {
    const idx = capitalCellIndices[i];
    if (!cells[idx].isWater) {
      ownership[idx] = i;
      queue.push(idx);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const owner = ownership[idx];
    for (const ni of cells[idx].neighbors) {
      if (
        ownership[ni] === -1 &&
        !cells[ni].isWater &&
        cells[ni].elevation < MOUNTAIN_THRESHOLD
      ) {
        ownership[ni] = owner;
        queue.push(ni);
      }
    }
  }
}

/**
 * Reconstruct the full cell-ownership array at a given year from snapshots + deltas.
 * Returns an Int16Array where value >= 0 is a countryId, -1 is unclaimed, -2 is impassable.
 */
export function getOwnershipAtYear(
  historyData: HistoryData,
  targetYear: number,
): Int16Array {
  const snapshotYears = Object.keys(historyData.snapshots)
    .map(Number)
    .filter(y => y <= targetYear)
    .sort((a, b) => b - a);

  const baseYear = snapshotYears.length > 0 ? snapshotYears[0] : 0;
  const ownership = new Int16Array(historyData.snapshots[baseYear]);

  for (const yearData of historyData.years) {
    if (yearData.year > baseYear && yearData.year <= targetYear) {
      for (const [cellIdx, newOwner] of yearData.ownershipDelta) {
        ownership[cellIdx] = newOwner;
      }
    }
  }

  return ownership;
}

export function generateHistory(
  cells: Cell[],
  width: number,
  rng: () => number,
  numYears: number
): { cities: City[]; roads: Road[]; historyData: HistoryData } {
  const numCells = cells.length;

  // --- Phase 1: Place initial country capitals ---
  const landCells = cells
    .filter(c => !c.isWater && c.elevation < MOUNTAIN_THRESHOLD)
    .sort((a, b) => scoreCell(b) - scoreCell(a));

  const numCountries = Math.min(5, Math.max(3, Math.floor(landCells.length / 800)));
  const minSpacing2 = (width * 0.12) ** 2;

  const capitalCells: Cell[] = [];
  for (const cell of landCells) {
    if (capitalCells.length >= numCountries) break;
    const tooClose = capitalCells.some(c => dist2(c.x, c.y, cell.x, cell.y) < minSpacing2);
    if (!tooClose) capitalCells.push(cell);
  }

  // Generate unique country names
  const usedNames = new Set<string>();
  const countries: Country[] = capitalCells.map((cell, i) => {
    let name = randomName(rng);
    let attempts = 0;
    while (usedNames.has(name) && attempts < 50) {
      name = randomName(rng);
      attempts++;
    }
    usedNames.add(name);
    return { id: i, name, capitalCellIndex: cell.index, isAlive: true };
  });

  // Ownership: -2 = impassable, -1 = unclaimed, >= 0 = countryId
  const ownership = new Int16Array(numCells).fill(-1);
  for (let i = 0; i < numCells; i++) {
    if (cells[i].isWater || cells[i].elevation >= MOUNTAIN_THRESHOLD) {
      ownership[i] = -2;
    }
  }

  bfsTerritory(cells, capitalCells.map(c => c.index), ownership);

  const snapshots: Record<number, Int16Array> = {};
  snapshots[0] = new Int16Array(ownership);

  const totalLandCells = landCells.length;

  // --- Phase 2: Year-by-year simulation ---
  const historyYears: HistoryYear[] = [];

  for (let year = 1; year <= numYears; year++) {
    const events: HistoryEvent[] = [];
    const ownershipDelta = new Map<number, number>();

    const aliveCountries = countries.filter(c => c.isAlive);
    if (aliveCountries.length === 0) break;

    // Compute cell counts and border cell lists per country
    const cellCounts = new Map<number, number>();
    for (const c of aliveCountries) cellCounts.set(c.id, 0);

    for (let i = 0; i < numCells; i++) {
      const o = ownership[i];
      if (o >= 0) cellCounts.set(o, (cellCounts.get(o) ?? 0) + 1);
    }

    // Build adjacency between countries (border pairs)
    const borderPairs = new Map<string, [number, number]>();
    for (let i = 0; i < numCells; i++) {
      const owner = ownership[i];
      if (owner < 0) continue;
      for (const ni of cells[i].neighbors) {
        const nOwner = ownership[ni];
        if (nOwner < 0 || nOwner === owner) continue;
        const key = owner < nOwner ? `${owner}-${nOwner}` : `${nOwner}-${owner}`;
        if (!borderPairs.has(key)) {
          borderPairs.set(key, owner < nOwner ? [owner, nOwner] : [nOwner, owner]);
        }
      }
    }

    // EXPANSION: each country may claim adjacent unclaimed cells
    for (const country of aliveCountries) {
      if (rng() > 0.4) continue;
      const numToClaim = Math.floor(rng() * 3) + 1;
      let claimed = 0;
      outer: for (let i = 0; i < numCells && claimed < numToClaim; i++) {
        if (ownership[i] !== country.id) continue;
        for (const ni of cells[i].neighbors) {
          if (ownership[ni] === -1 && claimed < numToClaim) {
            ownership[ni] = country.id;
            ownershipDelta.set(ni, country.id);
            cellCounts.set(country.id, (cellCounts.get(country.id) ?? 0) + 1);
            claimed++;
            if (claimed >= numToClaim) break outer;
          }
        }
      }
      if (claimed > 0) {
        events.push({
          type: 'EXPANSION',
          year,
          initiatorId: country.id,
          description: `${country.name} expands its territory.`,
        });
      }
    }

    // WARS: adjacent countries may go to war
    for (const [, [aId, bId]] of borderPairs) {
      if (rng() > 0.08) continue;
      const countryA = countries[aId];
      const countryB = countries[bId];
      if (!countryA?.isAlive || !countryB?.isAlive) continue;

      const sA = cellCounts.get(aId) ?? 1;
      const sB = cellCounts.get(bId) ?? 1;
      const winnerId = rng() < sA / (sA + sB) ? aId : bId;
      const loserId = winnerId === aId ? bId : aId;
      const winner = countries[winnerId];
      const loser = countries[loserId];

      events.push({
        type: 'WAR',
        year,
        initiatorId: winnerId,
        targetId: loserId,
        description: `${winner.name} declares war on ${loser.name}.`,
      });

      // Collect loser's border cells adjacent to winner
      const loserBorderCells: number[] = [];
      for (let i = 0; i < numCells; i++) {
        if (ownership[i] !== loserId) continue;
        for (const ni of cells[i].neighbors) {
          if (ownership[ni] === winnerId) {
            loserBorderCells.push(i);
            break;
          }
        }
      }

      const fraction = rng() * 0.3 + 0.1;
      const numToTake = Math.max(1, Math.floor(loserBorderCells.length * fraction));
      const taken = loserBorderCells.slice(0, numToTake);

      for (const ci of taken) {
        ownership[ci] = winnerId;
        ownershipDelta.set(ci, winnerId);
      }
      cellCounts.set(winnerId, (cellCounts.get(winnerId) ?? 0) + taken.length);
      cellCounts.set(loserId, (cellCounts.get(loserId) ?? 0) - taken.length);

      if (taken.length > 0) {
        events.push({
          type: 'CONQUEST',
          year,
          initiatorId: winnerId,
          targetId: loserId,
          description: `${winner.name} conquers ${taken.length} cells from ${loser.name}.`,
          cellsChanged: taken,
        });
      }
    }

    // MERGES: tiny countries voluntarily absorbed by a neighbor
    for (const country of aliveCountries) {
      if (!country.isAlive) continue;
      const size = cellCounts.get(country.id) ?? 0;
      if (size / totalLandCells > 0.03) continue;
      if (rng() > 0.25) continue;

      let neighborId = -1;
      for (let i = 0; i < numCells && neighborId < 0; i++) {
        if (ownership[i] !== country.id) continue;
        for (const ni of cells[i].neighbors) {
          const no = ownership[ni];
          if (no >= 0 && no !== country.id && countries[no]?.isAlive) {
            neighborId = no;
            break;
          }
        }
      }
      if (neighborId < 0) continue;

      const neighbor = countries[neighborId];
      const mergedCells: number[] = [];
      for (let i = 0; i < numCells; i++) {
        if (ownership[i] === country.id) {
          ownership[i] = neighborId;
          ownershipDelta.set(i, neighborId);
          mergedCells.push(i);
        }
      }
      country.isAlive = false;
      country.absorbedById = neighborId;

      events.push({
        type: 'MERGE',
        year,
        initiatorId: country.id,
        targetId: neighborId,
        description: `${country.name} merges into ${neighbor.name}.`,
        cellsChanged: mergedCells,
      });
    }

    // COLLAPSE: countries with 0 cells
    for (const country of aliveCountries) {
      if (!country.isAlive) continue;
      if ((cellCounts.get(country.id) ?? 0) === 0) {
        country.isAlive = false;
        events.push({
          type: 'COLLAPSE',
          year,
          initiatorId: country.id,
          description: `${country.name} collapses.`,
        });
      }
    }

    historyYears.push({ year, events, ownershipDelta });

    if (year % 20 === 0) {
      snapshots[year] = new Int16Array(ownership);
    }
  }

  // Always snapshot the final year
  snapshots[numYears] = new Int16Array(ownership);

  // --- Phase 3: Finalize ---
  // Apply final ownership to cell.kingdom
  for (let i = 0; i < numCells; i++) {
    const o = ownership[i];
    cells[i].kingdom = o >= 0 ? o : null;
  }

  // Build City[] — one per country capital
  const cities: City[] = countries.map(country => {
    const finalOwner = ownership[country.capitalCellIndex];
    return {
      cellIndex: country.capitalCellIndex,
      name: country.name,
      isCapital: country.isAlive,
      kingdomId: finalOwner >= 0 ? finalOwner : country.id,
    };
  });

  const roads = generateRoads(cells, cities);

  const historyData: HistoryData = {
    countries,
    years: historyYears,
    numYears,
    snapshots,
  };

  return { cities, roads, historyData };
}
