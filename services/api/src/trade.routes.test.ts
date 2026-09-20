import assert from "node:assert/strict";
import { test } from "node:test";
import { OrionisContractError, type Orionis, type PreparedTx } from "@orionis/sdk";
import Fastify from "fastify";
import { registerTradeRoutes } from "./routes/trade.js";

const TO = `0x${"0f".repeat(20)}` as const;
const FROM = `0x${"ab".repeat(20)}`;
const prepared = (description: string): PreparedTx => ({ to: TO, data: "0x1234", value: 0n, chainId: 46630, description });

/// A trading namespace that records each call and hands back a fixed transaction.
function fakeTrading(over: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string, result: unknown) => (...args: unknown[]) => (calls.push({ name, args }), result);
  const names = ["prepareWithdraw", "prepareOpenPerp", "prepareIncreasePerp", "prepareReducePerp", "prepareClosePerp", "preparePlaceLimitOrder", "prepareCancelLimitOrder", "prepareExecuteLimitOrder", "preparePlaceTriggerOrder", "prepareCancelTriggerOrder", "prepareExecuteTriggerOrder", "prepareOpenOption", "prepareCloseOption", "prepareExecuteRfq"];
  const trading: Record<string, unknown> = Object.fromEntries(names.map((name) => [name, record(name, prepared(name))]));
  trading.prepareDeposit = record("prepareDeposit", [prepared("approve"), prepared("deposit")]);
  trading.simulate = record("simulate", undefined);
  Object.assign(trading, over);
  return { orionis: { trading } as unknown as Orionis, calls };
}

function build(over: Record<string, unknown> = {}) {
  const { orionis, calls } = fakeTrading(over);
  const app = Fastify();
  registerTradeRoutes(app, orionis);
  return { app, calls };
}

const post = (app: ReturnType<typeof Fastify>, url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });

test("a deposit returns the approve and the deposit in order, with value as a string", async () => {
  const { app, calls } = build();
  const response = await post(app, "/v1/trade/deposit", { amount: "1000.50" });
  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.deepEqual(json.transactions.map((tx: { description: string }) => tx.description), ["approve", "deposit"]);
  assert.equal(json.transactions[0].value, "0");
  assert.equal(json.transactions[0].chainId, 46630);
  assert.deepEqual(calls[0], { name: "prepareDeposit", args: ["1000.50", undefined] });
});

test("opening a perp passes exact strings and a bigint leverage to the builder", async () => {
  const { app, calls } = build();
  const response = await post(app, "/v1/trade/perps/open", { market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, slippageBps: 25, deadline: "2000000000" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0]!.args[0], { market: "NVDA", side: "LONG", collateral: "1000", leverage: 5n, worstPrice: undefined, slippageBps: 25, deadline: 2_000_000_000n });
});

test("every perp route builds through the matching method", async () => {
  const { app, calls } = build();
  const base = { market: "NVDA", side: "SHORT", positionId: "3" };
  await post(app, "/v1/trade/perps/increase", { ...base, addSize: "500" });
  await post(app, "/v1/trade/perps/reduce", { ...base, size: "200" });
  await post(app, "/v1/trade/perps/close", base);
  await post(app, "/v1/trade/perps/limit-order", { market: "NVDA", side: "LONG", collateral: "1000", leverage: 2, triggerPrice: "180" });
  await post(app, "/v1/trade/perps/limit-order/cancel", { orderId: "4" });
  await post(app, "/v1/trade/perps/limit-order/execute", { orderId: 4 });
  await post(app, "/v1/trade/perps/trigger-order", { positionId: "3", kind: "STOP_LOSS", triggerPrice: "170" });
  await post(app, "/v1/trade/perps/trigger-order/cancel", { orderId: "5" });
  await post(app, "/v1/trade/perps/trigger-order/execute", { orderId: "5" });
  assert.deepEqual(calls.map((call) => call.name), [
    "prepareIncreasePerp", "prepareReducePerp", "prepareClosePerp", "preparePlaceLimitOrder", "prepareCancelLimitOrder",
    "prepareExecuteLimitOrder", "preparePlaceTriggerOrder", "prepareCancelTriggerOrder", "prepareExecuteTriggerOrder",
  ]);
  assert.equal(calls[0]!.args[0], 3n);
});

