/// TypeScript port of `packages/contracts/src/risk/MarginEngine.sol`, kept as a `library`
/// on-chain with only `internal` functions (not callable via RPC), so a read-only monitor
/// has to reproduce the math rather than call it. BigInt is used throughout, matching
/// Solidity's integer (truncating) division exactly rather than approximating with floats —
/// this only ever feeds a liquidation-candidate *display*, but wrong rounding here would
/// still mean flagging (or missing) positions the chain doesn't actually consider at risk.
const BPS_DENOMINATOR = 10_000n;

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

/// Margin ratio in bps: (collateral + unrealizedPnl) / notional, floored at 0.
export function marginRatio(collateral: bigint, pnl: bigint, notional: bigint): bigint {
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
