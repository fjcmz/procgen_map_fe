# City Districts Catalog

Reference list of possible district roles for the V2 city generator
(`src/lib/citymap/`). Organized as: **currently-implemented** → **historical
candidates** → **fantastical candidates**. Each entry lists the district's
function (what it does in a real/fictional city) and the **fit conditions**
in our model (which `CityEnvironment` / `CitySize` context it belongs to).

The current `DistrictRole` union (`cityMapTypesV2.ts:27`) is:
`'market' | 'residential' | 'civic' | 'harbor' | 'agricultural' | 'slum' | 'dock'`.

This is a brainstorm / backlog — **not** an implementation plan. Anything new
has to be reachable from the block flood-fill in `cityMapBlocks.ts` and
landmark/openSpace reservations in `cityMapLandmarks.ts` / `cityMapOpenSpaces.ts`.

---

## 1. Currently implemented

| Role | Function | Fit |
|------|----------|-----|
| `civic` | Administrative core — town hall, courts, treasury, law-reading plaza. Seat of government in the city. | Inside walls. Anchors castle/palace landmarks for capitals. |
| `market` | Commerce and daily retail — stalls, weighhouses, auction block, moneychangers. Nexus of the trade economy. | Inside walls, near gates. Count scales with tier. |
| `harbor` | Coastal working waterfront — fishing fleet, customs house, quays, shipwrights. | `env.isCoastal && env.waterSide`, block centroid near that edge. |
| `residential` | Where most people live — tenements, townhouses, neighborhood wells, laundries. Default fill. | Inside walls, anything not otherwise classified. |
| `agricultural` | Cultivated fringe — fields, orchards, granaries, threshing floors. Feeds the city. | Outside walls, cluster ≥ `SLUM_SIZE_THRESHOLD`. |
| `slum` | Unregulated sprawl — shanties, squatters, dumps, informal trades. | Outside walls, small cluster. |
| `dock` | Large-tier water-overlap zone — warehouses, piers extending into `waterPolygonIds`. | `large+` cities with `env.waterSide`, special water-crossing block. |

---

## 2. Historical candidates

### Craft & industry quarters
Real medieval cities concentrated smelly, loud, or fire-prone trades away
from civic cores and elite housing.

| Role | Function | Fit |
|------|----------|-----|
| `smithing` / `forge` | Blacksmiths, armorers, nailmakers, foundries. Fire + anvil noise. | `medium+`. Prefer downwind edge; `industry` tech level biases count. |
| `tannery` | Hide curing with urine/lye/bark. Notoriously foul — always downwind + downstream on the river. | `hasRiver && medium+`. Snaps to the downstream river bank. |
| `weavers` / `textile` | Looms, dye vats, fullers' tubs. Needs clean water upstream of tanneries. | `hasRiver && medium+`. |
| `potters_row` | Kilns, clay pits — fire risk, usually walled off. | `small+`, any terrain. |
| `shambles` / `butchers` | Slaughter, offal carts, meat market. Paired with tanneries for hide flow. | `medium+`, near tannery / downstream. |
| `brewery_quarter` | Breweries, malthouses, hop stores. Heavy grain + water draw. | `medium+`, near agricultural edge. |
| `mill_row` | Water-mills, grain floors. | `hasRiver`. Anchors on a river edge block. |
| `guild_hall` | Not a district per se — a civic sub-role where master guilds hold charters, trials, feasts. | `medium+`. Could be a landmark on a market polygon instead of a full district. |

### Scholarship, faith, health

| Role | Function | Fit |
|------|----------|-----|
| `temple_quarter` | Concentration of religious buildings, monasteries, pilgrim hostels. Distinct from a single `temple` landmark. | `env.religionCount >= 2 && medium+`. |
| `necropolis` / `cemetery` | Burial ground, catacombs, crematoria, mausolea. Ritual exclusion zone. | Any size. Real cities placed these *outside* the main wall — fits an exterior block role. |
| `academia` / `university` | Colleges, libraries, scriptoria, printing houses. | `large+` with `science` or `philosophy` tech. Often becomes its own walled enclave. |
| `lazaretto` / `plague_ward` | Quarantine hospital, leper house. Historically a walled island or edge-of-town block. | `large+`; prefer `isCoastal` island or exterior block. |
| `archive_quarter` | Records office, chancery, scribes — administrative memory. | `large+` capitals with `government` tech. |

