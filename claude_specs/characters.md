# Characters (PCs / NPCs)

This file documents the **character generation layer** — the deterministic D&D 3.5e character roller that turns simulation metadata (race / deity / alignment) into PC rosters when a city is opened in the Details tab. Read `universe_map.md` for framework conventions and `world_history.md` for the simulation-side metadata that feeds this layer.

## Two Layers

The character system is split into:

- **`src/lib/fantasy/`** — the underlying D&D 3.5e engine. Pure data + RNG-driven rollers. No simulation knowledge.
- **`src/lib/citychars.ts`** — the UI-only lazy roster roller for the Details tab. Bridges the simulation's race/deity/alignment metadata to the fantasy roller.

## fantasy/ Engine

`src/lib/fantasy/` exports `RaceType`, `Deity`, `AlignmentType`, race specs (`RACE_SPECS`), deity specs (`DEITY_SPECS`), and two character rollers:

- **`generatePcChar(level, parentAlignment, rng)`** — frozen 3-arg signature. The original unbiased roller.
- **`generatePcCharBiased(level, parentAlignment, rng, opts)`** — biased entry point added by this layer. Accepts optional `{ raceWeights?, deityWeights? }` to skew the roll toward a country's `raceBias` / a religion's `deity`.

The biased roller does NOT mutate `RACE_SPECS` / `DEITY_SPECS` — it constructs **local biased copies** inside the function and discards them at return. Calling `generatePcCharBiased(level, alignment, rng, {})` (or omitting `opts`) is byte-identical to `generatePcChar`. If you add a new bias dimension (e.g. class), follow the same local-copy pattern — never mutate the shared spec records, or any future call site that runs in parallel will silently observe a stale weight table.

## Simulation-Side Metadata

Three new fields feed the roster roll. All are populated during simulation and serialized into `HistoryData` for the UI to consume.

### `Country.raceBias: { primary: RaceType; secondary?: RaceType }`

Picked at country founding in `CountryGenerator.generate` from a PRNG sub-stream `seededPRNG(`${world.seed}_racebias_${country.id}`)`, weighted by the founding region's biome via `BIOME_RACE_WEIGHTS` (forests/temperate → human + elf + halfling, mountains/tundra → dwarf + gnome, deserts → orc + half-orc).

60% chance of a meaningful secondary race; otherwise mono-cultural.

The base race-prob snapshot lives in `Country.ts::BASE_RACE_PROB` to avoid a circular import from `fantasy/RaceType.ts`. **Keep it in sync with `RACE_SPECS[r].prob`** whenever weights change there.

### `Religion.deity: Deity` + `Religion.alignment: AlignmentType`

Bound at religion founding (Path 1) in `ReligionGenerator.generate` from a PRNG sub-stream `seededPRNG(`${world.seed}_deity_${religion.id}`)`, weighted toward deities of the founder country's `raceBias.primary` race (×3) with universal deities at ×1.5 and race-disallowed deities at 0.

The display name stays illustrate-derived ("Faith of Aldric Stormvale") and `deity` / `alignment` are separate fields shown alongside.

### `World.seed: string`

Copied from the worker's seed string by `WorldGenerator.generate(rng, seed)` so simulation generators can derive their isolated sub-streams. Threaded through `buildPhysicalWorld(cells, width, rng, rarityWeights, seed)` and `historyGenerator.generate(cells, width, rng, numSimYears, rarityWeights, seed)`.

Defaults to `''` for the sweep harness and any standalone test path — sub-stream draws are still deterministic, just keyed off the empty-string root.

## Serialization

`HistoryGenerator.ts` copies the simulation-side metadata into `HistoryData` for client-side consumption:

- `country.raceBias` → `HistoryData.countries[i].raceBias`
- `religionDetails: ReligionDetail[]` (mirrors `wonderDetails`)
- `cityReligions: Record<number, string[]>` — final-year cellIndex → religion ids sorted by adherence descending. **First id is the dominant religion.**
- `worldSeed: string` — so `lib/citychars.ts` can derive its `${seed}_chars_<cellIndex>` PRNG client-side

## citychars.ts (UI-only roster)

`src/lib/citychars.ts` is the lazy roller that turns simulation metadata into a deterministic PC roster the moment a city is opened in the Details tab.

### Roster Sizing

Roster size scales with city tier:

| Tier | Roster |
|------|--------|
| small | 3 |
| medium | 6 |
| large | 12 |
| metropolis | 24 |
| megalopolis | 48 |

### Dominant Bias

