# History Package — Implementation Order

This document lists all classes to implement, in dependency order. Each class has a dedicated spec file in this directory.

## Phase 1: Utilities and Infrastructure

1. [`01_IdUtil.md`](./01_IdUtil.md) — String ID construction utility
2. [`02_HistoryRoot.md`](./02_HistoryRoot.md) — Root graph definition with world and timeline references

## Phase 2: Physical Model — Data Classes

3. [`03_Resource.md`](./03_Resource.md) — Resource entity (no dependencies on other model classes)
4. [`04_City.md`](./04_City.md) — City entity (references Resource, plus later Tech/Trade/etc.)
5. [`05_Region.md`](./05_Region.md) — Region entity (contains Cities and Resources, biome model)
6. [`06_Continent.md`](./06_Continent.md) — Continent entity (contains Regions)
7. [`07_World.md`](./07_World.md) — World entity (contains Continents, all runtime indexes)

## Phase 3: Physical Model — Generators and Visitors

8. [`08_ResourceGenerator.md`](./08_ResourceGenerator.md) — Generates Resource instances
9. [`09_CityGenerator.md`](./09_CityGenerator.md) — Generates City instances
10. [`10_RegionGenerator.md`](./10_RegionGenerator.md) — Generates Regions with adjacency assignment
11. [`11_ContinentGenerator.md`](./11_ContinentGenerator.md) — Generates Continents
12. [`12_WorldGenerator.md`](./12_WorldGenerator.md) — Generates World
13. [`13_CityVisitor.md`](./13_CityVisitor.md) — City traversal/selection utilities
14. [`14_RegionVisitor.md`](./14_RegionVisitor.md) — Region traversal/selection utilities

## Phase 4: Timeline Model — Core

15. [`15_Timeline.md`](./15_Timeline.md) — Timeline entity
16. [`16_Year.md`](./16_Year.md) — Year entity (holds all per-year event lists)
17. [`17_TimelineGenerator.md`](./17_TimelineGenerator.md) — Generates Timeline with start year
18. [`18_YearGenerator.md`](./18_YearGenerator.md) — Year pre-processing (population, religion, wars, resources)

## Phase 5: Timeline Entities and Generators (event types, in generation order)

19. [`19_Foundation.md`](./19_Foundation.md) — Foundation entity + FoundationGenerator
20. [`20_Contact.md`](./20_Contact.md) — Contact entity + ContactGenerator
21. [`21_Country.md`](./21_Country.md) — Country entity + CountryGenerator
22. [`22_Illustrate.md`](./22_Illustrate.md) — Illustrate entity + IllustrateGenerator
23. [`23_Religion.md`](./23_Religion.md) — Religion entity + ReligionGenerator
24. [`24_Trade.md`](./24_Trade.md) — Trade entity + TradeGenerator
25. [`25_Wonder.md`](./25_Wonder.md) — Wonder entity + WonderGenerator
26. [`26_Cataclysm.md`](./26_Cataclysm.md) — Cataclysm entity + CataclysmGenerator
27. [`27_War.md`](./27_War.md) — War entity + WarGenerator
28. [`28_Tech.md`](./28_Tech.md) — Tech entity + TechGenerator (includes mergeAllTechs, getNewTechs)
29. [`29_Conquer.md`](./29_Conquer.md) — Conquer entity + ConquerGenerator
30. [`30_Empire.md`](./30_Empire.md) — Empire entity + EmpireGenerator
31. [`31_Merge.md`](./31_Merge.md) — Merge placeholder class

## Phase 6: Orchestration

32. [`32_HistoryGenerator.md`](./32_HistoryGenerator.md) — Entrypoint: registration, seeding, output artifacts

## Dependency Notes

- **Phase 2** classes are pure data models and can be implemented in any order within the phase, but the listed order follows the containment hierarchy (Resource < City < Region < Continent < World).
- **Phase 3** generators depend on their corresponding Phase 2 data classes and on the World indexes.
- **Phase 4** (Timeline/Year) depends on Phase 2+3 being complete, since YearGenerator references World state.
- **Phase 5** entities are listed in the order they appear in per-year generation (`Year.references()`). Some have cross-dependencies:
  - `Country` depends on `Foundation` and `Contact` (cities must be founded+contacted).
  - `Religion` and `Tech` depend on `Illustrate` (consume illustrates).
  - `Conquer` depends on `War` (triggered by finishing wars).
  - `Empire` depends on `Conquer` (triggered by conquests).
- **Phase 6** (`HistoryGenerator`) is the final orchestrator and depends on everything above.
