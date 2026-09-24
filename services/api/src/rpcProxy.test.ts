import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createRpcCache, registerRpcProxy, type RpcRequest, type RpcResponse } from "./rpcProxy.js";

function fakeUpstream() {
  const seen: RpcRequest[][] = [];
  const upstream = async (calls: RpcRequest[]): Promise<RpcResponse[]> => {
    seen.push(calls);
    return calls.map((call) => ({ jsonrpc: "2.0", id: call.id, result: `${call.method}#${seen.length}` }));
  };
  return { upstream, seen };
}

const call = (id: number, method = "eth_call", params: unknown[] = [{ to: "0x1", data: "0xaa" }, "latest"]): RpcRequest => ({ jsonrpc: "2.0", id, method, params });

test("identical eth_call within the TTL is forwarded once, and each caller keeps its own id", async () => {
  const { upstream, seen } = fakeUpstream();
  const cache = createRpcCache(upstream);
  const [a] = await cache.handle([call(7)]);
  const [b] = await cache.handle([call(99)]);
  assert.equal(seen.length, 1);
  assert.equal(a!.id, 7);
  assert.equal(b!.id, 99);
  assert.equal(a!.result, b!.result);
});

test("a call is forwarded again once its TTL has passed", async () => {
  const { upstream, seen } = fakeUpstream();
  let time = 1_000;
  const cache = createRpcCache(upstream, () => time);
  await cache.handle([call(1)]);
  time += 3_001;
  await cache.handle([call(2)]);
  assert.equal(seen.length, 2);
});

test("concurrent identical calls share one upstream request", async () => {
  const { upstream, seen } = fakeUpstream();
  const cache = createRpcCache(upstream);
  await Promise.all([cache.handle([call(1)]), cache.handle([call(2)])]);
  assert.equal(seen.length, 1);
});

test("a batch forwards only the calls not cached, in one upstream request", async () => {
  const { upstream, seen } = fakeUpstream();
  const cache = createRpcCache(upstream);
  await cache.handle([call(1)]);
  const out = await cache.handle([call(10), call(11, "eth_call", [{ to: "0x2", data: "0xbb" }, "latest"])]);
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.length, 1);
  assert.deepEqual(out.map((r) => r.id), [10, 11]);
});

test("an error result is not cached", async () => {
  let n = 0;
  const cache = createRpcCache(async (calls) => calls.map((c) => (++n === 1 ? { jsonrpc: "2.0" as const, id: c.id, error: { code: -32000, message: "boom" } } : { jsonrpc: "2.0" as const, id: c.id, result: "ok" })));
  const [first] = await cache.handle([call(1)]);
  assert.ok(first!.error);
  await new Promise((resolve) => setImmediate(resolve));
  const [second] = await cache.handle([call(2)]);
  assert.equal(second!.result, "ok");
});

test("methods that write or are unknown are refused and never reach the provider", async () => {
  const { upstream, seen } = fakeUpstream();
  const cache = createRpcCache(upstream);
  const [sent] = await cache.handle([call(1, "eth_sendRawTransaction", ["0xdead"])]);
  assert.equal(sent!.error?.code, -32601);
  assert.equal(seen.length, 0);
});

test("a receipt lookup is never cached", async () => {
  const { upstream, seen } = fakeUpstream();
  const cache = createRpcCache(upstream);
  await cache.handle([call(1, "eth_getTransactionReceipt", ["0xabc"])]);
  await cache.handle([call(2, "eth_getTransactionReceipt", ["0xabc"])]);
  assert.equal(seen.length, 2);
});

test("an upstream failure comes back as a JSON-RPC error", async () => {
  const cache = createRpcCache(async () => {
    throw new Error("rpc provider returned 429");
  });
  const [out] = await cache.handle([call(1)]);
  assert.match(out!.error!.message, /429/);
});

test("the route answers a single call and a batch", async () => {
  const { upstream } = fakeUpstream();
  const app = Fastify();
  registerRpcProxy(app, upstream);
  const single = await app.inject({ method: "POST", url: "/v1/rpc", payload: call(1) });
  assert.equal(single.json().id, 1);
  const batch = await app.inject({ method: "POST", url: "/v1/rpc", payload: [call(2), call(3, "eth_blockNumber", [])] });
  assert.deepEqual(batch.json().map((r: RpcResponse) => r.id), [2, 3]);
  const empty = await app.inject({ method: "POST", url: "/v1/rpc", payload: [] });
  assert.equal(empty.statusCode, 400);
});
