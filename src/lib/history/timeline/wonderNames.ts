import type { ResourceType } from '../physical/ResourceCatalog';

/**
 * Wonder tier system — 10 tiers with fantasy/sci-fi progression, 50 names
 * per tier (500 total), and per-tier resource requirements.
 *
 * Purely cosmetic + balance metadata: resolved at generation time inside
 * `Wonder.ts` (tier/resource checks) and serialization time inside
 * `HistoryGenerator.ts` (name stamped onto WONDER events).
 *
 * IMPORTANT: This table is flavor metadata + balance config, never
 * simulation state beyond the generation moment. Import from `Wonder.ts`
 * and `HistoryGenerator.ts` only.
 */

/** Display names for each wonder tier (1-indexed). */
export const WONDER_TIER_NAMES: readonly string[] = [
  '', // index 0 unused
  'Monument',
  'Edifice',
  'Marvel',
  'Colossus',
  'Arcanum',
  'Celestium',
  'Dominion',
  'Nexus',
  'Ascendancy',
  'Apotheosis',
];

/**
 * 50 wonder names per tier, indexed 0-9 (tier 1 = index 0).
 * Tiers 1-3: historical/ancient inspiration.
 * Tiers 4-6: fantasy inspiration.
 * Tiers 7-10: science fiction inspiration.
 */
