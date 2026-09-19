import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { stringToHex } from "viem";
import { createStream, type WebSocketLike } from "./stream.js";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const NVDA = stringToHex("NVDA", { size: 32 });
const TSLA = stringToHex("TSLA", { size: 32 });
const tick = (marketId: string) =>
  JSON.stringify({ type: "tick", marketId, indexPrice: "184420000000000000000", timestamp: "1", fundingRateBps: "8" });

test("converts http to ws, parses bigint fields and filters by market", () => {
  FakeSocket.instances = [];
  const ticks: bigint[] = [];
  const stop = createStream("http://api.test", FakeSocket).subscribe({
    markets: ["NVDA-PERP"],
    onTick: (received) => ticks.push(received.indexPrice),
  });

  const socket = FakeSocket.instances[0]!;
  assert.equal(socket.url, "ws://api.test/v1/ws");
  socket.onmessage?.({ data: tick(NVDA) });
  socket.onmessage?.({ data: tick(TSLA) });
  assert.deepEqual(ticks, [184_420_000_000_000_000_000n]);

  stop();
  assert.equal(socket.closed, true);
});

test("reconnects after a drop with backoff and stops after unsubscribe", () => {
  FakeSocket.instances = [];
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const stop = createStream("https://api.test", FakeSocket).subscribe({ onTick: () => {} });
    assert.equal(FakeSocket.instances[0]!.url, "wss://api.test/v1/ws");

    FakeSocket.instances[0]!.onclose?.({});
    mock.timers.tick(1000);
    assert.equal(FakeSocket.instances.length, 2);

    stop();
    FakeSocket.instances[1]!.onclose?.({});
    mock.timers.tick(60_000);
    assert.equal(FakeSocket.instances.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test("requires apiUrl and a WebSocket implementation", () => {
  assert.throws(() => createStream(undefined, FakeSocket).subscribe({ onTick: () => {} }), /apiUrl/);
  const original = (globalThis as { WebSocket?: unknown }).WebSocket;
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
  try {
    assert.throws(() => createStream("http://api.test").subscribe({ onTick: () => {} }), /no global WebSocket/);
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = original;
  }
});
