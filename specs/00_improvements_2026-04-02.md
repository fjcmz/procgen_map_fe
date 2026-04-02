This file contains numbered improvements to add to the simulation.
These are based on real world historic examples:

01) War outcomes are a 50/50 coin flip (Conquer.ts:45) — should reflect military tech + population ratio
02) Population has no Malthusian ceiling — no carrying capacity, famine, or disease pressure
03) Country Spirit has zero mechanical effect (Country.ts assigns it but it's never read)
04) Technology has no prerequisites, and only transfers via conquest (not through trade/contact)
05) Religion spreads passively and never drives conflict (war reason weights are unrelated to actual religious tension)
06) Diplomacy is binary: war or not-war — no alliances, tributaries, non-aggression pacts
07) Empires only die through conquest, never through overextension or internal collapse
08) Geography (terrain) doesn't affect military outcomes — only biome growth rates
09) No epidemic/disease mechanics — no spread along trade/contact networks
10) Conquered nations vanish immediately — no resistance, assimilation lag, or cultural persistence
11) No accumulated wealth — economic power has no mechanical consequence
12) Tech never regresses — no Dark Age scenarios possible
