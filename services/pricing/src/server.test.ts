import assert from "node:assert/strict";
import { test } from "node:test";
import { closeQuoteTypedData, openQuoteTypedData, OptionPositionStatus, OptionType, resolveMarketId, type Orionis } from "@orionis/sdk";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildServer } from "./server.js";

const WAD = 10n ** 18n;
const ENGINE = `0x${"e1".repeat(20)}` as const;
const USER = `0x${"01".repeat(20)}` as const;
const OTHER = `0x${"02".repeat(20)}` as const;
const NOW_MS = Date.parse("2026-09-01T00:00:00Z");
const quoter = privateKeyToAccount(generatePrivateKey());

function fakeOrionis(position?: Record<string, unknown>) {
  return {
    addresses: { optionsEngine: ENGINE, settlementToken: `0x${"aa".repeat(20)}` },
    oracle: { getIndexPrice: async () => ({ price: 190n * WAD, timestamp: 1n }) },
    options: { contractSize: async () => 100n * WAD },
    erc20: { decimals: async () => 6 },
    portfolio: { getOptionPosition: async () => position },
  } as unknown as Orionis;
}

const body = { underlying: "NVDA", strike: "190", expiry: "2026-09-25", type: "CALL", contracts: 10, user: USER };

test("signs an open quote the contract's typed data recovers to the quoter", async () => {
  const app = buildServer({ orionis: fakeOrionis(), account: quoter, now: () => NOW_MS });
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
  const app = buildServer({ orionis: fakeOrionis(), account: quoter, now: () => NOW_MS });
  const json = (await app.inject({ method: "POST", url: "/quote", payload: body })).json();
  // per-unit premium (float) * 100 shares * 10 contracts, scaled to 6 decimals
  const expected = Math.round(json.premium * 100 * 10 * 1e6);
  assert.ok(Math.abs(Number(json.authorization.premium) - expected) <= 1_000, `${json.authorization.premium} vs ${expected}`);
});

test("no user, or no signing key, means analytics only", async () => {
  const noUser = buildServer({ orionis: fakeOrionis(), account: quoter, now: () => NOW_MS });
  const { user: _user, ...withoutUser } = body;
  assert.equal((await noUser.inject({ method: "POST", url: "/quote", payload: withoutUser })).json().authorization, undefined);

  const noKey = buildServer({ orionis: fakeOrionis(), now: () => NOW_MS });
  const keyless = (await noKey.inject({ method: "POST", url: "/quote", payload: body })).json();
  assert.equal(keyless.authorization, undefined);
  assert.ok(keyless.premium > 0);
});

test("rejects a malformed user address", async () => {
  const app = buildServer({ orionis: fakeOrionis(), account: quoter, now: () => NOW_MS });
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
  const app = buildServer({ orionis: fakeOrionis(openPosition), account: quoter, now: () => NOW_MS });
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

test("refuses to quote a close for someone else's, closed, or expired position", async () => {
  const other = buildServer({ orionis: fakeOrionis(openPosition), account: quoter, now: () => NOW_MS });
  assert.equal((await other.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: OTHER } })).statusCode, 403);

  const closed = buildServer({
    orionis: fakeOrionis({ ...openPosition, status: OptionPositionStatus.CLOSED }),
    account: quoter,
    now: () => NOW_MS,
  });
  assert.equal((await closed.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } })).statusCode, 409);

  const expired = buildServer({
    orionis: fakeOrionis(openPosition),
    account: quoter,
    now: () => Date.parse("2026-10-01T00:00:00Z"),
  });
  assert.equal((await expired.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } })).statusCode, 409);
});

test("close quotes need a signing key", async () => {
  const app = buildServer({ orionis: fakeOrionis(openPosition), now: () => NOW_MS });
  const response = await app.inject({ method: "POST", url: "/quote/close", payload: { positionId: "5", user: USER } });
  assert.equal(response.statusCode, 503);
});
