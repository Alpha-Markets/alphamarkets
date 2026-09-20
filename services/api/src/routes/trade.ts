import { AlphaMarketsContractError, AlphaMarketsError, type Address, type Hex, type AlphaMarkets, type PreparedTx } from "@alphamarkets/sdk";
import type { FastifyInstance, FastifyReply } from "fastify";

type Body = Record<string, unknown>;

class BadRequest extends Error {}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function bigint(body: Body, key: string): bigint {
  const value = body[key];
  if ((typeof value === "string" && /^\d+$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return BigInt(value);
  throw new BadRequest(`${key} must be a non-negative integer (a string for large values)`);
}

/// A decimal amount as an exact string. JSON numbers are accepted only when they print without an
/// exponent, so a float never sneaks into a money value.
function amount(body: Body, key: string, optional?: false): string;
function amount(body: Body, key: string, optional: true): string | undefined;
function amount(body: Body, key: string, optional = false): string | undefined {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text === "string" && /^\d+(\.\d+)?$/.test(text)) return text;
  throw new BadRequest(`${key} must be a decimal amount such as "1000.50"`);
}

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value === "string" && value.length > 0) return value;
  throw new BadRequest(`${key} is required`);
}

function side(body: Body): "LONG" | "SHORT" {
  const value = body.side;
  if (value === "LONG" || value === "SHORT") return value;
  throw new BadRequest('side must be "LONG" or "SHORT"');
}

function boundOf(body: Body) {
  const slippage = body.slippageBps;
  if (slippage !== undefined && (typeof slippage !== "number" || !Number.isInteger(slippage))) throw new BadRequest("slippageBps must be a whole number");
  return {
    worstPrice: amount(body, "worstPrice", true),
    slippageBps: slippage as number | undefined,
    deadline: body.deadline === undefined ? undefined : bigint(body, "deadline"),
  };
}

function authorizationOf(body: Body) {
  const raw = body.authorization as Body | undefined;
  if (!raw || typeof raw !== "object") throw new BadRequest("authorization (the signed quote from /v1/options/quote) is required");
  const signature = raw.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new BadRequest("authorization.signature must be a hex string");
  return { premium: bigint(raw, "premium"), validUntil: bigint(raw, "validUntil"), nonce: bigint(raw, "nonce"), signature: signature as Hex };
}

const json = (tx: PreparedTx) => ({ to: tx.to, data: tx.data, value: tx.value.toString(), chainId: tx.chainId, description: tx.description });

