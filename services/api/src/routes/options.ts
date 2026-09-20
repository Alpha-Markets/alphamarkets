import { resolveMarketId, type AlphaMarkets } from "@alphamarkets/sdk";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSql } from "../db.js";

/// "Chain" here means every option series someone has actually opened a position against
/// (from the indexed `SeriesCreated` event — `OptionMarket.getOrCreateSeries` fires it the
/// first time a strike/expiry/type combination is used). Unlike a traditional options
/// exchange, this contract design has no pre-listed strike/expiry matrix (any strike/expiry
/// is valid per `OptionsEngine.openPosition` — PROJECT_BRIEF.md Section 8's "Select strike"
/// is a free choice, not a pick from a list) — so an empty chain for an unused market is
/// correct, not a bug, and this endpoint does not synthesize a suggested strike ladder.
export function registerOptionRoutes(app: FastifyInstance, _alphamarkets: AlphaMarkets) {
  const sql = getSql();

  app.get<{ Params: { symbol: string } }>("/v1/options/:symbol/expiries", async (request) => {
    const marketId = resolveMarketId(request.params.symbol);
    const rows = await sql<{ expiry: string }[]>`
      select distinct args ->> 'expiry' as expiry
      from events
      where event_name = 'SeriesCreated' and args ->> 'underlyingMarketId' = ${marketId}
      order by expiry
    `;
    return rows.map((row) => row.expiry);
  });

  app.get<{ Params: { symbol: string }; Querystring: { expiry?: string } }>(
    "/v1/options/:symbol/chain",
    async (request) => {
      const marketId = resolveMarketId(request.params.symbol);
      const rows = await sql`
        select
          args ->> 'seriesId' as series_id,
          (args ->> 'expiry')::text as expiry,
          (args ->> 'strike')::text as strike,
          (args ->> 'optionType')::int as option_type
        from events
        where event_name = 'SeriesCreated'
          and args ->> 'underlyingMarketId' = ${marketId}
          ${request.query.expiry ? sql`and args ->> 'expiry' = ${request.query.expiry}` : sql``}
        order by strike, option_type
      `;
      return rows;
    },
  );

  /// Forwards to `services/pricing`, which prices the order and (when the request carries a `user`
  /// and pricing has a quoter key) signs the premium the chain will honour. The API adds nothing to
  /// the price — it is only the browser-reachable, CORS-controlled front door.
  async function proxyToPricing(path: string, request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
    const pricingUrl = process.env.PRICING_SERVICE_URL ?? "http://localhost:4100";
    const timeoutMs = Number(process.env.PRICING_REQUEST_TIMEOUT_MS ?? 10_000);

    let response: Response;
    try {
      response = await fetch(`${pricingUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      request.log.error({ error, pricingUrl, path }, "options quote: pricing service unreachable or timed out");
      return reply.code(504).send({ error: "pricing service unreachable or timed out" });
    }

    const body = await response.json();
    return reply.code(response.status).send(body);
  }

  /// The pricing model's volatility surface for one underlying (a GET, so `expiries` and `strikes`
  /// ride on the query string). Forwarded as is: the API adds nothing to the numbers.
  app.get<{ Params: { symbol: string }; Querystring: { expiries?: string; strikes?: string } }>(
    "/v1/options/:symbol/surface",
    async (request, reply) => {
      const pricingUrl = process.env.PRICING_SERVICE_URL ?? "http://localhost:4100";
      const timeoutMs = Number(process.env.PRICING_REQUEST_TIMEOUT_MS ?? 10_000);
      const query = new URLSearchParams({ underlying: request.params.symbol });
      for (const key of ["expiries", "strikes"] as const) {
        const value = request.query[key];
        if (value) query.set(key, value);
      }
      try {
        const response = await fetch(`${pricingUrl}/surface?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
        return reply.code(response.status).send(await response.json());
      } catch (error) {
        request.log.error({ error, pricingUrl }, "options surface: pricing service unreachable or timed out");
        return reply.code(504).send({ error: "pricing service unreachable or timed out" });
      }
    },
  );

  app.post<{ Body: unknown }>("/v1/options/quote", (request, reply) => proxyToPricing("/quote", request, reply));
  app.post<{ Body: unknown }>("/v1/options/quote/close", (request, reply) =>
    proxyToPricing("/quote/close", request, reply),
  );
}
