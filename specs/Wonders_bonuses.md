# Current State
Wonders are currently purely cosmetic — they have rich construction mechanics (10 tiers, resource consumption, industry-tech weighting, named progression from "Monument" to "Apotheosis") but provide zero gameplay bonuses. They're built, they can be destroyed by cataclysms, and that's it.
# Suggested Wonder Bonuses
Here are bonuses that would integrate naturally with the existing simulation systems, ordered from simplest to most impactful:
1. Population Growth Boost (city-level)
Cities with standing wonders grow faster — wonders attract settlers. A simple multiplier like 1 + 0.02 × sumOfWonderTiers on the city's population growth step in YearGenerator.ts. Higher-tier wonders matter more. Integrates cleanly with the existing step 4 growth logic.
2. Tech Discovery Bonus (country-level)
Countries with wonders get a boost to tech discovery chance. The existing techGenerator rolls min(1, illustrateCount / 5) per country — wonders could add a small bonus like +0.05 × wonderCount to that roll, representing institutional knowledge. Integrates with the Phase 2 throughput system in Tech.ts.
3. Religion Spread Bonus (city-level)
Cities with wonders could boost religion adherence drift — sacred sites attract pilgrims. A small +0.01 × wonderCount on the step 6 drift in YearGenerator.ts, stacking with the existing art and government bonuses. Thematic and simple.
4. Trade Capacity Bonus (city-level)
Wonders boost trade capacity similar to how TRADE_TECHS work — effectiveTradeCap() in CityEntity.ts could add +1 per standing wonder. Wonders as trade magnets.
5. Military Defense Bonus (country-level in wars/conquests)
Countries with wonders get a defensive bonus in the Conquer.ts winner roll — something like +0.02 × totalWonderTiers for the defender. Fortified wonders help defend territory. Doesn't change war initiation, just conquest outcomes.
6. Illustrate Attraction (city-level)
Wonders attract illustrious figures — in Illustrate.ts, cities with wonders could get higher selection weight. This creates a virtuous cycle: wonders → illustrates → tech → higher-tier wonders.
7. Cataclysm Resilience (city-level)
Standing wonders reduce cataclysm kill ratios for their city (similar to how biology tech works). Infrastructure saves lives. A modest 0.05 × wonderCount reduction.
8. Empire Stability (empire-level)
Empires whose member countries hold wonders get reduced dissolution chance in the 15% government-tech check in Conquer.ts. Prestigious monuments hold empires together. E.g., reduce the 15% by 2% × totalEmpireWonders.
