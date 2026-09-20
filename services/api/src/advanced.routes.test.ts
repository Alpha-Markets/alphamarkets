import assert from "node:assert/strict";
import { test } from "node:test";
import { OptionPositionStatus, OptionType, resolveMarketId, type AlphaMarkets } from "@alphamarkets/sdk";
import Fastify from "fastify";
import { registerAdvancedRoutes, parseShocks } from "./routes/advanced.js";

const WAD = 10n ** 18n;
const NVDA = resolveMarketId("NVDA");
const WALLET = `0x${"ab".repeat(20)}`;
const usd = (n: number) => BigInt(n) * 10n ** 6n;

/// A stand-in for the postgres tag: it answers by matching a word in the statement, and records
/// what it was asked so a test can see the bound values.
function fakeSql(answers: Record<string, unknown[]>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    const key = Object.keys(answers).find((word) => text.includes(word));
    return key ? answers[key] : [];
  }) as never;
  return { sql, calls };
}

function fakeAlphaMarkets(over: Record<string, unknown> = {}) {
  return {
    addresses: { settlementToken: `0x${"aa".repeat(20)}` },
    markets: { list: async () => [{ marketId: NVDA, perpsEnabled: true, optionsEnabled: true, active: true }] },
    portfolio: {
      positions: async () => ({
        perps: [
          { positionId: 1n, marketId: NVDA, isLong: true, entryPrice: 190n * WAD, size: usd(5_000), collateral: usd(1_000), open: true },
          { positionId: 2n, marketId: NVDA, isLong: false, entryPrice: 190n * WAD, size: usd(999), collateral: usd(99), open: false },
        ],
        options: [
          { positionId: 7n, marketId: NVDA, optionType: OptionType.CALL, strike: 200n * WAD, contracts: 10n, entryPremium: usd(4_000), status: OptionPositionStatus.OPEN },
          { positionId: 8n, marketId: NVDA, optionType: OptionType.PUT, strike: 100n * WAD, contracts: 1n, entryPremium: usd(1), status: OptionPositionStatus.CLOSED },
        ],
      }),
    },
    vault: { availableBalance: async () => usd(3_000) },
    erc20: { decimals: async () => 6 },
    oracle: { getMarkPrice: async () => ({ price: 190n * WAD, timestamp: 1n }) },
    risk: {
      get: async () => ({ maintenanceMarginRateBps: 500n, openInterestCap: usd(10_000) }),
      openInterest: async () => ({ long: usd(6_000), short: usd(2_000), total: usd(8_000) }),
    },
    options: { contractSize: async () => 100n * WAD },
    ...over,
  } as unknown as AlphaMarkets;
}

function build(sqlAnswers: Record<string, unknown[]> = {}, alphaMarkets = fakeAlphaMarkets()) {
  const app = Fastify();
  const { sql, calls } = fakeSql(sqlAnswers);
  registerAdvancedRoutes(app, alphaMarkets, sql);
  return { app, calls };
}

test("shock lists parse whole basis points and reject anything else", () => {
  assert.equal(parseShocks(undefined), undefined);
  assert.equal(parseShocks(""), undefined);
  assert.deepEqual(parseShocks("-1000, 0,500"), [-1000, 0, 500]);
  for (const bad of ["abc", "1.5", "-10000", "100001", Array.from({ length: 26 }, (_, i) => i).join(",")]) assert.equal(parseShocks(bad), null, bad);
});

test("funding analytics summarises the indexed rates and payments", async () => {
  const { app } = build({
    FundingRateUpdated: [
      { time: "0", rateBps: "2" },
      { time: "3600", rateBps: "4" },
    ],
    FundingPaid: [
      { amount: "-30", isLong: true },
      { amount: "30", isLong: false },
    ],
  });
  const response = await app.inject({ url: "/v1/perps/NVDA/funding/analytics?range=24h" });
  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.range, "24h");
  assert.equal(json.marketId, NVDA);
  assert.equal(json.avgRateBps, 3);
  assert.equal(json.avgIntervalSeconds, 3_600);
  assert.equal(json.paid, "30");
  assert.equal(json.longsNet, "-30");
  assert.equal((await app.inject({ url: "/v1/perps/AAPL/funding/analytics" })).statusCode, 404);
});

