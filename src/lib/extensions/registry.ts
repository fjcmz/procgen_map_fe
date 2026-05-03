import type { TerrainProfile } from '../types';
import { DEFAULT_PACK } from './builtins';
import type {
  ExtensionPack,
  PackedPalette,
  PackedRollRule,
  PackedSubtype,
  PackedUniverseScope,
  PackedWorldScope,
} from './types';

/**
 * Resolved snapshot of the active universe catalogue. Built from the default
 * pack + all loaded packs (in load order). Sent into the universe worker per
 * generation request so the worker stays stateless.
 */
export interface UniverseCatalogueSnapshot {
  planet: {
    subtypes: PackedSubtype[];
    /** subtype id → composition lookup. */
    composition: Record<string, string>;
    /** subtype id → palette lookup, used by the renderer. */
    palettes: Record<string, PackedPalette>;
    rollRules: PackedRollRule[];
    biomeMap: Record<string, string>;
    biomeWeights: { until: number; biome: string }[];
  };
  satellite: {
    subtypes: PackedSubtype[];
    composition: Record<string, string>;
    palettes: Record<string, PackedPalette>;
    rollRules: PackedRollRule[];
    biomeMap: Record<string, string>;
    biomeWeights: { until: number; biome: string }[];
  };
  /** Biome id → palette for life-bearing rock bodies. */
  biomePalettes: Record<string, PackedPalette>;
  /** All biome ids known to the registry — drives the biome roll's catch-all. */
  biomes: string[];
}

/** Resolved snapshot of the active world-map catalogue. */
export interface WorldCatalogueSnapshot {
  terrainProfiles: Record<string, TerrainProfile>;
  terrainShapes: Record<string, Partial<TerrainProfile>>;
  profileWaterRatios: Record<string, number>;
  biomeToProfile: Record<string, string>;
  profileLabels: Record<string, string>;
  shapeLabels: Record<string, string>;
  profileBadgeColors: Record<string, string>;
}

type Listener = () => void;

class Registry {
  private packs: ExtensionPack[] = [];
  private listeners = new Set<Listener>();
  private universeCache: UniverseCatalogueSnapshot | null = null;
  private worldCache: WorldCatalogueSnapshot | null = null;

  /** Currently loaded user packs (the default pack is always implicit). */
  getLoadedPacks(): ReadonlyArray<ExtensionPack> {
    return this.packs;
  }

  loadPack(pack: ExtensionPack): void {
    // Replace if a pack with the same id is already loaded.
    const idx = this.packs.findIndex(p => p.id === pack.id);
    if (idx >= 0) this.packs[idx] = pack;
    else this.packs.push(pack);
    this.invalidate();
  }

  unloadPack(id: string): void {
    const before = this.packs.length;
    this.packs = this.packs.filter(p => p.id !== id);
    if (this.packs.length !== before) this.invalidate();
  }

