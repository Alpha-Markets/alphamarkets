import assert from "node:assert/strict";
import { test } from "node:test";
import { CALM_MARKET, CALM_SIGMA, MAX_NUDGE_STEP, fromFeedPrice, planNudge, stepMarkets, toFeedPrice, type MarketModel } from "./priceModel.js";
import { createRng } from "./prng.js";

const start = (): MarketModel[] => [
  { symbol: "NVDA", anchor: 190, price: 190, sigma: CALM_SIGMA },
  { symbol: "TSLA", anchor: 350, price: 350, sigma: CALM_SIGMA * 1.4 },
];

function run(steps: number, seed: number, nudges: Parameters<typeof stepMarkets>[1] = []) {
  const rng = createRng(seed);
  let markets = start();
  let active = [...nudges];
  const path: MarketModel[][] = [markets];
  for (let i = 0; i < steps; i++) {
    const next = stepMarkets(markets, active, rng);
    markets = next.markets;
    active = next.nudges;
    path.push(markets);
  }
  return path;
}

test("the same seed gives the same prices", () => {
  assert.deepEqual(run(50, 7), run(50, 7));
  assert.notDeepEqual(run(50, 7), run(50, 8));
});

test("a calm market stays calm for a full day of ticks", () => {
  const path = run(5_760, 1); // one day at a 15 second tick
  for (const markets of path) {
    for (const market of markets) {
      const drift = Math.abs(market.price / market.anchor - 1);
      assert.ok(drift <= CALM_MARKET.maxDrift, `${market.symbol} drifted ${drift}`);
    }
  }
  // Nothing moves like a glitch: every step is small.
  for (let i = 1; i < path.length; i++) {
    for (let j = 0; j < 2; j++) {
      const step = Math.abs(path[i]![j]!.price / path[i - 1]![j]!.price - 1);
      assert.ok(step <= CALM_MARKET.maxStep + 0.0001, `step of ${step}`);
    }
  }
});

test("prices are quoted in whole cents", () => {
  for (const market of run(20, 3).flat()) assert.ok(Math.abs(market.price * 100 - Math.round(market.price * 100)) < 1e-6);
});

test("a nudge moves one market by about the asked percentage and leaves the other alone", () => {
  const nudge = planNudge("NVDA", -6, 90);
  const path = run(nudge.remainingSteps, 5, [nudge]);
  const last = path[path.length - 1]!;
  const nvda = last[0]!.price / 190 - 1;
  assert.ok(nvda < -0.045 && nvda > -0.075, `NVDA moved ${nvda}`);
  const tsla = last[1]!.price / 350 - 1;
  assert.ok(Math.abs(tsla) < 0.02, `TSLA moved ${tsla}`);
});

test("a nudge plays out over several steps and then ends", () => {
  const nudge = planNudge("NVDA", 5, 15);
  assert.ok(nudge.remainingSteps >= 5, "5% needs at least five steps of 1%");
  assert.ok(Math.abs(nudge.stepFraction) <= MAX_NUDGE_STEP + 1e-12);
  const rng = createRng(2);
  let active = [nudge];
  let markets = start();
  for (let i = 0; i < nudge.remainingSteps; i++) ({ markets, nudges: active } = stepMarkets(markets, active, rng));
  assert.equal(active.length, 0);
});

test("a nudge cannot push a price past the drift limit", () => {
  const path = run(80, 4, [planNudge("NVDA", -50, 80)]);
  const low = Math.min(...path.map((markets) => markets[0]!.price));
  assert.ok(low >= 190 * (1 - CALM_MARKET.maxDrift) - 0.01);
});

test("planNudge refuses a zero move", () => {
  assert.throws(() => planNudge("NVDA", 0, 30), /other than 0/);
  assert.throws(() => planNudge("NVDA", 3, 0), /above 0/);
});

test("feed prices round-trip through the 18 decimal integer", () => {
  assert.equal(toFeedPrice(190.25), 190_250_000_000_000_000_000n);
  assert.equal(fromFeedPrice(toFeedPrice(190.25)), 190.25);
  assert.equal(fromFeedPrice(190_000_000_000_000_000_000n), 190);
});

test("a nudge takes the same time whatever the step length", () => {
  const slow = planNudge("NVDA", -6, 90, 15);
  const fast = planNudge("NVDA", -6, 90, 1);
  assert.equal(slow.remainingSteps, 6);
  assert.equal(fast.remainingSteps, 90);
  assert.ok(Math.abs(slow.stepFraction * slow.remainingSteps - fast.stepFraction * fast.remainingSteps) < 1e-12, "both nudges move the same total");
  assert.ok(Math.abs(fast.stepFraction) < Math.abs(slow.stepFraction));
});

test("a one second step moves the market about as much per minute as a fifteen second step", () => {
  const spread = (tickSeconds: number) => {
    const moves: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      let markets = start();
      const steps = 600 / tickSeconds; // ten minutes
      for (let i = 0; i < steps; i++) ({ markets } = stepMarkets(markets, [], rng, { ...CALM_MARKET, reversion: 0 }, tickSeconds));
      moves.push(markets[0]!.price / 190 - 1);
    }
    const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
    return Math.sqrt(moves.reduce((a, b) => a + (b - mean) ** 2, 0) / moves.length);
  };
  const slow = spread(15);
  const fast = spread(1);
  assert.ok(fast / slow > 0.6 && fast / slow < 1.6, `ten minute spread: ${fast} against ${slow}`);
});

test("a one second step is small: no move like a glitch", () => {
  const rng = createRng(12);
  let markets = start();
  for (let i = 0; i < 3_600; i++) {
    const next = stepMarkets(markets, [], rng, CALM_MARKET, 1).markets;
    assert.ok(Math.abs(next[0]!.price / markets[0]!.price - 1) < 0.002);
    markets = next;
  }
});