test("an option open needs the signed quote and passes its fields as bigint", async () => {
  const { app, calls } = build();
  const authorization = { premium: "4820000000", validUntil: "1900000000", nonce: "7", signature: `0x${"11".repeat(65)}` };
  const response = await post(app, "/v1/trade/options/open", { underlying: "NVDA", type: "CALL", strike: "190", expiry: "1900100000", contracts: 10, authorization });
  assert.equal(response.statusCode, 200);
  const args = calls[0]!.args[0] as { authorization: { premium: bigint; nonce: bigint }; contracts: bigint };
  assert.equal(args.authorization.premium, 4_820_000_000n);
  assert.equal(args.authorization.nonce, 7n);
  assert.equal(args.contracts, 10n);
  assert.equal((await post(app, "/v1/trade/options/open", { underlying: "NVDA", type: "CALL", strike: "190", expiry: "1", contracts: 1 })).statusCode, 400);
  await post(app, "/v1/trade/options/close", { positionId: "9", authorization });
  assert.equal(calls.at(-1)!.name, "prepareCloseOption");
});

test("bad input is a 400 that names the field, and nothing is built", async () => {
  const { app, calls } = build();
  const cases: Array<[string, unknown, RegExp]> = [
    ["/v1/trade/deposit", { amount: "abc" }, /amount/],
    ["/v1/trade/deposit", { amount: "1e3" }, /amount/],
    ["/v1/trade/perps/open", { market: "NVDA", side: "UP", collateral: "1", leverage: 1 }, /side/],
    ["/v1/trade/perps/open", { side: "LONG", collateral: "1", leverage: 1 }, /market/],
    ["/v1/trade/perps/open", { market: "NVDA", side: "LONG", collateral: "1", leverage: -1 }, /leverage/],
    ["/v1/trade/perps/open", { market: "NVDA", side: "LONG", collateral: "1", leverage: 1, slippageBps: 1.5 }, /slippageBps/],
    ["/v1/trade/perps/limit-order/cancel", { orderId: "x" }, /orderId/],
    ["/v1/trade/perps/trigger-order", { positionId: "1", kind: "TRAILING", triggerPrice: "1" }, /kind/],
  ];
  for (const [url, payload, pattern] of cases) {
    const response = await post(app, url, payload);
    assert.equal(response.statusCode, 400, url);
    assert.match(response.json().error, pattern);
  }
  assert.equal(calls.length, 0);
});

test("simulate needs a sender, runs the first transaction, and turns a revert into 422", async () => {
  const { app, calls } = build();
  assert.equal((await post(app, "/v1/trade/perps/limit-order/cancel", { orderId: "1", simulate: true })).statusCode, 400);
  const ok = await post(app, "/v1/trade/perps/limit-order/cancel", { orderId: "1", simulate: true, from: FROM });
  assert.equal(ok.statusCode, 200);
  assert.equal(calls.at(-1)!.name, "simulate");
  assert.equal(calls.at(-1)!.args[1], FROM);

  const failing = build({ simulate: async () => { throw new OrionisContractError("InsufficientMargin", [], undefined); } });
  const response = await post(failing.app, "/v1/trade/perps/limit-order/cancel", { orderId: "1", simulate: true, from: FROM });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, "InsufficientMargin");
});

test("executing an RFQ quote passes the maker's numbers through as bigint, exactly as signed", async () => {
  const { app, calls } = build();
  const payload = { user: FROM, market: "NVDA", side: "LONG", collateral: "1000000000", leverage: 5, price: "190500000000000000000", validUntil: "1900000000", nonce: "7", signature: `0x${"22".repeat(65)}` };
  const response = await post(app, "/v1/trade/perps/rfq/execute", payload);
  assert.equal(response.statusCode, 200, response.body);
  const args = calls[0]!.args[0] as Record<string, unknown>;
  assert.equal(args.price, 190_500_000_000_000_000_000n);
  assert.equal(args.collateral, 1_000_000_000n);
  assert.equal(args.nonce, 7n);
  assert.equal(args.side, "LONG");
  for (const patch of [{ user: "0x12" }, { signature: "nope" }, { price: "190.5" }, { side: "UP" }]) {
    assert.equal((await post(app, "/v1/trade/perps/rfq/execute", { ...payload, ...patch })).statusCode, 400, JSON.stringify(patch));
  }
});
