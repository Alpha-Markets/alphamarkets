import assert from "node:assert/strict";
import { test } from "node:test";
import { InsufficientMarginError, NotImplementedError, PositionLimitExceededError } from "./errors.js";
import { createPerps, type PerpsDeps } from "./perps.js";
import { activeMarket, addresses, fakeClient, NVDA, revertError, USER, WAD } from "./testing.js";

const MARK = 184_480_000_000_000_000_000n; // 184.48, 18 decimals

function setup(reads: Record<string, unknown> = {}, market = activeMarket) {
  const fake = fakeClient({
    availableBalance: 2_000_000_000n,
    getPosition: { isLong: true, marketId: NVDA },
    ...reads,
  });
  const deps: PerpsDeps = {
    client: fake.client,
    addresses,
    decimals: async () => 6,
    markets: { list: async () => [market], get: async () => market },
    oracle: {
      getIndexPrice: async () => ({ price: 184_420_000_000_000_000_000n, timestamp: 1n }),
      getMarkPrice: async () => ({ price: MARK, timestamp: 1n }),
      getLastPrice: async () => ({ price: MARK, timestamp: 1n }),
    },
    risk: {
      get: async () => ({
        maxLeverage: 10n,
        allowedLeverageTiers: [1n, 2n, 3n, 5n, 10n],
        initialMarginRateBps: 1000n,
        maintenanceMarginRateBps: 500n,
        maxPositionNotional: 500_000n * WAD,
        openInterestCap: 5_000_000n * WAD,
      }),
    },
    fees: {
      get: async () => ({ makerFee: 2n, takerFee: 8n, optionOpenFee: 0n, optionCloseFee: 0n, settlementFee: 0n, liquidationFee: 0n }),
    },
    funding: {
      get: async () => ({ currentFundingRateBps: 8n, fundingIntervalSeconds: 3600n, nextFundingTimestamp: 99n }),
    },
  };
  return { perps: createPerps(deps), ...fake };
}

test("previewOpen matches the brief's example: $1,000 at 5x, taker fee $4.00", async () => {
  const { perps } = setup();
  const preview = await perps.previewOpen({ market: "NVDA-PERP", side: "LONG", collateral: "1000", leverage: 5, user: USER });

  assert.equal(preview.collateral, 1_000_000_000n);
  assert.equal(preview.notional, 5_000_000_000n);
  assert.equal(preview.fee, 4_000_000n);
  assert.equal(preview.totalRequired, 1_004_000_000n);
  assert.equal(preview.entryPrice, MARK);
  // 5% maintenance margin on $5,000 = $250; equity buffer $750 -> 15% below entry.
  assert.equal(preview.liquidationPrice, 156_808_000_000_000_000_000n);
  assert.equal(preview.fundingRateBps, 8n);
  assert.equal(preview.sufficientCollateral, true);
  assert.deepEqual(preview.violations, []);
});

test("previewOpen reports insufficient Vault balance and onchain rule violations", async () => {
  const { perps } = setup({
    availableBalance: 500_000_000n,
    checkPositionSize: revertError("PositionLimitExceeded"),
    checkLeverage: revertError("InsufficientMargin"),
  });
  const preview = await perps.previewOpen({ market: "NVDA", side: "SHORT", collateral: "1000", leverage: 5, user: USER });

  assert.equal(preview.sufficientCollateral, false);
  assert.equal(preview.violations.length, 2);
  assert.ok(preview.violations.some((violation) => violation instanceof PositionLimitExceededError));
  assert.ok(preview.violations.some((violation) => violation instanceof InsufficientMarginError));
});

test("previewOpen flags a paused market", async () => {
  const { perps } = setup({}, { ...activeMarket, active: false });
  const preview = await perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "10", leverage: 1 });
  assert.equal(preview.violations[0]?.errorName, "MarketPaused");
  assert.equal(preview.availableBalance, undefined);
});

test("openPosition sends scaled collateral, leverage and a slippage-bounded price", async () => {
  const { perps, simulated } = setup();
  const { hash, positionId } = await perps.openPosition({
    market: "NVDA-PERP",
    side: "LONG",
    collateral: "1000",
    leverage: 5,
    deadline: 2_000_000_000n,
  });

  assert.equal(positionId, 42n);
  assert.match(hash, /^0x/);
  const [call] = simulated();
  assert.equal(call!.functionName, "openPosition");
  // 0.5% default slippage above mark for a long
  assert.deepEqual(call!.args, [NVDA, true, 1_000_000_000n, 5n, (MARK * 10_050n) / 10_000n, 2_000_000_000n]);
});

test("a short entry bound sits below mark; an explicit worstPrice wins", async () => {
  const short = setup();
  await short.perps.openPosition({ market: "NVDA", side: "SHORT", collateral: "1", leverage: 1, slippageBps: 100 });
  assert.equal(short.simulated()[0]!.args![4], (MARK * 9_900n) / 10_000n);

  const explicit = setup();
  await explicit.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, worstPrice: "200" });
  assert.equal(explicit.simulated()[0]!.args![4], 200n * WAD);
});

test("LIMIT orders are rejected before any RPC call", async () => {
  const { perps, calls } = setup();
  await assert.rejects(
    perps.openPosition({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, orderType: "LIMIT" }),
    NotImplementedError,
  );
  await assert.rejects(
    perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, orderType: "LIMIT" }),
    NotImplementedError,
  );
  assert.equal(calls.length, 0);
});

test("closing a long uses a lower-bound exit price; a short uses an upper bound", async () => {
  const long = setup();
  await long.perps.closePosition(1n, { deadline: 2_000_000_000n });
  const [closeLong] = long.simulated();
  assert.equal(closeLong!.functionName, "closePosition");
  assert.equal(closeLong!.args![1], (MARK * 9_950n) / 10_000n);

  const short = setup({ getPosition: { isLong: false, marketId: NVDA } });
  await short.perps.closePosition(1n, { deadline: 2_000_000_000n });
  assert.equal(short.simulated()[0]!.args![1], (MARK * 10_050n) / 10_000n);
});

test("increase and reduce scale sizes by settlement decimals", async () => {
  const { perps, simulated } = setup();
  await perps.increasePosition(3n, { addCollateral: "100", addSize: "500", deadline: 2_000_000_000n });
  await perps.reducePosition(3n, { size: "250", deadline: 2_000_000_000n });

  const [increase, reduce] = simulated();
  assert.deepEqual(increase!.args!.slice(0, 3), [3n, 100_000_000n, 500_000_000n]);
  assert.deepEqual(reduce!.args!.slice(0, 2), [3n, 250_000_000n]);
});

test("list returns only active perp markets", async () => {
  const { perps } = setup();
  assert.equal((await perps.list()).length, 1);
  const paused = setup({}, { ...activeMarket, perpsEnabled: false });
  assert.equal((await paused.perps.list()).length, 0);
});
