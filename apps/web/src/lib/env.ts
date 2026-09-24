import { addressesForChain, resolveChainId, type ChainId, type ContractAddresses } from "@alphamarkets/config";
import type { Address } from "@alphamarkets/types";

/// Every value the terminal needs from the environment (PROJECT_BRIEF.md Section 4). Next only
/// inlines `process.env.NEXT_PUBLIC_*` when written out literally, so each name appears in full
/// here rather than being looked up dynamically.
const raw = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  rpcProxyUrl: process.env.NEXT_PUBLIC_RPC_PROXY_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  marketRegistry: process.env.NEXT_PUBLIC_MARKET_REGISTRY,
  vault: process.env.NEXT_PUBLIC_ALPHAMARKETS_VAULT,
  optionsEngine: process.env.NEXT_PUBLIC_OPTIONS_ENGINE,
  perpsEngine: process.env.NEXT_PUBLIC_PERPS_ENGINE,
  oracleRouter: process.env.NEXT_PUBLIC_ORACLE_ROUTER,
  riskManager: process.env.NEXT_PUBLIC_RISK_MANAGER,
  feeManager: process.env.NEXT_PUBLIC_FEE_MANAGER,
  settlementToken: process.env.NEXT_PUBLIC_COLLATERAL_TOKEN,
  collateralManager: process.env.NEXT_PUBLIC_COLLATERAL_MANAGER,
  optionMarket: process.env.NEXT_PUBLIC_OPTION_MARKET,
  optionPositionManager: process.env.NEXT_PUBLIC_OPTION_POSITION_MANAGER,
  perpPositionManager: process.env.NEXT_PUBLIC_PERP_POSITION_MANAGER,
  perpOrderManager: process.env.NEXT_PUBLIC_PERP_ORDER_MANAGER,
  liquidationEngine: process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE,
  fundingManager: process.env.NEXT_PUBLIC_FUNDING_MANAGER,
  priceValidator: process.env.NEXT_PUBLIC_PRICE_VALIDATOR,
  buybackModule: process.env.NEXT_PUBLIC_BUYBACK_MODULE,
  optionStrikeStepBps: process.env.NEXT_PUBLIC_OPTION_STRIKE_STEP_BPS,
  optionStrikeRows: process.env.NEXT_PUBLIC_OPTION_STRIKE_ROWS,
  optionExpiryDays: process.env.NEXT_PUBLIC_OPTION_EXPIRY_DAYS,
  optionExpiryHourUtc: process.env.NEXT_PUBLIC_OPTION_EXPIRY_HOUR_UTC,
};

/// A whole number from the environment, or `fallback` when it is unset, not a number or out of range.
function wholeNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/// Comma-separated whole numbers ("7,14,30"), keeping only valid entries; `fallback` if none remain.
function wholeNumberList(value: string | undefined, fallback: number[], min: number, max: number): number[] {
  const parsed = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= min && n <= max);
  return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : fallback;
}

const chainId: ChainId = resolveChainId(raw.chainId);

/// The recorded deployment for `chainId`, with any contract address set in the environment
/// replacing the recorded one for that contract only.
function resolveAddresses(): ContractAddresses {
  const overrides: Partial<Record<keyof ContractAddresses, string | undefined>> = {
    marketRegistry: raw.marketRegistry,
    vault: raw.vault,
    optionsEngine: raw.optionsEngine,
    perpsEngine: raw.perpsEngine,
    oracleRouter: raw.oracleRouter,
    riskManager: raw.riskManager,
    feeManager: raw.feeManager,
    settlementToken: raw.settlementToken,
    collateralManager: raw.collateralManager,
    optionMarket: raw.optionMarket,
    optionPositionManager: raw.optionPositionManager,
    perpPositionManager: raw.perpPositionManager,
    perpOrderManager: raw.perpOrderManager,
    liquidationEngine: raw.liquidationEngine,
    fundingManager: raw.fundingManager,
    priceValidator: raw.priceValidator,
    buybackModule: raw.buybackModule,
  };
  const resolved = { ...addressesForChain(chainId) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value) resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}

export const env = {
  chainId,
  /// No default RPC is baked in: Robinhood's own default had an expired TLS certificate
  /// (packages/contracts CHANGELOG). When unset, a reserved `.invalid` host stands in so the app
  /// still builds and renders, and every read fails visibly instead of silently using another RPC.
  rpcUrl: raw.rpcUrl || "http://rpc-not-configured.invalid",
  rpcConfigured: Boolean(raw.rpcUrl || raw.rpcProxyUrl),
  /// Where the app's own reads go. `services/api` serves `/v1/rpc`, a caching proxy, so many
  /// visitors share one upstream call instead of each spending the provider's quota. Unset reads
  /// straight from `rpcUrl`. The wallet still gets `rpcUrl` (see `chain` in wagmi.ts), because it
  /// broadcasts transactions itself and the proxy refuses writes.
  readRpcUrl: raw.rpcProxyUrl || raw.rpcUrl || "http://rpc-not-configured.invalid",
  explorerUrl: raw.explorerUrl,
  apiUrl: raw.apiUrl ? raw.apiUrl.replace(/\/+$/, "") : undefined,
  addresses: resolveAddresses(),
  /// Limit orders need a deployment that includes `PerpOrderManager`; the terminal hides them without one.
  limitOrders: Boolean(resolveAddresses().perpOrderManager),
  /// Cross margin needs a deployment that includes `CrossMarginManager`; the ticket hides it without one.
  crossMargin: Boolean(resolveAddresses().crossMargin),
  /// Option chain layout. The contract lists no strikes (a series is created on first use), so the
  /// terminal proposes a ladder around spot and a few upcoming expiries; these set its shape.
  options: {
    strikeStepBps: wholeNumber(raw.optionStrikeStepBps, 500, 1, 5_000),
    strikeRows: wholeNumber(raw.optionStrikeRows, 5, 1, 20),
    expiryDays: wholeNumberList(raw.optionExpiryDays, [7, 14, 30], 1, 365),
    expiryHourUtc: wholeNumber(raw.optionExpiryHourUtc, 20, 0, 23),
  },
} as const;
