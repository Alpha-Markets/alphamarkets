import { addressesForChain, ROBINHOOD_TESTNET_CHAIN_ID, type ChainId, type ContractAddresses } from "@orionis/config";
import type { Address } from "@orionis/types";

/// Every value the terminal needs from the environment (PROJECT_BRIEF.md Section 4). Next only
/// inlines `process.env.NEXT_PUBLIC_*` when written out literally, so each name appears in full
/// here rather than being looked up dynamically.
const raw = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  marketRegistry: process.env.NEXT_PUBLIC_MARKET_REGISTRY,
  vault: process.env.NEXT_PUBLIC_ORIONIS_VAULT,
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
  liquidationEngine: process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE,
  fundingManager: process.env.NEXT_PUBLIC_FUNDING_MANAGER,
  priceValidator: process.env.NEXT_PUBLIC_PRICE_VALIDATOR,
  buybackModule: process.env.NEXT_PUBLIC_BUYBACK_MODULE,
};

function supportedChainId(value: string | undefined): ChainId {
  const id = Number(value ?? ROBINHOOD_TESTNET_CHAIN_ID);
  if (id !== ROBINHOOD_TESTNET_CHAIN_ID) {
    throw new Error(`NEXT_PUBLIC_CHAIN_ID=${value} has no deployment recorded in @orionis/config`);
  }
  return id;
}

const chainId = supportedChainId(raw.chainId);

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
  rpcConfigured: Boolean(raw.rpcUrl),
  explorerUrl: raw.explorerUrl,
  apiUrl: raw.apiUrl ? raw.apiUrl.replace(/\/+$/, "") : undefined,
  addresses: resolveAddresses(),
} as const;
