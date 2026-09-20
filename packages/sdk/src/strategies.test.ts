import assert from "node:assert/strict";
import { test } from "node:test";
import { AlphaMarketsError } from "./errors.js";
import { analyzeStrategy, buildStrategy, payoffCurve, type QuoteLookup } from "./strategies.js";

const close = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
};

/// Premiums by strike, so each test can read the numbers it expects straight off the table.
const table = (rows: Record<string, number>): QuoteLookup => (type, strike) => {
  const mark = rows[`${type}${strike}`];
  if (mark === undefined) throw new Error(`no quote for ${type} ${strike}`);
  return { mark, greeks: { delta: type === "CALL" ? 0.5 : -0.5, gamma: 0.01, theta: -0.1, vega: 0.2 } };
};

const quote = table({ CALL100: 8, CALL110: 3, CALL90: 13, PUT100: 7, PUT90: 2, PUT110: 12, PUT80: 0.5, CALL120: 1 });

test("a bull call spread: capped profit and loss, one break-even, both short legs cannot open yet", () => {
  const spread = buildStrategy("BULL_CALL_SPREAD", { lowStrike: 100, highStrike: 110 }, { spot: 100, quote });
  close(spread.netPremium, 5); // pay 8, receive 3
  close(spread.maxProfit, 5); // 10 wide less 5
  close(spread.maxLoss, 5);
  assert.deepEqual(spread.breakEvens.map((b) => Math.round(b * 1e6) / 1e6), [105]);
  close(spread.payoffAt(90), -5);
  close(spread.payoffAt(105), 0);
  close(spread.payoffAt(200), 5);
  assert.equal(spread.executable, false);
});

test("a bear put spread mirrors it", () => {
  const spread = buildStrategy("BEAR_PUT_SPREAD", { lowStrike: 90, highStrike: 100 }, { spot: 100, quote });
  close(spread.netPremium, 5); // pay 7 for the 100 put, receive 2 for the 90 put
  close(spread.maxProfit, 5);
  close(spread.maxLoss, 5);
  assert.deepEqual(spread.breakEvens, [95]);
});

test("a straddle loses the premium at the strike and has unlimited profit upward", () => {
  const straddle = buildStrategy("STRADDLE", { strike: 100 }, { spot: 100, quote });
  close(straddle.netPremium, 15);
  close(straddle.maxLoss, 15);
  assert.equal(straddle.maxProfit, null);
  assert.deepEqual(straddle.breakEvens, [85, 115]);
  assert.equal(straddle.executable, true, "two long options");
  close(straddle.greeks.delta, 0);
  close(straddle.greeks.vega, 0.4);
});

test("a strangle needs the put strike below the call strike", () => {
  const strangle = buildStrategy("STRANGLE", { putStrike: 90, callStrike: 110 }, { spot: 100, quote });
  close(strangle.netPremium, 5);
  close(strangle.maxLoss, 5);
  assert.deepEqual(strangle.breakEvens, [85, 115]);
  assert.throws(() => buildStrategy("STRANGLE", { putStrike: 110, callStrike: 90 }, { spot: 100, quote }), AlphaMarketsError);
});

test("a covered call caps the upside and keeps the downside, and cannot open (short call)", () => {
  const covered = buildStrategy("COVERED_CALL", { callStrike: 110 }, { spot: 100, quote });
  // Bought at 100, sold the 110 call for 3.
  close(covered.payoffAt(100), 3);
  close(covered.payoffAt(110), 13);
  close(covered.payoffAt(150), 13);
  close(covered.maxProfit, 13);
  close(covered.maxLoss, 97, 1e-9); // the underlying to zero, less the 3 collected
  assert.deepEqual(covered.breakEvens, [97]);
  assert.equal(covered.executable, false);
  close(covered.greeks.delta, 1 - 0.5);
});

