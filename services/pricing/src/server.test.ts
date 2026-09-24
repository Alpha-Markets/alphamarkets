import assert from "node:assert/strict";
import { test } from "node:test";
import { closeQuoteTypedData, openQuoteTypedData, OptionPositionStatus, OptionType, resolveMarketId, type AlphaMarkets } from "@alphamarkets/sdk";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildServer } from "./server.js";

const WAD = 10n ** 18n;
const ENGINE = `0x${"e1".repeat(20)}` as const;
const USER = `0x${"01".repeat(20)}` as const;
const OTHER = `0x${"02".repeat(20)}` as const;
const NOW_MS = Date.parse("2026-09-01T00:00:00Z");
const quoter = privateKeyToAccount(generatePrivateKey());

function fakeAlphaMarkets(position?: Record<string, unknown>) {
  return {
    addresses: { optionsEngine: ENGINE, settlementToken: `0x${"aa".repeat(20)}` },
    oracle: { getIndexPrice: async () => ({ price: 190n * WAD, timestamp: 1n }) },
    options: { contractSize: async () => 100n * WAD },
    erc20: { decimals: async () => 6 },
    portfolio: { getOptionPosition: async () => position },
  } as unknown as AlphaMarkets;
}

const body = { underlying: "NVDA", strike: "190", expiry: "2026-09-25", type: "CALL", contracts: 10, user: USER };

test("signs an open quote the contract's typed data recovers to the quoter", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), account: quoter, now: () => NOW_MS });
  const response = await app.inject({ method: "POST", url: "/quote", payload: body });
  const json = response.json();

  assert.equal(response.statusCode, 200);
  assert.ok(json.authorization, "authorization present");
  const { premium, validUntil, nonce, signature } = json.authorization;
  assert.equal(BigInt(validUntil), BigInt(NOW_MS / 1000) + 30n);

  // Rebuild exactly what the contract will hash, from the response, and recover the signer.
  const recovered = await recoverTypedDataAddress({
    ...openQuoteTypedData({
      chainId: 46630,
      optionsEngine: ENGINE,
      user: USER,
      marketId: resolveMarketId("NVDA"),
      optionType: OptionType.CALL,
      strike: 190n * WAD,
      expiry: BigInt(Date.parse("2026-09-25") / 1000),
      contracts: 10n,
      premium: BigInt(premium),
      validUntil: BigInt(validUntil),
      nonce: BigInt(nonce),
    }),
    signature,
  });
  assert.equal(recovered, quoter.address);
  assert.ok(BigInt(premium) > 0n);
});

test("the signed premium is per contract size and count in token units", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), account: quoter, now: () => NOW_MS });
  const json = (await app.inject({ method: "POST", url: "/quote", payload: body })).json();
  // per-unit premium (float) * 100 shares * 10 contracts, scaled to 6 decimals
  const expected = Math.round(json.premium * 100 * 10 * 1e6);
  assert.ok(Math.abs(Number(json.authorization.premium) - expected) <= 1_000, `${json.authorization.premium} vs ${expected}`);
});

test("no user, or no signing key, means analytics only", async () => {
  const noUser = buildServer({ alphaMarkets: fakeAlphaMarkets(), account: quoter, now: () => NOW_MS });
  const { user: _user, ...withoutUser } = body;
  assert.equal((await noUser.inject({ method: "POST", url: "/quote", payload: withoutUser })).json().authorization, undefined);

  const noKey = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS });
  const keyless = (await noKey.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.equal(keyless.authorization, undefined);
  assert.ok(keyless.premium > 0);
});

test("rejects a malformed user address", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), account: quoter, now: () => NOW_MS });
  const response = await app.inject({ method: "POST", url: "/quote", payload: { ...body, user: "0x123" } });
  assert.equal(response.statusCode, 400);
});

