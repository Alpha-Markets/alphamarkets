import assert from "node:assert/strict";
import { test } from "node:test";
import { quote } from "./blackScholes.js";

// Reference case (Hull, "Options, Futures, and Other Derivatives"): S=42, K=40, r=10%,
// sigma=20%, T=0.5y. Textbook call premium ~= 4.76, put premium ~= 0.81.
test("matches the textbook Hull reference values", () => {
  const call = quote({ spot: 42, strike: 40, timeToExpiryYears: 0.5, volatility: 0.2, riskFreeRate: 0.1, optionType: "CALL" });
  const put = quote({ spot: 42, strike: 40, timeToExpiryYears: 0.5, volatility: 0.2, riskFreeRate: 0.1, optionType: "PUT" });

  assert.ok(Math.abs(call.premium - 4.76) < 0.01, `call premium ${call.premium} not close to 4.76`);
  assert.ok(Math.abs(put.premium - 0.81) < 0.01, `put premium ${put.premium} not close to 0.81`);
});

test("put-call parity holds: C - P = S - K * e^(-rT)", () => {
  const spot = 190;
  const strike = 200;
  const timeToExpiryYears = 0.25;
  const riskFreeRate = 0.05;
  const volatility = 0.4;

  const call = quote({ spot, strike, timeToExpiryYears, volatility, riskFreeRate, optionType: "CALL" });
  const put = quote({ spot, strike, timeToExpiryYears, volatility, riskFreeRate, optionType: "PUT" });

  const lhs = call.premium - put.premium;
  const rhs = spot - strike * Math.exp(-riskFreeRate * timeToExpiryYears);
  assert.ok(Math.abs(lhs - rhs) < 1e-6, `parity violated: ${lhs} != ${rhs}`);
});

test("breakEven matches strike +/- premium", () => {
  const call = quote({ spot: 190, strike: 190, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0, optionType: "CALL" });
  assert.equal(call.breakEven, 190 + call.premium);

  const put = quote({ spot: 190, strike: 190, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0, optionType: "PUT" });
  assert.equal(put.breakEven, 190 - put.premium);
});

test("call delta in (0,1), put delta in (-1,0)", () => {
  const call = quote({ spot: 190, strike: 190, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0, optionType: "CALL" });
  const put = quote({ spot: 190, strike: 190, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0, optionType: "PUT" });

  assert.ok(call.delta > 0 && call.delta < 1);
  assert.ok(put.delta > -1 && put.delta < 0);
});

test("rejects non-positive inputs", () => {
  assert.throws(() => quote({ spot: 0, strike: 190, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0, optionType: "CALL" }));
  assert.throws(() => quote({ spot: 190, strike: 190, timeToExpiryYears: 0, volatility: 0.4, riskFreeRate: 0, optionType: "CALL" }));
});
