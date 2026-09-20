import assert from "node:assert/strict";
import { test } from "node:test";
import websocket from "@fastify/websocket";
import { resolveMarketId, rfqQuoteTypedData, type Orionis } from "@orionis/sdk";
import Fastify from "fastify";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { registerRfqRoutes } from "./routes/rfq.js";
import { RateLimiter, RfqBroker } from "./rfq.js";

const WAD = 10n ** 18n;
const NVDA = resolveMarketId("NVDA");
const USER = `0x${"01".repeat(20)}`;
const RFQ_MANAGER = `0x${"7f".repeat(20)}` as const;
const NOW_MS = 1_800_000_000_000;
const NOW_S = BigInt(NOW_MS / 1000);

const makerA = privateKeyToAccount(generatePrivateKey());
const makerB = privateKeyToAccount(generatePrivateKey());
const KEY_A = "maker-a-key-0123456789";
const KEY_B = "maker-b-key-0123456789";

function fakeOrionis(over: { rfqManager?: string | undefined; mark?: bigint } = {}) {
  return {
    chainId: 46630,
    addresses: { rfqManager: "rfqManager" in over ? over.rfqManager : RFQ_MANAGER, settlementToken: `0x${"aa".repeat(20)}` },
    erc20: { decimals: async () => 6 },
    oracle: { getMarkPrice: async () => ({ price: over.mark ?? 190n * WAD, timestamp: 1n }) },
    rfq: { parameters: async () => ({ maxDeviationBps: 100n, blockMinNotional: 0n, blockMaxNotional: 0n }) },
  } as unknown as Orionis;
}

async function build(over: Parameters<typeof fakeOrionis>[0] = {}, limiter?: RateLimiter) {
  const app = Fastify();
  await app.register(websocket);
  const broker = new RfqBroker({ now: () => NOW_MS });
  registerRfqRoutes(app, fakeOrionis(over), {
    broker,
    makers: new Map([[KEY_A, makerA.address], [KEY_B, makerB.address]]),
    limiter: limiter ?? new RateLimiter(1000, 1000, () => NOW_MS),
    now: () => NOW_MS,
  });
  return { app, broker };
}

async function openRequest(app: Awaited<ReturnType<typeof build>>["app"], side = "LONG") {
  const response = await app.inject({ method: "POST", url: "/v1/rfq/requests", payload: { user: USER, market: "NVDA", side, collateral: "1000", leverage: 5 } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; marketId: string; collateral: string; leverage: string; chainId: number; rfqManager: string };
}

/// What a maker sends: it signs the typed data for the request, at its own price.
async function makerQuote(account: typeof makerA, request: { marketId: string; collateral: string; leverage: string }, price: string, over: { validUntil?: bigint; nonce?: string; isLong?: boolean } = {}) {
  const validUntil = over.validUntil ?? NOW_S + 60n;
  const nonce = over.nonce ?? "1";
  const signature = await account.signTypedData(
    rfqQuoteTypedData({
      chainId: 46630,
      rfqManager: RFQ_MANAGER,
      user: USER as `0x${string}`,
      marketId: request.marketId as `0x${string}`,
      isLong: over.isLong ?? true,
      collateral: BigInt(request.collateral),
      leverage: BigInt(request.leverage),
      price: BigInt(Math.round(Number(price) * 1e6)) * 10n ** 12n,
      validUntil,
      nonce: BigInt(nonce),
    }),
  );
  return { price, validUntil: validUntil.toString(), nonce, signature };
}

const post = (app: Awaited<ReturnType<typeof build>>["app"], url: string, payload: unknown, key?: string) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: key ? { "x-api-key": key } : {} });

test("a user opens a request and reads it back with no quotes yet", async () => {
  const { app } = await build();
  const created = await openRequest(app);
  assert.equal(created.marketId, NVDA);
  assert.equal(created.collateral, "1000000000", "1,000 in a 6-decimal token");
  assert.equal(created.chainId, 46630);
  assert.equal(created.rfqManager, RFQ_MANAGER);

  const read = (await app.inject({ url: `/v1/rfq/requests/${created.id}` })).json();
  assert.deepEqual(read.quotes, []);
  assert.equal(read.best, null);
  assert.equal((await app.inject({ url: "/v1/rfq/requests/nope" })).statusCode, 404);
});

test("bad requests are refused with the field named", async () => {
  const { app } = await build();
  const ok = { user: USER, market: "NVDA", side: "LONG", collateral: "1000", leverage: 5 };
  for (const [patch, pattern] of [
    [{ user: "0x12" }, /user/],
    [{ market: "" }, /market/],
    [{ side: "UP" }, /side/],
    [{ collateral: "abc" }, /collateral/],
    [{ collateral: "0" }, /collateral/],
    [{ leverage: 0 }, /leverage/],
    [{ leverage: 1.5 }, /leverage/],
    [{ ttlSeconds: -1 }, /ttlSeconds/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    const response = await post(app, "/v1/rfq/requests", { ...ok, ...patch });
    assert.equal(response.statusCode, 400, JSON.stringify(patch));
    assert.match(response.json().error, pattern);
  }
});

test("without an RFQManager a request is a 501", async () => {
  const { app } = await build({ rfqManager: undefined });
  assert.equal((await post(app, "/v1/rfq/requests", { user: USER, market: "NVDA", side: "LONG", collateral: "1", leverage: 1 })).statusCode, 501);
});

test("market maker routes need a known API key", async () => {
  const { app } = await build();
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers: { "x-api-key": "wrong-key-0123456789" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers: { "x-api-key": KEY_A } })).statusCode, 200);
});