  unloadAll(): void {
    if (this.packs.length === 0) return;
    this.packs = [];
    this.invalidate();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getUniverseCatalogue(): UniverseCatalogueSnapshot {
    if (this.universeCache) return this.universeCache;
    this.universeCache = buildUniverseCatalogue(this.allPacks());
    return this.universeCache;
  }

  getWorldCatalogue(): WorldCatalogueSnapshot {
    if (this.worldCache) return this.worldCache;
    this.worldCache = buildWorldCatalogue(this.allPacks());
    return this.worldCache;
  }

  /**
   * Resolve a profile name + shape name + optional overrides into the fully-
   * merged TerrainProfile that the worker would have computed before. Three-
   * way merge order matches `mapgen.worker.ts`: profile → shape → overrides.
   */
  resolveTerrainProfile(profileName: string, shapeName: string, overrides?: Partial<TerrainProfile>): TerrainProfile {
    const cat = this.getWorldCatalogue();
    const base = cat.terrainProfiles[profileName] ?? cat.terrainProfiles.default;
    const shape = cat.terrainShapes[shapeName] ?? {};
    return { ...base, ...shape, ...(overrides ?? {}) };
  }

  private allPacks(): ExtensionPack[] {
    // Default pack is always the seed; user packs layer on top in load order.
    return [DEFAULT_PACK, ...this.packs];
  }

  private invalidate(): void {
    this.universeCache = null;
    this.worldCache = null;
    for (const l of this.listeners) l();
  }
}

function buildUniverseCatalogue(packs: ExtensionPack[]): UniverseCatalogueSnapshot {
  // Start with empty accumulators; default pack supplies the seed values.
  let planetSubtypes: PackedSubtype[] = [];
  let planetRules: PackedRollRule[] = [];
  let planetBiomeMap: Record<string, string> = {};
  let planetBiomeWeights: { until: number; biome: string }[] = [];
  let satSubtypes: PackedSubtype[] = [];
  let satRules: PackedRollRule[] = [];
  let satBiomeMap: Record<string, string> = {};
  let satBiomeWeights: { until: number; biome: string }[] = [];
  let biomePalettes: Record<string, PackedPalette> = {};

  for (const pack of packs) {
    const u: PackedUniverseScope | undefined = pack.universe;
    if (!u) continue;
    const replace = pack.mode === 'replace';

    if (u.planet) {
      if (u.planet.subtypes) {
        planetSubtypes = replace ? u.planet.subtypes.slice() : mergeSubtypes(planetSubtypes, u.planet.subtypes);
      }
      if (u.planet.rollRules) {
        planetRules = replace ? u.planet.rollRules.slice() : [...planetRules, ...u.planet.rollRules];
      }
      if (u.planet.biomeMap) {
        planetBiomeMap = replace ? { ...u.planet.biomeMap } : { ...planetBiomeMap, ...u.planet.biomeMap };
      }
      if (u.planet.biomeWeights) {
        planetBiomeWeights = replace ? u.planet.biomeWeights.slice() : u.planet.biomeWeights.slice();
      }
    }
    if (u.satellite) {
      if (u.satellite.subtypes) {
        satSubtypes = replace ? u.satellite.subtypes.slice() : mergeSubtypes(satSubtypes, u.satellite.subtypes);
      }
      if (u.satellite.rollRules) {
        satRules = replace ? u.satellite.rollRules.slice() : [...satRules, ...u.satellite.rollRules];
      }
      if (u.satellite.biomeMap) {
        satBiomeMap = replace ? { ...u.satellite.biomeMap } : { ...satBiomeMap, ...u.satellite.biomeMap };
      }
      if (u.satellite.biomeWeights) {
        satBiomeWeights = replace ? u.satellite.biomeWeights.slice() : u.satellite.biomeWeights.slice();
      }
    }
    if (u.biomePalettes) {
      biomePalettes = replace ? { ...u.biomePalettes } : { ...biomePalettes, ...u.biomePalettes };
    }
  }

  const planetComposition: Record<string, string> = {};
  const planetPalettes: Record<string, PackedPalette> = {};
  for (const s of planetSubtypes) {
    planetComposition[s.id] = s.composition;
    planetPalettes[s.id] = s.palette;
  }
  const satComposition: Record<string, string> = {};
  const satPalettes: Record<string, PackedPalette> = {};
  for (const s of satSubtypes) {
    satComposition[s.id] = s.composition;
    satPalettes[s.id] = s.palette;
  }

  // Biome list is the union of all biomes that appear anywhere — biome maps,
  // biome palettes, biome weights. Used by callers that want to enumerate.
  const biomes = new Set<string>();
  for (const e of planetBiomeWeights) biomes.add(e.biome);
  for (const e of satBiomeWeights) biomes.add(e.biome);
  for (const k of Object.keys(planetBiomeMap)) biomes.add(k);
  for (const k of Object.keys(biomePalettes)) biomes.add(k);

  return {
    planet: {
      subtypes: planetSubtypes,
      composition: planetComposition,
      palettes: planetPalettes,
      rollRules: planetRules,
      biomeMap: planetBiomeMap,
      biomeWeights: planetBiomeWeights,
    },
    satellite: {
      subtypes: satSubtypes,
      composition: satComposition,
      palettes: satPalettes,
      rollRules: satRules,
      biomeMap: satBiomeMap,
      biomeWeights: satBiomeWeights,
    },
    biomePalettes,
    biomes: Array.from(biomes),
  };
}

function mergeSubtypes(existing: PackedSubtype[], incoming: PackedSubtype[]): PackedSubtype[] {
  const byId = new Map<string, PackedSubtype>();
  for (const s of existing) byId.set(s.id, s);
  for (const s of incoming) byId.set(s.id, s);
  return Array.from(byId.values());
}

function buildWorldCatalogue(packs: ExtensionPack[]): WorldCatalogueSnapshot {
  let terrainProfiles: Record<string, TerrainProfile> = {};
  let terrainShapes: Record<string, Partial<TerrainProfile>> = {};
  let profileWaterRatios: Record<string, number> = {};
  let biomeToProfile: Record<string, string> = {};
  let profileLabels: Record<string, string> = {};
  let shapeLabels: Record<string, string> = {};
  let profileBadgeColors: Record<string, string> = {};

  for (const pack of packs) {
    const w: PackedWorldScope | undefined = pack.world;
    if (!w) continue;
    const replace = pack.mode === 'replace';

    if (w.terrainProfiles) {
      terrainProfiles = replace ? { ...w.terrainProfiles } : { ...terrainProfiles, ...w.terrainProfiles };
    }
    if (w.terrainShapes) {
      terrainShapes = replace ? { ...w.terrainShapes } : { ...terrainShapes, ...w.terrainShapes };
    }
    if (w.profileWaterRatios) {
      profileWaterRatios = replace ? { ...w.profileWaterRatios } : { ...profileWaterRatios, ...w.profileWaterRatios };
    }
    if (w.biomeToProfile) {
      biomeToProfile = replace ? { ...w.biomeToProfile } : { ...biomeToProfile, ...w.biomeToProfile };
    }
    if (w.profileLabels) {
      profileLabels = replace ? { ...w.profileLabels } : { ...profileLabels, ...w.profileLabels };
    }
    if (w.shapeLabels) {
      shapeLabels = replace ? { ...w.shapeLabels } : { ...shapeLabels, ...w.shapeLabels };
    }
    if (w.profileBadgeColors) {
      profileBadgeColors = replace ? { ...w.profileBadgeColors } : { ...profileBadgeColors, ...w.profileBadgeColors };
    }
  }

  return {
    terrainProfiles,
    terrainShapes,
    profileWaterRatios,
    biomeToProfile,
    profileLabels,
    shapeLabels,
    profileBadgeColors,
  };
}

/** Singleton — modules import this and main-thread code subscribes to changes. */
export const extensionRegistry = new Registry();
