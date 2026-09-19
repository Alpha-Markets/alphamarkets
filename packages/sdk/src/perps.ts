import type { ContractAddresses } from "@orionis/config";
import type { Address, Hex, MarketConfig } from "@orionis/types";
import { perpPositionManagerAbi, perpsEngineAbi, vaultAbi } from "./abis.js";
import { PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError, type OrionisContractError } from "./errors.js";
import type { FeesNamespace } from "./fees.js";
import type { FundingInfo, FundingNamespace } from "./funding.js";
import { applyBps, feeFromBps, liquidationPrice } from "./math.js";
import type { MarketsNamespace } from "./markets.js";
import type { OracleNamespace } from "./oracle.js";
import { collectRiskViolations, type RiskInfo, type RiskNamespace } from "./risk.js";
import { executeTx, type TxOptions } from "./transactions.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

export type Side = "LONG" | "SHORT";
/// `LIMIT` is part of the interface from the start (PROJECT_BRIEF.md Section 27) so callers do
/// not break later, but resting limit orders ship in DEVELOPMENT_STEPS.md Phase 5 and are
/// rejected until then. `MARKET` here still carries a slippage bound.
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
  violations: OrionisContractError[];
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
  increasePosition(positionId: bigint, params: IncreasePerpPositionParams): Promise<Hex>;
  reducePosition(positionId: bigint, params: ReducePerpPositionParams): Promise<Hex>;
  closePosition(positionId: bigint, params: ClosePerpPositionParams): Promise<Hex>;
}

export interface PerpsDeps {
  client: OrionisClient;
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

  function assertMarketOrder(orderType: OrderType | undefined, method: string) {
    if (orderType === "LIMIT") {
      throw new NotImplementedError(method, "LIMIT orders are not supported yet (DEVELOPMENT_STEPS.md Phase 5)");
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
    assertMarketOrder(params.orderType, "perps.previewOpen");

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

    return {
      marketId,
      side: params.side,
      indexPrice: index.price,
      entryPrice: mark.price,
      worstPrice,
      collateral,
      leverage,
      notional,
      fee,
      feeBps: feeInfo.takerFee,
      totalRequired,
      maintenanceMarginRateBps: riskInfo.maintenanceMarginRateBps,
      liquidationPrice: liquidationPrice(isLong, mark.price, collateral, notional, riskInfo.maintenanceMarginRateBps),
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

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.perpsEngine,
          abi: perpsEngineAbi,
          functionName: "openPosition",
          args: [marketId, isLong, collateral, leverage, worstPrice, deadline],
        }),
      params.tx,
    );
    return { hash, positionId: result };
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
    increasePosition,
    reducePosition,
    closePosition,
  };
}
