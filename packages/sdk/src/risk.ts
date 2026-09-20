import type { ContractAddresses } from "@orionis/config";
import type { Hex } from "@orionis/types";
import { riskManagerAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { createApiGet } from "./api.js";
import { MarketPausedError, mapError, OrionisContractError } from "./errors.js";
import type { MarketsNamespace } from "./markets.js";
import { resolveMarketId } from "./utils.js";

/// Per-market risk parameters from RiskManager (PROJECT_BRIEF.md Section 19). Leverage tiers
/// come from here so no client hardcodes the 1x/2x/3x/5x/10x list (Section 11).
export interface RiskInfo {
  maxLeverage: bigint;
  /// Whole-number leverage multiples the market accepts, ascending.
  allowedLeverageTiers: bigint[];
  initialMarginRateBps: bigint;
  maintenanceMarginRateBps: bigint;
  maxPositionNotional: bigint;
  openInterestCap: bigint;
}

export interface OpenInterest {
  long: bigint;
  short: bigint;
  /// `long + short`, the figure RiskManager checks against `openInterestCap`.
  total: bigint;
}

/// Open interest at one moment, rebuilt from the indexed position events.
export interface OpenInterestPoint {
  /// Unix seconds, the start of the bucket.
  time: number;
  long: bigint;
  short: bigint;
}

export type OpenInterestRange = "24h" | "7d" | "30d";

export interface RiskNamespace {
  /// Long and short open interest over time, from `services/indexer` via the API. Requires
  /// `apiUrl`. Display data; `openInterest` is what the chain enforces.
  openInterestHistory(marketIdOrSymbol: string, range?: OpenInterestRange): Promise<OpenInterestPoint[]>;
  get(marketIdOrSymbol: string): Promise<RiskInfo>;
  /// Notional currently open on each side, read from RiskManager.
  openInterest(marketIdOrSymbol: string): Promise<OpenInterest>;
}

export function createRisk(client: OrionisClient, addresses: ContractAddresses, apiUrl?: string): RiskNamespace {
  const apiGet = createApiGet(apiUrl);

  async function get(marketIdOrSymbol: string): Promise<RiskInfo> {
    const config = await client.readContract({
      address: addresses.riskManager,
      abi: riskManagerAbi,
      functionName: "getRiskConfig",
      args: [resolveMarketId(marketIdOrSymbol)],
    });
    return {
      maxLeverage: config.maxLeverage,
      allowedLeverageTiers: [...config.allowedLeverageTiers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      initialMarginRateBps: config.initialMarginRateBps,
      maintenanceMarginRateBps: config.maintenanceMarginRateBps,
      maxPositionNotional: config.maxPositionNotional,
      openInterestCap: config.openInterestCap,
    };
  }

  async function openInterest(marketIdOrSymbol: string): Promise<OpenInterest> {
    const marketId = resolveMarketId(marketIdOrSymbol);
    const [long, short] = await Promise.all([
      client.readContract({ address: addresses.riskManager, abi: riskManagerAbi, functionName: "openInterestLong", args: [marketId] }),
      client.readContract({ address: addresses.riskManager, abi: riskManagerAbi, functionName: "openInterestShort", args: [marketId] }),
    ]);
    return { long, short, total: long + short };
  }

  async function openInterestHistory(marketIdOrSymbol: string, range: OpenInterestRange = "7d"): Promise<OpenInterestPoint[]> {
    const rows = await apiGet<Array<{ time: number; long: string; short: string }>>(
      "risk.openInterestHistory",
      `/v1/perps/${marketIdOrSymbol}/open-interest?range=${range}`,
    );
    return rows.map((row) => ({ time: row.time, long: BigInt(row.long), short: BigInt(row.short) }));
  }

  return { get, openInterest, openInterestHistory };
}

/// Runs RiskManager's own `check*` view functions (each reverts with a custom error when a rule
/// is broken) plus the market's active/enabled flags, and returns the decoded violations. The
/// contract stays the source of truth: this only asks it, it never re-implements the rules.
export async function collectRiskViolations(
  client: OrionisClient,
  addresses: ContractAddresses,
  markets: MarketsNamespace,
  params: { marketId: Hex; isLong: boolean; notional: bigint; leverage?: bigint; needs: "perps" | "options" },
): Promise<OrionisContractError[]> {
  const { marketId, isLong, notional, leverage } = params;
  const violations: OrionisContractError[] = [];

  const calls: Array<() => Promise<unknown>> = [
    () =>
      client.readContract({
        address: addresses.riskManager,
        abi: riskManagerAbi,
        functionName: "checkPositionSize",
        args: [marketId, notional],
      }),
    () =>
      client.readContract({
        address: addresses.riskManager,
        abi: riskManagerAbi,
        functionName: "checkOpenInterest",
        args: [marketId, isLong, notional],
      }),
  ];
  if (leverage !== undefined) {
    calls.push(() =>
      client.readContract({
        address: addresses.riskManager,
        abi: riskManagerAbi,
        functionName: "checkLeverage",
        args: [marketId, leverage],
      }),
    );
  }

  await Promise.all(
    calls.map(async (call) => {
      try {
        await call();
      } catch (error) {
        const mapped = mapError(error);
        if (mapped instanceof OrionisContractError) violations.push(mapped);
        else throw mapped;
      }
    }),
  );

  const config = await markets.get(marketId);
  const enabled = params.needs === "perps" ? config.perpsEnabled : config.optionsEnabled;
  if (!config.active || !enabled) {
    violations.push(new MarketPausedError("MarketPaused", [marketId]));
  }
  return violations;
}
