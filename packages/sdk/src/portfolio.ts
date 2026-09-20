import type { ContractAddresses } from "@orionis/config";
import type { Address, OptionPosition, PerpPosition } from "@orionis/types";
import { optionPositionManagerAbi, perpPositionManagerAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError, OrionisError } from "./errors.js";
import { readUserOrders, readUserTriggerOrders, type OpenOrder, type TriggerOrder } from "./orders.js";
import { createApiGet } from "./api.js";
import { unrealizedPnl } from "./math.js";
import type { OracleNamespace } from "./oracle.js";
import type { VaultBalances, VaultNamespace } from "./vault.js";

export interface PortfolioPositions {
  options: OptionPosition[];
  perps: PerpPosition[];
}

/// One row from `services/indexer`'s `events` table, as returned by
/// `services/api`'s `GET /v1/history/:wallet`.
export interface HistoryEvent {
  id: number;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  contractName: string;
  eventName: string;
  args: Record<string, unknown>;
  createdAt: string;
}

/// PROJECT_BRIEF.md Section 28 summary. MVP is single-collateral (Section 7), so all figures are
/// in settlement-token units.
export interface PortfolioSummary {
  balances: VaultBalances;
  positions: PortfolioPositions;
  /// Sum of mark-to-market PnL on open perp positions. Options are excluded: their mark premium
  /// is an offchain quote (Section 10), never priced from the chain.
  unrealizedPerpPnl: bigint;
  /// Sum of `realizedPnl` across every option and perp position.
  realizedPnl: bigint;
}

/// One funding payment on a perp position (PROJECT_BRIEF.md Section 15). Positive `amount` was
/// received, negative was paid; settlement-token base units.
export interface FundingPayment {
  id: number;
  txHash: string;
  blockNumber: string;
  createdAt: string;
  positionId: bigint;
  marketId: `0x${string}`;
  amount: bigint;
}

export interface PortfolioNamespace {
  /// Funding received or paid on the user's perp positions, from `services/indexer` via the API
  /// (oldest first). Requires `apiUrl`.
  funding(user: Address, options?: { limit?: number; cursor?: number }): Promise<FundingPayment[]>;
  summary(user: Address): Promise<PortfolioSummary>;
  /// Every limit order the user placed, oldest first, read from the chain (no `apiUrl` needed).
  /// Filter on `status === "OPEN"` for the ones still resting. Empty on a deployment that
  /// predates limit orders.
  orders(user: Address): Promise<OpenOrder[]>;
  /// Every stop-loss and take-profit the user placed, oldest first, read from the chain. Filter on
  /// `status === "OPEN"` for the ones still resting; one on a position that has since closed can
  /// never fire, so also check the position is open.
  triggerOrders(user: Address): Promise<TriggerOrder[]>;
  /// Reads open/closed/settled positions directly from the position-manager contracts.
  positions(user: Address): Promise<PortfolioPositions>;
  /// Single-position lookups by id — used by callers (e.g. `services/risk-monitor`) that
  /// already know which position ids to watch, so they don't pay for every position a user
  /// has just to re-read one.
  getOptionPosition(positionId: bigint): Promise<OptionPosition>;
  getPerpPosition(positionId: bigint): Promise<PerpPosition>;
  /// Deposit/withdrawal and PnL-settlement history, from `services/indexer` reached through
  /// `services/api`'s `GET /v1/history/:wallet` — requires `apiUrl` in the `Orionis`
  /// constructor config; throws `NotImplementedError` if it wasn't provided. PROJECT_BRIEF.md
  /// Section 31 requires historical data to come from the indexer, never a substitute built
  /// from frontend RPC calls, so this SDK will not paper over a missing `apiUrl` with one.
  history(user: Address, options?: { limit?: number; cursor?: number }): Promise<HistoryEvent[]>;
}

export interface PortfolioDeps {
  client: OrionisClient;
  addresses: ContractAddresses;
  vault: VaultNamespace;
  oracle: OracleNamespace;
  apiUrl?: string;
}

