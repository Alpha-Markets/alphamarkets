import assert from "node:assert/strict";
import { test } from "node:test";
import { quote } from "./blackScholes.js";
import { applySpread } from "./spread.js";

const mark = quote({ spot: 190, strike: 190, timeToExpiryYears: 0.1, volatility: 0.5, riskFreeRate: 0, optionType: "CALL" });

test("a zero spread leaves bid, ask and mark equal", () => {
  const result = applySpread(mark, 0, 190, "CALL");
  assert.equal(result.bid, mark.premium);
  assert.equal(result.ask, mark.premium);
  assert.equal(result.breakEven, mark.breakEven);
});

test("the spread is split evenly around the mark", () => {
  const result = applySpread(mark, 400, 190, "CALL"); // 4%: 2% each side
  assert.ok(Math.abs(result.ask - mark.premium * 1.02) < 1e-12);
  assert.ok(Math.abs(result.bid - mark.premium * 0.98) < 1e-12);
  assert.equal(result.premium, mark.premium, "premium stays the mark");
});

test("break-even follows the ask the buyer pays, for calls and puts", () => {
  const call = applySpread(mark, 400, 190, "CALL");
  assert.ok(Math.abs(call.breakEven - (190 + call.ask)) < 1e-12);
  const put = applySpread({ ...mark, premium: 5 }, 400, 190, "PUT");
  assert.ok(Math.abs(put.breakEven - (190 - put.ask)) < 1e-12);
});

test("an out-of-range spread is an error, not a negative bid", () => {
  for (const bad of [-1, 20_000, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => applySpread(mark, bad, 190, "CALL"), /spread must be in/);
  }
  assert.ok(applySpread(mark, 19_999, 190, "CALL").bid >= 0);
});
