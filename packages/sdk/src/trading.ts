import type { ContractAddresses } from "@alphamarkets/config";
import { OptionType, type Address, type Hex } from "@alphamarkets/types";
import { encodeFunctionData } from "viem";
import { erc20Abi, optionsEngineAbi, perpsEngineAbi, rfqManagerAbi, vaultAbi } from "./abis.js";
import { PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { AlphaMarketsClient } from "./client.js";
import { mapError, AlphaMarketsError } from "./errors.js";
import { applyBps } from "./math.js";
import type { OracleNamespace } from "./oracle.js";
import type { TriggerKind } from "./orders.js";
import { TRIGGER_KINDS } from "./orders.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

/// The trading API (PROJECT_BRIEF.md Section 39): builds UNSIGNED transactions for every trading
/// action, so a bot, a market maker or an integrator in any language can sign them with its own
/// key and send them. Nothing here signs, holds a key or sends anything: `services/api` exposes it
/// as `POST /v1/trade/...`, and the SDK's own methods (`perps.openPosition`, ...) stay the way to
/// send a transaction from TypeScript.
///
/// A prepared transaction is only calldata. Before it is signed, `simulate` runs it as an `eth_call`
/// from the sender and turns a revert into the typed error the contract raised.

export interface PreparedTx {
  to: Address;
  data: Hex;
  /// Always 0: the protocol takes no native currency.
  value: bigint;
  chainId: number;
  /// One line saying what the transaction does, for a person or a log.
  description: string;
}

export interface PerpBound {
  /// Worst acceptable price: an upper bound for a buy, a lower bound for a sell. Takes precedence.
  worstPrice?: Amount;
  /// Distance from the current mark price, in basis points, when no `worstPrice` is given.
  /// Defaults to 50 (0.5%).
  slippageBps?: number;
  /// Unix seconds, `Date` or ISO string. Defaults to five minutes from now.
  deadline?: bigint | Date | string;
}

export interface PrepareOpenPerp extends PerpBound {
  market: string;
  side: "LONG" | "SHORT";
  collateral: Amount;
  leverage: number | bigint;
}

export interface PrepareLimitOrder {
  market: string;
  side: "LONG" | "SHORT";
  collateral: Amount;
  leverage: number | bigint;
  triggerPrice: Amount;
  /// Defaults to 24 hours from now.
  expiry?: bigint | Date | string;
}

export interface PrepareTriggerOrder {
  positionId: bigint;
  kind: TriggerKind;
  triggerPrice: Amount;
  /// Defaults to 30 days from now.
  expiry?: bigint | Date | string;
}

export interface PrepareOptionOpen {
  underlying: string;
  type: "CALL" | "PUT";
  strike: Amount;
  expiry: bigint | Date | string;
  contracts: number | bigint;
  /// From `options.quote({ user })`: the signed premium the chain will honour, for that user only.
  authorization: { premium: bigint; validUntil: bigint; nonce: bigint; signature: Hex };
  deadline?: bigint | Date | string;
}

export interface PrepareOptionClose {
  positionId: bigint;
  /// From `options.quoteClose`.
  authorization: { premium: bigint; validUntil: bigint; nonce: bigint; signature: Hex };
  deadline?: bigint | Date | string;
}

export interface PrepareExecuteRfq {
  user: Address;
  market: string;
  side: "LONG" | "SHORT";
  /// Settlement-token base units.
  collateral: bigint;
  leverage: number | bigint;
  /// 18 decimals.
  price: bigint;
  validUntil: bigint;
  nonce: bigint;
  /// The maker's EIP-712 signature over the quote.
  signature: Hex;
}

export interface TradingNamespace {
  /// Opens the quoted position at a market maker's signed price (`RFQManager.execute`). Sent from the
  /// quote's user. Needs a deployment with an RFQManager.
  prepareExecuteRfq(quote: PrepareExecuteRfq): PreparedTx;
  /// `approve` then `deposit`: the vault pulls the tokens, so it needs an allowance first. Send
  /// them in order.
  prepareDeposit(amount: Amount, token?: Address): Promise<[PreparedTx, PreparedTx]>;
  prepareWithdraw(amount: Amount, token?: Address): Promise<PreparedTx>;
  prepareOpenPerp(params: PrepareOpenPerp): Promise<PreparedTx>;
  prepareIncreasePerp(positionId: bigint, params: PerpBound & { addCollateral?: Amount; addSize: Amount; side: "LONG" | "SHORT"; market: string }): Promise<PreparedTx>;
  prepareReducePerp(positionId: bigint, params: PerpBound & { size: Amount; side: "LONG" | "SHORT"; market: string }): Promise<PreparedTx>;
  prepareClosePerp(positionId: bigint, params: PerpBound & { side: "LONG" | "SHORT"; market: string }): Promise<PreparedTx>;
  preparePlaceLimitOrder(params: PrepareLimitOrder): Promise<PreparedTx>;
  prepareCancelLimitOrder(orderId: bigint): PreparedTx;
  prepareExecuteLimitOrder(orderId: bigint): PreparedTx;
  preparePlaceTriggerOrder(params: PrepareTriggerOrder): PreparedTx;
  prepareCancelTriggerOrder(orderId: bigint): PreparedTx;
  prepareExecuteTriggerOrder(orderId: bigint): PreparedTx;
  prepareOpenOption(params: PrepareOptionOpen): PreparedTx;
  prepareCloseOption(params: PrepareOptionClose): PreparedTx;
  /// Runs a prepared transaction as an `eth_call` from `from` and returns nothing on success. A
  /// revert throws the typed error the contract raised (`InsufficientMarginError`, ...), so a bot
  /// learns why before it pays gas.
  simulate(tx: PreparedTx, from: Address): Promise<void>;
}

export interface TradingDeps {
  client: AlphaMarketsClient;
  addresses: ContractAddresses;
  chainId: number;
  decimals: (token: Address) => Promise<number>;
  oracle: OracleNamespace;
}

const DEFAULT_SLIPPAGE_BPS = 50;

export function createTrading(deps: TradingDeps): TradingNamespace {
  const { client, addresses, chainId, decimals, oracle } = deps;

  function tx(to: Address, data: Hex, description: string): PreparedTx {
    return { to, data, value: 0n, chainId, description };
  }

  const settlementDecimals = () => decimals(addresses.settlementToken);
  const deadlineOf = (deadline?: bigint | Date | string) => (deadline === undefined ? defaultDeadline() : toUnixSeconds(deadline));

  /// Entry: a long pays at most mark+slippage, a short receives at least mark-slippage. Exit is the
  /// mirror image.
  async function bound(params: PerpBound, isLong: boolean, isEntry: boolean, marketId: Hex): Promise<bigint> {
    if (params.worstPrice !== undefined) return toBaseUnits(params.worstPrice, PRICE_DECIMALS);
    const slippage = BigInt(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    if (slippage < 0n || slippage >= 10_000n) throw new AlphaMarketsError("trading: slippageBps must be between 0 and 9999");
    const { price } = await oracle.getMarkPrice(marketId);
    return applyBps(price, isEntry === isLong ? slippage : -slippage);
  }

  const sideOf = (side: "LONG" | "SHORT") => {
    if (side !== "LONG" && side !== "SHORT") throw new AlphaMarketsError(`trading: side must be "LONG" or "SHORT", received "${String(side)}"`);
    return side === "LONG";
  };

  function optionTypeOf(type: "CALL" | "PUT"): OptionType {
    if (type !== "CALL" && type !== "PUT") throw new AlphaMarketsError(`trading: option type must be "CALL" or "PUT", received "${String(type)}"`);
    return type === "CALL" ? OptionType.CALL : OptionType.PUT;
  }

  const quoteStruct = (a: { validUntil: bigint; nonce: bigint; signature: Hex }) => ({ validUntil: a.validUntil, nonce: a.nonce, signature: a.signature });

  return {
    async prepareDeposit(amount, token = addresses.settlementToken) {
      const value = toBaseUnits(amount, await decimals(token));
      return [
        tx(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addresses.vault, value] }), `approve the vault to pull ${value} base units`),
        tx(addresses.vault, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [token, value] }), `deposit ${value} base units`),
      ];
    },

    async prepareWithdraw(amount, token = addresses.settlementToken) {
      const value = toBaseUnits(amount, await decimals(token));
      return tx(addresses.vault, encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [token, value] }), `withdraw ${value} base units`);
    },

    async prepareOpenPerp(params) {
      const marketId = resolveMarketId(params.market);
      const isLong = sideOf(params.side);
      const collateral = toBaseUnits(params.collateral, await settlementDecimals());
      const leverage = toInteger(params.leverage, "leverage");
      const worst = await bound(params, isLong, true, marketId);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({ abi: perpsEngineAbi, functionName: "openPosition", args: [marketId, isLong, collateral, leverage, worst, deadlineOf(params.deadline)] }),
        `open a ${params.side.toLowerCase()} ${params.market} perp at ${leverage}x with ${collateral} base units of margin`,
      );
    },

    async prepareIncreasePerp(positionId, params) {
      const marketId = resolveMarketId(params.market);
      const isLong = sideOf(params.side);
      const digits = await settlementDecimals();
      const addCollateral = params.addCollateral === undefined ? 0n : toBaseUnits(params.addCollateral, digits);
      const addSize = toBaseUnits(params.addSize, digits);
      const worst = await bound(params, isLong, true, marketId);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({ abi: perpsEngineAbi, functionName: "increasePosition", args: [positionId, addCollateral, addSize, worst, deadlineOf(params.deadline)] }),
        `increase perp position ${positionId} by ${addSize} of size`,
      );
    },

    async prepareReducePerp(positionId, params) {
      const marketId = resolveMarketId(params.market);
      const isLong = sideOf(params.side);
      const size = toBaseUnits(params.size, await settlementDecimals());
      const worst = await bound(params, isLong, false, marketId);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({ abi: perpsEngineAbi, functionName: "reducePosition", args: [positionId, size, worst, deadlineOf(params.deadline)] }),
        `reduce perp position ${positionId} by ${size} of size`,
      );
    },

    async prepareClosePerp(positionId, params) {
      const marketId = resolveMarketId(params.market);
      const isLong = sideOf(params.side);
      const worst = await bound(params, isLong, false, marketId);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({ abi: perpsEngineAbi, functionName: "closePosition", args: [positionId, worst, deadlineOf(params.deadline)] }),
        `close perp position ${positionId}`,
      );
    },

    async preparePlaceLimitOrder(params) {
      const marketId = resolveMarketId(params.market);
      const collateral = toBaseUnits(params.collateral, await settlementDecimals());
      const expiry = params.expiry === undefined ? BigInt(Math.floor(Date.now() / 1000) + 86_400) : toUnixSeconds(params.expiry);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({
          abi: perpsEngineAbi,
          functionName: "placeLimitOrder",
          args: [marketId, sideOf(params.side), collateral, toInteger(params.leverage, "leverage"), toBaseUnits(params.triggerPrice, PRICE_DECIMALS), expiry],
        }),
        `place a ${params.side.toLowerCase()} limit order on ${params.market}`,
      );
    },

    prepareCancelLimitOrder: (orderId) => tx(addresses.perpsEngine, encodeFunctionData({ abi: perpsEngineAbi, functionName: "cancelLimitOrder", args: [orderId] }), `cancel limit order ${orderId}`),
    prepareExecuteLimitOrder: (orderId) => tx(addresses.perpsEngine, encodeFunctionData({ abi: perpsEngineAbi, functionName: "executeLimitOrder", args: [orderId] }), `fill limit order ${orderId}`),

    preparePlaceTriggerOrder(params) {
      const kind = TRIGGER_KINDS.indexOf(params.kind);
      if (kind < 0) throw new AlphaMarketsError(`trading: unknown trigger kind ${String(params.kind)}`);
      const expiry = params.expiry === undefined ? BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400) : toUnixSeconds(params.expiry);
      return tx(
        addresses.perpsEngine,
        encodeFunctionData({ abi: perpsEngineAbi, functionName: "placeTriggerOrder", args: [params.positionId, kind, toBaseUnits(params.triggerPrice, PRICE_DECIMALS), expiry] }),
        `place a ${params.kind.toLowerCase().replace("_", "-")} on position ${params.positionId}`,
      );
    },

    prepareCancelTriggerOrder: (orderId) => tx(addresses.perpsEngine, encodeFunctionData({ abi: perpsEngineAbi, functionName: "cancelTriggerOrder", args: [orderId] }), `cancel trigger order ${orderId}`),
    prepareExecuteTriggerOrder: (orderId) => tx(addresses.perpsEngine, encodeFunctionData({ abi: perpsEngineAbi, functionName: "executeTriggerOrder", args: [orderId] }), `fire trigger order ${orderId}`),

    prepareExecuteRfq(quote) {
      if (!addresses.rfqManager) throw new AlphaMarketsError("trading: this deployment has no RFQManager (it needs a deployment made after [1.3.0])");
      return tx(
        addresses.rfqManager,
        encodeFunctionData({
          abi: rfqManagerAbi,
          functionName: "execute",
          args: [
            {
              user: quote.user,
              marketId: resolveMarketId(quote.market),
              isLong: sideOf(quote.side),
              collateral: quote.collateral,
              leverage: toInteger(quote.leverage, "leverage"),
              price: quote.price,
              validUntil: quote.validUntil,
              nonce: quote.nonce,
            },
            quote.signature,
          ],
        }),
        `open a ${quote.side.toLowerCase()} ${quote.market} position at the quoted price`,
      );
    },

    prepareOpenOption(params) {
      const args = {
        marketId: resolveMarketId(params.underlying),
        optionType: optionTypeOf(params.type),
        strike: toBaseUnits(params.strike, PRICE_DECIMALS),
        expiry: toUnixSeconds(params.expiry),
        contracts: toInteger(params.contracts, "contracts"),
        premium: params.authorization.premium,
        deadline: deadlineOf(params.deadline),
      };
      return tx(
        addresses.optionsEngine,
        encodeFunctionData({ abi: optionsEngineAbi, functionName: "openPosition", args: [args, quoteStruct(params.authorization)] }),
        `open ${args.contracts} ${params.type.toLowerCase()} contract(s) on ${params.underlying}`,
      );
    },

    prepareCloseOption(params) {
      return tx(
        addresses.optionsEngine,
        encodeFunctionData({
          abi: optionsEngineAbi,
          functionName: "closePosition",
          args: [params.positionId, params.authorization.premium, deadlineOf(params.deadline), quoteStruct(params.authorization)],
        }),
        `close option position ${params.positionId}`,
      );
    },

    async simulate(prepared, from) {
      try {
        await client.call({ account: from, to: prepared.to, data: prepared.data });
      } catch (error) {
        throw mapError(error);
      }
    },
  };
}