export function createPortfolio({ client, addresses, vault, oracle, apiUrl }: PortfolioDeps): PortfolioNamespace {
  const apiGet = createApiGet(apiUrl);

  async function positions(user: Address): Promise<PortfolioPositions> {
    const [optionIds, perpIds] = await Promise.all([
      client.readContract({
        address: addresses.optionPositionManager,
        abi: optionPositionManagerAbi,
        functionName: "getUserPositions",
        args: [user],
      }),
      client.readContract({
        address: addresses.perpPositionManager,
        abi: perpPositionManagerAbi,
        functionName: "getUserPositions",
        args: [user],
      }),
    ]);

    const [optionPositions, perpPositions] = await Promise.all([
      Promise.all(
        optionIds.map(async (positionId) => {
          const position = await client.readContract({
            address: addresses.optionPositionManager,
            abi: optionPositionManagerAbi,
            functionName: "getPosition",
            args: [positionId],
          });
          return { positionId, ...position } as OptionPosition;
        }),
      ),
      Promise.all(
        perpIds.map(async (positionId) => {
          const position = await client.readContract({
            address: addresses.perpPositionManager,
            abi: perpPositionManagerAbi,
            functionName: "getPosition",
            args: [positionId],
          });
          return { positionId, ...position } as PerpPosition;
        }),
      ),
    ]);

    return { options: optionPositions, perps: perpPositions };
  }

  async function getOptionPosition(positionId: bigint): Promise<OptionPosition> {
    const position = await client.readContract({
      address: addresses.optionPositionManager,
      abi: optionPositionManagerAbi,
      functionName: "getPosition",
      args: [positionId],
    });
    return { positionId, ...position } as OptionPosition;
  }

  async function getPerpPosition(positionId: bigint): Promise<PerpPosition> {
    const position = await client.readContract({
      address: addresses.perpPositionManager,
      abi: perpPositionManagerAbi,
      functionName: "getPosition",
      args: [positionId],
    });
    return { positionId, ...position } as PerpPosition;
  }

  async function history(user: Address, options?: { limit?: number; cursor?: number }): Promise<HistoryEvent[]> {
    if (!apiUrl) {
      throw new NotImplementedError(
        "portfolio.history",
        "requires `apiUrl` in the Orionis constructor config, pointing at services/api",
      );
    }

    const query = new URLSearchParams();
    if (options?.limit) query.set("limit", String(options.limit));
    if (options?.cursor) query.set("cursor", String(options.cursor));
    const queryString = query.toString();

    const response = await fetch(`${apiUrl}/v1/history/${user}${queryString ? `?${queryString}` : ""}`);
    if (!response.ok) {
      throw new OrionisError(`portfolio.history: services/api returned ${response.status}`);
    }
    return (await response.json()) as HistoryEvent[];
  }

  async function summary(user: Address): Promise<PortfolioSummary> {
    const [balances, allPositions] = await Promise.all([
      vault.balances(user, addresses.settlementToken),
      positions(user),
    ]);

    const openPerps = allPositions.perps.filter((position) => position.open);
    const marks = await Promise.all(openPerps.map((position) => oracle.getMarkPrice(position.marketId)));
    const unrealizedPerpPnl = openPerps.reduce(
      (total, position, index) =>
        total + unrealizedPnl(position.isLong, position.entryPrice, marks[index]!.price, position.size),
      0n,
    );
    const realizedPnl = [...allPositions.perps, ...allPositions.options].reduce(
      (total, position) => total + position.realizedPnl,
      0n,
    );

    return { balances, positions: allPositions, unrealizedPerpPnl, realizedPnl };
  }

  function orders(user: Address): Promise<OpenOrder[]> {
    return readUserOrders(client, addresses, user);
  }

  function triggerOrders(user: Address): Promise<TriggerOrder[]> {
    return readUserTriggerOrders(client, addresses, user);
  }

  async function funding(user: Address, options?: { limit?: number; cursor?: number }): Promise<FundingPayment[]> {
    const query = new URLSearchParams();
    if (options?.limit) query.set("limit", String(options.limit));
    if (options?.cursor) query.set("cursor", String(options.cursor));
    const queryString = query.toString();
    const rows = await apiGet<
      Array<{ id: number; txHash: string; blockNumber: string; createdAt: string; positionId: string; marketId: `0x${string}`; amount: string }>
    >("portfolio.funding", `/v1/funding/${user}${queryString ? `?${queryString}` : ""}`);
    // The API camel-cases column names, so rows already have the SDK's field names.
    return rows.map((row) => ({ ...row, positionId: BigInt(row.positionId), amount: BigInt(row.amount) }));
  }

  return { summary, orders, triggerOrders, positions, funding, getOptionPosition, getPerpPosition, history };
}
