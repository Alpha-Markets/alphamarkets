import assert from "node:assert/strict";
import { test } from "node:test";
import { createThrottledFetch } from "./throttle.js";

/// A fake clock. `sleep` sets a timer; `run` moves time to each timer in turn until every request is done.
function setup(options: { readsPerSecond: number; sendWeight?: number }) {
  let time = 1_000;
  const timers: Array<{ at: number; wake: () => void }> = [];
  const started: Array<{ at: number; body: string }> = [];
  const base = (async (_input: unknown, init?: { body?: string }) => {
    started.push({ at: time, body: init?.body ?? "" });
    return new Response("{}");
  }) as unknown as typeof fetch;
  const throttled = createThrottledFetch({ ...options, base, now: () => time, sleep: (ms) => new Promise<void>((wake) => timers.push({ at: time + ms, wake })) });
  async function run(requests: Array<Promise<unknown>>) {
    let done = false;
    void Promise.all(requests).then(() => (done = true));
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      const next = timers.sort((a, b) => a.at - b.at).shift();
      if (next) {
        time = Math.max(time, next.at);
        next.wake();
      }
    }
  }
  return { throttled, started, run, advance: (ms: number) => void (time += ms) };
}

const read = { method: "POST", body: '{"method":"eth_call"}' };
const send = { method: "POST", body: '{"method":"eth_sendRawTransaction"}' };

test("it spaces out reads that arrive together", async () => {
  const { throttled, started, run } = setup({ readsPerSecond: 10 });
  await run([throttled("x", read), throttled("x", read), throttled("x", read)]);
  assert.deepEqual(started.map((s) => s.at - started[0]!.at), [0, 100, 200]);
});

test("a transaction holds back what follows it, by its weight", async () => {
  const { throttled, started, run } = setup({ readsPerSecond: 10, sendWeight: 5 });
  await run([throttled("x", send), throttled("x", read)]);
  assert.deepEqual(started.map((s) => s.at - started[0]!.at), [0, 500]);
});

test("it does not delay a request that comes after the quiet time", async () => {
  const { throttled, started, run, advance } = setup({ readsPerSecond: 10 });
  await run([throttled("x", read)]);
  advance(1_000);
  await run([throttled("x", read)]);
  assert.equal(started[1]!.at - started[0]!.at, 1_000);
});

test("a rate of 0 turns it off", async () => {
  const { throttled, started, run } = setup({ readsPerSecond: 0 });
  await run([throttled("x", read), throttled("x", read)]);
  assert.deepEqual(started.map((s) => s.at), [1_000, 1_000]);
});
