import assert from "node:assert/strict";
import { test } from "node:test";
import { AlphaMarketsError } from "./errors.js";
import type { OptionsNamespace } from "./options.js";
import { createStructured, STRUCTURED_KINDS } from "./structured.js";
import type { PreparedTx, TradingNamespace } from "./trading.js";
import { USER, WAD } from "./testing.js";

const SIG = `0x${"11".repeat(65)}` as const;

/// Premiums by "TYPE-strike", so each test can read the numbers it expects off the table.
const premiums: Record<string, number> = { "PUT-90": 2, "CALL-100": 8, "PUT-100": 7, "CALL-110": 3, "PUT-95": 4 };

function setup(over: { signed?: boolean; contractSize?: bigint } = {}) {
  const quoted: Array<Record<string, unknown>> = [];
  const built: string[] = [];
  const tx = (description: string): PreparedTx => ({ to: `0x${"0f".repeat(20)}`, data: "0x", value: 0n, chainId: 1, description });

  const options = {
    contractSize: async () => over.contractSize ?? 1n * WAD,
    quote: async (params: Record<string, unknown>) => {
      quoted.push(params);
      const price = premiums[`${params.type}-${params.strike}`]!;
      return {
        premium: price, bid: price, ask: price, iv: 0.5, delta: params.type === "CALL" ? 0.5 : -0.5, gamma: 0.01, theta: -3.65, vega: 20, breakEven: 0, spot: 100,
        ...(over.signed === false ? {} : { authorization: { premium: BigInt(price * 1e6), validUntil: 1_000n + BigInt(price), nonce: 1n, signature: SIG } }),
      };
    },
  } as unknown as OptionsNamespace;

  const trading = {
    prepareOpenPerp: async (params: Record<string, unknown>) => (built.push(`perp:${params.collateral}`), tx("perp")),
    prepareOpenOption: (params: Record<string, unknown>) => (built.push(`option:${params.type}:${params.strike}`), tx("option")),
  } as unknown as TradingNamespace;

  const oracle = { getIndexPrice: async () => ({ price: 100n * WAD, timestamp: 1n }) } as never;
  return { structured: createStructured({ options, trading, oracle, decimals: async () => 6 }), quoted, built };
}

const base = { market: "NVDA", expiry: 1_900_000_000n, contracts: 10n, trader: USER };

test("the products are the ones whose legs the contracts can open", () => {
  assert.deepEqual(setup().structured.kinds(), STRUCTURED_KINDS);
  assert.deepEqual(STRUCTURED_KINDS, ["PROTECTED_LONG", "BREAKOUT_STRADDLE", "BREAKOUT_STRANGLE"]);
});

test("a protected long is a 1x perpetual plus a put, with the loss floored at the strike", async () => {
  const { structured, built, quoted } = setup();
  const product = await structured.build({ ...base, kind: "PROTECTED_LONG", strikes: { putStrike: 90 } });

  // 10 units at $100 is $1,000 of margin at 1x.
  assert.deepEqual(built, ["perp:1000.000000", "option:PUT:90"]);
  assert.equal(product.calls.length, 2);
  assert.equal(quoted[0]!.user, USER, "the quote is signed for the trader that will execute it");
  // 10 units: floor at 90 costs 10 down plus 2 of premium, per unit.
  assert.equal(Math.round(product.analysis.maxLoss! * 1e6) / 1e6, 120);
  assert.equal(product.analysis.maxProfit, null);
  assert.equal(product.optionPremium, 2_000_000n);
  assert.equal(product.validUntil, 1_002n);
  assert.match(product.summary, /floored/);
});

test("a straddle is two long options and no perpetual, and reports the earliest quote expiry", async () => {
  const { structured, built } = setup();
  const product = await structured.build({ ...base, kind: "BREAKOUT_STRADDLE", strikes: { strike: 100 } });
  assert.deepEqual(built, ["option:CALL:100", "option:PUT:100"]);
  assert.equal(product.optionPremium, 15_000_000n);
  assert.equal(product.validUntil, 1_007n, "the put's quote lapses first");
  assert.deepEqual(product.analysis.breakEvens.map((b) => Math.round(b * 1e6) / 1e6), [85, 115]);
});

test("a strangle takes the put below and the call above", async () => {
  const { structured, built } = setup();
  await structured.build({ ...base, kind: "BREAKOUT_STRANGLE", strikes: { putStrike: 95, callStrike: 110 } });
  assert.deepEqual(built, ["option:PUT:95", "option:CALL:110"]);
});

test("contract size scales the units the terms sheet covers", async () => {
  const { structured } = setup({ contractSize: 100n * WAD });
  const product = await structured.build({ ...base, contracts: 1n, kind: "BREAKOUT_STRADDLE", strikes: { strike: 100 } });
  assert.equal(product.analysis.legs[0]!.quantity, 100);
});

test("bad requests and unsigned quotes are refused", async () => {
  const { structured } = setup();
  await assert.rejects(structured.build({ ...base, kind: "COVERED_CALL" as never, strikes: { callStrike: 110 } }), /unknown product/);
  await assert.rejects(structured.build({ ...base, contracts: 0n, kind: "BREAKOUT_STRADDLE", strikes: { strike: 100 } }), /above zero/);
  await assert.rejects(setup({ signed: false }).structured.build({ ...base, kind: "BREAKOUT_STRADDLE", strikes: { strike: 100 } }), /did not sign/);
  await assert.rejects(structured.build({ ...base, kind: "BREAKOUT_STRANGLE", strikes: { putStrike: 110, callStrike: 95 } }), AlphaMarketsError);
});
