import assert from "node:assert/strict";
import { test } from "node:test";
import { quote, type OptionType } from "./blackScholes.js";
import { advancedGreeks } from "./greeks.js";

const base = { spot: 190, strike: 195, timeToExpiryYears: 0.25, volatility: 0.4, riskFreeRate: 0.03 };

/// Central differences of the model's own price, delta, gamma and vega are the ground truth for
/// every closed form here.
const diff = (f: (x: number) => number, x: number, h: number) => (f(x + h) - f(x - h)) / (2 * h);

for (const optionType of ["CALL", "PUT"] as OptionType[]) {
  const at = (overrides: Partial<typeof base>) => quote({ ...base, ...overrides, optionType });

  test(`${optionType}: rho matches the price's sensitivity to the rate`, () => {
    const numeric = diff((r) => at({ riskFreeRate: r }).premium, base.riskFreeRate, 1e-5);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).rho - numeric) < 1e-3, `${advancedGreeks({ ...base, optionType }).rho} vs ${numeric}`);
  });

  test(`${optionType}: vanna matches the delta's sensitivity to volatility`, () => {
    const numeric = diff((v) => at({ volatility: v }).delta, base.volatility, 1e-5);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).vanna - numeric) < 1e-5);
  });

  test(`${optionType}: vomma matches the vega's sensitivity to volatility`, () => {
    const numeric = diff((v) => at({ volatility: v }).vega, base.volatility, 1e-5);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).vomma - numeric) < 1e-3);
  });

  test(`${optionType}: speed matches the gamma's sensitivity to spot`, () => {
    const numeric = diff((s) => at({ spot: s }).gamma, base.spot, 1e-3);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).speed - numeric) < 1e-7);
  });

  test(`${optionType}: charm matches the delta's decay as time passes`, () => {
    // Time passing shortens the time to expiry, so the decay is minus the change per year of T.
    const numeric = -diff((t) => at({ timeToExpiryYears: t }).delta, base.timeToExpiryYears, 1e-6);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).charm - numeric) < 1e-4, `${advancedGreeks({ ...base, optionType }).charm} vs ${numeric}`);
  });

  test(`${optionType}: color matches the gamma's decay as time passes`, () => {
    const numeric = -diff((t) => at({ timeToExpiryYears: t }).gamma, base.timeToExpiryYears, 1e-6);
    assert.ok(Math.abs(advancedGreeks({ ...base, optionType }).color - numeric) < 1e-5, `${advancedGreeks({ ...base, optionType }).color} vs ${numeric}`);
  });
}

test("a call has positive rho and a put negative rho", () => {
  assert.ok(advancedGreeks({ ...base, optionType: "CALL" }).rho > 0);
  assert.ok(advancedGreeks({ ...base, optionType: "PUT" }).rho < 0);
});

test("vanna, vomma, speed and color do not depend on call or put", () => {
  const call = advancedGreeks({ ...base, optionType: "CALL" });
  const put = advancedGreeks({ ...base, optionType: "PUT" });
  for (const key of ["vanna", "vomma", "speed", "color", "charm"] as const) assert.equal(call[key], put[key], key);
});

test("bad input is rejected", () => {
  assert.throws(() => advancedGreeks({ ...base, timeToExpiryYears: 0, optionType: "CALL" }), /must all be positive/);
  assert.throws(() => advancedGreeks({ ...base, volatility: 0, optionType: "PUT" }), /must all be positive/);
});
