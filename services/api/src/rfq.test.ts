import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMakerKeys, RateLimiter, RfqBroker, type RfqRequest } from "./rfq.js";

const USER = `0x${"01".repeat(20)}` as const;
const MAKER_A = `0x${"aa".repeat(20)}` as const;
const MAKER_B = `0x${"bb".repeat(20)}` as const;
const SIG = `0x${"11".repeat(65)}` as const;
const WAD = 10n ** 18n;

const input = (isLong = true): Omit<RfqRequest, "id" | "createdAt" | "expiresAt"> => ({ user: USER, marketId: `0x${"22".repeat(32)}`, isLong, collateral: 1_000n, leverage: 5n });
const quote = (maker: `0x${string}`, price: bigint, validUntil = 1_000n) => ({ maker, price: price * WAD, validUntil, nonce: 1n, signature: SIG });

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test("a request is open until its ttl, then gone with its quotes", () => {
  const time = clock();
  const broker = new RfqBroker({ now: time.now, ttlMs: 30_000 });
  const request = broker.create(input());
  assert.equal(broker.get(request.id)?.user, USER);
  assert.equal(broker.open().length, 1);
  assert.equal(broker.addQuote(request.id, quote(MAKER_A, 190n)), true);

  time.advance(30_001);
  assert.equal(broker.get(request.id), undefined);
  assert.deepEqual(broker.open(), []);
  assert.deepEqual(broker.quotesFor(request.id), []);
  assert.equal(broker.addQuote(request.id, quote(MAKER_A, 190n)), false);
});

test("a long is offered the lowest price and a short the highest", () => {
  const time = clock(0);
  const broker = new RfqBroker({ now: time.now, minQuoteLifeSeconds: 0 });
  const long = broker.create(input(true));
  broker.addQuote(long.id, quote(MAKER_A, 191n));
  broker.addQuote(long.id, quote(MAKER_B, 190n));
  assert.equal(broker.best(long.id)?.maker, MAKER_B);
  assert.deepEqual(broker.quotesFor(long.id).map((q) => q.price / WAD), [190n, 191n]);

  const short = broker.create(input(false));
  broker.addQuote(short.id, quote(MAKER_A, 189n));
  broker.addQuote(short.id, quote(MAKER_B, 190n));
  assert.equal(broker.best(short.id)?.maker, MAKER_B);
});

test("a maker's newer quote replaces its older one, and equal prices go to whoever was first", () => {
  const time = clock(0);
  const broker = new RfqBroker({ now: time.now, minQuoteLifeSeconds: 0 });
  const request = broker.create(input());
  broker.addQuote(request.id, quote(MAKER_A, 191n));
  time.advance(10);
  broker.addQuote(request.id, quote(MAKER_A, 190n));
  assert.equal(broker.quotesFor(request.id).length, 1);
  assert.equal(broker.best(request.id)?.price, 190n * WAD);

  broker.addQuote(request.id, quote(MAKER_B, 190n));
  assert.equal(broker.best(request.id)?.maker, MAKER_A, "the same price: the earlier one");
});

test("a quote that will lapse before the user can act is not offered", () => {
  const time = clock(1_000_000); // 1,000 seconds
  const broker = new RfqBroker({ now: time.now, minQuoteLifeSeconds: 10 });
  const request = broker.create(input());
  broker.addQuote(request.id, quote(MAKER_A, 190n, 1_005n)); // 5 seconds left
  broker.addQuote(request.id, quote(MAKER_B, 191n, 1_020n));
  assert.equal(broker.best(request.id)?.maker, MAKER_B);
});

test("listeners hear about new requests, and a throwing one does not stop the rest", () => {
  const broker = new RfqBroker();
  const heard: string[] = [];
  broker.subscribe(() => {
    throw new Error("socket closed");
  });
  const stop = broker.subscribe((request) => heard.push(request.id));
  const first = broker.create(input());
  assert.deepEqual(heard, [first.id]);
  stop();
  broker.create(input());
  assert.equal(heard.length, 1);
});

test("the broker holds a bounded number of requests, dropping the oldest", () => {
  const broker = new RfqBroker({ maxOpen: 2 });
  const first = broker.create(input());
  broker.create(input());
  broker.create(input());
  assert.equal(broker.open().length, 2);
  assert.equal(broker.get(first.id), undefined);
});

test("a requested ttl is capped", () => {
  const time = clock(0);
  const broker = new RfqBroker({ now: time.now, ttlMs: 30_000 });
  const request = broker.create(input(), 10_000_000);
  assert.equal(request.expiresAt, 120_000);
});

test("maker keys parse as key:address and reject anything else", () => {
  const keys = parseMakerKeys(`0123456789abcdef:${MAKER_A}, another-long-key-1234:${MAKER_B}`);
  assert.equal(keys.get("0123456789abcdef"), MAKER_A);
  assert.equal(keys.size, 2);
  assert.equal(parseMakerKeys(undefined).size, 0);
  assert.equal(parseMakerKeys("").size, 0);
  for (const bad of ["short:" + MAKER_A, "0123456789abcdef:0x123", "0123456789abcdef", ":" + MAKER_A]) {
    assert.throws(() => parseMakerKeys(bad), /MM_API_KEYS/, bad);
  }
});

test("the rate limiter allows a burst, then the refill rate", () => {
  const time = clock(0);
  const limiter = new RateLimiter(2, 3, time.now);
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow("a")), [true, true, true, false]);
  assert.equal(limiter.allow("b"), true, "another key has its own bucket");
  time.advance(500); // one token back
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  time.advance(60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow("a")), [true, true, true, false], "the bucket never holds more than the burst");
});
