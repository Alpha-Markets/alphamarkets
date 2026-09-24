/// A small seeded random number generator, so a simulation run can be repeated and tested.
export type Rng = () => number;

/// mulberry32: 32 bits of state, uniform in [0, 1).
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// A standard normal draw (Box-Muller).
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: nothing to choose from");
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}