test("a maker sees the open requests and answers one; the user gets the best quote", async () => {
  const { app } = await build();
  const created = await openRequest(app);

  const open = (await app.inject({ url: "/v1/mm/rfq/open", headers: { "x-api-key": KEY_A } })).json();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, created.id);

  const a = await makerQuote(makerA, created, "190.50");
  const b = await makerQuote(makerB, created, "190.25", { nonce: "2" });
  assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, a, KEY_A)).statusCode, 200);
  assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, b, KEY_B)).statusCode, 200);

  const read = (await app.inject({ url: `/v1/rfq/requests/${created.id}` })).json();
  assert.equal(read.quotes.length, 2);
  assert.equal(read.best.maker, makerB.address, "a long is offered the lowest price");
  assert.equal(read.best.price, (190_250_000n * 10n ** 12n).toString());
});

test("a quote is refused when it is not signed by the key's own maker", async () => {
  const { app } = await build();
  const created = await openRequest(app);
  // Maker B signs, but sends with maker A's key.
  const stolen = await makerQuote(makerB, created, "190.25");
  const response = await post(app, `/v1/mm/rfq/${created.id}/quote`, stolen, KEY_A);
  assert.equal(response.statusCode, 401);
  // And a signature over a different price does not verify.
  const good = await makerQuote(makerA, created, "190.25");
  assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, { ...good, price: "185" }, KEY_A)).statusCode, 401);
});

test("a quote's terms are checked: life, price band, shape", async () => {
  const { app } = await build();
  const created = await openRequest(app);
  const tooShort = await makerQuote(makerA, created, "190", { validUntil: NOW_S + 2n });
  assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, tooShort, KEY_A)).statusCode, 422);
  const tooLong = await makerQuote(makerA, created, "190", { validUntil: NOW_S + 3_600n });
  assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, tooLong, KEY_A)).statusCode, 422);
  const offBand = await makerQuote(makerA, created, "200");
  const banded = await post(app, `/v1/mm/rfq/${created.id}/quote`, offBand, KEY_A);
  assert.equal(banded.statusCode, 422);
  assert.match(banded.json().error, /band/);

  const good = await makerQuote(makerA, created, "190");
  for (const patch of [{ price: "abc" }, { nonce: "x" }, { validUntil: "soon" }, { signature: "nope" }]) {
    assert.equal((await post(app, `/v1/mm/rfq/${created.id}/quote`, { ...good, ...patch }, KEY_A)).statusCode, 400, JSON.stringify(patch));
  }
  assert.equal((await post(app, "/v1/mm/rfq/unknown/quote", good, KEY_A)).statusCode, 404);
});

test("a short is offered the highest price", async () => {
  const { app } = await build();
  const created = await openRequest(app, "SHORT");
  await post(app, `/v1/mm/rfq/${created.id}/quote`, await makerQuote(makerA, created, "189.75", { isLong: false }), KEY_A);
  await post(app, `/v1/mm/rfq/${created.id}/quote`, await makerQuote(makerB, created, "190.00", { isLong: false, nonce: "2" }), KEY_B);
  const read = (await app.inject({ url: `/v1/rfq/requests/${created.id}` })).json();
  assert.equal(read.best.maker, makerB.address);
});

test("makers are rate limited per key", async () => {
  const { app } = await build({}, new RateLimiter(1, 2, () => NOW_MS));
  const headers = { "x-api-key": KEY_A };
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers })).statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers })).statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers })).statusCode, 429);
  assert.equal((await app.inject({ url: "/v1/mm/rfq/open", headers: { "x-api-key": KEY_B } })).statusCode, 200, "another maker is unaffected");
});

test("a maker connected by WebSocket hears each new request and can answer over it", async () => {
  const { app } = await build();
  await app.ready();
  const socket = await app.injectWS("/v1/mm/ws", { headers: { "x-api-key": KEY_A } });
  const received: Array<Record<string, any>> = [];
  socket.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));

  const created = await openRequest(app);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received[0]!.type, "rfq");
  assert.equal(received[0]!.request.id, created.id);

  socket.send(JSON.stringify({ type: "quote", requestId: created.id, ...(await makerQuote(makerA, created, "190.10")) }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(received.at(-1), { type: "quote_result", requestId: created.id, accepted: true });
  assert.equal((await app.inject({ url: `/v1/rfq/requests/${created.id}` })).json().best.maker, makerA.address);

  socket.send("not json");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.at(-1)!.type, "error");
  socket.terminate();
  await app.close();
});

test("a WebSocket without a valid key is told so and closed", async () => {
  const { app } = await build();
  await app.ready();
  const messages: string[] = [];
  // The server speaks and hangs up as soon as the socket opens, so listen before it does.
  await app.injectWS("/v1/mm/ws", {}, { onInit: (ws) => ws.on("message", (data: Buffer) => messages.push(data.toString())) });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(messages[0]!, /x-api-key/);
  await app.close();
});
