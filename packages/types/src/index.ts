/// Shared shapes mirroring the on-chain structs in `packages/contracts/src/interfaces/DataTypes.sol`
/// and the position-manager contracts. Contracts, API, indexer, SDK, and frontend all import
/// these instead of redefining them locally (DEVELOPMENT_STEPS.md "Monorepo tooling").

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/// Mirrors `OptionType` in DataTypes.sol — numeric values must stay in sync with the enum order.
export enum OptionType {
  CALL = 0,
  PUT = 1,
}

/// Mirrors `MarketConfig` in DataTypes.sol.
export interface MarketConfig {
  marketId: Hex;
  underlyingToken: Address;
  oracleId: Hex;
  optionsEnabled: boolean;
  perpsEnabled: boolean;
  maxLeverage: bigint;
  openInterestCap: bigint;
  active: boolean;
}

/// Mirrors `OptionPositionManager.PositionStatus`.
export enum OptionPositionStatus {
  OPEN = 0,
  CLOSED = 1,
  SETTLED = 2,
}

/// Mirrors `OptionPositionManager.OptionPosition`.
export interface OptionPosition {
  positionId: bigint;
  marketId: Hex;
  optionType: OptionType;
  strike: bigint;
  expiry: bigint;
  contracts: bigint;
  entryPremium: bigint;
  collateral: bigint;
  realizedPnl: bigint;
  status: OptionPositionStatus;
  owner: Address;
}

/// Mirrors `PerpPositionManager.PerpPosition`.
export interface PerpPosition {
  positionId: bigint;
  marketId: Hex;
  isLong: boolean;
  entryPrice: bigint;
  size: bigint;
  collateral: bigint;
  leverage: bigint;
  realizedPnl: bigint;
  fundingAccrued: bigint;
  lastFundingIndex: bigint;
  open: boolean;
  owner: Address;
}
