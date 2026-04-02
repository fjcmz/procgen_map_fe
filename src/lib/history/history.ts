import type { Cell, City, Road, Country, HistoryEvent, HistoryYear, HistoryData, RegionData, ContinentData } from '../types';
import { generateRoads } from './roads';
import { World } from './physical/World';
import { Continent } from './physical/Continent';
import { Region, BIOME_TO_REGION_BIOME } from './physical/Region';
import { Resource, pickResourceType } from './physical/Resource';
import { CityEntity } from './physical/CityEntity';

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

const PHYSICAL_CITY_NAMES = [
  'Ironhold', 'Ashenvale', 'Stormgate', 'Rivenmoor', 'Coldhaven',
  'Embercrest', 'Thornwall', 'Silverpeak', 'Duskwood', 'Brightwater',
  'Frostmark', 'Grimstone', 'Oakhaven', 'Shadowmere', 'Goldmere',
  'Irondale', 'Wolfspire', 'Aldenmoor', 'Sunwatch', 'Bleakhaven',
  'Coppergate', 'Nightfall', 'Dawnrock', 'Stonehearth', 'Harrowfen',
  'Saltmere', 'Ravenwall', 'Duskreach', 'Brightford', 'Coldstone',
  'Ambervale', 'Thorngate', 'Ironwater', 'Ashmark', 'Stormvale',
  'Goldspire', 'Silvermoor', 'Frostwood', 'Grimhaven', 'Oakdale',
];

let _physicalCityNameIdx = 0;

function nextPhysicalCityName(): string {
  return PHYSICAL_CITY_NAMES[_physicalCityNameIdx++ % PHYSICAL_CITY_NAMES.length];
}

function scoreCellForCity(cell: Cell): number {
  if (cell.isWater || cell.elevation > 0.75) return -Infinity;
  let score = 0;
  if (cell.isCoast) score += 3;
  if (cell.riverFlow > 5) score += 2;
  if (cell.riverFlow > 15) score += 2;
  score -= cell.elevation * 4;
  score += cell.moisture * 1.5;
  return score;
}

/**
 * BFS through a set of eligible cells starting from a random seed.
 * Returns a geographically contiguous subset of up to maxCount cells.
 */
function bfsContiguousCells(
  cells: Cell[],
  eligible: number[],
  rng: () => number,
  maxCount: number
): number[] {
  if (eligible.length === 0) return [];
  const eligibleSet = new Set<number>(eligible);
  const seed = eligible[Math.floor(rng() * eligible.length)];
  const visited = new Set<number>([seed]);
  const queue: number[] = [seed];
  const result: number[] = [];
  let head = 0;
  while (head < queue.length && result.length < maxCount) {
    const current = queue[head++];
    result.push(current);
    for (const ni of cells[current].neighbors) {
      if (!visited.has(ni) && eligibleSet.has(ni)) {
        visited.add(ni);
        queue.push(ni);
      }
    }
  }
  return result;
}

/**
 * Grow a country's territory by claiming up to numToClaim unclaimed (-1) cells,
 * BFS-expanding from a single randomly chosen frontier cell rather than scanning
 * all cells in index order.
 */
function bfsExpand(
  cells: Cell[],
  ownership: Int16Array,
  ownershipDelta: Map<number, number>,
  countryId: number,
  numToClaim: number,
  rng: () => number
): number {
  const numCells = cells.length;
  const frontier: number[] = [];
  for (let i = 0; i < numCells; i++) {
    if (ownership[i] !== countryId) continue;
    for (const ni of cells[i].neighbors) {
      if (ownership[ni] === -1) { frontier.push(i); break; }
    }
  }
  if (frontier.length === 0) return 0;

  const seed = frontier[Math.floor(rng() * frontier.length)];
  const visitedOwned = new Set<number>([seed]);
  const queue: number[] = [seed];
  let claimed = 0;
  let head = 0;

  while (head < queue.length && claimed < numToClaim) {
    const current = queue[head++];
    for (const ni of cells[current].neighbors) {
      if (claimed >= numToClaim) break;
      if (ownership[ni] === -1) {
        ownership[ni] = countryId;
        ownershipDelta.set(ni, countryId);
        claimed++;
      } else if (ownership[ni] === countryId && !visitedOwned.has(ni)) {
        visitedOwned.add(ni);
        queue.push(ni);
      }
    }
  }
  return claimed;
}

/**
 * Eliminate isolated cells — cells with zero same-owner land neighbors —
 * by reassigning them to the majority neighboring owner.
 * Runs up to maxPasses times; stops early when no changes occur.
 */
