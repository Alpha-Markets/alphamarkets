import { resolveMarketId, rfqQuoteTypedData, toBaseUnits, type Address, type Hex, type Orionis } from "@orionis/sdk";
import type { FastifyInstance } from "fastify";
import { verifyTypedData } from "viem";
import { parseMakerKeys, RateLimiter, RfqBroker, type MakerQuote, type RfqRequest } from "../rfq.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/// A quote must stay valid at least this long, and at most this long: a price the chain honours for
/// minutes is a price the pool is exposed to for minutes.
const MIN_QUOTE_SECONDS = 5n;
const MAX_QUOTE_SECONDS = 300n;

export interface RfqRouteOptions {
  broker?: RfqBroker;
  /// API key to the address that maker signs with. Read from `MM_API_KEYS` when omitted.
  makers?: Map<string, Address>;
  limiter?: RateLimiter;
  now?: () => number;
}

type Result = { ok: true } | { ok: false; status: number; error: string };

const serialize = (request: RfqRequest, orionis: Orionis) => ({
  id: request.id,
  user: request.user,
  marketId: request.marketId,
  side: request.isLong ? "LONG" : "SHORT",
  collateral: request.collateral.toString(),
  leverage: request.leverage.toString(),
  expiresAt: new Date(request.expiresAt).toISOString(),
  /// What a maker needs to sign this request's quote (`rfqQuoteTypedData`).
  chainId: orionis.chainId,
  rfqManager: orionis.addresses.rfqManager,
});

const serializeQuote = (quote: MakerQuote) => ({
  maker: quote.maker,
  price: quote.price.toString(),
  validUntil: quote.validUntil.toString(),
  nonce: quote.nonce.toString(),
  signature: quote.signature,
});