export const WONDER_NAMES: readonly string[][] = [
  // ── Tier 1: Monument (historical/primitive) ──
  [
    'The Standing Stones', 'Ancestor\'s Barrow', 'The Great Timber Hall',
    'Circle of the Sun', 'The Stone Cairn', 'The Sacred Grove',
    'The Bone Arch', 'The Offering Mound', 'The First Hearth',
    'The Elder Totem', 'The Painted Cave', 'The Reed Temple',
    'The Chalk Giant', 'The Flint Spire', 'The Wattle Shrine',
    'The Clay Colossus', 'The Shell Midden Tower', 'The Obsidian Altar',
    'The Mammoth Gate', 'The Tidewater Cairn', 'The Peat Throne',
    'The Antler Crown', 'The Ash Circle', 'The Pilgrim\'s Dolmen',
    'The Hearthstone Ring', 'The Storm Monolith', 'The Ochre Sanctum',
    'The Wolf Shrine', 'The Granite Sentinel', 'The Amber Throne',
    'The Horn of Gathering', 'The Firewalker\'s Path', 'The Stargazer\'s Mound',
    'The Serpent Effigy', 'The Thunder Rock', 'The Moon Pool',
    'The Hawk Perch', 'The Iron Bog Shrine', 'The Cinder Altar',
    'The Briar Gate', 'The Salt Pillar', 'The Dust Obelisk',
    'The River Marker', 'The Goat Stone', 'The Tusk Arch',
    'The Ember Pit', 'The Weeping Stone', 'The Dawn Pillar',
    'The Shadow Cairn', 'The Bone Spire',
  ],
  // ── Tier 2: Edifice (early civilization) ──
  [
    'The Bronze Ziggurat', 'The Ivory Colonnade', 'The Cedar Palace',
    'The Sun King\'s Tomb', 'The Canal of Prosperity', 'The Lion Gate',
    'The Serpent Wall', 'The Jade Pavilion', 'The Sandstone Amphitheater',
    'The Gilded Granary', 'The Oracle\'s Basin', 'The Copper Beacon',
    'The Lotus Fountain', 'The Obsidian Pyramid', 'The Bull Court',
    'The Sphinx Corridor', 'The Falcon Obelisk', 'The Ancestor\'s Archive',
    'The Painted Cloister', 'The Feathered Altar', 'The Tide Gate',
    'The Scorpion Throne', 'The Basalt Forum', 'The Palm Colonnade',
    'The River Palace', 'The Star Chamber', 'The Merchant\'s Vault',
    'The Harvest Temple', 'The Warden\'s Tower', 'The Scarab Gate',
    'The Pearl Cistern', 'The Coral Terrace', 'The Ochre Library',
    'The Elephant Walk', 'The Crane Pagoda', 'The Emerald Court',
    'The Dusk Pavilion', 'The Onyx Shrine', 'The Sandstorm Wall',
    'The Reed Basilica', 'The Saffron Tower', 'The Granite Wharf',
    'The Amber Observatory', 'The Chariot Monument', 'The Vulture Arch',
    'The Myrrh Sanctum', 'The Turquoise Hall', 'The Bison Frieze',
    'The Moonstone Gate', 'The Thunder Drum Tower',
  ],
  // ── Tier 3: Marvel (classical era) ──
  [
    'The Marble Colosseum', 'The Hanging Gardens', 'The Lighthouse of Storms',
    'The Philosopher\'s Lyceum', 'The Aqueduct of Ages', 'The Senate Rotunda',
    'The Triumphal Arch', 'The Library of All Tongues', 'The Golden Hippodrome',
    'The Thermal Baths', 'The Mosaic Cathedral', 'The Iron Bridge',
    'The Amphitheater of Echoes', 'The Porcelain Pagoda', 'The Silk Road Caravanserai',
    'The Jade Emperor\'s Hall', 'The Forum of Justice', 'The Obelisk of Unity',
    'The Harbor Colossus', 'The Pantheon of Stars', 'The Crystal Bathhouse',
    'The Terracotta Legion', 'The Ivory Tower', 'The Grand Bazaar',
    'The Crimson Arena', 'The Midnight Sundial', 'The Coral Acropolis',
    'The Silver Agora', 'The Atlas Pillar', 'The Obsidian Amphitheater',
    'The Titan\'s Causeway', 'The Sapphire Minaret', 'The Oak Parliament',
    'The Dragon Frieze', 'The Sunken Forum', 'The Copper Dome',
    'The Winged Victory', 'The Marble Oracle', 'The Gilded Ark',
    'The Sandstone Citadel', 'The Alabaster Cloister', 'The Thundergate Bridge',
    'The Pearl Lighthouse', 'The Granite Colossus', 'The Ebony Throne Hall',
    'The Laurel Amphitheater', 'The Crystal Obelisk', 'The Bronze Astrolabe',
    'The Mithril Gate', 'The Celestial Orrery',
  ],
  // ── Tier 4: Colossus (imperial scale) ──
  [
    'The Emperor\'s Citadel', 'The Fortress of Ten Thousand Shields',
    'The Cathedral of Radiance', 'The Iron Colossus', 'The Grand Canal',
    'The Vault of the Realm', 'The Crown Spire', 'The War Memorial Eternal',
    'The Palace of Mirrors', 'The Obsidian Bastion', 'The Dreadnought Docks',
    'The Parliament of Crowns', 'The Steel Viaduct', 'The Titan Forge',
    'The Crimson Cathedral', 'The Midnight Fortress', 'The Clockwork Citadel',
    'The Ivory Bastion', 'The Siege Engine Monument', 'The Imperial Observatory',
    'The Dragon Keep', 'The Thunderclap Tower', 'The Jade Fortress',
    'The Stormwall Battlement', 'The Gilded Armory', 'The Granite Imperium',
    'The Iron Parliament', 'The Blood Obelisk', 'The Frost Citadel',
    'The Sunfire Beacon', 'The Wardens\' Redoubt', 'The Steel Cathedral',
    'The Eagle\'s Aerie', 'The Bone Fortress', 'The Sapphire Keep',
    'The Siege Eternal', 'The Crown of Storms', 'The Volcanic Forge',
    'The Mithril Bastion', 'The Obsidian Throne', 'The Hammer Monument',
    'The Crimson Bulwark', 'The Glacier Fortress', 'The Sandstorm Citadel',
    'The Wolf\'s Redoubt', 'The Thunder Keep', 'The Coral Stronghold',
    'The Diamond Battlement', 'The Wyvern Roost', 'The Titan\'s Throne',
  ],
  // ── Tier 5: Arcanum (mystical/magical) ──
  [
    'The Spellforge Citadel', 'The Prismatic Observatory', 'The Astral Beacon',
    'The Enchanted Labyrinth', 'The Crystal Sanctum', 'The Runebound Tower',
    'The Ethereal Bridge', 'The Moonwell Temple', 'The Arcane Athenaeum',
    'The Stormcaller\'s Spire', 'The Dreamwalker\'s Gate', 'The Phoenix Pyre',
    'The Shadowmere Keep', 'The Starweaver\'s Loom', 'The Elemental Crucible',
    'The Frostfire Citadel', 'The Wyrdstone Obelisk', 'The Soulforge',
    'The Verdant Sanctum', 'The Tempest Spire', 'The Twilight Observatory',
    'The Dragonbone Archive', 'The Voidmirror Hall', 'The Celestial Loom',
    'The Thunderheart Shrine', 'The Emerald Orrery', 'The Ironbloom Garden',
    'The Mistwalker\'s Tower', 'The Sunstone Citadel', 'The Wraithgate',
    'The Bloodmoon Altar', 'The Silverwind Spire', 'The Thornwall Sanctum',
    'The Oracle\'s Eye', 'The Living Fortress', 'The Crystalspine Cathedral',
    'The Windcaller\'s Peak', 'The Nethervault', 'The Radiant Atrium',
    'The Grimoire Vault', 'The Flameheart Forge', 'The Tidecaller\'s Throne',
    'The Stardust Reliquary', 'The Spiritwood Shrine', 'The Hexwall Bastion',
    'The Fateweaver\'s Tower', 'The Obsidian Sanctum', 'The Runegate',
    'The Dreamspire', 'The Archon\'s Crucible',
  ],
  // ── Tier 6: Celestium (transcendent/divine) ──
  [
    'The Celestial Basilica', 'The Sunforge', 'The Adamantine Spire',
    'The Temple of Infinite Light', 'The Crystalline Dome', 'The Aether Conduit',
    'The Seraph\'s Crown', 'The Luminous Vault', 'The Harmonic Cathedral',
    'The Astral Palace', 'The Garden of Eternity', 'The Skybridge Eternal',
    'The Radiant Pinnacle', 'The Solarium of Ages', 'The Diamond Cathedral',
    'The Empyrean Gate', 'The Starcrown Citadel', 'The Hallowed Colossus',
    'The Aurelian Throne', 'The Lightweaver\'s Spire', 'The Opalescent Tower',
    'The Sanctuary of Echoes', 'The Golden Firmament', 'The Chrysalis Sanctum',
    'The Platinum Nave', 'The Verdant Ascension', 'The Moonfire Basilica',
    'The Silver Empyrean', 'The Prismheart Cathedral', 'The Eternal Beacon',
    'The Dawnspire', 'The Ivory Ascension', 'The Throne of Radiance',
    'The Sapphire Firmament', 'The Glorium', 'The Halo Sanctum',
    'The Everglow Citadel', 'The Cathedral of Whispers', 'The Sunlit Reliquary',
    'The Gilded Eternity', 'The Amethyst Spire', 'The Celestine Vault',
    'The Lightfall Shrine', 'The Palladium Throne', 'The Angelic Bastion',
    'The Resplendent Tower', 'The Zenith Basilica', 'The Astral Reliquary',
    'The Corona Sanctum', 'The Infinite Nave',
  ],
  // ── Tier 7: Dominion (early sci-fi/industrial mega) ──
  [
    'The Ironclad Megaplex', 'The Steam Colossus', 'The Cogwork Parliament',
    'The Voltaic Spire', 'The Pneumatic Citadel', 'The Analytical Engine',
    'The Tesla Obelisk', 'The Dynamo Cathedral', 'The Chrome Ziggurat',
    'The Turbine Fortress', 'The Automaton Foundry', 'The Aether Reactor',
    'The Brass Leviathan', 'The Galvanic Tower', 'The Clockwork Colossus',
    'The Magnetic Rail Nexus', 'The Neon Acropolis', 'The Radium Spire',
    'The Mercury Pavilion', 'The Titanium Dome', 'The Photonic Beacon',
    'The Hydraulic Throne', 'The Carbon Monolith', 'The Ionic Column',
    'The Fusion Hearth', 'The Electrum Cathedral', 'The Ferrite Bastion',
    'The Tungsten Crucible', 'The Cobalt Spire', 'The Nickel Vault',
    'The Alloy Parliament', 'The Graphene Tower', 'The Polymer Sanctum',
    'The Circuit Basilica', 'The Silicone Dome', 'The Reactor Throne',
    'The Steel Meridian', 'The Arc Forge', 'The Chromium Keep',
    'The Thermal Pinnacle', 'The Plasma Hearth', 'The Magnetic Throne',
    'The Lithium Spire', 'The Beryllium Vault', 'The Neutron Citadel',
    'The Iridium Crown', 'The Osmium Gate', 'The Palladium Forge',
    'The Radiant Reactor', 'The Engine Eternal',
  ],
  // ── Tier 8: Nexus (advanced sci-fi) ──
  [
    'The Quantum Basilica', 'The Orbital Ring', 'The Gravity Well Shrine',
    'The Antimatter Reliquary', 'The Photon Cathedral', 'The Dark Matter Vault',
    'The Tachyon Spire', 'The Warp Gate', 'The Dyson Shrine',
    'The Neural Cathedral', 'The Singularity Beacon', 'The Zero-Point Tower',
    'The Graviton Throne', 'The Quasar Forge', 'The Nebula Sanctum',
    'The Event Horizon Gate', 'The Fusion Citadel', 'The Pulsar Obelisk',
    'The Chronon Vault', 'The Magneton Spire', 'The Subspace Nexus',
    'The Particle Basilica', 'The Stellar Foundry', 'The Plasma Reliquary',
    'The Hadron Cathedral', 'The Muon Sanctum', 'The Boson Gate',
    'The Lepton Throne', 'The Gluon Spire', 'The Fermion Vault',
    'The Neutrino Beacon', 'The Photonic Citadel', 'The Ion Cathedral',
    'The Meson Forge', 'The Baryon Obelisk', 'The Positron Tower',
    'The Axion Reliquary', 'The Preon Sanctum', 'The Higgs Basilica',
    'The Gravitino Spire', 'The Tachyon Citadel', 'The Planck Gate',
    'The Kaon Vault', 'The Pion Throne', 'The Sigma Beacon',
    'The Lambda Forge', 'The Omega Catheral', 'The Xi Sanctum',
    'The Delta Citadel', 'The Theta Obelisk',
  ],
  // ── Tier 9: Ascendancy (cosmic scale) ──
  [
    'The Dyson Sphere Fragment', 'The Stellar Engine', 'The Cosmic Loom',
    'The Galactic Beacon', 'The Void Citadel', 'The Entropy Reverser',
    'The Dark Energy Conduit', 'The Dimension Gate', 'The Reality Anchor',
    'The Temporal Basilica', 'The Universe Mirror', 'The Cosmic String Harp',
    'The Multiverse Beacon', 'The Infinity Vault', 'The Eternity Forge',
    'The Spacetime Cathedral', 'The Quantum Foam Sanctum', 'The Brane Walker',
    'The Cosmic Ray Throne', 'The Supercluster Spire', 'The Filament Bridge',
    'The Void Whale Shrine', 'The Magnetar Forge', 'The Quasar Throne',
    'The Neutron Star Citadel', 'The Black Hole Oracle', 'The White Hole Gate',
    'The Pulsar Clock', 'The Nebula Cradle', 'The Cosmic Web Sanctum',
    'The Dark Flow Beacon', 'The Great Attractor Shrine', 'The Hubble Vault',
    'The Redshift Spire', 'The Blueshift Gate', 'The Cosmic Dawn Tower',
    'The Inflation Relic', 'The Baryon Acoustic Throne', 'The Lensing Cathedral',
    'The Parallax Obelisk', 'The Cepheid Beacon', 'The Chandrasekhar Vault',
    'The Schwarzschild Gate', 'The Hawking Sanctum', 'The Penrose Citadel',
    'The Boltzmann Throne', 'The Planck Epoch Forge', 'The Fermi Paradox Shrine',
    'The Drake Beacon', 'The Kardashev Spire',
  ],
  // ── Tier 10: Apotheosis (reality-altering/mythic) ──
  [
    'The World Engine', 'The Throne of the Void', 'The Eternal Codex',
    'The Genesis Forge', 'The Omniscient Eye', 'The Reality Loom',
    'The Akashic Archive', 'The Philosopher\'s Apotheosis', 'The Godmind Citadel',
    'The Singularity Throne', 'The Omega Point', 'The Universal Consciousness',
    'The Infinity Engine', 'The Eschaton Gate', 'The Final Theorem',
    'The Cosmic Seed', 'The Matrioshka Brain', 'The Boltzmann Cathedral',
    'The Tipler Oracle', 'The Maxwell Daemon Shrine', 'The Laplace Sanctum',
    'The Noosphere Crown', 'The Logos Spire', 'The Pleroma Vault',
    'The Monad Throne', 'The Axis Mundi', 'The Uroboros Gate',
    'The Yggdrasil Engine', 'The Brahma Crucible', 'The Atman Beacon',
    'The Dharma Wheel', 'The Tao Nexus', 'The Anima Mundi Sanctum',
    'The Sophia Crown', 'The Nous Cathedral', 'The Demiurge Forge',
    'The Pneuma Spire', 'The Henosis Gate', 'The Theurgy Throne',
    'The Emanation Vault', 'The Palingenesis Beacon', 'The Metempsychosis Shrine',
    'The Apokatastasis Citadel', 'The Theophany Sanctum', 'The Hierophany Crown',
    'The Kratophany Forge', 'The Mysterium Tremendum', 'The Coincidentia Oppositorum',
    'The Ungrund Throne', 'The Absolute Sanctum',
  ],
];

