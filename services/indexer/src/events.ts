import type { ContractAddresses } from "@orionis/config";
import type { Address } from "@orionis/types";

/// Every event declared across `packages/contracts/src/**` (PROJECT_BRIEF.md Section 35),
/// hand-written for the same reason `packages/sdk/src/abis.ts` is: no Foundry toolchain
/// available to generate them. Kept in one combined ABI (rather than one per contract) so
/// `parseEventLogs` can decode a whole block range's logs from every watched address in a
/// single pass — event names don't collide across contracts here.
export const allEventsAbi = [
  { type: "event", name: "CollateralDeposited", inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "CollateralWithdrawn", inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "SeriesCreated", inputs: [
    { name: "seriesId", type: "bytes32", indexed: true },
    { name: "underlyingMarketId", type: "bytes32", indexed: true },
    { name: "expiry", type: "uint256", indexed: false },
    { name: "strike", type: "uint256", indexed: false },
    { name: "optionType", type: "uint8", indexed: false },
  ] },
  { type: "event", name: "ContractSizeUpdated", inputs: [
    { name: "underlyingMarketId", type: "bytes32", indexed: true },
    { name: "contractSize", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "MarketAdded", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "underlyingToken", type: "address", indexed: false },
    { name: "oracleId", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "MarketUpdated", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "underlyingToken", type: "address", indexed: false },
    { name: "oracleId", type: "bytes32", indexed: false },
    { name: "active", type: "bool", indexed: false },
  ] },
  { type: "event", name: "SupportedTokenAdded", inputs: [{ name: "token", type: "address", indexed: true }] },
  { type: "event", name: "SupportedTokenRemoved", inputs: [{ name: "token", type: "address", indexed: true }] },
  { type: "event", name: "FeesNotified", inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "BuybackExecuted", inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "amountIn", type: "uint256", indexed: false },
    { name: "amountOut", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "ProtocolTokenUpdated", inputs: [{ name: "protocolToken", type: "address", indexed: true }] },
  { type: "event", name: "PositionLiquidated", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "liquidator", type: "address", indexed: false },
    { name: "markPriceAtLiquidation", type: "uint256", indexed: false },
    { name: "pnl", type: "int256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "FeeConfigUpdated", inputs: [{ name: "marketId", type: "bytes32", indexed: true }] },
  { type: "event", name: "BuybackShareUpdated", inputs: [{ name: "bps", type: "uint256", indexed: false }] },
  { type: "event", name: "BuybackModuleUpdated", inputs: [{ name: "module", type: "address", indexed: true }] },
  { type: "event", name: "ProtocolFeeCollected", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "payer", type: "address", indexed: true },
    { name: "token", type: "address", indexed: false },
    { name: "amount", type: "uint256", indexed: false },
    { name: "feeType", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "RiskConfigUpdated", inputs: [{ name: "marketId", type: "bytes32", indexed: true }] },
  { type: "event", name: "OracleSourceUpdated", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "primarySource", type: "address", indexed: false },
    { name: "fallbackSource", type: "address", indexed: false },
  ] },
  { type: "event", name: "OracleMarketPaused", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "paused", type: "bool", indexed: false },
  ] },
  { type: "event", name: "SettlementPriceRecorded", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "expiry", type: "uint256", indexed: true },
    { name: "price", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "FundingIntervalUpdated", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "interval", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "FundingRateUpdated", inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "rateBps", type: "int256", indexed: false },
    { name: "cumulativeIndex", type: "int256", indexed: false },
  ] },
  { type: "event", name: "FundingPaid", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "amount", type: "int256", indexed: false },
    { name: "fundingIndex", type: "int256", indexed: false },
  ] },
  { type: "event", name: "PerpPositionOpened", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "isLong", type: "bool", indexed: false },
    { name: "size", type: "uint256", indexed: false },
    { name: "collateral", type: "uint256", indexed: false },
    { name: "leverage", type: "uint256", indexed: false },
    { name: "entryPrice", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "PerpPositionUpdated", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "newSize", type: "uint256", indexed: false },
    { name: "newCollateral", type: "uint256", indexed: false },
    { name: "realizedPnlDelta", type: "int256", indexed: false },
  ] },
  { type: "event", name: "PerpPositionClosed", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "realizedPnl", type: "int256", indexed: false },
  ] },
  { type: "event", name: "OptionPositionOpened", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "optionType", type: "uint8", indexed: false },
    { name: "strike", type: "uint256", indexed: false },
    { name: "expiry", type: "uint256", indexed: false },
    { name: "contracts", type: "uint256", indexed: false },
    { name: "premium", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "OptionPositionClosed", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "realizedPnl", type: "int256", indexed: false },
  ] },
  { type: "event", name: "OptionExercised", inputs: [
    { name: "positionId", type: "uint256", indexed: true },
    { name: "intrinsicValue", type: "uint256", indexed: false },
    { name: "payout", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "OptionSettled", inputs: [
    { name: "seriesId", type: "bytes32", indexed: true },
    { name: "settlementPrice", type: "uint256", indexed: false },
    { name: "timestamp", type: "uint256", indexed: false },
  ] },
] as const;

/// Maps a watched address back to a human-readable contract name for the `events.contract_name`
/// column — built from `@orionis/config` so it stays in sync with the deployment record.
export function contractNamesByAddress(addresses: ContractAddresses): Map<Address, string> {
  return new Map(
    Object.entries(addresses).map(([name, address]) => [address.toLowerCase() as Address, name]),
  );
}

export function watchedAddresses(addresses: ContractAddresses): Address[] {
  return Object.values(addresses);
}
