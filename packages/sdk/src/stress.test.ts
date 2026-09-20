import assert from "node:assert/strict";
import { test } from "node:test";
import { liquidationDistances, netPerpExposure, shockPrice, stressAt, stressPortfolio, type StressInput } from "./stress.js";

const WAD = 10n ** 18n;
const M = "0xmarket";
const usd = (n: number) => BigInt(n) * 10n ** 6n; // a 6-decimal settlement token

const longPerp = { positionId: 1n, marketId: M, isLong: true, entryPrice: 190n * WAD, size: usd(5_000), collateral: usd(1_000), maintenanceMarginRateBps: 500n };
const shortPerp = { positionId: 2n, marketId: M, isLong: false, entryPrice: 190n * WAD, size: usd(2_000), collateral: usd(400), maintenanceMarginRateBps: 500n };
const call = { positionId: 7n, marketId: M, type: "CALL" as const, strike: 200n * WAD, contracts: 10n, contractSize: 100n * WAD, entryPremium: usd(4_000) };

const input = (over: Partial<StressInput> = {}): StressInput => ({
  marks: { [M]: 190n * WAD },
  perps: [longPerp, shortPerp],
  options: [call],
  settlementDecimals: 6,
  availableBalance: usd(3_000),
  ...over,
});

test("a price shock scales by basis points and never goes below zero", () => {
  assert.equal(shockPrice(200n * WAD, -1000), 180n * WAD);
  assert.equal(shockPrice(200n * WAD, 500), 210n * WAD);
  assert.equal(shockPrice(200n * WAD, -10_000), 0n);
  assert.equal(shockPrice(200n * WAD, -20_000), 0n);
});

test("at no move the perps carry no PnL and the equity is free plus locked collateral", () => {
  const result = stressAt(input(), 0);
  assert.equal(result.perpPnl, 0n);
  assert.deepEqual(result.liquidated, []);
  assert.equal(result.equity, usd(3_000 + 1_000 + 400));
});

test("a 10% fall gains the short, loses the long, and equity follows both", () => {
  const result = stressAt(input(), -1000);
  const [long, short] = result.perps;
  // 5,000 * (171 - 190) / 190 = -500; 2,000 * (190 - 171) / 190 = +200.
  assert.equal(long!.pnl, usd(-500));
  assert.equal(short!.pnl, usd(200));
  assert.equal(result.perpPnl, usd(-300));
  assert.equal(result.equity, usd(3_000 + 1_400 - 300));
});

test("a position is liquidated once its margin ratio is under its maintenance rate", () => {
  // The long has 20% margin and a 5% maintenance rate: it survives -10% (ratio 10%) and dies at -20%.
  assert.deepEqual(stressAt(input(), -1000).liquidated, []);
  assert.deepEqual(stressAt(input(), -2000).liquidated, [1n]);
  // The short is hit on the way up.
  assert.deepEqual(stressAt(input(), 2000).liquidated, [2n]);
  assert.equal(stressAt(input(), 2000).perps.find((p) => p.positionId === 2n)!.marginRatioBps, 0n, "equity is gone");
});

test("options are valued at intrinsic value at the shocked price, against the premium paid", () => {
  // The 200 call on 100-unit contracts x 10: 1,000 units. At 230 it is worth 30 * 1,000 = 30,000.
  const up = stressAt(input({ marks: { [M]: 200n * WAD } }), 1500);
  assert.equal(up.optionValue, usd(30_000));
  assert.equal(up.optionCost, usd(4_000));
  assert.equal(up.optionPnl, usd(26_000));
  // Out of the money it is worth nothing and the whole premium is lost.
  const flat = stressAt(input(), 0);
  assert.equal(flat.optionValue, 0n);
  assert.equal(flat.optionPnl, usd(-4_000));
});

test("a put pays as the price falls", () => {
  const put = { ...call, type: "PUT" as const, strike: 190n * WAD };
  const result = stressAt(input({ options: [put] }), -1000); // 171: 19 * 1,000 units
  assert.equal(result.optionValue, usd(19_000));
});

test("a position on a market with no mark is left out", () => {
  const result = stressAt(input({ marks: {} }), -1000);
  assert.equal(result.perps.length, 0);
  assert.equal(result.optionValue, 0n);
  assert.equal(result.equity, usd(3_000), "no locked margin is counted for it either");
});

test("the default grid runs nine scenarios in order", () => {
  const results = stressPortfolio(input());
  assert.equal(results.length, 9);
  assert.deepEqual(results.map((r) => r.shockBps), [-3000, -2000, -1000, -500, 0, 500, 1000, 2000, 3000]);
});

test("liquidation distance is the mark's move that reaches the liquidation price", () => {
  const [long, short] = liquidationDistances(input());
  // Long: margin 20%, maintenance 5% => liquidation at -15% of entry (161.5): -1500 bps.
  assert.equal(long!.liquidationPrice, 1615n * WAD / 10n);
  assert.equal(long!.distanceBps, -1500n);
  assert.equal(short!.distanceBps, 1500n);
  assert.equal(liquidationDistances({ marks: {}, perps: [longPerp] })[0]!.distanceBps, null);
});

test("net exposure is longs minus shorts per market", () => {
  assert.deepEqual(netPerpExposure([longPerp, shortPerp]), { [M]: usd(3_000) });
  assert.deepEqual(netPerpExposure([]), {});
});
