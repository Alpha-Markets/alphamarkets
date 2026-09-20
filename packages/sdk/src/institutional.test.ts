import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NotImplementedError, AlphaMarketsError } from "./errors.js";
import { createInstitutional } from "./institutional.js";
import { USER } from "./testing.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(body: unknown, status = 200, urls: string[] = []) {
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return typeof body === "string" ? new Response(body, { status }) : new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return urls;
}

test("funding analytics restores the amounts as bigint and asks for the range", async () => {
  const urls = respond({ marketId: "0xm", range: "24h", intervals: 2, avgRateBps: 3, received: "30", paid: "12", longsNet: "-12", shortsNet: "30" });
  const result = await createInstitutional("http://api.test").fundingAnalytics("NVDA", "24h");
  assert.equal(urls[0], "http://api.test/v1/perps/NVDA/funding/analytics?range=24h");
  assert.equal(result.received, 30n);
  assert.equal(result.longsNet, -12n);
  assert.equal(result.avgRateBps, 3);
});

test("a report restores bigint amounts and passes the dates as unix seconds", async () => {
  const urls = respond({
    wallet: USER,
    from: "a",
    to: "b",
    truncated: false,
    rows: [{ time: "t", type: "fee", txHash: "0x1", positionId: "", marketId: "", amount: "-5", detail: "" }],
    totals: { deposited: "1000", withdrawn: "0", fees: "5", funding: "-2", perpRealizedPnl: "12", liquidationLoss: "0", optionPremiumPaid: "0", optionRealizedPnl: "0", optionSettlementPayouts: "0", counts: { fee: 1 } },
  });
  const report = await createInstitutional("http://api.test").report(USER, { from: 1_800_000_000n, to: new Date("2027-01-01T00:00:00Z") });
  assert.equal(urls[0], `http://api.test/v1/reports/${USER}?from=1800000000&to=1798761600`);
  assert.equal(report.rows[0]!.amount, -5n);
  assert.equal(report.totals.deposited, 1000n);
  assert.equal(report.totals.funding, -2n);
  assert.deepEqual(report.totals.counts, { fee: 1 });
});

test("the CSV is returned as text, and fails clearly on a bad status", async () => {
  const urls = respond("time,type\r\n");
  assert.equal(await createInstitutional("http://api.test").reportCsv(USER), "time,type\r\n");
  assert.equal(urls[0], `http://api.test/v1/reports/${USER}?format=csv`);
  respond("no", 500);
  await assert.rejects(createInstitutional("http://api.test").reportCsv(USER), /returned 500/);
});

test("risk restores every amount, passes shocks, and rejects fractional ones before any call", async () => {
  const urls = respond({
    wallet: USER,
    settlementDecimals: 6,
    availableBalance: "3000",
    marks: { "0xm": "190" },
    netPerpExposure: { "0xm": "-5" },
    distances: [{ positionId: "1", marketId: "0xm", markPrice: "190", liquidationPrice: "161", distanceBps: null }],
    scenarios: [{ shockBps: -2000, perpPnl: "-1000", liquidated: ["1"], optionValue: "0", optionCost: "4", optionPnl: "-4", equity: "3000", perps: [{ positionId: "1", marketId: "0xm", markPrice: "152", pnl: "-1000", marginRatioBps: "0", liquidated: true }] }],
    note: "n",
  });
  const risk = await createInstitutional("http://api.test").risk(USER, [-2000, 0]);
  assert.equal(urls[0], `http://api.test/v1/risk/${USER}?shocks=-2000,0`);
  assert.equal(risk.marks["0xm"], 190n);
  assert.equal(risk.netPerpExposure["0xm"], -5n);
  assert.equal(risk.distances[0]!.distanceBps, null);
  assert.deepEqual(risk.scenarios[0]!.liquidated, [1n]);
  assert.equal(risk.scenarios[0]!.perps[0]!.liquidated, true);
  await assert.rejects(createInstitutional("http://api.test").risk(USER, [1.5]), AlphaMarketsError);
  assert.equal(urls.length, 1, "no call for the bad shock");
});

test("protocol exposure restores bigint and keeps a missing cap as null", async () => {
  respond([{ marketId: "0xm", active: true, long: "6", short: "2", total: "8", net: "4", cap: "0", usedBps: null }]);
  const [row] = await createInstitutional("http://api.test").protocolExposure();
  assert.equal(row!.net, 4n);
  assert.equal(row!.usedBps, null);
});

test("without apiUrl every method says so", async () => {
  const bare = createInstitutional(undefined);
  await assert.rejects(bare.fundingAnalytics("NVDA"), NotImplementedError);
  await assert.rejects(bare.report(USER), NotImplementedError);
  await assert.rejects(bare.reportCsv(USER), NotImplementedError);
  await assert.rejects(bare.risk(USER), NotImplementedError);
  await assert.rejects(bare.protocolExposure(), NotImplementedError);
});
