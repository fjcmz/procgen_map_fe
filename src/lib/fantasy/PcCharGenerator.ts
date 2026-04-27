// Port of es.fjcmz.lib.procgen.fantasy.PcCharGenerator from procgen-sample.
// Source signature was generate(Settlement parent, Randomizer rng); the parent
// only ever supplied a level + an alignment, so the TS port takes those two
// directly — making it trivial to wire characters to any city/settlement
// representation later.

import type { Ability } from './Ability';
import { ABILITIES, MENTAL, abilityMod } from './Ability';
import type { AlignmentType } from './AlignmentType';
import { ALIGNMENT_SPECS, ALIGNMENT_TYPES } from './AlignmentType';
import { RACE_SPECS, RACE_TYPES, getAdjustAbilities } from './RaceType';
import type { PcClassType } from './PcClassType';
import { PC_CLASS_SPECS, PC_CLASS_TYPES, getClassesForMainAbility } from './PcClassType';
import type { Deity } from './Deity';
import { DEITIES, DEITY_SPECS, deityAllowsRace, deityAllowsAlignment } from './Deity';
import { PcChar } from './PcChar';
import type { PcCharAge } from './PcChar';
import { probPick, probPickAdjusted, pickRandom } from './ProbEnum';
import { roll } from './Rollable';

const ABILITY_ROLL = roll(3, 6).best(3); // Java: Rollable.Roll.roll(3, 6).best(3)

function rollAbilities(rng: () => number): Map<Ability, number> {
  const out = new Map<Ability, number>();
  for (const ab of ABILITIES) {
    out.set(ab, ABILITY_ROLL.roll(rng));
  }
  return out;
}

function isGoodEnough(abilities: Map<Ability, number>, level: number): boolean {
  const values = Array.from(abilities.values());
  const mods = values.map(v => abilityMod(v));

  if (level >= 15) {
    if (values.filter(v => v >= 10).length < 6) return false;
    if (mods.filter(m => m >= 2).length < 3) return false;
    if (mods.filter(m => m >= 3).length < 2) return false;
    if (mods.filter(m => m >= 4).length <= 0) return false;
    if (!mentalAbilitiesAbove(abilities, 10)) return false;
  }
  if (level >= 10) {
    if (values.filter(v => v >= 10).length < 5) return false;
    if (mods.filter(m => m >= 2).length < 3) return false;
    if (mods.filter(m => m >= 3).length < 2) return false;
    if (!mentalAbilitiesAbove(abilities, 8)) return false;
  }
  if (level >= 5) {
    if (values.filter(v => v >= 10).length < 4) return false;
    if (mods.filter(m => m >= 2).length < 2) return false;
    if (mods.filter(m => m >= 3).length < 1) return false;
    if (!mentalAbilitiesAbove(abilities, 6)) return false;
  }
  return mods.reduce((a, b) => a + b, 0) >= 2;
}

function mentalAbilitiesAbove(abilities: Map<Ability, number>, min: number): boolean {
  for (const [ab, v] of abilities) {
    if (MENTAL.has(ab) && v < min) return false;
  }
  return true;
}

function generateAbilities(pcChar: PcChar, level: number, rng: () => number): void {
  let abilities: Map<Ability, number>;
  do {
    abilities = rollAbilities(rng);
  } while (!isGoodEnough(abilities, level));

  // Apply racial adjustments (humans / half-elves / half-orcs pick a random ability,
  // see RaceType.getAdjustAbilities).
  const adjust = getAdjustAbilities(pcChar.race, rng);
  for (const ab of Object.keys(adjust) as Ability[]) {
    abilities.set(ab, (abilities.get(ab) ?? 0) + (adjust[ab] ?? 0));
  }

  pcChar.abilities = abilities;
}

function classIsGoodEnough(pcClass: PcClassType, pcChar: PcChar): boolean {
  for (const ab of PC_CLASS_SPECS[pcClass].mainAbilities) {
    if ((pcChar.abilities.get(ab) ?? 0) < 10) return false;
  }
  return true;
}

function generateClass(pcChar: PcChar, rng: () => number): void {
  // Sort abilities descending by value (matches Java's Collections.sort comparator).
  const entries = Array.from(pcChar.abilities.entries())
    .sort((a, b) => b[1] - a[1]);

  let pcClass: PcClassType | null = null;
  let i = 0;
  while (pcClass === null) {
    while (
      i < entries.length &&
      getClassesForMainAbility(entries[i][0]) === undefined
    ) {
      i++;
    }
    // Java reads abilities.get(i) here without a bounds check; mirror that —
    // entries.length is the ability count (6) so an out-of-range read would only
    // happen if no class maps to any ability, which is impossible with the
    // current PC_CLASS_SPECS table.
    const possibleClasses = getClassesForMainAbility(entries[i][0]);
    if (!possibleClasses || possibleClasses.length === 0) {
      // Defensive: should not happen — break to avoid an infinite outer loop.
      pcClass = PC_CLASS_TYPES[0];
      break;
    }
    pcClass = pickRandom(possibleClasses, rng);
    let j = 0;
    while (!classIsGoodEnough(pcClass, pcChar) && j < 1000) {
      pcClass = pickRandom(possibleClasses, rng);
      j++;
    }
  }
  pcChar.pcClass = pcClass;
}

