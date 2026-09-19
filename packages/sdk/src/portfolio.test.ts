import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NotImplementedError } from "./errors.js";
import { createPortfolio } from "./portfolio.js";
import { addresses, fakeClient, NVDA, USER, WAD } from "./testing.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const perp = (overrides: Record<string, unknown>) => ({
  marketId: NVDA,
  isLong: true,
  entryPrice: 100n * WAD,
  size: 1000n * WAD,
  collateral: 200n * WAD,
  leverage: 5n,
  realizedPnl: 0n,
  fundingAccrued: 0n,
  lastFundingIndex: 0n,
  open: true,
  owner: USER,
  ...overrides,
});

function setup(apiUrl?: string) {
  const positions: Record<string, Record<string, unknown>> = { "1": perp({}), "2": perp({ isLong: false }), "3": perp({ open: false, realizedPnl: 5n * WAD }) };
  const { client } = fakeClient();
  // `positions()` reads getUserPositions then getPosition per id; answer both from this stub.
  (client as unknown as { readContract: unknown }).readContract = async (params: { address: string; functionName: string; args: readonly unknown[] }) => {
    if (params.functionName === "getUserPositions") {
      return params.address === addresses.perpPositionManager ? [1n, 2n, 3n] : [];
    }
    return positions[String(params.args[0])];
  };
  return createPortfolio({
    client,
    addresses,
    vault: { balances: async () => ({ balance: 10n, lockedMargin: 4n, available: 6n }) } as never,
    oracle: { getMarkPrice: async () => ({ price: 110n * WAD, timestamp: 1n }) } as never,
    apiUrl,
  });
}

test("summary aggregates open perp PnL at mark and realized PnL across positions", async () => {
  const summary = await setup().summary(USER);

  // long +10% on $1000 = +100, short -10% = -100 -> nets to 0; closed position is excluded.
  assert.equal(summary.unrealizedPerpPnl, 0n);
  assert.equal(summary.realizedPnl, 5n * WAD);
  assert.equal(summary.balances.available, 6n);
  assert.equal(summary.positions.perps.length, 3);
});

test("orders and history require apiUrl; orders reads the API when set", async () => {
  await assert.rejects(setup().orders(USER), NotImplementedError);
  await assert.rejects(setup().history(USER), NotImplementedError);

  globalThis.fetch = (async (url: string) => {
    assert.equal(url, `http://api.test/v1/orders/${USER}`);
    return new Response("[]");
  }) as typeof fetch;
  assert.deepEqual(await setup("http://api.test").orders(USER), []);
});
