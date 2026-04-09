import type { Cell, City } from '../types';
import { generateCityName } from './nameGenerator';
import { seededPRNG } from '../terrain/noise';

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function scoreCell(cell: Cell): number {
  if (cell.isWater || cell.elevation > 0.75) return -Infinity;
  let score = 0;
  if (cell.isCoast) score += 3;
  if (cell.riverFlow > 5) score += 2;
  if (cell.riverFlow > 15) score += 2;
  score -= cell.elevation * 4; // prefer flatlands
  score += cell.moisture * 1.5;
  return score;
}

/** Place cities, ensuring minimum spacing. */
export function placeCities(cells: Cell[], width: number): City[] {
  const n = Math.min(20, Math.max(5, Math.floor(cells.length / 150)));
  const minDist2 = (width * 0.07) ** 2;

  const landCells = cells
    .filter(c => !c.isWater && c.elevation < 0.75)
    .sort((a, b) => scoreCell(b) - scoreCell(a));

  const chosen: Cell[] = [];
  for (const cell of landCells) {
    if (chosen.length >= n) break;
    const tooClose = chosen.some(c => dist2(c.x, c.y, cell.x, cell.y) < minDist2);
    if (!tooClose) chosen.push(cell);
  }

  // Assign kingdoms using simple k-means grouping (3-5 kingdoms)
  const numKingdoms = Math.min(5, Math.max(3, Math.floor(chosen.length / 3)));
  const kingdomCenters = chosen.slice(0, numKingdoms);

  const nameRng = seededPRNG('legacy-cities');
  const usedNames = new Set<string>();
  const cities: City[] = chosen.map((cell, idx) => {
    // Find nearest kingdom center
    let kingdomId = 0;
    let bestDist = Infinity;
    for (let k = 0; k < numKingdoms; k++) {
      const d = dist2(cell.x, cell.y, kingdomCenters[k].x, kingdomCenters[k].y);
      if (d < bestDist) {
        bestDist = d;
        kingdomId = k;
      }
    }
    const isCapital = idx < numKingdoms && idx === kingdomId;
    return {
      cellIndex: cell.index,
      name: generateCityName(nameRng, usedNames),
      isCapital,
      kingdomId,
      foundedYear: 0,
      size: 'small' as const,
    };
  });

  // Ensure each kingdom has exactly one capital (first city with that kingdomId)
  const capitalSet = new Set<number>();
  for (const city of cities) {
    if (!capitalSet.has(city.kingdomId)) {
      city.isCapital = true;
      capitalSet.add(city.kingdomId);
    } else {
      city.isCapital = false;
    }
  }

  return cities;
}
