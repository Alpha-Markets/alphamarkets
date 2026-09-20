import type { ContractAddresses } from "@alphamarkets/config";
import type { Address, Hex, MarketConfig } from "@alphamarkets/types";
import { perpOrderManagerAbi, perpPositionManagerAbi, perpsEngineAbi, vaultAbi } from "./abis.js";
import {
  readOrder,
  readOrderRange,
  readTriggerOrder,
  readTriggerOrderRange,
  readUserOrders,
  readUserTriggerOrders,
  requireOrderManager,
  TRIGGER_KINDS,
  type OpenOrder,
  type TriggerKind,
  type TriggerOrder,
} from "./orders.js";
import { PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { AlphaMarketsClient } from "./client.js";
import { NotImplementedError, AlphaMarketsError, type AlphaMarketsContractError } from "./errors.js";
import type { FeesNamespace } from "./fees.js";
import type { FundingInfo, FundingNamespace } from "./funding.js";
import { applyBps, feeFromBps, liquidationPrice } from "./math.js";
import type { MarketsNamespace } from "./markets.js";
import type { OracleNamespace } from "./oracle.js";
import { collectRiskViolations, type RiskInfo, type RiskNamespace } from "./risk.js";
import { executeTx, type TxOptions } from "./transactions.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

export type Side = "LONG" | "SHORT";
/// `MARKET` fills at the current mark price within a slippage bound. `LIMIT` rests until the mark
/// price reaches the trigger: {@link PerpsNamespace.placeLimitOrder} places one, and
/// {@link PerpsNamespace.previewOpen} previews it when given `orderType: "LIMIT"` and `limitPrice`.
export type OrderType = "MARKET" | "LIMIT";

/// Default worst-case entry/exit slippage when the caller supplies neither `slippageBps` nor
/// `worstPrice`.
export const DEFAULT_SLIPPAGE_BPS = 50;

interface PriceBound {
  /// Worst acceptable fill price as a decimal string or an 18-decimal base-unit `bigint`. When
  /// omitted it is derived from the current mark price and `slippageBps`.
  worstPrice?: Amount;
  slippageBps?: number;
  /// Unix seconds, `Date`, or ISO string. Defaults to five minutes from now.
  deadline?: bigint | Date | string;
  tx?: TxOptions;
}

export interface OpenPerpPositionParams extends PriceBound {
  /// Symbol ("NVDA"), market label ("NVDA-PERP"), or bytes32 market id.
  market: string;
  side: Side;
  /// Margin posted, in settlement-token units: decimal string (`"1000"`) or base-unit `bigint`.
  collateral: Amount;
  /// Whole-number leverage multiple (1, 2, 3, 5, 10 for the MVP tiers). Validated onchain
  /// against the per-market tiers in RiskManager, never in this SDK.
  leverage: number | bigint;
  orderType?: OrderType;
  /// `ISOLATED` (default): the position is backed only by its own margin. `CROSS`: it is backed by
  /// the whole account (free balance, other cross positions, other collateral) and is liquidated when
  /// the account's equity falls under its requirement. Needs a deployment with `CrossMarginManager`.
  marginMode?: "ISOLATED" | "CROSS";
  /// The trigger price of a `LIMIT` order (decimal string or 18-decimal `bigint`): a long fills at
  /// or below it, a short at or above it. Required by `previewOpen` for `LIMIT`; ignored for
  /// `MARKET`.
  limitPrice?: Amount;
}

export interface PlaceLimitOrderParams {
  market: string;
  side: Side;
  collateral: Amount;
  leverage: number | bigint;
  /// Trigger price: a long fills at or below it, a short at or above it.
  limitPrice: Amount;
  /// Unix seconds, `Date` or ISO string after which the order can no longer fill. Defaults to 24
  /// hours from now.
  expiry?: bigint | Date | string;
  tx?: TxOptions;
}

export interface PlaceTriggerOrderParams {
  positionId: bigint;
  kind: TriggerKind;
  /// Mark price that fires the order. For a long a stop-loss must sit below the current mark and a
  /// take-profit above it; a short is the mirror image. A trigger already reached is rejected.
  triggerPrice: Amount;
  /// Unix seconds, `Date` or ISO string after which the order can no longer fire. Defaults to 30
  /// days from now.
  expiry?: bigint | Date | string;
  tx?: TxOptions;
}

export interface IncreasePerpPositionParams extends PriceBound {
  addCollateral?: Amount;
  /// Notional to add, in settlement-token units.
  addSize: Amount;
}

export interface ReducePerpPositionParams extends PriceBound {
  /// Notional to remove, in settlement-token units.
  size: Amount;
}

export type ClosePerpPositionParams = PriceBound;

export interface PerpOpenPreview {
  marketId: Hex;
  side: Side;
  indexPrice: bigint;
  /// Price the position would enter at if sent now (OracleRouter mark price, 18 decimals).
  entryPrice: bigint;
  /// Worst price the transaction will accept, as `open` would submit it.
  worstPrice: bigint;
  collateral: bigint;
  leverage: bigint;
  /// `collateral * leverage`, settlement-token units.
  notional: bigint;
  fee: bigint;
  feeBps: bigint;
  /// `collateral + fee` — what must be available in the Vault.
  totalRequired: bigint;
  maintenanceMarginRateBps: bigint;
  liquidationPrice: bigint;
  fundingRateBps: bigint;
  nextFundingTimestamp: bigint;
  /// Present only when `user` was passed.
  availableBalance?: bigint;
  sufficientCollateral?: boolean;
  /// Onchain rules this order would currently break (leverage tier, position cap, open-interest
  /// cap, paused market), decoded from RiskManager's own view functions. Empty means the order
  /// would pass those checks now.
  violations: AlphaMarketsContractError[];
}

export interface PerpMarketInfo {
  market: MarketConfig;
  risk: RiskInfo;
  funding: FundingInfo;
  indexPrice: bigint;
  markPrice: bigint;
  lastPrice: bigint;
}

export interface PerpsNamespace {
  /// Every active market with perps enabled, from MarketRegistry.
  list(): Promise<MarketConfig[]>;
  get(market: string): Promise<PerpMarketInfo>;
  funding(market: string): Promise<FundingInfo>;
  /// Everything PROJECT_BRIEF.md Section 45 requires before signing a perp order, computed at
  /// the current mark price. Pass `user` to also check the Vault balance.
  previewOpen(params: OpenPerpPositionParams & { user?: Address }): Promise<PerpOpenPreview>;
  openPosition(params: OpenPerpPositionParams): Promise<{ hash: Hex; positionId: bigint }>;
  /// Places a resting order to open a position once the mark price reaches `limitPrice`. Nothing is
  /// reserved in the Vault: margin and the taker fee are taken when it fills, so it cannot fill if
  /// the balance is gone by then. Anyone can fill it (`executeLimitOrder`), and its owner can
  /// cancel it. Needs a deployment with a `PerpOrderManager`.
  placeLimitOrder(params: PlaceLimitOrderParams): Promise<{ hash: Hex; orderId: bigint }>;
  cancelLimitOrder(orderId: bigint, tx?: TxOptions): Promise<Hex>;
  /// Fills an open order whose trigger has been reached (a keeper does this). Reverts with
  /// `LimitPriceNotReachedError` before then.
  executeLimitOrder(orderId: bigint, tx?: TxOptions): Promise<{ hash: Hex; positionId: bigint }>;
  getOrder(orderId: bigint): Promise<OpenOrder>;
  /// Every order the user placed, oldest first.
  orders(user: Address): Promise<OpenOrder[]>;
  /// Orders with ids from `fromId` up to the newest, for a keeper scanning the book.
  scanOrders(fromId?: bigint): Promise<OpenOrder[]>;
  /// Attaches a stop-loss or take-profit to an open position. When the mark price reaches the
  /// trigger anyone can fire it (`executeTriggerOrder`) and the whole remaining position closes at
  /// the mark price, which can be worse than the trigger if the price gapped. Its owner can cancel
  /// it. An order left on a position that closed another way can never fire. Needs a deployment
  /// with trigger orders (`[1.3.0]` or later).
  placeTriggerOrder(params: PlaceTriggerOrderParams): Promise<{ hash: Hex; orderId: bigint }>;
  cancelTriggerOrder(orderId: bigint, tx?: TxOptions): Promise<Hex>;
  /// Whether the deployment has trigger orders. The record of a deployment made before `[1.3.0]`
  /// has a `PerpOrderManager` (limit orders) without them, and the trigger methods fail there;
  /// call this first to hide or skip them. A failed probe (for example an unreachable RPC) reads as
  /// `false` and is retried on the next call.
  supportsTriggerOrders(): Promise<boolean>;
  /// Closes the position of an open trigger order whose trigger has been reached (a keeper does
  /// this). Reverts with `TriggerPriceNotReachedError` before then.
  executeTriggerOrder(orderId: bigint, tx?: TxOptions): Promise<Hex>;
  getTriggerOrder(orderId: bigint): Promise<TriggerOrder>;
  /// Every trigger order the user placed, oldest first.
  triggerOrders(user: Address): Promise<TriggerOrder[]>;
  /// Trigger orders with ids from `fromId` up to the newest, for a keeper scanning the book.
  scanTriggerOrders(fromId?: bigint): Promise<TriggerOrder[]>;
  increasePosition(positionId: bigint, params: IncreasePerpPositionParams): Promise<Hex>;
  reducePosition(positionId: bigint, params: ReducePerpPositionParams): Promise<Hex>;
  closePosition(positionId: bigint, params: ClosePerpPositionParams): Promise<Hex>;
}

export interface PerpsDeps {
  client: AlphaMarketsClient;
  addresses: ContractAddresses;
  decimals: (token: Address) => Promise<number>;
  markets: MarketsNamespace;
  oracle: OracleNamespace;
  risk: RiskNamespace;
  fees: FeesNamespace;
  funding: FundingNamespace;
}

export function createPerps(deps: PerpsDeps): PerpsNamespace {
  const { client, addresses, decimals, markets, oracle, risk, fees, funding } = deps;

  /// `openPosition` opens at the current price; a resting order is a different call with a
  /// different result (an order id, not a position id).
  function assertMarketOrder(orderType: OrderType | undefined, method: string) {
    if (orderType === "LIMIT") {
      throw new AlphaMarketsError(`${method}: a LIMIT order rests until its trigger, so use perps.placeLimitOrder`);
    }
  }

  function settlementDecimals() {
    return decimals(addresses.settlementToken);
  }

  /// Entry (long: cap above, short: floor below) or exit (the reverse) price bound.
  async function priceBound(bound: PriceBound, isLong: boolean, isEntry: boolean, marketId: Hex): Promise<bigint> {
    if (bound.worstPrice !== undefined) return toBaseUnits(bound.worstPrice, PRICE_DECIMALS);
    const { price } = await oracle.getMarkPrice(marketId);
    const slippage = BigInt(bound.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    // Entry: a long pays at most mark+slippage, a short receives at least mark-slippage.
    // Exit is the mirror image.
    const widenUp = isEntry === isLong;
    return applyBps(price, widenUp ? slippage : -slippage);
  }

  function deadlineOf(bound: PriceBound): bigint {
    return bound.deadline === undefined ? defaultDeadline() : toUnixSeconds(bound.deadline);
  }

  async function list() {
    const all = await markets.list();
    return all.filter((market) => market.active && market.perpsEnabled);
  }

  async function get(market: string): Promise<PerpMarketInfo> {
    const marketId = resolveMarketId(market);
    const [config, riskInfo, fundingInfo, index, mark, last] = await Promise.all([
      markets.get(marketId),
      risk.get(marketId),
      funding.get(marketId),
      oracle.getIndexPrice(marketId),
      oracle.getMarkPrice(marketId),
      oracle.getLastPrice(marketId),
    ]);
    return {
      market: config,
      risk: riskInfo,
      funding: fundingInfo,
      indexPrice: index.price,
      markPrice: mark.price,
      lastPrice: last.price,
    };
  }

  async function previewOpen(params: OpenPerpPositionParams & { user?: Address }): Promise<PerpOpenPreview> {
    const isLimit = params.orderType === "LIMIT";
    if (isLimit && params.limitPrice === undefined) {
      throw new AlphaMarketsError("perps.previewOpen: a LIMIT order needs a limitPrice");
    }

    const marketId = resolveMarketId(params.market);
    const isLong = params.side === "LONG";
    const leverage = toInteger(params.leverage, "leverage");
    const collateral = toBaseUnits(params.collateral, await settlementDecimals());
    const notional = collateral * leverage;

    const [index, mark, riskInfo, feeInfo, fundingInfo] = await Promise.all([
      oracle.getIndexPrice(marketId),
      oracle.getMarkPrice(marketId),
      risk.get(marketId),
      fees.get(marketId),
      funding.get(marketId),
    ]);

    const fee = feeFromBps(notional, feeInfo.takerFee);
    const totalRequired = collateral + fee;
    const [violations, worstPrice, availableBalance] = await Promise.all([
      collectRiskViolations(client, addresses, markets, { marketId, isLong, leverage, notional, needs: "perps" }),
      priceBound(params, isLong, true, marketId),
      params.user
        ? client.readContract({
            address: addresses.vault,
            abi: vaultAbi,
            functionName: "availableBalance",
            args: [params.user, addresses.settlementToken],
          })
        : Promise.resolve(undefined),
    ]);

    // A limit order's figures are worked out at its trigger, the price it fills at or better than.
    const entryPrice = isLimit ? toBaseUnits(params.limitPrice!, PRICE_DECIMALS) : mark.price;

    return {
      marketId,
      side: params.side,
      indexPrice: index.price,
      entryPrice,
      worstPrice,
      collateral,
      leverage,
      notional,
      fee,
      feeBps: feeInfo.takerFee,
      totalRequired,
      maintenanceMarginRateBps: riskInfo.maintenanceMarginRateBps,
      liquidationPrice: liquidationPrice(isLong, entryPrice, collateral, notional, riskInfo.maintenanceMarginRateBps),
      fundingRateBps: fundingInfo.currentFundingRateBps,
      nextFundingTimestamp: fundingInfo.nextFundingTimestamp,
      availableBalance,
      sufficientCollateral: availableBalance === undefined ? undefined : availableBalance >= totalRequired,
      violations,
    };
  }

  async function openPosition(params: OpenPerpPositionParams) {
    assertMarketOrder(params.orderType, "perps.openPosition");

    const marketId = resolveMarketId(params.market);
    const isLong = params.side === "LONG";
    const collateral = toBaseUnits(params.collateral, await settlementDecimals());
    const leverage = toInteger(params.leverage, "leverage");
    const worstPrice = await priceBound(params, isLong, true, marketId);
    const deadline = deadlineOf(params);

    if (params.marginMode === "CROSS" && !addresses.crossMargin) {
      throw new NotImplementedError("perps.openPosition", "cross margin needs a deployment with a CrossMarginManager (made after [1.3.0])");
    }
    const functionName = params.marginMode === "CROSS" ? "openPositionCross" : "openPosition";

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName,
          args: [marketId, isLong, collateral, leverage, worstPrice, deadline],
        }),
      params.tx,
    );
    return { hash, positionId: result };
  }

  async function placeLimitOrder(params: PlaceLimitOrderParams) {
    requireOrderManager(addresses, "perps.placeLimitOrder");
    const marketId = resolveMarketId(params.market);
    const collateral = toBaseUnits(params.collateral, await settlementDecimals());
    const leverage = toInteger(params.leverage, "leverage");
    const triggerPrice = toBaseUnits(params.limitPrice, PRICE_DECIMALS);
    const expiry = params.expiry === undefined ? BigInt(Math.floor(Date.now() / 1000) + 86_400) : toUnixSeconds(params.expiry);

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "placeLimitOrder",
          args: [marketId, params.side === "LONG", collateral, leverage, triggerPrice, expiry],
        }),
      params.tx,
    );
    return { hash, orderId: result };
  }

  async function cancelLimitOrder(orderId: bigint, tx?: TxOptions) {
    const { hash } = await executeTx(
      client,
      () => client.simulateContract({ address: addresses.perpsEngine, abi: perpsEngineAbi, functionName: "cancelLimitOrder", args: [orderId] }),
      tx,
    );
    return hash;
  }

  async function executeLimitOrder(orderId: bigint, tx?: TxOptions) {
    const { hash, result } = await executeTx(
      client,
      () => client.simulateContract({ address: addresses.perpsEngine, abi: perpsEngineAbi, functionName: "executeLimitOrder", args: [orderId] }),
      tx,
    );
    return { hash, positionId: result };
  }

  let triggerSupport = false;
  async function supportsTriggerOrders(): Promise<boolean> {
    if (triggerSupport) return true;
    if (!addresses.perpOrderManager) return false;
    try {
      await client.readContract({ address: addresses.perpOrderManager, abi: perpOrderManagerAbi, functionName: "nextTriggerOrderId" });
      triggerSupport = true;
    } catch {
      return false;
    }
    return true;
  }

  async function placeTriggerOrder(params: PlaceTriggerOrderParams) {
    requireOrderManager(addresses, "perps.placeTriggerOrder");
    if (!(await supportsTriggerOrders())) {
      throw new NotImplementedError("perps.placeTriggerOrder", "this deployment has no trigger orders (they need a deployment made after [1.3.0])");
    }
    const kind = TRIGGER_KINDS.indexOf(params.kind);
    if (kind < 0) throw new AlphaMarketsError(`perps.placeTriggerOrder: unknown kind ${String(params.kind)}`);
    const triggerPrice = toBaseUnits(params.triggerPrice, PRICE_DECIMALS);
    const expiry = params.expiry === undefined ? BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400) : toUnixSeconds(params.expiry);

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "placeTriggerOrder",
          args: [params.positionId, kind, triggerPrice, expiry],
        }),
      params.tx,
    );
    return { hash, orderId: result };
  }

  async function cancelTriggerOrder(orderId: bigint, tx?: TxOptions) {
    const { hash } = await executeTx(
      client,
      () => client.simulateContract({ address: addresses.perpsEngine, abi: perpsEngineAbi, functionName: "cancelTriggerOrder", args: [orderId] }),
      tx,
    );
    return hash;
  }

  async function executeTriggerOrder(orderId: bigint, tx?: TxOptions) {
    const { hash } = await executeTx(
      client,
      () => client.simulateContract({ address: addresses.perpsEngine, abi: perpsEngineAbi, functionName: "executeTriggerOrder", args: [orderId] }),
      tx,
    );
    return hash;
  }

  async function positionMarket(positionId: bigint): Promise<{ isLong: boolean; marketId: Hex }> {
    const position = await client.readContract({
      address: addresses.perpPositionManager,
      abi: perpPositionManagerAbi,
      functionName: "getPosition",
      args: [positionId],
    });
    return { isLong: position.isLong, marketId: position.marketId };
  }

  async function increasePosition(positionId: bigint, params: IncreasePerpPositionParams) {
    const tokenDecimals = await settlementDecimals();
    const { isLong, marketId } = await positionMarket(positionId);
    const addCollateral = toBaseUnits(params.addCollateral ?? 0n, tokenDecimals);
    const addSize = toBaseUnits(params.addSize, tokenDecimals);
    const worstPrice = await priceBound(params, isLong, true, marketId);
    const deadline = deadlineOf(params);

    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "increasePosition",
          args: [positionId, addCollateral, addSize, worstPrice, deadline],
        }),
      params.tx,
    );
    return hash;
  }

  async function reducePosition(positionId: bigint, params: ReducePerpPositionParams) {
    const sizeDelta = toBaseUnits(params.size, await settlementDecimals());
    const { isLong, marketId } = await positionMarket(positionId);
    const worstPrice = await priceBound(params, isLong, false, marketId);
    const deadline = deadlineOf(params);

    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "reducePosition",
          args: [positionId, sizeDelta, worstPrice, deadline],
        }),
      params.tx,
    );
    return hash;
  }

  async function closePosition(positionId: bigint, params: ClosePerpPositionParams = {}) {
    const { isLong, marketId } = await positionMarket(positionId);
    const worstPrice = await priceBound(params, isLong, false, marketId);
    const deadline = deadlineOf(params);

    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "closePosition",
          args: [positionId, worstPrice, deadline],
        }),
      params.tx,
    );
    return hash;
  }

  return {
    list,
    get,
    funding: (market) => funding.get(market),
    previewOpen,
    openPosition,
    placeLimitOrder,
    cancelLimitOrder,
    executeLimitOrder,
    getOrder: (orderId) => readOrder(client, addresses, orderId),
    orders: (user) => readUserOrders(client, addresses, user),
    scanOrders: (fromId = 1n) => readOrderRange(client, addresses, fromId),
    placeTriggerOrder,
    cancelTriggerOrder,
    supportsTriggerOrders,
    executeTriggerOrder,
    getTriggerOrder: (orderId) => readTriggerOrder(client, addresses, orderId),
    triggerOrders: (user) => readUserTriggerOrders(client, addresses, user),
    scanTriggerOrders: (fromId = 1n) => readTriggerOrderRange(client, addresses, fromId),
    increasePosition,
    reducePosition,
    closePosition,
  };
}