const openPosition = {
  owner: USER,
  status: OptionPositionStatus.OPEN,
  marketId: resolveMarketId("NVDA"),
  optionType: OptionType.CALL,
  strike: 190n * WAD,
  expiry: BigInt(Date.parse("2026-09-25") / 1000),
  contracts: 10n,
};

test("signs a close quote for the position's owner", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(openPosition), account: quoter, now: () => NOW_MS });
  const response = await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } });
  assert.equal(response.statusCode, 200);

  const { premium, validUntil, nonce, signature } = response.json().authorization;
  const recovered = await recoverTypedDataAddress({
    ...closeQuoteTypedData({
      chainId: 46630,
      optionsEngine: ENGINE,
      user: USER,
      positionId: 5n,
      premium: BigInt(premium),
      validUntil: BigInt(validUntil),
      nonce: BigInt(nonce),
    }),
    signature,
  });
  assert.equal(recovered, quoter.address);
});

test("retries a position the RPC node does not show yet, then quotes it", async () => {
  const empty = { ...openPosition, owner: "0x0000000000000000000000000000000000000000" as const };
  let reads = 0;
  const base = fakeAlphaMarkets(openPosition);
  const alphaMarkets = {
    ...base,
    portfolio: { getOptionPosition: async () => (++reads < 3 ? empty : openPosition) },
  } as unknown as typeof base;
  const app = buildServer({ alphaMarkets, account: quoter, now: () => NOW_MS, positionRetryDelayMs: 0 });
  const response = await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } });
  assert.equal(response.statusCode, 200);
  assert.equal(reads, 3);
});

test("says a position is not found yet, not that it belongs to someone else, when it never shows", async () => {
  const empty = { ...openPosition, owner: "0x0000000000000000000000000000000000000000" as const };
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(empty), account: quoter, now: () => NOW_MS, positionRetryDelayMs: 0 });
  const response = await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } });
  assert.equal(response.statusCode, 404);
  assert.match(response.json().error, /not found yet/);
});

test("refuses to quote a close for someone else's, closed, or expired position", async () => {
  const other = buildServer({ alphaMarkets: fakeAlphaMarkets(openPosition), account: quoter, now: () => NOW_MS });
  assert.equal((await other.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: OTHER } })).statusCode, 403);

  const closed = buildServer({
    alphaMarkets: fakeAlphaMarkets({ ...openPosition, status: OptionPositionStatus.CLOSED }),
    account: quoter,
    now: () => NOW_MS,
  });
  assert.equal((await closed.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } })).statusCode, 409);

  const expired = buildServer({
    alphaMarkets: fakeAlphaMarkets(openPosition),
    account: quoter,
    now: () => Date.parse("2026-10-01T00:00:00Z"),
  });
  assert.equal((await expired.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } })).statusCode, 409);
});

test("close quotes need a signing key", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(openPosition), now: () => NOW_MS });
  const response = await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } });
  assert.equal(response.statusCode, 503);
});

// ---- bid/ask spread and volatility source -----------------------------------

/// 60 samples, 30 minutes apart, moving about 0.3% each step.
const history = async () =>
  Array.from({ length: 60 }, (_, i) => ({ time: i * 1800, price: 190 * Math.exp(i % 2 === 0 ? 0 : 0.003) }));
const noHistory = async () => [];

test("opening pays the ask and closing receives the bid, both signed for the whole order", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(openPosition), account: quoter, now: () => NOW_MS, spreadBps: 400, priceHistory: noHistory });

  const open = (await app.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.ok(open.ask > open.premium && open.bid < open.premium);
  assert.ok(Math.abs(open.ask - open.premium * 1.02) < 1e-9);
  // per-unit ask * 100 units per contract * 10 contracts, at 6 decimals
  assert.ok(Math.abs(Number(open.authorization.premium) - Math.round(open.ask * 100 * 10 * 1e6)) <= 1_000);
  // Break-even follows the price actually paid.
  assert.ok(Math.abs(open.breakEven - (190 + open.ask)) < 1e-9);

  const close = (await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } })).json();
  assert.ok(Math.abs(Number(close.authorization.premium) - Math.round(close.bid * 100 * 10 * 1e6)) <= 1_000);
  assert.ok(BigInt(close.authorization.premium) < BigInt(open.authorization.premium));
});