test("a protective put floors the loss and is executable (long perp plus long put)", () => {
  const protectedLong = buildStrategy("PROTECTIVE_PUT", { putStrike: 90 }, { spot: 100, quote });
  close(protectedLong.maxLoss, 12); // 10 down to the strike plus 2 of premium
  assert.equal(protectedLong.maxProfit, null);
  assert.deepEqual(protectedLong.breakEvens, [102]);
  assert.equal(protectedLong.executable, true);
  close(protectedLong.netPremium, 2, 1e-9);
});

test("an iron condor collects a credit with capped risk on both sides", () => {
  const condor = buildStrategy("IRON_CONDOR", { wings: [80, 90, 110, 120] }, { spot: 100, quote });
  // Long 80 put 0.5, short 90 put 2, short 110 call 3, long 120 call 1: credit 3.5.
  close(condor.netPremium, -3.5);
  close(condor.maxProfit, 3.5);
  close(condor.maxLoss, 6.5); // 10 wide less the 3.5 credit
  assert.deepEqual(condor.breakEvens.map((b) => Math.round(b * 1e6) / 1e6), [86.5, 113.5]);
  close(condor.payoffAt(100), 3.5);
  assert.equal(condor.executable, false);
});

test("quantity scales every figure, and bid and ask price the two sides", () => {
  const priced: QuoteLookup = (type) => ({ mark: 5, bid: type === "CALL" ? 4 : 4, ask: 6 });
  const straddle = buildStrategy("STRADDLE", { strike: 100 }, { spot: 100, quantity: 3, quote: priced });
  close(straddle.netPremium, 36, 1e-9); // buys at the ask: 2 legs * 6 * 3
  const spread = buildStrategy("BULL_CALL_SPREAD", { lowStrike: 100, highStrike: 110 }, { spot: 100, quote: priced });
  close(spread.netPremium, 2); // buy at 6, sell at 4
});

test("breakEvens are exact for a hand-built set of legs, including a flat payoff", () => {
  const flat = analyzeStrategy([
    { kind: "UNDERLYING", side: "LONG", quantity: 1, price: 100 },
    { kind: "UNDERLYING", side: "SHORT", quantity: 1, price: 100 },
  ]);
  close(flat.maxProfit, 0);
  close(flat.maxLoss, 0);
  assert.deepEqual(flat.breakEvens, [], "a payoff of zero everywhere has no single break-even");
});

test("bad input is rejected with a clear error", () => {
  assert.throws(() => analyzeStrategy([]), /at least one leg/);
  assert.throws(() => buildStrategy("STRADDLE", {}, { spot: 100, quote }), /needs a strike/);
  assert.throws(() => buildStrategy("BULL_CALL_SPREAD", { lowStrike: 110, highStrike: 100 }, { spot: 100, quote }), /below the higher strike/);
  assert.throws(() => analyzeStrategy([{ kind: "CALL", side: "LONG", quantity: 0, strike: 100, price: 1 }]), /quantity/);
  assert.throws(() => analyzeStrategy([{ kind: "CALL", side: "LONG", quantity: 1, price: 1 }]), /strike/);
});

test("payoffCurve samples the payoff evenly", () => {
  const legs = buildStrategy("STRADDLE", { strike: 100 }, { spot: 100, quote }).legs;
  const curve = payoffCurve(legs, 80, 120, 5);
  assert.deepEqual(curve.map(([price]) => price), [80, 90, 100, 110, 120]);
  close(curve[2]![1], -15);
  assert.throws(() => payoffCurve(legs, 100, 100), AlphaMarketsError);
});

test("the payoff at expiry equals the sum of the leg payoffs, whatever the strategy (property check)", () => {
  for (const price of [0, 1, 79.5, 100, 130, 500]) {
    const condor = buildStrategy("IRON_CONDOR", { wings: [80, 90, 110, 120] }, { spot: 100, quote });
    const manual =
      Math.max(80 - price, 0) - 0.5 - (Math.max(90 - price, 0) - 2) - (Math.max(price - 110, 0) - 3) + (Math.max(price - 120, 0) - 1);
    close(condor.payoffAt(price), manual, 1e-9);
  }
});