### Military & security

| Role | Function | Fit |
|------|----------|-----|
| `barracks` / `garrison` | Standing-army quarters, armories, drill yards. | `medium+` capitals or `military`-spirit countries. Prefer a block adjacent to a wall/gate. |
| `citadel` | Inner fortress — last-resort keep, separate from the civic palace. | `metropolis+`. Maps well onto the existing inner-wall enclosure. |
| `arsenal` / `armory` | State-owned weapon storage, artillery park, powder magazine. | Capitals + `military` tech. Kept walled-off. |
| `watchmen_precinct` | City guard barracks + holding cells + gatehouse annex. | Any `medium+`. |

### Trade & finance

| Role | Function | Fit |
|------|----------|-----|
| `foreign_quarter` / `fondaco` | Enclave for merchants from another nation — their own warehouses, chapel, often own laws. | `large+` coastal/river cities with trade routes to at least one other country. |
| `caravanserai` | Walled inn + stables + warehouse for overland traders. | Inland cities on major roads; would anchor on `exitRoads`. |
| `bankers_row` / `counting_house` | Money-lending, bourses, letters of credit. | `large+`, often pinned to the civic block. |
| `warehouse_row` | Bonded storage, customs sheds. Distinct from `dock` — can be inland, along roads. | `medium+`. |

### Entertainment & social

| Role | Function | Fit |
|------|----------|-----|
| `theater_district` | Playhouses, arenas, odeons, pleasure gardens. | `large+` with `art` tech. |
| `bathhouse_quarter` | Public baths, steam rooms — social and hygienic center. | `large+`, warm/temperate biomes, or any `isCapital`. |
| `red_lantern` / `pleasure_quarter` | Taverns, brothels, gaming houses. Often segregated to a single block by ordinance. | `medium+`, often near gates or docks. |
| `festival_grounds` | Open field for fairs, markets-of-the-year, jousts. | Outside walls, `medium+`. An oversize open space rather than a dense district. |

### Excluded / outcast

| Role | Function | Fit |
|------|----------|-----|
| `ghetto` | Walled minority quarter — religious/ethnic enclave, often gated at night. | `large+` with `env.religionCount >= 2` (or foreign-quarter signal). |
| `workhouse` / `poorhouse` | Institutional poverty — almshouses, charity kitchens. | `large+`. |
| `gallows_hill` / `execution_ground` | Legal-death space — scaffold, gibbet cages, potters' field alongside. | Exterior block, a single landmark inside an otherwise unremarkable slum. |

---

## 3. Fantastical candidates

These lean on the existing world-sim signals: `wonderCount`, `religionCount`,
tech fields (`science`, `art`, `government`, `industry`…), `mountainDirection`,
and the `Spirit` enum on countries.

### Arcane & scholarly

| Role | Function | Fit |
|------|----------|-----|
| `mages_quarter` | Wizard towers, arcane college, spell-component shops, warded libraries. | `large+` with `science` tech high, or a dedicated "magic" tech if added. Often a walled sub-enclave, like the citadel. |
| `alchemists_row` | Potion labs, reagent vendors. Fire/poison hazard — placed like tanneries. | `medium+` with `science` or `biology`. Downwind edge. |
| `planar_embassy` | Enclaves for non-human envoys, demi-planar guests. | `metropolis+` capitals; one block per "foreign" faction. |
| `astronomers_terrace` | Observatories, star-charts hall — needs high ground. | `large+` with `science`; prefers a polygon near `mountainDirection` or a high-`elevation` edge. |

### Divine & monstrous