function normalizeBorders(
  cells: Cell[],
  ownership: Int16Array,
  ownershipDelta: Map<number, number>,
  maxPasses = 3
): void {
  const numCells = cells.length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let i = 0; i < numCells; i++) {
      const owner = ownership[i];
      if (owner < 0) continue;
      const neighborOwnerCount = new Map<number, number>();
      let sameOwnerCount = 0;
      for (const ni of cells[i].neighbors) {
        if (cells[ni].isWater || ownership[ni] === -2) continue;
        const no = ownership[ni];
        if (no === owner) {
          sameOwnerCount++;
        } else if (no >= 0) {
          neighborOwnerCount.set(no, (neighborOwnerCount.get(no) ?? 0) + 1);
        }
        // no === -1 (unclaimed): counts as land for isolation detection
        // but doesn't vote for majority reassignment
      }
      if (sameOwnerCount > 0 || neighborOwnerCount.size === 0) continue;
      let majorityOwner = -1, maxCount = 0;
      for (const [id, count] of neighborOwnerCount) {
        if (count > maxCount) { maxCount = count; majorityOwner = id; }
      }
      ownership[i] = majorityOwner;
      ownershipDelta.set(i, majorityOwner);
      changed = true;
    }
    if (!changed) break;
  }
}

/**
 * Builds the physical world hierarchy (World → Continents → Regions → Cities/Resources)
 * from the terrain cells. Returns the World object plus serializable rendering data.
 */
