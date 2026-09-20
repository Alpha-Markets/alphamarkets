import assert from "node:assert/strict";
import { test } from "node:test";
import { OptionPositionStatus, OptionType, type Orionis } from "@orionis/sdk";
import { collateralFor, createHedger } from "./hedger.js";

const WAD = 10n ** 18n;
const ME = `0x${"aa".repeat(20)}` as const;
const MARKET = `0x${"11".repeat(32)}` as const;
const usd = (n: number) => BigInt(n) * 10n ** 6n;
const NOW = 1_000_000;

function setup(over: { options?: unknown[]; perps?: unknown[]; delta?: number; failOpen?: boolean } = {}) {
  const sent: Array<{ name: string; args: unknown[] }> = [];
  const logs: string[] = [];
  const orionis = {
    addresses: { settlementToken: `0x${"bb".repeat(20)}` },
    erc20: { decimals: async () => 6 },
    oracle: { getMarkPrice: async () => ({ price: 190n * WAD, timestamp: 1n }) },
    markets: { get: async () => ({ marketId: MARKET }) },
    options: {
      contractSize: async () => 100n * WAD,
      quote: async () => ({ delta: over.delta ?? 0.5 }),
    },
    portfolio: {
      positions: async () => ({
        options: over.options ?? [
          { positionId: 1n, marketId: MARKET, optionType: OptionType.CALL, strike: 190n * WAD, expiry: BigInt(NOW / 1000 + 86_400), contracts: 10n, status: OptionPositionStatus.OPEN },
          // Expired, closed and other-market positions are not part of the book.
          { positionId: 2n, marketId: MARKET, optionType: OptionType.CALL, strike: 190n * WAD, expiry: BigInt(NOW / 1000 - 1), contracts: 99n, status: OptionPositionStatus.OPEN },
          { positionId: 3n, marketId: MARKET, optionType: OptionType.PUT, strike: 190n * WAD, expiry: BigInt(NOW / 1000 + 86_400), contracts: 99n, status: OptionPositionStatus.CLOSED },
          { positionId: 4n, marketId: `0x${"22".repeat(32)}`, optionType: OptionType.CALL, strike: 190n * WAD, expiry: BigInt(NOW / 1000 + 86_400), contracts: 99n, status: OptionPositionStatus.OPEN },
        ],
        perps: over.perps ?? [],
      }),
    },
    perps: {
      closePosition: async (id: bigint) => (sent.push({ name: "close", args: [id] }), "0x"),
      reducePosition: async (id: bigint, params: { size: bigint }) => (sent.push({ name: "reduce", args: [id, params.size] }), "0x"),
      openPosition: async (params: unknown) => {
        if (over.failOpen) throw Object.assign(new Error("boom"), { shortMessage: "InsufficientCollateral" });
        sent.push({ name: "open", args: [params] });
        return { hash: "0x", positionId: 1n };
      },
    },
  } as unknown as Orionis;
  const make = (execute: boolean) =>
    createHedger({ orionis, account: ME, market: "NVDA", targetDelta: 0, toleranceUnits: 1, minNotional: 0n, leverage: 2, execute, now: () => NOW, log: (m) => logs.push(m) });
  return { make, sent, logs };
}

test("collateral is the notional over the leverage, rounded up", () => {
  assert.equal(collateralFor(usd(1_000), 2), usd(500));
  assert.equal(collateralFor(1_001n, 2), 501n);
  assert.equal(collateralFor(10n, 3), 4n);
});

test("only the open, unexpired options on the hedged market count, and a dry run sends nothing", async () => {
  const { make, sent, logs } = setup();
  const tick = await make(false).tick();
  // 10 contracts x 100 units x delta 0.5 = 500 units of delta.
  assert.equal(tick.optionDelta, 500);
  assert.equal(tick.adjustUnits, -500);
  assert.deepEqual(tick.actions, [{ type: "open", side: "SHORT", notional: usd(95_000) }]);
  assert.equal(tick.executed, false);
  assert.deepEqual(sent, []);
  assert.ok(logs.some((line) => line.includes("dry run")), logs.join("|"));
});

test("with trading on, a new short is opened at the configured leverage", async () => {
  const { make, sent } = setup();
  const tick = await make(true).tick();
  assert.equal(tick.executed, true);
  assert.deepEqual(sent[0]!.args[0], { market: "NVDA", side: "SHORT", collateral: usd(47_500), leverage: 2, tx: { wait: true } });
});

test("an existing hedge counts, and an opposite position is reduced before anything opens", async () => {
  // A long perp of 100 units when the book wants to sell 500: close the long, then short the rest.
  const perps = [{ positionId: 9n, marketId: MARKET, isLong: true, size: usd(19_000), entryPrice: 190n * WAD, open: true }];
  const { make, sent } = setup({ perps });
  const tick = await make(true).tick();
  assert.equal(tick.perpDelta, 100);
  assert.equal(tick.adjustUnits, -600);
  assert.deepEqual(sent.map((s) => s.name), ["close", "open"]);
});

test("inside the tolerance nothing trades", async () => {
  const perps = [{ positionId: 9n, marketId: MARKET, isLong: false, size: usd(95_000), entryPrice: 190n * WAD, open: true }]; // -500 units
  const { make, sent, logs } = setup({ perps });
  const tick = await make(true).tick();
  assert.equal(tick.netDelta, 0);
  assert.deepEqual(tick.actions, []);
  assert.deepEqual(sent, []);
  assert.ok(logs.some((line) => line.includes("no trade")));
});

test("a failed trade is logged and stops the rest, reporting it as not executed", async () => {
  const { make, sent, logs } = setup({ failOpen: true });
  const tick = await make(true).tick();
  assert.equal(tick.executed, false);
  assert.deepEqual(sent, []);
  assert.ok(logs.some((line) => line.includes("failed: InsufficientCollateral")), logs.join("|"));
});

test("a book with no options wants no hedge", async () => {
  const { make } = setup({ options: [] });
  const tick = await make(false).tick();
  assert.equal(tick.optionDelta, 0);
  assert.deepEqual(tick.actions, []);
});