test("without a spread bid, ask and mark are the same price", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, spreadBps: 0, priceHistory: noHistory });
  const json = (await app.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.equal(json.bid, json.premium);
  assert.equal(json.ask, json.premium);
});

test("volatility is realized from price history when there is enough, and the source says which", async () => {
  const realized = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, priceHistory: history });
  const a = (await realized.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.equal(a.ivSource, "realized");
  assert.notEqual(a.iv, 0.5);

  const assumed = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, priceHistory: noHistory });
  const b = (await assumed.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.equal(b.ivSource, "default");
  assert.equal(b.iv, 0.5);
});

test("a history lookup that fails prices with the default instead of failing the quote", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, priceHistory: async () => [] });
  assert.equal((await app.inject({ method: "POST", url: "/quote", payload: body })).statusCode, 200);
});

test("history is cached between quotes", async () => {
  let calls = 0;
  const app = buildServer({
    alphaMarkets: fakeAlphaMarkets(),
    now: () => NOW_MS,
    priceHistory: async () => {
      calls++;
      return history();
    },
  });
  for (let i = 0; i < 3; i++) await app.inject({ method: "POST", url: "/quote", payload: body });
  assert.equal(calls, 1);
});

test("the quote carries the higher-order Greeks for display", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS });
  const json = (await app.inject({ method: "POST", url: "/quote", payload: { ...body, user: undefined } })).json();
  for (const key of ["rho", "vanna", "vomma", "charm", "speed", "color"]) {
    assert.equal(typeof json[key], "number", key);
  }
});

test("a skewed surface prices a low strike with more volatility than the ATM, and the quote follows it", async () => {
  const shape = { skewSlope: -0.5, smileCurve: 0, termSlope: 0 };
  const skewed = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, surfaceShape: shape });
  const flat = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS });
  const put = { ...body, user: undefined, type: "PUT", strike: "170" };
  const skewedPut = (await skewed.inject({ method: "POST", url: "/quote", payload: put })).json();
  const flatPut = (await flat.inject({ method: "POST", url: "/quote", payload: put })).json();
  assert.ok(skewedPut.premium > flatPut.premium, "the 170 put costs more when low strikes carry more volatility");
  assert.ok(skewedPut.vega > 0);
});

test("the surface endpoint returns a grid, a default one when no strikes or expiries are given", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS, surfaceShape: { skewSlope: -0.3, smileCurve: 0, termSlope: 0 } });
  const response = await app.inject({ url: "/surface?underlying=NVDA" });
  const surface = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(surface.spot, 190);
  assert.equal(surface.expiries.length, 5);
  assert.equal(surface.strikes.length, 9);
  assert.equal(surface.ivSource, "default");
  const week = surface.expiries[0];
  assert.ok(week.skew > 0);
  assert.ok(week.points[0].iv > week.points[8].iv);
});

test("the surface endpoint takes explicit strikes and expiries and rejects bad input", async () => {
  const app = buildServer({ alphaMarkets: fakeAlphaMarkets(), now: () => NOW_MS });
  const expiry = Math.floor(NOW_MS / 1000) + 10 * 86_400;
  const ok = (await app.inject({ url: `/surface?underlying=NVDA&strikes=180,200&expiries=${expiry}` })).json();
  assert.deepEqual(ok.strikes, [180, 200]);
  assert.equal(ok.expiries.length, 1);

  assert.equal((await app.inject({ url: "/surface" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/surface?underlying=NVDA&strikes=abc" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/surface?underlying=NVDA&expiries=-5" })).statusCode, 400);
  const many = Array.from({ length: 30 }, (_, i) => 100 + i).join(",");
  assert.equal((await app.inject({ url: `/surface?underlying=NVDA&strikes=${many}` })).statusCode, 400);
});