/**
 * Per-tier resource requirements. Index 0 = tier 1.
 * `types` lists the required ResourceType values.
 * `costPerResource` is the amount consumed from each (= tier number).
 */
export const WONDER_TIER_RESOURCES: readonly { types: readonly ResourceType[]; costPerResource: number }[] = [
  { types: ['timber', 'limestone'],                                              costPerResource: 1 },
  { types: ['timber', 'limestone', 'copper'],                                    costPerResource: 2 },
  { types: ['iron', 'granite', 'timber'],                                        costPerResource: 3 },
  { types: ['iron', 'granite', 'marble', 'coal'],                                costPerResource: 4 },
  { types: ['marble', 'gold', 'coal', 'hardwood'],                               costPerResource: 5 },
  { types: ['gold', 'silver', 'diamonds', 'marble', 'coal'],                     costPerResource: 6 },
  { types: ['gold', 'silver', 'obsidian', 'silk', 'oil'],                        costPerResource: 7 },
  { types: ['platinum', 'diamonds', 'obsidian', 'uranium', 'oil'],               costPerResource: 8 },
  { types: ['platinum', 'uranium', 'diamonds', 'rubies', 'sapphires', 'oil'],    costPerResource: 9 },
  { types: ['platinum', 'uranium', 'granite', 'diamonds', 'gold', 'obsidian', 'rubies', 'silk'], costPerResource: 10 },
];

/** Total tech levels required for each tier (index 0 = tier 1). */
export const WONDER_TIER_TECH_REQUIREMENT: readonly number[] = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
];

/**
 * Pick a random unused wonder name for the given tier.
 * Falls back to "{TierName} Wonder #{n}" if all 50 are exhausted.
 */
export function pickWonderName(
  rng: () => number,
  tier: number,
  usedNames: Set<string>,
): string {
  const tierIndex = Math.max(0, Math.min(tier - 1, WONDER_NAMES.length - 1));
  const pool = WONDER_NAMES[tierIndex];

  // Collect unused names
  const available: string[] = [];
  for (const name of pool) {
    if (!usedNames.has(name)) available.push(name);
  }

  if (available.length > 0) {
    const pick = available[Math.floor(rng() * available.length)];
    usedNames.add(pick);
    return pick;
  }

  // Exhaustion fallback: generate a numbered name
  const tierName = WONDER_TIER_NAMES[tier] ?? 'Wonder';
  let n = 1;
  let fallback = `${tierName} Wonder #${n}`;
  while (usedNames.has(fallback)) {
    n++;
    fallback = `${tierName} Wonder #${n}`;
  }
  usedNames.add(fallback);
  return fallback;
}
