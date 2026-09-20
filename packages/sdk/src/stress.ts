/// Portfolio stress testing for the advanced risk API (PROJECT_BRIEF.md Section 40, "advanced risk
/// API"): what a set of open positions would be worth, and which perp positions would be
/// liquidated, if every market moved by a given percentage.
///
/// Pure bigint arithmetic on the same formulas the contracts use (`math.ts`), no I/O, so a
/// bot or the API can run it on data it already has. It is an estimate of a price move, not a
/// forecast, and never an input to onchain margin or liquidation, which always read the oracle.
///
/// Options are valued at their INTRINSIC value at the shocked price: what they would pay if they
/// expired at that price. That ignores time value and volatility, so it understates a
/// long option's worth before expiry. The premium paid is shown as the cost.
import { convertDecimals } from "./amounts.js";
import { liquidationPrice, marginRatioBps, unrealizedPnl } from "./math.js";

const WAD = 10n ** 18n;
const BPS = 10_000n;

export interface StressPerp {
  positionId: bigint;
  marketId: string;
  isLong: boolean;
  /// 18 decimals.
  entryPrice: bigint;
  /// Notional, settlement-token base units.
  size: bigint;
  collateral: bigint;
  maintenanceMarginRateBps: bigint;
}

export interface StressOption {
  positionId: bigint;
  marketId: string;
  type: "CALL" | "PUT";
  /// 18 decimals.
  strike: bigint;
  contracts: bigint;
  /// Underlying units per contract, 18 decimals.
  contractSize: bigint;
  /// Premium paid for the whole position, settlement-token base units.
  entryPremium: bigint;
}

export interface StressInput {
  /// Current mark price per market id, 18 decimals. A position on a market with no mark is skipped.
  marks: Record<string, bigint>;
  perps: StressPerp[];
  options: StressOption[];
  settlementDecimals: number;
  /// Free collateral in the Vault, settlement-token base units.
  availableBalance: bigint;
}

export interface StressPerpResult {
  positionId: bigint;
  marketId: string;
  markPrice: bigint;
  pnl: bigint;
  marginRatioBps: bigint;
  liquidated: boolean;
}

export interface StressResult {
  shockBps: number;
  perps: StressPerpResult[];
  perpPnl: bigint;
  /// Ids of the perp positions whose margin ratio would fall below their maintenance rate.
  liquidated: bigint[];
  /// Intrinsic value of every option position, and what was paid for them.
  optionValue: bigint;
  optionCost: bigint;
  optionPnl: bigint;
  /// Free collateral, plus locked margin, plus perp PnL: the account's value before options.
  equity: bigint;
}

/// Scales a price by a move in basis points. A price cannot go below zero.
export function shockPrice(price: bigint, shockBps: number): bigint {
  const scaled = (price * (BPS + BigInt(shockBps))) / BPS;
  return scaled < 0n ? 0n : scaled;
}

function intrinsic(type: "CALL" | "PUT", strike: bigint, price: bigint): bigint {
  const value = type === "CALL" ? price - strike : strike - price;
  return value > 0n ? value : 0n;
}

/// The result for one uniform price move across every market.
export function stressAt(input: StressInput, shockBps: number): StressResult {
  const perps: StressPerpResult[] = [];
  for (const position of input.perps) {
    const base = input.marks[position.marketId];
    if (base === undefined) continue;
    const markPrice = shockPrice(base, shockBps);
    const pnl = unrealizedPnl(position.isLong, position.entryPrice, markPrice, position.size);
    const ratio = marginRatioBps(position.collateral, pnl, position.size);
    perps.push({
      positionId: position.positionId,
      marketId: position.marketId,
      markPrice,
      pnl,
      marginRatioBps: ratio,
      liquidated: ratio < position.maintenanceMarginRateBps,
    });
  }

  let optionValue = 0n;
  let optionCost = 0n;
  for (const position of input.options) {
    const base = input.marks[position.marketId];
    if (base === undefined) continue;
    const perUnit = intrinsic(position.type, position.strike, shockPrice(base, shockBps));
    const wad = ((perUnit * position.contractSize) / WAD) * position.contracts;
    optionValue += convertDecimals(wad, 18, input.settlementDecimals);
    optionCost += position.entryPremium;
  }

  const perpPnl = perps.reduce((sum, result) => sum + result.pnl, 0n);
  const locked = input.perps.filter((position) => input.marks[position.marketId] !== undefined).reduce((sum, position) => sum + position.collateral, 0n);

  return {
    shockBps,
    perps,
    perpPnl,
    liquidated: perps.filter((result) => result.liquidated).map((result) => result.positionId),
    optionValue,
    optionCost,
    optionPnl: optionValue - optionCost,
    equity: input.availableBalance + locked + perpPnl,
  };
}

/// The default grid: -30% to +30% in 10% steps, plus the current price.
export const DEFAULT_SHOCKS_BPS = [-3000, -2000, -1000, -500, 0, 500, 1000, 2000, 3000];

export function stressPortfolio(input: StressInput, shocksBps: number[] = DEFAULT_SHOCKS_BPS): StressResult[] {
  return shocksBps.map((shock) => stressAt(input, shock));
}

export interface PositionDistance {
  positionId: bigint;
  marketId: string;
  markPrice: bigint;
  liquidationPrice: bigint;
  /// Move in the mark, in basis points of it, that reaches the liquidation price: negative for a
  /// long (the price must fall), positive for a short. `null` when there is no mark.
  distanceBps: bigint | null;
}

/// How far each perp position is from liquidation at the current marks.
export function liquidationDistances(input: Pick<StressInput, "marks" | "perps">): PositionDistance[] {
  return input.perps.map((position) => {
    const markPrice = input.marks[position.marketId];
    const liquidation = liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, position.maintenanceMarginRateBps);
    return {
      positionId: position.positionId,
      marketId: position.marketId,
      markPrice: markPrice ?? 0n,
      liquidationPrice: liquidation,
      distanceBps: markPrice === undefined || markPrice === 0n ? null : ((liquidation - markPrice) * BPS) / markPrice,
    };
  });
}

/// Signed notional per market: longs positive, shorts negative. The net directional exposure of
/// the perp book, before options.
export function netPerpExposure(perps: StressPerp[]): Record<string, bigint> {
  const net: Record<string, bigint> = {};
  for (const position of perps) net[position.marketId] = (net[position.marketId] ?? 0n) + (position.isLong ? position.size : -position.size);
  return net;
}