function applyAbilitiesMod(pcChar: PcChar, mod: Partial<Record<Ability, number>>): void {
  for (const ab of Object.keys(mod) as Ability[]) {
    pcChar.abilities.set(ab, (pcChar.abilities.get(ab) ?? 0) + (mod[ab] ?? 0));
  }
}

function ageEffects(pcChar: PcChar, rng: () => number): void {
  const raceSpec = RACE_SPECS[pcChar.race];
  const age: PcCharAge = {
    currentAge:
      raceSpec.baseAge +
      raceSpec.ageAdjustement[PC_CLASS_SPECS[pcChar.pcClass].jobMaturityType].roll(rng),
    middleAge: raceSpec.middleAge.roll(rng),
    oldAge: raceSpec.oldAge.roll(rng),
    venerableAge: raceSpec.venerableAge.roll(rng),
    maxAge: raceSpec.maxAge.roll(rng),
  };
  pcChar.age = age;

  const perLevel = age.currentAge - raceSpec.baseAge;
  age.currentAge = age.currentAge + Math.floor((perLevel * pcChar.level) / 2);

  if (age.currentAge >= age.middleAge) {
    applyAbilitiesMod(pcChar, { constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 });
    applyAbilitiesMod(pcChar, { strength: -1, dexterity: -1 });
  }
  if (age.currentAge >= age.oldAge) {
    applyAbilitiesMod(pcChar, { constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 });
    applyAbilitiesMod(pcChar, { strength: -2, dexterity: -2 });
  }
  if (age.currentAge >= age.venerableAge) {
    applyAbilitiesMod(pcChar, { constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 });
    applyAbilitiesMod(pcChar, { strength: -3, dexterity: -3 });
  }

  for (const ab of ABILITIES) {
    if ((pcChar.abilities.get(ab) ?? 0) < 3) pcChar.abilities.set(ab, 3);
  }
}

function selectGod(pcChar: PcChar, rng: () => number): void {
  let deity: Deity | null = null;
  let i = 0;
  // Java: do { ... } while (deity == null && (needsDeity || i < 5))
  do {
    const candidate = probPick(DEITY_SPECS, DEITIES, rng);
    if (!deityAllowsRace(candidate, pcChar.race) || !deityAllowsAlignment(candidate, pcChar.alignment)) {
      deity = null;
    } else {
      deity = candidate;
    }
    i++;
  } while (deity === null && (PC_CLASS_SPECS[pcChar.pcClass].needsDeity || i < 5));

  pcChar.deity = deity !== null ? DEITY_SPECS[deity].name : 'none';
}

export function generatePcChar(
  level: number,
  parentAlignment: AlignmentType,
  rng: () => number,
): PcChar {
  const pcChar = new PcChar();

  pcChar.alignment = probPickAdjusted(
    ALIGNMENT_SPECS,
    ALIGNMENT_TYPES,
    ALIGNMENT_SPECS[parentAlignment].adjustAlignment,
    rng,
  );

  pcChar.race = probPick(RACE_SPECS, RACE_TYPES, rng);

  generateAbilities(pcChar, level, rng);

  generateClass(pcChar, rng);
  pcChar.level = level;

  // Bonus to main ability: +1 per 4 levels.
  const addAbility = Math.floor(level / 4);
  const mainAb = PC_CLASS_SPECS[pcChar.pcClass].mainAbility;
  pcChar.abilities.set(mainAb, (pcChar.abilities.get(mainAb) ?? 0) + addAbility);

  // Re-roll alignment until allowed by the chosen class.
  while (!PC_CLASS_SPECS[pcChar.pcClass].allowedAlignment(pcChar.alignment)) {
    pcChar.alignment = probPickAdjusted(
      ALIGNMENT_SPECS,
      ALIGNMENT_TYPES,
      ALIGNMENT_SPECS[parentAlignment].adjustAlignment,
      rng,
    );
  }

  ageEffects(pcChar, rng);

  pcChar.height = RACE_SPECS[pcChar.race].baseHeight + RACE_SPECS[pcChar.race].heightAdjustment.roll(rng);
  pcChar.weight = RACE_SPECS[pcChar.race].baseWeight + RACE_SPECS[pcChar.race].weightAdjustment.roll(rng);
  pcChar.wealth = PC_CLASS_SPECS[pcChar.pcClass].initialWealth.roll(rng);

  // Hit points: max hit die + Con mod for level 1, then random 1..hitDie + Con mod
  // for each level after. Java: IntStream.range(1, level) is (level - 1) iterations.
  const hitDie = PC_CLASS_SPECS[pcChar.pcClass].hitDie;
  const conMod = abilityMod(pcChar.abilities.get('constitution') ?? 10);
  let hp = hitDie + conMod;
  for (let lvl = 1; lvl < level; lvl++) {
    hp += Math.floor(rng() * hitDie) + conMod + 1;
  }
  pcChar.hitPoints = hp;

  selectGod(pcChar, rng);

  return pcChar;
}

// Singleton mirroring the convention used by src/lib/history/physical generators.
export class PcCharGenerator {
  generate(level: number, parentAlignment: AlignmentType, rng: () => number): PcChar {
    return generatePcChar(level, parentAlignment, rng);
  }
}

export const pcCharGenerator = new PcCharGenerator();