"Dominant bias" — race + deity locked to the country/dominant religion — scales the **opposite** way:

| Tier | Dominant bias |
|------|---------------|
| small | 1.00 |
| medium | 0.70 |
| large | 0.50 |
| metropolis | 0.30 |
| megalopolis | 0.15 |

So small towns are racially/religiously homogeneous; megalopolises are cosmopolitan.

### Roll Mechanism

The roster is rolled **on demand** inside `DetailsTab.tsx::CityDetails` via a `useMemo` keyed on `(charactersOpen, city, country, cityReligionDetails, history.worldSeed)`. Ruined cities and worlds with no `worldSeed` short-circuit to an empty array.

PRNG: `seededPRNG(`${worldSeed}_chars_${cellIndex}`)`. Independent of every other PRNG sub-stream. **Same `(worldSeed, cellIndex)` pair always returns the same roster** — this is the contract Details-tab code relies on for stable rosters across re-mounts.

The tooltip on each row carries HP, abilities, age, height/weight, and starting wealth so the table itself stays narrow inside the 280 px overlay.

## Equipment Catalog

`src/lib/fantasy/Equipment.ts` exports two records:

- `EQUIPMENT_CATALOG` — non-magical baseline (mundane weapons, armor, shields, ammo, plus alchemy and scrolls).
- `MAGICAL_EQUIPMENT_CATALOG` — magical items spanning levels 1–20 across every slot. Inspired by D&D 3.5e SRD, Pathfinder, and similar OGL sources.

The combined catalog covers ~400 entries across:

- **Weapons** — base mundane variants (simple / martial / exotic, melee + ranged), magical enchantment tiers from +1 through +5, elemental damage variants (Flaming / Frost / Shock / Corrosive / Thundering — fire / cold / electricity / acid / sonic), aligned variants (Holy / Unholy / Anarchic / Axiomatic), burst variants (Flaming Burst / Icy Burst / Shocking Burst / Corrosive Burst), special properties (Keen / Defending / Wounding / Vicious / Throwing / Returning / Ghost Touch / Brilliant Energy / Speed / Spell-Storing / Bane), and legendary named weapons (Vorpal Sword/Scimitar/Greataxe/Falchion/Longbow, Holy Avenger, Frost Brand, Flame Tongue, Sun Blade, Mace of Disruption, Sword of Dancing, Nine Lives Stealer, dragonslayer / giantslayer / demonbane).
- **Armor** — every D&D base armor + magical +1 through +5 tiers + Mithral / Adamantine / Dragonhide / Celestial / Elven Chain / Ghostward / Glamered / Slick / Silent Moves / Shadow / Determination / Dwarven / Rhino Hide variants. Special protection: **Fortification** (Light/Moderate/Heavy — fold critical-hit-negation chance into bonus HP), **Energy Resistance** (Fire / Cold / Electricity / Acid / Sonic / Prismatic — fold into bonus Fortitude or Reflex), **Spell Resistance** (SR 13/15/17/19 → bonus Will), **Ghost Touch**, **Invulnerability** (DR/magic), **Righteousness**, etc.
- **Shields** — base wooden/steel buckler + light/heavy variants at +1..+5; specialty (Animated / Arrow-Catching / Blinding / Spined / Bashing / Reflecting / Fortification / Mithral).
- **Helmets** — Headbands of Intellect / Inspired Wisdom / Alluring Charisma at +2/+4/+6, plus Hat of Disguise, Circlet of Persuasion / Blasting, Helm of Comprehend / Underwater / Glorious Recovery / Protection / Battle / Telepathy / Teleportation / Brilliance, Crown of Might, Diadem of Intellect, Spectacles of Truth, Mask of the Skull, phylacteries (Faithfulness / Undead Turning).
- **Bracers** — Bracers of Armor +1..+8, Bracers of Archery (regular and Greater), Falcon's Aim, Blinding Strike, Mighty Striking, Dawn, Quickstrike, Swordsmith, Relentless Hunt.
- **Gloves** — Gauntlets of Ogre Power, Gloves of Dexterity +2/+4/+6, Gloves of Storing / Arrow Snaring / Swimming-and-Climbing / Glamered, Gauntlets of Iron / Rust / Destruction, Gloves of the Titan's Grip / Minstrel.
- **Boots** — Boots of Elvenkind / Striding / Speed / Levitation / Flying / Teleportation / Winterlands / Earth / Swiftness / the Cat / Balance / Silent Step / Dimensional Stride / Long Road / Spider Climbing / Water Walking / Battle Charger.
- **Necklaces / Amulets** — Amulet of Natural Armor +1..+6, Amulet of Health +2..+8, Amulet of Mighty Fists +1..+5, Periapt of Wisdom +2/+4/+6, Brooch of Shielding, Scarab of Protection, Amulet of Proof Against Detection / the Archer / Inescapable Focus / the Emerald Eye / the Planes / Undying Loyalty, Talisman of Pure Good / Ultimate Evil, Periapt of Health / Proof Against Poison, Necklace of Fireballs.
- **Rings** — Ring of Protection +1..+5 (Minor variant adds Fort), Force Shield, Sustenance, Mind Shielding, Evasion, Blinking, Wizardry I-IV, Arcane Mastery, Freedom of Movement, Regeneration, Spell Storing (full and Minor), Djinni Calling, Three Wishes, Climbing (regular & Improved), Swimming, Jumping, Animal Friendship, Chameleon Power, Telekinesis, X-Ray Vision, Invisibility, Water Walking, Energy Resistance (Minor / Major / Greater fire/cold/electricity/acid/sonic + Universal), Counterspells, Arcane / Divine Might, Lightning Reflexes, Iron Will, Great Fortitude, Styptic, Friend Shield, Chronos.
- **Belts** — Giant Strength +2/+4/+6/+8, Incredible Dexterity +2/+4/+6, Mighty Constitution +2/+4/+6, Physical Might (STR+CON) +2/+4, Physical Perfection (STR+DEX+CON) +2/+4/+6, Many Pockets, Dwarvenkind, Monk's Belt, Priestly Might, Health Replenishment, Battle, Seven Skills, Thunderous Charge.
- **Cloaks** — Cloak of Resistance +1..+5 (with Minor single-save variant), Charisma +2/+4/+6, Elvenkind, Displacement, Etherealness, Bat, Arachnida, Manta Ray, Minor Displacement, Shadow, Winter Wolf, Predatory Vigor, Protection +2; Mantle of Spell Resistance / Faith / Unholy; Robe of the Archmage (white/gray/black) / Eyes / Stars / Blending / Useful Items; Cloak of the Fangs.
- **Utility** — Potions (Cure Light/Moderate/Serious/Critical, Bull's Strength, Bear's Endurance, Cat's Grace, Haste, Invisibility, Blur, Mage Armor, Protection from Evil, Shield of Faith, Resist Energy, Remove Fear, Heroism, Fly, Water Breathing, Gaseous Form, Displacement, Neutralize Poison, Remove Disease, Stoneskin), Wands (CLW/CMW/CSW, Magic Missiles, Fireball, Lightning Bolt, Invisibility, Dispel Magic, Haste), Pearls of Power I–IX, Ioun Stones (Dusty Rose / Pale Green / Orange / Incandescent Blue / Vibrant Purple / Clear / Deep Red / Pale Blue / Pink Rhomboid / Scarlet & Blue / Pink / Pearly White / Lavender & Green / Dark Blue), Staves (Healing / Fire / Frost / Power / Woodlands / Charming), Rods (Absorption / Lordly Might / Extend Spell / Empower Spell / Negation / Alertness), Figurines (Silver Raven / Onyx Dog / Bronze Griffon / Marble Elephant), Horns (Valhalla / Blasting / Drums of Panic), Stones (Luckstone / Alarm), Decanter of Endless Water, Cube of Force, Crystal Ball, Well of Many Worlds, Horseshoes of Speed, Bag of Holding I/II/IV, Handy Haversack, Portable Hole, Holy Water, Alchemist's Fire, Antitoxin, scrolls (Mage Armor / CLW / CSW / Fireball / Invisibility / Raise Dead).

### Bonus Targets

`EquipBonus.target` covers `ac`, `bab`, `fort`, `ref`, `will`, `str`, `dex`, `con`, `int`, `wis`, `cha`, `hp`, `spell_slots`, `caster_level`. Effects that don't have a direct numeric mechanic (energy resistance, fortification, ghost touch, brilliant energy, vorpal kill-on-crit, etc.) are described in `Equipment.description` and folded approximately into the most relevant numeric bonus (e.g. fortification → bonus HP; energy resistance → bonus Fort/Ref).

### Assignment with Variety

`assignEquipment(pcClass, level, wealth, abilities, rng?)` selects equipment per slot using class-role weights. The optional `rng` parameter enables per-character variety:

- **No `rng`** — the function picks the single best-scoring affordable item per slot (legacy behavior; deterministic per `(pcClass, wealth, abilities)`).
- **With `rng`** — at each phase, the function builds a shortlist of items whose score is within ~20% of the best score, caps at 12 candidates, and weight-samples one. Same character stats produce different (but still class-appropriate) loadouts across rng seeds.

`citychars.ts` derives `rng` from an isolated PRNG sub-stream `seededPRNG(`${worldSeed}_chareq_${cellIndex}_${i}${yearKey}`)` per character. This sub-stream:

- **Is independent of the main character roll RNG.** Adding new equipment items, scoring weights, or shortlist tuning never shifts the existing rosters' core identity (race / class / abilities / level / deity).
- **Stays out of the world-history sweep.** Equipment is render-only; the sweep harness never reaches `assignEquipment`.

## Pitfalls

- **Sweep stability is preserved by design.** Race bias and deity binding draws go to ISOLATED PRNG sub-streams (`_racebias_<countryId>`, `_deity_<religionId>`). They do not perturb the main timeline RNG, and neither field enters `HistoryStats`. `npm run sweep` must remain byte-identical against `scripts/results/baseline-a.json` after any change to `Country.ts`'s `pickRaceBias`, `Religion.ts`'s `pickDeity`, or the `BIOME_RACE_WEIGHTS` table. **A non-zero diff means a sub-stream draw accidentally leaked into the main `rng` parameter — fix the leak rather than rebaseline.**
- **No simulation feedback in v1.** `Country.raceBias` and `Religion.deity / alignment` are purely decorative. They are NOT consumed by `WarGenerator` / `ConquerGenerator` / `TradeGenerator` / `ReligionGenerator.Path 2` / etc. Future work could (e.g. wars more likely between alignment-incompatible deities, trade easier between same-race countries) but doing so would require a sweep rebase.
- **Do NOT import `lib/citychars.ts` from the worker** (`src/workers/mapgen.worker.ts`) or from `src/lib/history/`. The roller is render-side only — it depends on render-layer types (`City`, `Country`, `ReligionDetail`) and rolls fresh PRNGs on demand. Importing from the worker would defeat the lazy-on-open design and balloon the postMessage payload.
- **Do NOT import `fantasy/Deity.ts` `DEITY_SPECS` into mutation sites.** The same naming-vs-mutation discipline as `techNames.ts` (see `world_history.md`) applies: `lib/fantasy/Deity.ts` `DEITY_SPECS` is referenced by `Religion.ts` (sim, picks the deity), `HistoryGenerator.ts` (serialize, reads display name), and `lib/citychars.ts` (UI, picks character deities). No other mutation sites should touch it.
- **`generatePcCharBiased` does not mutate shared specs.** It constructs local biased copies inside the function and discards them at return. Calling it with `{}` or no opts is byte-identical to `generatePcChar`. If you add a new bias dimension (e.g. class), follow the same local-copy pattern. Mutating `RACE_SPECS` / `DEITY_SPECS` would silently corrupt parallel call sites.
- **`citychars.ts` PRNG keying** — uses `seededPRNG(`${worldSeed}_chars_${cellIndex}`)`. Independent of every other sub-stream. Don't change the key format without updating all Details-tab call sites; downstream code relies on stable rosters across re-mounts.
- **Keep `Country.ts::BASE_RACE_PROB` in sync with `RACE_SPECS[r].prob`.** The duplication exists to avoid a circular import from `fantasy/RaceType.ts`. Drift between the two would cause race bias picks to silently diverge from race spec assumptions.
- **`World.seed` defaults to `''` for sweep / test paths.** Sub-stream draws are still deterministic, just keyed off the empty-string root. Any new sub-stream that depends on `World.seed` must tolerate the empty-string root (which it does naturally — `seededPRNG('_racebias_X')` is a valid input).
- **Equipment uses an isolated PRNG sub-stream `_chareq_<cellIndex>_<i><yearKey>`.** The variety injected by the rng-driven shortlist sampling never leaks into the main character roll. New items, scoring tweaks, and shortlist size changes must keep this discipline; calling `assignEquipment` without an `rng` argument falls back to the deterministic single-best behavior. **Do NOT pass the main `rng` from `generateCityCharacters` into `assignEquipment` directly** — that would consume draws on the character roll's stream and shift identity rolls. Always derive a fresh sub-stream.
- **Equipment catalog duplicate-key trap.** `EQUIPMENT_CATALOG` and `MAGICAL_EQUIPMENT_CATALOG` are spread together into `ALL_ITEMS`; collisions silently mask the first entry. When adding new items in either map, search the file for the proposed id first. TypeScript catches in-map duplicate property names but not cross-map collisions.