export function buildPhysicalWorld(
  cells: Cell[],
  width: number,
  rng: () => number
): { world: World; regionData: RegionData[]; continentData: ContinentData[] } {
  _physicalCityNameIdx = 0;
  const numCells = cells.length;
  const world = new World(rng);

  // --- Step 1: Find continents via BFS flood-fill on connected land cells ---
  const cellContinent = new Int16Array(numCells).fill(-1);
  const continentCellGroups: number[][] = [];

  for (let i = 0; i < numCells; i++) {
    if (cells[i].isWater || cellContinent[i] !== -1) continue;
    const group: number[] = [];
    const queue = [i];
    cellContinent[i] = continentCellGroups.length;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      group.push(idx);
      for (const ni of cells[idx].neighbors) {
        if (!cells[ni].isWater && cellContinent[ni] === -1) {
          cellContinent[ni] = continentCellGroups.length;
          queue.push(ni);
        }
      }
    }
    continentCellGroups.push(group);
  }

  // Filter to meaningful continents (>= 10 cells)
  const validContinentGroups = continentCellGroups.filter(g => g.length >= 10);

  // --- Step 2: For each continent, cluster cells into regions ---
  const regionData: RegionData[] = [];
  const continentData: ContinentData[] = [];

  for (const continentCells of validContinentGroups) {
    const continent = new Continent(rng);

    // Target ~30 cells per region, minimum 1
    const targetRegionCount = Math.max(1, Math.floor(continentCells.length / 30));
    const minSeedSpacing2 = (width * 0.06) ** 2;

    // Pick region seeds with minimum spacing
    const seeds: number[] = [];
    // Shuffle continentCells order using rng for determinism
    const shuffled = [...continentCells].sort(() => rng() - 0.5);
    for (const idx of shuffled) {
      if (seeds.length >= targetRegionCount) break;
      const cell = cells[idx];
      const tooClose = seeds.some(s => {
        const sc = cells[s];
        return (sc.x - cell.x) ** 2 + (sc.y - cell.y) ** 2 < minSeedSpacing2;
      });
      if (!tooClose) seeds.push(idx);
    }
    // Fallback: if no seeds found (very small continent), use first cell
    if (seeds.length === 0 && continentCells.length > 0) {
      seeds.push(continentCells[0]);
    }

    // BFS multi-source fill: assign each land cell to nearest seed (by BFS order)
    const cellRegionSeed = new Map<number, number>(); // cellIdx → seedIdx
    const bfsQueue: number[] = [];
    for (let si = 0; si < seeds.length; si++) {
      cellRegionSeed.set(seeds[si], si);
      bfsQueue.push(seeds[si]);
    }
    let bfsHead = 0;
    while (bfsHead < bfsQueue.length) {
      const idx = bfsQueue[bfsHead++];
      const owner = cellRegionSeed.get(idx)!;
      for (const ni of cells[idx].neighbors) {
        if (!cells[ni].isWater && !cellRegionSeed.has(ni) && continentCells.includes(ni)) {
          cellRegionSeed.set(ni, owner);
          bfsQueue.push(ni);
        }
      }
    }

    // Group cells by seed → Region
    const seedToRegion = new Map<number, Region>();
    for (let si = 0; si < seeds.length; si++) {
      // Determine dominant biome for this region
      const biomeCounts = new Map<string, number>();
      for (const [cellIdx, seedIdx] of cellRegionSeed) {
        if (seedIdx !== si) continue;
        const b = cells[cellIdx].biome;
        biomeCounts.set(b, (biomeCounts.get(b) ?? 0) + 1);
      }
      let dominantBiome = 'GRASSLAND';
      let maxCount = 0;
      for (const [b, count] of biomeCounts) {
        if (count > maxCount) { maxCount = count; dominantBiome = b; }
      }
      const regionBiome = BIOME_TO_REGION_BIOME[dominantBiome as keyof typeof BIOME_TO_REGION_BIOME] ?? 'temperate';
      const region = new Region(regionBiome, rng);
      region.continentId = continent.id;
      seedToRegion.set(si, region);
    }

    // Assign cells to regions and annotate cell.regionId
    for (const [cellIdx, seedIdx] of cellRegionSeed) {
      const region = seedToRegion.get(seedIdx);
      if (!region) continue;
      region.cellIndices.push(cellIdx);
      cells[cellIdx].regionId = region.id;
    }

    // Build region neighbour relationships
    for (const [cellIdx, seedIdx] of cellRegionSeed) {
      const region = seedToRegion.get(seedIdx)!;
      for (const ni of cells[cellIdx].neighbors) {
        const nSeed = cellRegionSeed.get(ni);
        if (nSeed !== undefined && nSeed !== seedIdx) {
          const nRegion = seedToRegion.get(nSeed)!;
          region.neighbours.add(nRegion.id);
        }
      }
    }
    for (const region of seedToRegion.values()) {
      region.neighbourRegions = Array.from(region.neighbours)
        .map(id => {
          for (const r of seedToRegion.values()) {
            if (r.id === id) return r;
          }
          return null;
        })
        .filter((r): r is Region => r !== null);
    }

    // --- Step 3: Place resources in each region ---
    for (const region of seedToRegion.values()) {
      const count = Math.floor(rng() * 10) + 1;
      for (let i = 0; i < count; i++) {
        const type = pickResourceType(rng);
        region.resources.push(new Resource(type, rng));
      }
      region.updateHasResources();
    }

    // --- Step 4: Place cities in each region ---
    const globalMinCityDist2 = (width * 0.04) ** 2;
    const globalPlacedCityCells: number[] = [];

    for (const region of seedToRegion.values()) {
      const landCells = region.cellIndices
        .filter(ci => !cells[ci].isWater && cells[ci].elevation < 0.75)
        .sort((a, b) => scoreCellForCity(cells[b]) - scoreCellForCity(cells[a]));

      if (landCells.length === 0) continue;

      const cityCount = Math.floor(rng() * 5) + 1;
      let placed = 0;

      for (const ci of landCells) {
        if (placed >= cityCount) break;
        const cell = cells[ci];
        const tooClose = globalPlacedCityCells.some(gi => {
          const gc = cells[gi];
          return (gc.x - cell.x) ** 2 + (gc.y - cell.y) ** 2 < globalMinCityDist2;
        });
        if (tooClose) continue;

        const cityEntity = new CityEntity(ci, nextPhysicalCityName(), rng);
        cityEntity.regionId = region.id;
        region.cities.push(cityEntity);
        globalPlacedCityCells.push(ci);
        placed++;
      }
    }

    // Attach regions to continent
    for (const region of seedToRegion.values()) {
      continent.regions.push(region);
    }

    // Build rendering data
    const continentRegionIds: string[] = [];
    for (const region of seedToRegion.values()) {
      // Primary resource = first resource (deterministic)
      const primaryResourceType = region.resources[0]?.type;
      regionData.push({
        id: region.id,
        cellIndices: region.cellIndices,
        biome: region.biome,
        continentId: continent.id,
        primaryResourceType,
      });
      continentRegionIds.push(region.id);
    }
    continentData.push({ id: continent.id, regionIds: continentRegionIds });

    world.addContinent(continent);
  }

  return { world, regionData, continentData };
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
): { cities: City[]; roads: Road[]; historyData: HistoryData; regions: RegionData[]; continents: ContinentData[] } {
  const numCells = cells.length;

  // --- Phase 0: Build physical world (continents, regions, resources, cities) ---
  const { regionData, continentData } = buildPhysicalWorld(cells, width, rng);

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
      const claimed = bfsExpand(cells, ownership, ownershipDelta, country.id, numToClaim, rng);
      if (claimed > 0) {
        cellCounts.set(country.id, (cellCounts.get(country.id) ?? 0) + claimed);
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
      const taken = bfsContiguousCells(cells, loserBorderCells, rng, numToTake);

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

    normalizeBorders(cells, ownership, ownershipDelta);

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

  return { cities, roads, historyData, regions: regionData, continents: continentData };
}
