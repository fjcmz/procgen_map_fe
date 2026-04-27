// Port of es.fjcmz.lib.procgen.random.Rollable from procgen-sample.
// Dice expression builder: roll N dice of S sides, optionally take the best K,
// then add/multiply constants. Each .roll(rng) call evaluates fresh.

export interface Rollable {
  roll(rng: () => number): number;
  add(constant: number): Rollable;
  mult(factor: number): Rollable;
  best(k: number): Rollable;
}

class DiceRollable implements Rollable {
  constructor(
    private readonly n: number,
    private readonly sides: number,
    private readonly keepBest: number = -1,
    private readonly addConst: number = 0,
    private readonly multFactor: number = 1,
  ) {}

  roll(rng: () => number): number {
    const rolls: number[] = [];
    for (let i = 0; i < this.n; i++) {
      rolls.push(Math.floor(rng() * this.sides) + 1);
    }
    let used = rolls;
    if (this.keepBest > 0 && this.keepBest < rolls.length) {
      used = [...rolls].sort((a, b) => b - a).slice(0, this.keepBest);
    }
    const sum = used.reduce((acc, v) => acc + v, 0);
    return (sum + this.addConst) * this.multFactor;
  }

  add(constant: number): Rollable {
    return new DiceRollable(this.n, this.sides, this.keepBest, this.addConst + constant, this.multFactor);
  }

  mult(factor: number): Rollable {
    return new DiceRollable(this.n, this.sides, this.keepBest, this.addConst, this.multFactor * factor);
  }

  best(k: number): Rollable {
    return new DiceRollable(this.n, this.sides, k, this.addConst, this.multFactor);
  }
}

export function roll(n: number, sides: number): Rollable {
  return new DiceRollable(n, sides);
}
