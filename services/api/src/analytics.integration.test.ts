/// Runs the analytics SQL against a real PostgreSQL that already has the indexer's schema
/// (`pnpm --filter @orionis/indexer db:migrate`). Skipped unless TEST_DATABASE_URL is set, so the
/// suite passes on a machine without a database. The tables are emptied first: point it at a
/// scratch database, never a real one.
///
///   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/orionis_test pnpm --filter @orionis/api test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { resolveMarketId } from "@orionis/sdk";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
const WAD = 10n ** 18n;
const NVDA = resolveMarketId("NVDA");
const ALICE = `0x${"01".repeat(20)}`;
const BOB = `0x${"02".repeat(20)}`;
const IN_A_WEEK = String(Math.floor(Date.now() / 1000) + 7 * 86_400);
const STRIKE = (190n * WAD).toString();

describe("analytics routes against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  let app: Awaited<ReturnType<(typeof import("./server.js"))["buildServer"]>>;
  const sql = postgres(url ?? "postgres://unused");
  let txCounter = 0;

  /// One event row `minutesAgo` minutes in the past.
  async function event(name: string, minutesAgo: number, args: Record<string, unknown>) {
    await sql`
      insert into events (tx_hash, log_index, block_number, contract_name, event_name, args, created_at)
      values (${`0x${(++txCounter).toString(16).padStart(64, "0")}`}, 0, ${txCounter}, 'test', ${name}, ${sql.json(args as never)},
        now() - make_interval(mins => ${minutesAgo}))
    `;
  }

  before(async () => {
    if (!url) return;
    process.env.DATABASE_URL = url;
    process.env.RPC_URL = "http://127.0.0.1:1"; // never called: these routes only read the database
    await sql`truncate events, price_ticks restart identity`;

    // 40 index-price samples over the last two hours, every three minutes.
    for (let i = 0; i < 40; i++) {
      const price = (BigInt(190 + (i % 5)) * WAD).toString();
      await sql`insert into price_ticks (market_id, price, sampled_at) values (${NVDA}, ${price}, now() - make_interval(mins => ${120 - i * 3}))`;
    }

    // Position 1: long 5,000, grown to 7,000, closed. Position 2: short 2,000, still open.
    await event("PerpPositionOpened", 90, { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: (5_000n * WAD).toString() });
    await event("PerpPositionUpdated", 60, { positionId: "1", newSize: (7_000n * WAD).toString(), newCollateral: "1", realizedPnlDelta: "0" });
    await event("PerpPositionOpened", 50, { positionId: "2", owner: BOB, marketId: NVDA, isLong: false, size: (2_000n * WAD).toString() });
    await event("PerpPositionClosed", 20, { positionId: "1", realizedPnl: "0" });

    await event("FundingRateUpdated", 100, { marketId: NVDA, rateBps: "5", cumulativeIndex: "5" });
    await event("FundingRateUpdated", 40, { marketId: NVDA, rateBps: "-3", cumulativeIndex: "2" });

    // A call series with two positions; the first (10 contracts) was closed, the second (4) is open.
    const series = { marketId: NVDA, optionType: 0, strike: STRIKE, expiry: IN_A_WEEK, premium: "1" };
    await event("OptionPositionOpened", 200, { ...series, positionId: "10", owner: ALICE, contracts: "10" });
    await event("OptionPositionOpened", 30, { ...series, positionId: "11", owner: BOB, contracts: "4" });
    await event("OptionPositionClosed", 10, { positionId: "10", owner: ALICE, realizedPnl: "0" });

    // Orders: 1 open, 2 cancelled, 3 executed, 4 open but expired.
    const order = { owner: ALICE, marketId: NVDA, isLong: true, collateral: "1000", leverage: "5", triggerPrice: (180n * WAD).toString() };
    await event("LimitOrderPlaced", 30, { ...order, orderId: "1", expiry: IN_A_WEEK });
    await event("LimitOrderPlaced", 29, { ...order, orderId: "2", expiry: IN_A_WEEK });
    await event("LimitOrderPlaced", 28, { ...order, orderId: "3", expiry: IN_A_WEEK });
    await event("LimitOrderPlaced", 27, { ...order, orderId: "4", expiry: "1000" });
    await event("LimitOrderCancelled", 25, { orderId: "2", owner: ALICE });
    await event("LimitOrderExecuted", 24, { orderId: "3", owner: ALICE, positionId: "7", executionPrice: "1" });

    const { buildServer } = await import("./server.js");
    app = buildServer();
  });

  after(async () => {
    await app?.close();
    await sql.end();
    const { getSql } = await import("./db.js");
    await getSql().end();
  });

  test("candles group the price samples and carry the perp volume of their bucket", async () => {
    const response = await app.inject({ url: "/v1/prices/NVDA/candles?interval=15m&limit=20" });
    assert.equal(response.statusCode, 200);
    const candles = response.json() as Array<{ time: number; open: string; high: string; low: string; close: string; volume: string }>;

    assert.ok(candles.length >= 8 && candles.length <= 10, `one candle per 15 minutes of 2 hours: ${candles.length}`);
    for (const candle of candles) {
      assert.ok(BigInt(candle.low) <= BigInt(candle.open) && BigInt(candle.open) <= BigInt(candle.high));
      assert.ok(BigInt(candle.low) <= BigInt(candle.close) && BigInt(candle.close) <= BigInt(candle.high));
    }
    assert.deepEqual(candles.map((c) => c.time), [...candles.map((c) => c.time)].sort((a, b) => a - b), "oldest first");

    // 5,000 open + 2,000 grow + 2,000 short open + 7,000 close.
    const total = candles.reduce((sum, candle) => sum + BigInt(candle.volume), 0n);
    assert.equal(total, 16_000n * WAD);
  });

  test("open interest rebuilds long and short totals from the position events", async () => {
    const points = (await app.inject({ url: "/v1/perps/NVDA/open-interest?range=24h" })).json() as Array<{ time: number; long: string; short: string }>;
    const last = points.at(-1)!;
    assert.equal(last.long, "0", "the long was closed");
    assert.equal(last.short, (2_000n * WAD).toString());
    const peak = points.reduce((max, p) => (BigInt(p.long) > max ? BigInt(p.long) : max), 0n);
    assert.equal(peak, 7_000n * WAD, "the long peaked after it was grown");
    assert.ok(points.length > 90, "24h in 15 minute buckets");
  });

  test("funding history lists the applied rates oldest first", async () => {
    const rows = (await app.inject({ url: "/v1/perps/NVDA/funding/history?limit=10" })).json() as Array<{ rateBps: string; cumulativeIndex: string }>;
    assert.deepEqual(rows.map((row) => row.rateBps), ["5", "-3"]);
    assert.deepEqual(rows.map((row) => row.cumulativeIndex), ["5", "2"]);
    const latest = (await app.inject({ url: "/v1/perps/NVDA/funding/history?limit=1" })).json() as Array<{ rateBps: string }>;
    assert.deepEqual(latest.map((row) => row.rateBps), ["-3"], "a limit keeps the newest");
  });

  test("option stats give open interest and 24h volume per series", async () => {
    const rows = (await app.inject({ url: "/v1/options/NVDA/stats" })).json() as Array<{ expiry: string; strike: string; optionType: number; openInterest: string; volume24h: string }>;
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row!.strike, STRIKE);
    assert.equal(row!.optionType, 0);
    assert.equal(Number(row!.openInterest), 4, "10 opened and closed, 4 opened and still open");
    // Position 10 was opened 200 minutes ago (outside 24h? no: inside) and closed 10 minutes ago.
    assert.equal(Number(row!.volume24h), 10 + 4 + 10);

    const filtered = (await app.inject({ url: `/v1/options/NVDA/stats?expiry=${IN_A_WEEK}` })).json() as unknown[];
    assert.equal(filtered.length, 1);
    assert.deepEqual((await app.inject({ url: "/v1/options/NVDA/stats?expiry=1" })).json(), []);
    assert.deepEqual((await app.inject({ url: "/v1/options/NVDA/stats?expiry=x;drop" })).json(), []);
  });

  test("open orders are the placed ones that were not cancelled, filled or expired", async () => {
    const orders = (await app.inject({ url: `/v1/orders/${ALICE}` })).json() as Array<{ id: string; status: string; isLong: boolean; triggerPrice: string }>;
    assert.deepEqual(orders.map((o) => o.id), ["1"]);
    assert.equal(orders[0]!.status, "OPEN");
    assert.equal(orders[0]!.triggerPrice, (180n * WAD).toString());
    assert.deepEqual((await app.inject({ url: `/v1/orders/${BOB}` })).json(), []);
  });
});
