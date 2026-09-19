import { type Account, type Address, createWalletClient, publicActions, type Transport } from "viem";
import { addressesForChain, chains, type ChainId, type ContractAddresses } from "@orionis/config";
import { createDecimalsReader, createErc20, type Erc20Namespace } from "./erc20.js";
import { createExplorer, type ExplorerNamespace } from "./explorer.js";
import { createFees, type FeesNamespace } from "./fees.js";
import { createFunding, type FundingNamespace } from "./funding.js";
import { createMarkets, type MarketsNamespace } from "./markets.js";
import { createOptions, type OptionsNamespace } from "./options.js";
import { createOracle, createPrices, type OracleNamespace, type PricesNamespace } from "./oracle.js";
import { createPerps, type PerpsNamespace } from "./perps.js";
import { createPortfolio, type PortfolioNamespace } from "./portfolio.js";
import { createRisk, type RiskNamespace } from "./risk.js";
import { createStream, type StreamNamespace, type WebSocketConstructor } from "./stream.js";
import { createVault, type VaultNamespace } from "./vault.js";

export interface OrionisConfig {
  chainId: ChainId;
  /// Contract addresses to use instead of the checked-in deployment for `chainId` — for a local
  /// Anvil deployment or a fresh testnet redeploy (PROJECT_BRIEF.md Section 4: never hardcode
  /// per-environment addresses in client logic).
  addresses?: ContractAddresses;
  /// Caller-supplied transport (PROJECT_BRIEF.md Section 34) — e.g. `custom(window.ethereum)`
  /// in a browser, or `http(rpcUrl)` for a script. No default RPC is baked in: Robinhood's own
  /// default RPC had an expired TLS cert at deploy time (CHANGELOG [1.0.0-testnet]).
  transport: Transport;
  /// Required only for methods that send transactions (openPosition, deposit, approve, ...).
  /// Read-only usage (markets.list, portfolio.positions) works without it.
  account?: Account | Address;
  /// Base URL of `services/api` (e.g. `http://localhost:4000`, no trailing slash or `/v1`
  /// suffix). Required only for what the SDK cannot serve from the chain alone: `options.quote`
  /// / `previewOpen` / `chain` / `expiries` (pricing + indexer), `portfolio.history` /
  /// `orders` (indexer), and `stream.subscribe`. Omitting it keeps every other method working;
  /// those throw `NotImplementedError` instead.
  apiUrl?: string;
  /// Block explorer base URL (`NEXT_PUBLIC_EXPLORER_URL`), used by `explorer.*` links.
  explorerUrl?: string;
  /// WebSocket implementation for `stream.subscribe` on runtimes without a global `WebSocket`
  /// (Node < 22): pass the `ws` package's `WebSocket` class.
  webSocket?: WebSocketConstructor;
}

function buildClient(config: OrionisConfig) {
  return createWalletClient({
    chain: chains[config.chainId],
    transport: config.transport,
    account: config.account,
  }).extend(publicActions);
}

export type OrionisClient = ReturnType<typeof buildClient>;

/// `simulateContract`'s `request` result carries an `account` typed against this client's
/// account generic, which is `Account | undefined` here since `OrionisConfig.account` is
/// optional (read-only usage must work without one) — but viem's `writeContract` parameter
/// type requires `Account | Address | null`, rejecting `undefined` even though the value at
/// that point is exactly what `simulateContract` just produced for that same client. The cast
/// is confined to this one function, and only ever receives a `request` this SDK generated
/// from its own `simulateContract` call, never a value a caller constructed by hand; a caller
/// who omitted `account` still gets viem's own runtime "no account" error on the write.
export function sendTransaction(client: OrionisClient, request: object) {
  return client.writeContract(request as Parameters<OrionisClient["writeContract"]>[0]);
}

export class Orionis {
  readonly chainId: ChainId;
  readonly addresses: ContractAddresses;
  readonly markets: MarketsNamespace;
  readonly options: OptionsNamespace;
  readonly perps: PerpsNamespace;
  readonly portfolio: PortfolioNamespace;
  readonly vault: VaultNamespace;
  readonly erc20: Erc20Namespace;
  readonly oracle: OracleNamespace;
  readonly prices: PricesNamespace;
  readonly funding: FundingNamespace;
  readonly risk: RiskNamespace;
  readonly fees: FeesNamespace;
  readonly explorer: ExplorerNamespace;
  readonly stream: StreamNamespace;

  constructor(config: OrionisConfig) {
    this.chainId = config.chainId;
    this.addresses = config.addresses ?? addressesForChain(config.chainId);

    const client = buildClient(config);
    const decimals = createDecimalsReader(client);

    this.markets = createMarkets(client, this.addresses);
    this.oracle = createOracle(client, this.addresses);
    this.prices = createPrices(client, this.addresses, this.oracle);
    this.funding = createFunding(client, this.addresses);
    this.risk = createRisk(client, this.addresses);
    this.fees = createFees(client, this.addresses);
    this.erc20 = createErc20(client, decimals);
    this.vault = createVault(client, this.addresses, decimals);
    this.options = createOptions({
      client,
      addresses: this.addresses,
      decimals,
      markets: this.markets,
      fees: this.fees,
      apiUrl: config.apiUrl,
    });
    this.perps = createPerps({
      client,
      addresses: this.addresses,
      decimals,
      markets: this.markets,
      oracle: this.oracle,
      risk: this.risk,
      fees: this.fees,
      funding: this.funding,
    });
    this.portfolio = createPortfolio({
      client,
      addresses: this.addresses,
      vault: this.vault,
      oracle: this.oracle,
      apiUrl: config.apiUrl,
    });
    this.explorer = createExplorer(config.explorerUrl);
    this.stream = createStream(config.apiUrl, config.webSocket);
  }
}
