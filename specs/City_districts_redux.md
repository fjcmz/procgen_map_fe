# City Districts Redux
This document describes a new approach for the generation and organisation of city quarters and districts. 
The general approach is to produce an incremental new quarters and districts generation logic that stays unused until phase 7 when the old implementation is replaced by the new one. 
Each phase will produced an incremental implementation towards a fully working implementation in phase 7.
Then the new implementation replaces the old one, and the old one can be deleted. 

## General approach 
The new implementation reuses some of the concepts and logic from the old one, with these major changes:
* Wonders, palaces, castles, parks, and markets are now quarters with a generation, placement, and rendering behaviour similar to all the other quarters; including the icons and labels treatment when rendering.
* Quarters are placed in the city by selecting the polygons they occupy before districts are formed.
* Districts are formed parting from the quarters and assigning polygons to districts depending on adjacency and distance from different quarters

## Phases
Each phase ends with npm run build passing and the app running, only Phase 7 changes what the user sees.

### Phase 1
* Type foundation & wonder-name plumbing. * Add DistrictType (13 values, includes park) and LandmarkKind unions alongside existing DistrictRole.
* Change deriveCityEnvironment to accept wonderEntries: WonderSnapshotEntry[] instead of wonderCellIndices
* Populate env.wonderNames.
* Update DetailsTab and HierarchyTab call sites.
* Zero behavior change.

### Phase 2
* Candidate pool + landmark scaffolding.
* New file cityMapCandidatePool.ts exporting buildCandidatePool(wall, polygons, edgeGraph) (interior ∪ 5-hop boundary band).
* New file cityMapLandmarksUnified.ts with the alignment table and empty placer stubs.
* Wire it to write to a temporary _landmarksNew: LandmarkV2[] field
* Renderer ignores it.

### Phase 3
* Named landmark placers.
* Implement placers for the user-named kinds:
  * wonders (using env.wonderNames)
  * palaces
  * castles
  * civic squares
  * temples
  * markets
  * parks
* Each uses geometric scoring against the candidate pool, no dependency on block roles.

### Phase 4
* Quarter landmark placers.
* Implement remaining catalog kinds grouped by alignment:
  * industrial (forge/tannery/textile/potters/mill)
  * military (barracks/citadel/arsenal/watchmen)
  * faith aux (temple_quarter/necropolis/plague_ward/academia/archive)
  * entertainment (theater/bathhouse/pleasure/festival)
  * trade (foreign_quarter/caravanserai/bankers_row/warehouse)
  * excluded (gallows/workhouse/ghetto_marker).
* Fit conditions ported from existing files.

### Phase 5
* District classifier.
* New file cityMapDistricts.ts.
* Implement placeSlumClusters (≤10-polygon BFS diameter, exterior, far from center; megalopolis 25% second cluster).
* Implement assignDistricts: water/mountain skip → exterior → agricultural → slum overlay → multi-source BFS from non-park landmarks → composite wealth score reclassifies residential into high/medium/low.
* Park polygons stay park.
* Output to _districtsNew: DistrictType[].

### Phase 6
* Blocks rebuild + buildings/sprawl re-keying.
* Slim cityMapBlocks.ts to buildBlocksFromDistricts plus exported pickProceduralName.
* Update PACKING_ROLES in cityMapBuildings.ts and SPRAWL_ROLES in cityMapSprawl.ts to consume the 13-district union.
* Per-role density table re-mapped. Output to _blocksNew.

### Phase 7
* Renderer cutover.
* Promote _landmarksNew → landmarks, _districtsNew → districts, _blocksNew → blocks.
* Drop openSpaces.
* Update drawLandmarks to read LandmarkV2, render labels for park/market/wonder/castle/palace, keep all glyphs.
* Update computeDistrictLabels for the new union.
* First phase with visible visual change — verify in dev server.

### Phase 8
* Delete legacy.
* Remove:
  * cityMapOpenSpaces.ts
  * cityMapSFHQuarters.ts
  * cityMapMilitaryQuarters.ts
  * cityMapTradeFinanceQuarters.ts
  * cityMapEntertainmentQuarters.ts
  * cityMapExcludedQuarters.ts
  * the legacy assignCraftRoles block in cityMapBlocks.ts
  * the old DistrictRole and CityLandmarkV2 types
  * stale index.ts
  * re-exports

## End State
After phase 8, the new quarters and districts implementation will have replaced the old one, and the old one will be deleted.
With the new implementation the city map rendering will show the city, distinctive internal and external areas, walls (if any), special quarters, icons and labels depending on checkboxes toggle, and hovering quarters will show names and additional info when labels are disabled.
