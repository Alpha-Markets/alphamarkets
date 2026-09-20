import { randomUUID } from "node:crypto";
import type { Address, Hex } from "@orionis/sdk";

/// The request-for-quote broker for perpetuals (PROJECT_BRIEF.md Sections 39 and 40, "market maker
/// API" and "RFQ"). A user posts a request; connected market makers answer with a signed quote; the
/// user takes the best one and executes it onchain (`RFQManager.execute`). The broker only carries
/// requests and quotes between them: it holds no funds and signs nothing, and the chain verifies
/// every signature, the price band and the single use of a quote.
///
/// It lives in memory: a request is worth seconds, so a restart loses only requests that were about to
/// expire, and there is nothing to migrate or clean up.

export interface RfqRequest {
  id: string;
  user: Address;
  marketId: Hex;
  isLong: boolean;
  /// Settlement-token base units.
  collateral: bigint;
  leverage: bigint;
  createdAt: number;
  /// Milliseconds since the epoch.
  expiresAt: number;
}

export interface MakerQuote {
  maker: Address;
  /// 18 decimals.
  price: bigint;
  /// Unix seconds.
  validUntil: bigint;
  nonce: bigint;
  signature: Hex;
  receivedAt: number;
}

export interface RfqBrokerOptions {
  now?: () => number;
  /// How long a request stays open. Default 30 seconds.
  ttlMs?: number;
  /// Requests held at once. The oldest is dropped past this. Default 1,000.
  maxOpen?: number;
  /// Least seconds a quote must still be valid to be offered as best. Default 10, so a user has
  /// time to sign and send it.
  minQuoteLifeSeconds?: number;
}

type Listener = (request: RfqRequest) => void;

export class RfqBroker {
  private readonly requests = new Map<string, RfqRequest>();
  private readonly quotes = new Map<string, Map<string, MakerQuote>>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxOpen: number;
  private readonly minQuoteLifeSeconds: bigint;

  constructor(options: RfqBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxOpen = options.maxOpen ?? 1_000;
    this.minQuoteLifeSeconds = BigInt(options.minQuoteLifeSeconds ?? 10);
  }

  /// Opens a request and tells every listener (the connected makers).
  create(input: Omit<RfqRequest, "id" | "createdAt" | "expiresAt">, ttlMs = this.ttlMs): RfqRequest {
    this.purge();
    while (this.requests.size >= this.maxOpen) {
      const oldest = this.requests.keys().next().value as string;
      this.requests.delete(oldest);
      this.quotes.delete(oldest);
    }
    const createdAt = this.now();
    const request: RfqRequest = { ...input, id: randomUUID(), createdAt, expiresAt: createdAt + Math.min(ttlMs, this.ttlMs * 4) };
    this.requests.set(request.id, request);
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch {
        // A closing socket must not stop the others from hearing about the request.
      }
    }
    return request;
  }

  get(id: string): RfqRequest | undefined {
    const request = this.requests.get(id);
    return request && request.expiresAt > this.now() ? request : undefined;
  }

  open(): RfqRequest[] {
    this.purge();
    return [...this.requests.values()];
  }

  /// A maker's latest quote replaces its earlier one for the same request. Returns false when the
  /// request is closed or unknown.
  addQuote(id: string, quote: Omit<MakerQuote, "receivedAt">): boolean {
    if (!this.get(id)) return false;
    const book = this.quotes.get(id) ?? new Map<string, MakerQuote>();
    book.set(quote.maker.toLowerCase(), { ...quote, receivedAt: this.now() });
    this.quotes.set(id, book);
    return true;
  }

  /// Every quote still worth taking, best first: the lowest price for a long, the highest for a short.
  quotesFor(id: string): MakerQuote[] {
    const request = this.get(id);
    if (!request) return [];
    const nowSeconds = BigInt(Math.floor(this.now() / 1000));
    const live = [...(this.quotes.get(id)?.values() ?? [])].filter((quote) => quote.validUntil >= nowSeconds + this.minQuoteLifeSeconds);
    return live.sort((a, b) => {
      if (a.price === b.price) return a.receivedAt - b.receivedAt;
      const better = request.isLong ? a.price < b.price : a.price > b.price;
      return better ? -1 : 1;
    });
  }

  best(id: string): MakerQuote | undefined {
    return this.quotesFor(id)[0];
  }

  /// Calls `listener` for each new request. Returns the function that stops it.
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private purge() {
    const now = this.now();
    for (const [id, request] of this.requests) {
      if (request.expiresAt <= now) {
        this.requests.delete(id);
        this.quotes.delete(id);
      }
    }
  }
}

/// `MM_API_KEYS` as `key:0xMaker,key2:0xMaker2`: each market maker's API key and the address it
/// signs quotes with. A quote is only accepted when it recovers to the address bound to the key that
/// sent it, so one maker cannot post a quote in another's name.
export function parseMakerKeys(value: string | undefined): Map<string, Address> {
  const keys = new Map<string, Address>();
  for (const entry of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [key, maker] = entry.split(":");
    if (!key || key.length < 16 || !maker || !/^0x[0-9a-fA-F]{40}$/.test(maker)) {
      throw new Error("MM_API_KEYS must be a comma-separated list of key:0xMakerAddress, with each key at least 16 characters");
    }
    keys.set(key, maker as Address);
  }
  return keys;
}

/// A token bucket per key: `perSecond` requests refill each second, up to `burst`.
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    bucket.tokens = Math.min(this.burst, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
    bucket.at = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return allowed;
  }
}
