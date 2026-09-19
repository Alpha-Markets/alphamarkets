import { BPS_DENOMINATOR } from "./utils.js";

/// Bigint mirrors of `packages/contracts/src/risk/MarginEngine.sol`, used only to show
/// pre-sign previews (PROJECT_BRIEF.md Section 45). The contract remains the source of truth
/// for liquidation eligibility and settlement (Section 14) — these helpers never decide either.
/// BigInt division truncates toward zero, matching Solidity's signed integer division, so the
/// results agree with the onchain library bit for bit for the same inputs.

export function initialMargin(notional: bigint, initialMarginRateBps: bigint): bigint {
  return (notional * initialMarginRateBps) / BPS_DENOMINATOR;
}

export function maintenanceMargin(notional: bigint, maintenanceMarginRateBps: bigint): bigint {
  return (notional * maintenanceMarginRateBps) / BPS_DENOMINATOR;
}

export function unrealizedPnl(isLong: boolean, entryPrice: bigint, markPrice: bigint, size: bigint): bigint {
  if (entryPrice === 0n) return 0n;
  const priceDelta = isLong ? markPrice - entryPrice : entryPrice - markPrice;
  return (size * priceDelta) / entryPrice;
}

export function marginRatioBps(collateral: bigint, pnl: bigint, notional: bigint): bigint {
  if (notional === 0n) return 0n;
  const equity = collateral + pnl;
  if (equity <= 0n) return 0n;
  return (equity * BPS_DENOMINATOR) / notional;
}

export function liquidationPrice(
  isLong: boolean,
  entryPrice: bigint,
  collateral: bigint,
  size: bigint,
  maintenanceMarginRateBps: bigint,
): bigint {
  if (size === 0n) return 0n;

  const maintMargin = maintenanceMargin(size, maintenanceMarginRateBps);
  const shortfall = maintMargin - collateral;
  const offset = (entryPrice * shortfall) / size;

  const price = isLong ? entryPrice + offset : entryPrice - offset;
  return price <= 0n ? 0n : price;
}

/// Fee as `amount * feeBps / 10_000`, rounded down like the contracts.
export function feeFromBps(amount: bigint, feeBps: bigint): bigint {
  return (amount * feeBps) / BPS_DENOMINATOR;
}

/// Scales a price by `(10_000 + deltaBps) / 10_000`.
export function applyBps(price: bigint, deltaBps: bigint): bigint {
  return (price * (BPS_DENOMINATOR + deltaBps)) / BPS_DENOMINATOR;
}