test("a report lists the wallet's events with totals, and binds the wallet and dates as values", async () => {
  const { app, calls } = build({
    "from events e": [
      { id: 1, txHash: "0x1", eventName: "CollateralDeposited", createdAt: new Date("2026-09-10T00:00:00Z"), args: { user: WALLET, amount: "1000" } },
      { id: 2, txHash: "0x2", eventName: "ProtocolFeeCollected", createdAt: new Date("2026-09-11T00:00:00Z"), args: { payer: WALLET, amount: "5", feeType: "TAKER" } },
    ],
  });
  const response = await app.inject({ url: `/v1/reports/${WALLET}?from=2026-09-01&to=2026-09-30` });
  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.rows.length, 2);
  assert.equal(json.totals.deposited, "1000");
  assert.equal(json.totals.fees, "5");
  assert.equal(json.truncated, false);
  assert.ok(calls[0]!.values.includes(WALLET.toLowerCase()), "the wallet is a bound value, never text in the statement");
  assert.ok(!calls[0]!.text.includes(WALLET));
});

test("a report can be a CSV file", async () => {
  const { app } = build({
    "from events e": [{ id: 1, txHash: "0x1", eventName: "CollateralDeposited", createdAt: new Date("2026-09-10T00:00:00Z"), args: { user: WALLET, amount: "1000" } }],
  });
  const response = await app.inject({ url: `/v1/reports/${WALLET}?format=csv` });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /text\/csv/);
  assert.match(response.headers["content-disposition"] as string, /attachment; filename="alphamarkets-report-0xabababab\.csv"/);
  assert.ok(response.body.startsWith("time,type,txHash,positionId,marketId,amount,detail\r\n"));
});

test("a report rejects a bad wallet, date or format, and an inverted range", async () => {
  const { app } = build();
  for (const url of [
    "/v1/reports/nope",
    `/v1/reports/${WALLET}?from=nope`,
    `/v1/reports/${WALLET}?to=nope`,
    `/v1/reports/${WALLET}?format=xml`,
    `/v1/reports/${WALLET}?from=2026-09-30&to=2026-09-01`,
  ]) {
    assert.equal((await app.inject({ url })).statusCode, 400, url);
  }
});

test("a report over the row cap says it was cut short", async () => {
  const rows = Array.from({ length: 5_001 }, (_, id) => ({ id, txHash: `0x${id}`, eventName: "CollateralDeposited", createdAt: new Date("2026-09-10T00:00:00Z"), args: { amount: "1" } }));
  const { app } = build({ "from events e": rows });
  const json = (await app.inject({ url: `/v1/reports/${WALLET}` })).json();
  assert.equal(json.truncated, true);
  assert.equal(json.rows.length, 5_000);
});

test("the wallet risk view stresses only open positions and reports distance to liquidation", async () => {
  const { app } = build();
  const response = await app.inject({ url: `/v1/risk/${WALLET}?shocks=-2000,0` });
  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.scenarios.length, 2);
  const [down, flat] = json.scenarios;
  assert.deepEqual(down.liquidated, ["1"], "the 5x long is liquidated by -20%");
  assert.equal(flat.perps.length, 1, "the closed perp is left out");
  assert.equal(flat.optionCost, usd(4_000).toString(), "the closed option is left out");
  assert.equal(json.distances[0].distanceBps, "-1500");
  assert.equal(json.netPerpExposure[NVDA], usd(5_000).toString());
  assert.match(json.note, /intrinsic/);
});

test("the wallet risk view uses the default grid and rejects bad input", async () => {
  const { app } = build();
  assert.equal((await app.inject({ url: `/v1/risk/${WALLET}` })).json().scenarios.length, 9);
  assert.equal((await app.inject({ url: `/v1/risk/${WALLET}?shocks=abc` })).statusCode, 400);
  assert.equal((await app.inject({ url: "/v1/risk/nope" })).statusCode, 400);
});

test("protocol exposure gives long, short, net skew and the share of the cap used", async () => {
  const { app } = build();
  const rows = (await app.inject({ url: "/v1/risk/protocol/exposure" })).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net, usd(4_000).toString());
  assert.equal(rows[0].usedBps, "8000");
});
