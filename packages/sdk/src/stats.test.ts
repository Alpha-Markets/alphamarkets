import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFunding } from "./funding.js";
import { createMarkets } from "./markets.js";
import { createRisk } from "./risk.js";
import { createPrices } from "./oracle.js";
import { NotImplementedError } from "./errors.js";
import { addresses, fakeClient, NVDA } from "./testing.js";
import type { OracleNamespace } from "./oracle.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown) {
  return (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
}

test("markets.stats restores bigints from the API's strings", async () => {
  globalThis.fetch = json([
    { marketId: NVDA, change24hBps: -125, changeWindowSeconds: 86400, perpVolume24h: "5000000000000000000000", optionsVolume24h: "42" },
  ]);
  const markets = createMarkets(fakeClient().client, addresses, "http://api.test");
  const [row] = await markets.stats();
  assert.equal(row!.change24hBps, -125);
  assert.equal(row!.perpVolume24h, 5_000n * 10n ** 18n);
  assert.equal(row!.optionsVolume24h, 42n);
});

test("prices.history asks for the range and parses prices", async () => {
  let requested = "";
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response(JSON.stringify([{ time: 1_700_000_000, price: "190000000000000000000" }]));
  }) as unknown as typeof fetch;
  const prices = createPrices(fakeClient().client, addresses, {} as OracleNamespace, "http://api.test");
  const points = await prices.history("NVDA-PERP", "7d");
  assert.equal(requested, "http://api.test/v1/prices/NVDA-PERP/history?range=7d");
  assert.deepEqual(points, [{ time: 1_700_000_000, price: 190n * 10n ** 18n }]);
});

test("statistics need apiUrl", async () => {
  await assert.rejects(createMarkets(fakeClient().client, addresses).stats(), NotImplementedError);
  await assert.rejects(createPrices(fakeClient().client, addresses, {} as OracleNamespace).history("NVDA"), NotImplementedError);
});

test("portfolio.funding parses the API's camelCase rows", async () => {
  globalThis.fetch = json([
    { id: 3, txHash: "0xabc", blockNumber: "77", createdAt: "2026-09-19T00:00:00Z", positionId: "5", marketId: NVDA, amount: "-1500000" },
  ]);
  const { createPortfolio } = await import("./portfolio.js");
  const portfolio = createPortfolio({ client: fakeClient().client, addresses, vault: {} as never, oracle: {} as never, apiUrl: "http://api.test" });
  const [payment] = await portfolio.funding(`0x${"01".repeat(20)}`);
  assert.equal(payment!.positionId, 5n);
  assert.equal(payment!.amount, -1_500_000n);
  assert.equal(payment!.txHash, "0xabc");
});

test("prices.candles asks for the interval and limit and restores bigints", async () => {
  let requested = "";
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response(
      JSON.stringify([{ time: 1_700_000_000, open: "190000000000000000000", high: "191000000000000000000", low: "189000000000000000000", close: "190500000000000000000", volume: "5000000000" }]),
    );
  }) as unknown as typeof fetch;
  const prices = createPrices(fakeClient().client, addresses, {} as OracleNamespace, "http://api.test");
  const [candle] = await prices.candles("NVDA", "15m", 60);
  assert.equal(requested, "http://api.test/v1/prices/NVDA/candles?interval=15m&limit=60");
  assert.equal(candle!.high, 191n * 10n ** 18n);
  assert.equal(candle!.volume, 5_000_000_000n);
});

test("funding.history and risk.openInterestHistory parse the API rows", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return new Response(
      JSON.stringify(
        url.includes("funding")
          ? [{ time: 5, rateBps: "-12", cumulativeIndex: "-40", txHash: "0xabc" }]
          : [{ time: 9, long: "5000", short: "2000" }],
      ),
    );
  }) as unknown as typeof fetch;
  const { client } = fakeClient();
  const funding = await createFunding(client, addresses, "http://api.test").history("NVDA", 20);
  const oi = await createRisk(client, addresses, "http://api.test").openInterestHistory("NVDA", "24h");
  assert.deepEqual(requests, ["http://api.test/v1/perps/NVDA/funding/history?limit=20", "http://api.test/v1/perps/NVDA/open-interest?range=24h"]);
  assert.deepEqual(funding, [{ time: 5, rateBps: -12n, cumulativeIndex: -40n, txHash: "0xabc" }]);
  assert.deepEqual(oi, [{ time: 9, long: 5000n, short: 2000n }]);
});

test("analytics methods without apiUrl fail with NotImplementedError", async () => {
  const { client } = fakeClient();
  await assert.rejects(createFunding(client, addresses).history("NVDA"), NotImplementedError);
  await assert.rejects(createRisk(client, addresses).openInterestHistory("NVDA"), NotImplementedError);
  await assert.rejects(createPrices(client, addresses, {} as OracleNamespace).candles("NVDA"), NotImplementedError);
});
