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
  const nudge = planNudge("NVDA", -6, 6);
  const path = run(nudge.remainingSteps, 5, [nudge]);
  const last = path[path.length - 1]!;
  const nvda = last[0]!.price / 190 - 1;
  assert.ok(nvda < -0.045 && nvda > -0.075, `NVDA moved ${nvda}`);
  const tsla = last[1]!.price / 350 - 1;
  assert.ok(Math.abs(tsla) < 0.02, `TSLA moved ${tsla}`);
});

test("a nudge plays out over several steps and then ends", () => {
  const nudge = planNudge("NVDA", 5, 1);
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
  assert.throws(() => planNudge("NVDA", 0, 3), /other than 0/);
});

test("feed prices round-trip through the 18 decimal integer", () => {
  assert.equal(toFeedPrice(190.25), 190_250_000_000_000_000_000n);
  assert.equal(fromFeedPrice(toFeedPrice(190.25)), 190.25);
  assert.equal(fromFeedPrice(190_000_000_000_000_000_000n), 190);
});
