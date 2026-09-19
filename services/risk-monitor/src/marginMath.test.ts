import assert from "node:assert/strict";
import { test } from "node:test";
import { initialMargin, liquidationPrice, maintenanceMargin, marginRatio, unrealizedPnl } from "./marginMath.js";

test("initialMargin / maintenanceMargin apply the bps rate to notional", () => {
  const notional = 500_000n * 10n ** 18n;
  assert.equal(initialMargin(notional, 1000n), 50_000n * 10n ** 18n); // 10%
  assert.equal(maintenanceMargin(notional, 500n), 25_000n * 10n ** 18n); // 5%
});

test("unrealizedPnl: long gains when mark rises above entry", () => {
  const entry = 190n * 10n ** 18n;
  const mark = 200n * 10n ** 18n;
  const size = 5_000n * 10n ** 18n;
  const pnl = unrealizedPnl(true, entry, mark, size);
  // priceDelta/entry = 10/190, size * that ≈ 263.15...e18
  assert.ok(pnl > 260n * 10n ** 18n && pnl < 264n * 10n ** 18n);
});

test("unrealizedPnl: short loses when mark rises above entry", () => {
  const entry = 190n * 10n ** 18n;
  const mark = 200n * 10n ** 18n;
  const size = 5_000n * 10n ** 18n;
  assert.equal(unrealizedPnl(false, entry, mark, size), -unrealizedPnl(true, entry, mark, size));
});

test("marginRatio floors at 0 when equity is non-positive", () => {
  assert.equal(marginRatio(0n, 0n, 1000n), 0n);
  assert.equal(marginRatio(10n, -50n, 1000n), 0n);
});

test("liquidationPrice: collateral exactly at maintenance margin means no offset", () => {
  const entry = 190n * 10n ** 18n;
  const size = 5_000n * 10n ** 18n;
  const maintRateBps = 500n; // 5%
  const collateral = maintenanceMargin(size, maintRateBps); // exact match -> shortfall 0
  assert.equal(liquidationPrice(true, entry, collateral, size, maintRateBps), entry);
  assert.equal(liquidationPrice(false, entry, collateral, size, maintRateBps), entry);
});

test("liquidationPrice: long liquidates below entry, short liquidates above entry", () => {
  const entry = 190n * 10n ** 18n;
  const size = 5_000n * 10n ** 18n;
  const collateral = 500n * 10n ** 18n; // above 5% maintenance margin of 250 - safely margined
  const maintRateBps = 500n;
  assert.ok(liquidationPrice(true, entry, collateral, size, maintRateBps) < entry);
  assert.ok(liquidationPrice(false, entry, collateral, size, maintRateBps) > entry);
});