/// Request-for-quote for perpetuals and the market-maker API (PROJECT_BRIEF.md Sections 39 and 40).
///
/// Users: `POST /v1/rfq/requests` opens a request; `GET /v1/rfq/requests/:id` returns the quotes
/// so far and the best one, which the user executes onchain (`POST /v1/trade/perps/rfq/execute`
/// builds that transaction).
///
/// Market makers authenticate with an API key (`x-api-key`, from `MM_API_KEYS`) and are rate limited:
/// `GET /v1/mm/rfq/open` lists the open requests, `POST /v1/mm/rfq/:id/quote` answers one, and
/// `/v1/mm/ws` streams new requests and takes quotes over one connection. A quote is an EIP-712
/// signature (`rfqQuoteTypedData`) and is only accepted when it recovers to the address bound to the
/// sender's key. The chain re-checks everything, so this layer decides what is worth showing a user,
/// not what is valid.
export function registerRfqRoutes(app: FastifyInstance, orionis: Orionis, options: RfqRouteOptions = {}) {
  const now = options.now ?? Date.now;
  const broker = options.broker ?? new RfqBroker({ now });
  const makers = options.makers ?? parseMakerKeys(process.env.MM_API_KEYS);
  const limiter = options.limiter ?? new RateLimiter(Number(process.env.MM_RATE_PER_SECOND ?? 20), Number(process.env.MM_RATE_BURST ?? 40), now);

  const rfqAvailable = () => Boolean(orionis.addresses.rfqManager);

  /// Checks and stores one quote. Shared by REST and the WebSocket.
  async function acceptQuote(maker: Address, id: string, body: Record<string, unknown>): Promise<Result> {
    const request = broker.get(id);
    if (!request) return { ok: false, status: 404, error: "unknown or expired request" };

    const price = typeof body.price === "string" || typeof body.price === "number" ? String(body.price) : "";
    const nonce = body.nonce;
    const validUntil = body.validUntil;
    const signature = body.signature;
    if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) return { ok: false, status: 400, error: "price must be a positive decimal" };
    if (typeof nonce !== "string" || !/^\d+$/.test(nonce)) return { ok: false, status: 400, error: "nonce must be an integer string" };
    if ((typeof validUntil !== "string" && typeof validUntil !== "number") || !/^\d+$/.test(String(validUntil))) return { ok: false, status: 400, error: "validUntil must be unix seconds" };
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return { ok: false, status: 400, error: "signature must be a hex string" };

    const nowSeconds = BigInt(Math.floor(now() / 1000));
    const until = BigInt(String(validUntil));
    if (until < nowSeconds + MIN_QUOTE_SECONDS) return { ok: false, status: 422, error: `the quote must stay valid at least ${MIN_QUOTE_SECONDS} seconds` };
    if (until > nowSeconds + MAX_QUOTE_SECONDS) return { ok: false, status: 422, error: `the quote may stay valid at most ${MAX_QUOTE_SECONDS} seconds` };

    const priceBase = toBaseUnits(price, 18);
    const typed = rfqQuoteTypedData({
      chainId: orionis.chainId,
      rfqManager: orionis.addresses.rfqManager!,
      user: request.user,
      marketId: request.marketId,
      isLong: request.isLong,
      collateral: request.collateral,
      leverage: request.leverage,
      price: priceBase,
      validUntil: until,
      nonce: BigInt(nonce as string),
    });
    const genuine = await verifyTypedData({ address: maker, signature: signature as Hex, ...typed }).catch(() => false);
    if (!genuine) return { ok: false, status: 401, error: "the signature does not recover to this API key's maker address" };

    // Pre-filter what the contract would refuse anyway, so a user is never shown a quote that cannot fill.
    try {
      const [{ price: mark }, { maxDeviationBps }] = await Promise.all([orionis.oracle.getMarkPrice(request.marketId), orionis.rfq.parameters()]);
      const gap = priceBase > mark ? priceBase - mark : mark - priceBase;
      if (gap * 10_000n > mark * maxDeviationBps) return { ok: false, status: 422, error: "the price is outside the band around the mark price that the contract accepts" };
    } catch {
      // No mark or no parameters to check against: leave it to the chain.
    }

    broker.addQuote(id, { maker, price: priceBase, validUntil: until, nonce: BigInt(nonce as string), signature: signature as Hex });
    return { ok: true };
  }

  function authenticate(header: unknown): Address | undefined {
    return typeof header === "string" ? makers.get(header) : undefined;
  }

  // ---- users -------------------------------------------------------------------

  app.post<{ Body: Record<string, unknown> }>("/v1/rfq/requests", async (request, reply) => {
    if (!rfqAvailable()) return reply.code(501).send({ error: "this deployment has no RFQManager" });
    const body = request.body ?? {};
    const { user, market, side, collateral, leverage } = body;
    if (typeof user !== "string" || !ADDRESS.test(user)) return reply.code(400).send({ error: "user must be an address" });
    if (typeof market !== "string" || market === "") return reply.code(400).send({ error: "market is required" });
    if (side !== "LONG" && side !== "SHORT") return reply.code(400).send({ error: 'side must be "LONG" or "SHORT"' });
    const collateralText = typeof collateral === "number" ? String(collateral) : collateral;
    if (typeof collateralText !== "string" || !/^\d+(\.\d+)?$/.test(collateralText) || Number(collateralText) <= 0) return reply.code(400).send({ error: "collateral must be a positive decimal amount" });
    const leverageText = typeof leverage === "number" ? String(leverage) : leverage;
    if (typeof leverageText !== "string" || !/^\d+$/.test(leverageText) || BigInt(leverageText) === 0n) return reply.code(400).send({ error: "leverage must be a positive whole number" });
    const ttlSeconds = body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds);
    if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) return reply.code(400).send({ error: "ttlSeconds must be positive" });

    const decimals = await orionis.erc20.decimals(orionis.addresses.settlementToken);
    const created = broker.create(
      { user: user as Address, marketId: resolveMarketId(market), isLong: side === "LONG", collateral: toBaseUnits(collateralText, decimals), leverage: BigInt(leverageText) },
      ttlSeconds === undefined ? undefined : ttlSeconds * 1000,
    );
    return reply.code(201).send(serialize(created, orionis));
  });

  app.get<{ Params: { id: string } }>("/v1/rfq/requests/:id", async (request, reply) => {
    const found = broker.get(request.params.id);
    if (!found) return reply.code(404).send({ error: "unknown or expired request" });
    const quotes = broker.quotesFor(found.id);
    return { request: serialize(found, orionis), quotes: quotes.map(serializeQuote), best: quotes[0] ? serializeQuote(quotes[0]) : null };
  });

  // ---- market makers -----------------------------------------------------------

  async function guard(request: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    const key = request.headers["x-api-key"];
    const maker = authenticate(key);
    if (!maker) {
      reply.code(401).send({ error: "a valid x-api-key header is required" });
      return undefined;
    }
    if (!limiter.allow(String(key))) {
      reply.code(429).send({ error: "rate limit exceeded" });
      return undefined;
    }
    return maker;
  }

  app.get("/v1/mm/rfq/open", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    return broker.open().map((open) => serialize(open, orionis));
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>("/v1/mm/rfq/:id/quote", async (request, reply) => {
    const maker = await guard(request, reply);
    if (!maker) return;
    const result = await acceptQuote(maker, request.params.id, request.body ?? {});
    return result.ok ? { accepted: true } : reply.code(result.status).send({ error: result.error });
  });

  /// One connection for a maker: it receives every open request on connect and each new one as it
  /// arrives, and answers with `{ type: "quote", requestId, price, validUntil, nonce, signature }`.
  app.get("/v1/mm/ws", { websocket: true }, (socket, request) => {
    const key = request.headers["x-api-key"];
    const maker = authenticate(key);
    if (!maker) {
      socket.send(JSON.stringify({ type: "error", error: "a valid x-api-key header is required" }));
      socket.close();
      return;
    }

    const send = (message: unknown) => {
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // The socket is closing.
      }
    };
    for (const open of broker.open()) send({ type: "rfq", request: serialize(open, orionis) });
    const stop = broker.subscribe((created) => send({ type: "rfq", request: serialize(created, orionis) }));
    socket.on("close", stop);

    socket.on("message", async (raw: Buffer) => {
      if (!limiter.allow(String(key))) return send({ type: "error", error: "rate limit exceeded" });
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return send({ type: "error", error: "messages must be JSON" });
      }
      if (message.type !== "quote" || typeof message.requestId !== "string") return send({ type: "error", error: 'expected { "type": "quote", "requestId": ... }' });
      const result = await acceptQuote(maker, message.requestId, message);
      send({ type: "quote_result", requestId: message.requestId, ...(result.ok ? { accepted: true } : { accepted: false, error: result.error }) });
    });
  });
}
