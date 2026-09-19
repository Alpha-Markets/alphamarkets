import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBps, feeFromBps, initialMargin, liquidationPrice, maintenanceMargin, marginRatioBps, unrealizedPnl } from "./math.js";

const WAD = 10n ** 18n;
const usd = (value: number) => BigInt(Math.round(value * 1e6)) * 10n ** 12n; // exact for test inputs

test("long liquidation price: 5x, 5% maintenance margin", () => {
  // entry 184.48, collateral 1000, notional 5000, maintenance 250, shortfall -750,
  // offset = 184.48 * -750 / 5000 = -27.672 -> 156.808
  assert.equal(liquidationPrice(true, usd(184.48), 1000n * WAD, 5000n * WAD, 500n), usd(156.808));
});

test("short liquidation price is the mirror image", () => {
  assert.equal(liquidationPrice(false, usd(184.48), 1000n * WAD, 5000n * WAD, 500n), usd(212.152));
});

test("liquidation price floors at zero and handles zero size", () => {
  assert.equal(liquidationPrice(true, usd(100), 10_000n * WAD, 100n * WAD, 500n), 0n);
  assert.equal(liquidationPrice(true, usd(100), 1n, 0n, 500n), 0n);
});

test("unrealized pnl is signed by side", () => {
  assert.equal(unrealizedPnl(true, usd(100), usd(110), 1000n * WAD), 100n * WAD);
  assert.equal(unrealizedPnl(false, usd(100), usd(110), 1000n * WAD), -100n * WAD);
  assert.equal(unrealizedPnl(true, 0n, usd(110), 1000n * WAD), 0n);
});

test("margin ratio floors at zero when equity is exhausted", () => {
  assert.equal(marginRatioBps(1000n * WAD, 0n, 5000n * WAD), 2000n);
  assert.equal(marginRatioBps(1000n * WAD, -1000n * WAD, 5000n * WAD), 0n);
  assert.equal(marginRatioBps(1n, 1n, 0n), 0n);
});

test("margin, fee and slippage helpers round down like the contracts", () => {
  assert.equal(initialMargin(5000n, 1000n), 500n);
  assert.equal(maintenanceMargin(5000n, 500n), 250n);
  assert.equal(feeFromBps(5000n * WAD, 8n), 4n * WAD);
  assert.equal(feeFromBps(999n, 1n), 0n);
  assert.equal(applyBps(10_000n, 50n), 10_050n);
  assert.equal(applyBps(10_000n, -50n), 9_950n);
});
