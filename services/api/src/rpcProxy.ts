import type { FastifyInstance } from "fastify";

/// A caching JSON-RPC read proxy for `apps/web`. Every visitor's browser asks the chain the same
/// questions (market list, prices, funding, open interest), so without this each tab pays for its
/// own copy against the RPC provider's quota. Here identical calls made within a short window share
/// one upstream request, and the provider key stays on the server.
///
/// Reads only. Anything that could change state (`eth_sendRawTransaction`) is refused: wallets send
/// transactions through their own RPC, not through this route.

/// How long a result is reused, per method, in milliseconds. A method listed with no entry here is
/// forwarded on every call.
export const CACHE_TTL_MS: Record<string, number> = {
  eth_call: 3_000,
  eth_blockNumber: 2_000,
  eth_chainId: 3_600_000,
  net_version: 3_600_000,
  eth_getBlockByNumber: 2_000,
  eth_gasPrice: 3_000,
  eth_maxPriorityFeePerGas: 3_000,
  eth_getBalance: 3_000,
  eth_getCode: 60_000,
};

/// Methods the proxy forwards. A wallet read client needs receipts, gas estimates and logs too;
/// those are forwarded but never cached (a receipt must appear the moment it exists).
export const ALLOWED_METHODS = new Set([
  ...Object.keys(CACHE_TTL_MS),
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_getLogs",
]);

/// Entries kept at most; the oldest are dropped first so a flood of unique calls cannot grow memory.
const MAX_ENTRIES = 5_000;
/// Calls accepted in one batch request.
const MAX_BATCH = 50;

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown[];
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Upstream = (calls: RpcRequest[]) => Promise<RpcResponse[]>;

function fail(id: RpcRequest["id"], code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/// A block tag other than a fixed number can move, so a result for it is only good for the TTL.
/// A call pinned to a block hash or number never changes, so it can be kept much longer.
function ttlFor(call: RpcRequest): number {
  const ttl = CACHE_TTL_MS[call.method];
  if (ttl === undefined) return 0;
  if (call.method === "eth_call" || call.method === "eth_getBalance") {
    const block = call.params?.[1];
    if (typeof block === "string" && /^0x[0-9a-fA-F]+$/.test(block)) return 60_000;
  }
  return ttl;
}

export function createRpcCache(upstream: Upstream, now: () => number = Date.now) {
  const entries = new Map<string, { expires: number; response: Promise<RpcResponse> }>();

  function prune() {
    const time = now();
    for (const [key, entry] of entries) if (entry.expires <= time) entries.delete(key);
    // Map keeps insertion order, so the first keys are the oldest.
    for (const key of entries.keys()) {
      if (entries.size <= MAX_ENTRIES) break;
      entries.delete(key);
    }
  }

  /// Answers each call, from the cache where a fresh result exists, and forwards the rest in a
  /// single upstream batch. Response order and ids match the request.
  async function handle(calls: RpcRequest[]): Promise<RpcResponse[]> {
    const time = now();
    const answers: Array<Promise<RpcResponse> | undefined> = calls.map(() => undefined);
    const toForward: Array<{ index: number; call: RpcRequest; key: string | undefined; ttl: number }> = [];

    calls.forEach((call, index) => {
      if (call === null || typeof call !== "object" || typeof call.method !== "string") {
        answers[index] = Promise.resolve(fail(null, -32600, "invalid request"));
      } else if (!ALLOWED_METHODS.has(call.method)) {
        answers[index] = Promise.resolve(fail(call.id ?? null, -32601, `${call.method} is not available through this proxy`));
      } else {
        const ttl = ttlFor(call);
        const key = ttl > 0 ? `${call.method}:${JSON.stringify(call.params ?? [])}` : undefined;
        const hit = key ? entries.get(key) : undefined;
        if (hit && hit.expires > time) {
          answers[index] = hit.response.then((response) => ({ ...response, id: call.id ?? null }));
        } else {
          toForward.push({ index, call, key, ttl });
        }
      }
    });

    if (toForward.length > 0) {
      // The upstream sees our own ids, so two callers using id 1 cannot collide.
      const forwarded = toForward.map(({ call }, i) => ({ ...call, id: i }));
      const batch = upstream(forwarded).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "upstream failed";
        return forwarded.map((call) => fail(call.id, -32603, message));
      });
      toForward.forEach(({ index, call, key, ttl }, i) => {
        const response = batch.then((responses) => responses.find((r) => r.id === i) ?? fail(i, -32603, "upstream returned no answer"));
        // Concurrent callers share the same pending promise; an error is dropped so the next call retries.
        if (key) {
          entries.set(key, { expires: time + ttl, response });
          void response.then((r) => {
            if (r.error) entries.delete(key);
          });
        }
        answers[index] = response.then((r) => ({ ...r, id: call.id ?? null }));
      });
      prune();
    }

    return Promise.all(answers as Array<Promise<RpcResponse>>);
  }

  return { handle, size: () => entries.size };
}

/// Sends one JSON-RPC batch to the provider.
export function httpUpstream(rpcUrl: string): Upstream {
  return async (calls) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`rpc provider returned ${response.status}`);
    const body = (await response.json()) as RpcResponse | RpcResponse[];
    return Array.isArray(body) ? body : [body];
  };
}

export function registerRpcProxy(app: FastifyInstance, upstream: Upstream) {
  const cache = createRpcCache(upstream);

  app.post<{ Body: RpcRequest | RpcRequest[] }>("/v1/rpc", async (request, reply) => {
    const body = request.body;
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return reply.code(400).send(fail(null, -32600, `batch must hold 1 to ${MAX_BATCH} calls`));
      return cache.handle(body);
    }
    if (body === null || typeof body !== "object") return reply.code(400).send(fail(null, -32600, "invalid request"));
    const [response] = await cache.handle([body]);
    return response;
  });
}