| Role | Function | Fit |
|------|----------|-----|
| `grand_cathedral_quarter` | Seat of a dominant religion — processional avenue, cloisters, relic vault. | `env.religionCount >= 1 && large+`. |
| `heretics_quarter` | Suppressed or underground faith — catacomb shrines, hidden ways. | `env.religionCount >= 2` and `government`-high cities (orthodoxy breeds heresy). |
| `beast_stables` | Griffin roosts, wyvern perches, warbeast kennels. | Capitals with `military` spirit; wall-adjacent block with roof access. |
| `shrine_walk` | Minor-deity cluster — many tiny shrines along one street, unlike the single grand cathedral. | Any `medium+` with `religionCount >= 2`. |
| `oracle_grove` | Sacred grove, augur's precinct. | Prefers the park-adjacent block; `forest`/`temperate` biomes. |

### Industrial fantasy

| Role | Function | Fit |
|------|----------|-----|
| `airship_docks` | Mooring masts, loading platforms for sky-vessels. | `metropolis+` with high `industry` + `energy` tech. High-elevation polygon or `mountainDirection` edge. |
| `steam_works` | Fantastical foundries — boilers, clocktowers, pneumatic tubes. | `metropolis+` with `industry + energy` both high. Upgraded `smithing`. |
| `dragon_gate` | Oversized gate/roost scaled for a riding-beast; often doubles as an airship pad. | `metropolis+` capitals, `military` spirit. |
| `clockwork_quarter` | Automaton shops, mechanical-guild enclave. | `megalopolis` with `industry >= high`. |

### Criminal & secret

| Role | Function | Fit |
|------|----------|-----|
| `shadow_market` | Black-market warren — contraband, forbidden magic, information broker stalls. | Under `slum`s or docks. Tagged sibling of `market`, usually exterior. |
| `thieves_warren` | Dense, maze-like slum with a concealed underworld hall. | `large+`, always adjacent to or overlapping a `slum`. |
| `assassins_cloister` | Disguised as a temple, functionally a guild hall. | `metropolis+` capitals only; rare. |

### Ruins & hauntings

| Role | Function | Fit |
|------|----------|-----|
| `old_quarter` / `ruin_overlay` | Remains of a prior city phase — half-collapsed walls, older street grid intruding. | `env.isRuin` or `megalopolis` (implies age). |
| `haunted_block` | Abandoned-then-reclaimed block; superstitious detour in street routing. | Any size with `isRuin` OR post-cataclysm history. |
| `sunken_quay` | Partially-submerged dock from a sea-level shift or earthquake. | Coastal `isRuin`. |

### Nature-integrated

| Role | Function | Fit |
|------|----------|-----|
| `elven_bower` / `canopy_quarter` | Buildings integrated into living trees; block follows a polygon cluster along a `forest`/`jungle` edge. | `neighborBiomes` includes a forest biome. |
| `dwarven_halls` / `underquarter` | Entrance complex carved into a mountain face — surface block is just the porch. | `mountainDirection != null`, prefers polygons toward the mountain edge. |
| `fey_market` | Only-at-dusk market in a park-adjacent block; dual use with `park`. | Any size; reskin of `market` with an adjacency constraint on a park polygon. |

---

## 4. Suggested pick order if we expand `DistrictRole`

If we were to actually add roles (not a commitment — just prioritized by
payoff-vs-complexity given existing signals):

1. **`tannery`** / **`smithing`** — rich historical flavor, already have
   `hasRiver` for upstream/downstream placement, maps cleanly onto the
   existing flood-fill + role-classification pipeline.
2. **`temple_quarter`** — we already have `religionCount`, currently only
   used for single-polygon `temple` landmarks. Elevating to a block role
   when `religionCount >= 2` unlocks a lot of visual variety.
3. **`barracks`** / **`citadel`** — capitals + `military`-spirit countries
   already exist in the simulation; citadel can reuse the inner-wall geometry
   for `metropolis+` cities.
4. **`foreign_quarter`** — requires a trade-partner signal on the city
   (currently only at country level). Cheap once that plumbs through.
5. **`necropolis`** — exterior-block role alongside `slum` / `agricultural`,
   driven by size tier. No new signals needed.
6. **`mages_quarter`** / **`airship_docks`** — fantastical high-tech anchor
   districts; gate on existing tech fields. Nice-to-have, not structural.

Everything else in the catalog is backlog / flavor, reachable by future
specs once the above pattern is established.