/// The trading API (PROJECT_BRIEF.md Section 39): every trading action as an UNSIGNED transaction,
/// for a bot, a market maker or an integrator in any language to sign with its own key. The API
/// holds no key, signs nothing and sends nothing, so the routes need no authentication and cannot
/// move money. Pass `simulate: true` with the sender as `from` to run each transaction as an
/// `eth_call` first: a revert then comes back as 422 with the contract's error name.
///
/// Amounts are exact decimal strings (`"1000.50"`), integers that can be large are strings, and
/// prices are plain decimals (`"190.25"`), the same forms `POST /v1/options/quote` uses.
export function registerTradeRoutes(app: FastifyInstance, alphaMarkets: AlphaMarkets) {
  const { trading } = alphaMarkets;

  async function respond(request: { body: unknown }, reply: FastifyReply, build: (body: Body) => Promise<PreparedTx | PreparedTx[]> | PreparedTx | PreparedTx[]) {
    const body = (request.body ?? {}) as Body;
    try {
      const built = await build(body);
      const transactions = Array.isArray(built) ? built : [built];
      if (body.simulate === true) {
        const from = body.from;
        if (typeof from !== "string" || !ADDRESS.test(from)) throw new BadRequest("simulate needs from (the sender's address)");
        // A deposit's second transaction needs the first one's allowance, so only the first can be simulated alone.
        await trading.simulate(transactions[0]!, from as Address);
      }
      return { transactions: transactions.map(json) };
    } catch (error) {
      if (error instanceof BadRequest) return reply.code(400).send({ error: error.message });
      if (error instanceof AlphaMarketsContractError) return reply.code(422).send({ error: error.errorName, message: error.message });
      if (error instanceof AlphaMarketsError) return reply.code(400).send({ error: error.message });
      request_log(error);
      throw error;
    }
  }
  const request_log = (error: unknown) => app.log.error({ error }, "trade route failed");

  app.post("/v1/trade/deposit", (request, reply) =>
    respond(request, reply, (body) => trading.prepareDeposit(amount(body, "amount"), body.token === undefined ? undefined : (text(body, "token") as Address))),
  );
  app.post("/v1/trade/withdraw", (request, reply) =>
    respond(request, reply, (body) => trading.prepareWithdraw(amount(body, "amount"), body.token === undefined ? undefined : (text(body, "token") as Address))),
  );

  app.post("/v1/trade/perps/open", (request, reply) =>
    respond(request, reply, (body) =>
      trading.prepareOpenPerp({ market: text(body, "market"), side: side(body), collateral: amount(body, "collateral"), leverage: bigint(body, "leverage"), ...boundOf(body) }),
    ),
  );
  app.post("/v1/trade/perps/increase", (request, reply) =>
    respond(request, reply, (body) =>
      trading.prepareIncreasePerp(bigint(body, "positionId"), { market: text(body, "market"), side: side(body), addCollateral: amount(body, "addCollateral", true), addSize: amount(body, "addSize"), ...boundOf(body) }),
    ),
  );
  app.post("/v1/trade/perps/reduce", (request, reply) =>
    respond(request, reply, (body) => trading.prepareReducePerp(bigint(body, "positionId"), { market: text(body, "market"), side: side(body), size: amount(body, "size"), ...boundOf(body) })),
  );
  app.post("/v1/trade/perps/close", (request, reply) =>
    respond(request, reply, (body) => trading.prepareClosePerp(bigint(body, "positionId"), { market: text(body, "market"), side: side(body), ...boundOf(body) })),
  );

  app.post("/v1/trade/perps/limit-order", (request, reply) =>
    respond(request, reply, (body) =>
      trading.preparePlaceLimitOrder({
        market: text(body, "market"),
        side: side(body),
        collateral: amount(body, "collateral"),
        leverage: bigint(body, "leverage"),
        triggerPrice: amount(body, "triggerPrice"),
        expiry: body.expiry === undefined ? undefined : bigint(body, "expiry"),
      }),
    ),
  );
  app.post("/v1/trade/perps/limit-order/cancel", (request, reply) => respond(request, reply, (body) => trading.prepareCancelLimitOrder(bigint(body, "orderId"))));
  app.post("/v1/trade/perps/limit-order/execute", (request, reply) => respond(request, reply, (body) => trading.prepareExecuteLimitOrder(bigint(body, "orderId"))));

  app.post("/v1/trade/perps/trigger-order", (request, reply) =>
    respond(request, reply, (body) => {
      const kind = body.kind;
      if (kind !== "STOP_LOSS" && kind !== "TAKE_PROFIT") throw new BadRequest('kind must be "STOP_LOSS" or "TAKE_PROFIT"');
      return trading.preparePlaceTriggerOrder({ positionId: bigint(body, "positionId"), kind, triggerPrice: amount(body, "triggerPrice"), expiry: body.expiry === undefined ? undefined : bigint(body, "expiry") });
    }),
  );
  app.post("/v1/trade/perps/trigger-order/cancel", (request, reply) => respond(request, reply, (body) => trading.prepareCancelTriggerOrder(bigint(body, "orderId"))));
  app.post("/v1/trade/perps/trigger-order/execute", (request, reply) => respond(request, reply, (body) => trading.prepareExecuteTriggerOrder(bigint(body, "orderId"))));

  app.post("/v1/trade/perps/rfq/execute", (request, reply) =>
    respond(request, reply, (body) => {
      const user = text(body, "user");
      if (!ADDRESS.test(user)) throw new BadRequest("user must be an address");
      const signature = body.signature;
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new BadRequest("signature must be a hex string");
      return trading.prepareExecuteRfq({
        user: user as Address,
        market: text(body, "market"),
        side: side(body),
        // Base units, as the maker signed them: the chain hashes exactly these numbers.
        collateral: bigint(body, "collateral"),
        leverage: bigint(body, "leverage"),
        price: bigint(body, "price"),
        validUntil: bigint(body, "validUntil"),
        nonce: bigint(body, "nonce"),
        signature: signature as Hex,
      });
    }),
  );

  app.post("/v1/trade/options/open", (request, reply) =>
    respond(request, reply, (body) => {
      const type = body.type;
      if (type !== "CALL" && type !== "PUT") throw new BadRequest('type must be "CALL" or "PUT"');
      return trading.prepareOpenOption({
        underlying: text(body, "underlying"),
        type,
        strike: amount(body, "strike"),
        expiry: bigint(body, "expiry"),
        contracts: bigint(body, "contracts"),
        authorization: authorizationOf(body),
        deadline: body.deadline === undefined ? undefined : bigint(body, "deadline"),
      });
    }),
  );
  app.post("/v1/trade/options/close", (request, reply) =>
    respond(request, reply, (body) =>
      trading.prepareCloseOption({ positionId: bigint(body, "positionId"), authorization: authorizationOf(body), deadline: body.deadline === undefined ? undefined : bigint(body, "deadline") }),
    ),
  );
}
