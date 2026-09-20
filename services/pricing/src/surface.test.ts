import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSurface, FLAT_SURFACE, surfaceVolatility } from "./surface.js";

const bounds = { min: 0.1, max: 3 };
const DAY = 86_400;

test("a flat surface gives the base volatility at every strike and expiry", () => {
  for (const strike of [150, 190, 250]) {
    for (const years of [0.02, 0.25, 1]) {
      assert.equal(surfaceVolatility(0.5, FLAT_SURFACE, bounds, 190, strike, years), 0.5);
    }
  }
});

test("a negative skew slope prices low strikes with more volatility", () => {
  const shape = { skewSlope: -0.4, smileCurve: 0, termSlope: 0 };
  const low = surfaceVolatility(0.5, shape, bounds, 190, 170, 0.1);
  const atm = surfaceVolatility(0.5, shape, bounds, 190, 190, 0.1);
  const high = surfaceVolatility(0.5, shape, bounds, 190, 210, 0.1);
  assert.equal(atm, 0.5);
  assert.ok(low > atm && atm > high);
});

test("curvature lifts both wings and the term slope moves the level with expiry", () => {
  const smile = { skewSlope: 0, smileCurve: 2, termSlope: 0 };
  assert.ok(surfaceVolatility(0.5, smile, bounds, 190, 150, 0.1) > 0.5);
  assert.ok(surfaceVolatility(0.5, smile, bounds, 190, 240, 0.1) > 0.5);
  const term = { skewSlope: 0, smileCurve: 0, termSlope: 0.3 };
  assert.ok(surfaceVolatility(0.5, term, bounds, 190, 190, 1) > surfaceVolatility(0.5, term, bounds, 190, 190, 0.02));
});

test("the result is clamped to the bounds", () => {
  const steep = { skewSlope: -50, smileCurve: 0, termSlope: 0 };
  assert.equal(surfaceVolatility(0.5, steep, bounds, 190, 100, 0.1), 3);
  assert.equal(surfaceVolatility(0.5, steep, bounds, 190, 400, 0.1), 0.1);
});

test("a surface lists each future expiry with a point per strike, sorted, and skips past ones", () => {
  const now = 1_000_000;
  const surface = buildSurface({
    spot: 190,
    strikes: [200, 180, 190, 190],
    expiries: [now + 30 * DAY, now - DAY, now + 7 * DAY],
    nowSeconds: now,
    baseVolatility: 0.5,
    ivSource: "default",
    shape: { skewSlope: -0.3, smileCurve: 0, termSlope: 0 },
    bounds,
    riskFreeRate: 0,
  });
  assert.deepEqual(surface.strikes, [180, 190, 200]);
  assert.deepEqual(surface.expiries.map((e) => e.expiry), [now + 7 * DAY, now + 30 * DAY]);
  const week = surface.expiries[0]!;
  assert.equal(week.points.length, 3);
  assert.ok(week.skew > 0, "negative slope means puts cost more");
  assert.equal(week.atmIv, 0.5);
  assert.ok(week.points[0]!.iv > week.points[2]!.iv);
  // Prices come from the model at that strike's own volatility.
  assert.ok(week.points[0]!.put.premium > 0 && week.points[0]!.call.greeks.vanna !== undefined);
});

test("a flat surface with put-call parity at r=0: call minus put is spot minus strike", () => {
  const now = 0;
  const surface = buildSurface({
    spot: 190,
    strikes: [170, 190, 210],
    expiries: [30 * DAY],
    nowSeconds: now,
    baseVolatility: 0.4,
    ivSource: "realized",
    shape: FLAT_SURFACE,
    bounds,
    riskFreeRate: 0,
  });
  for (const point of surface.expiries[0]!.points) {
    assert.ok(Math.abs(point.call.premium - point.put.premium - (190 - point.strike)) < 1e-6);
  }
  assert.equal(surface.ivSource, "realized");
});
