import type { ContractAddresses } from "@orionis/config";
import type { Address, Hex } from "@orionis/types";
import { crossMarginAbi, insuranceFundAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError } from "./errors.js";
import { executeTx, type TxOptions } from "./transactions.js";

/// Cross margin, other collateral and portfolio margin (PROJECT_BRIEF.md Sections 39 and 40), read
/// from `CrossMarginManager`. Open a cross position with `perps.openPosition({ marginMode: "CROSS" })`.
///
/// An account's health is its `equity` against a `requirement`, in settlement-token base units, and it
/// is liquidatable once equity is under the requirement. Equity is the free balance, plus the margin and
/// unrealised PnL of every open cross position, plus the haircut value of other collateral. These
/// numbers come from the contract, so they are what liquidation itself uses.
export interface AccountHealth {
  /// Can be negative.
  equity: bigint;
  requirement: bigint;
  /// `equity - requirement`: how much the account can lose before it is liquidatable.
  buffer: bigint;
  liquidatable: boolean;
  hasCrossPositions: boolean;
  portfolioMargin: boolean;
}

export interface CollateralAsset {
  token: Address;
  /// Share of the token's oracle value that counts, in basis points.
  factorBps: number;
  priceMarketId: Hex;
  enabled: boolean;
}

export interface CrossMarginNamespace {
  supported(): boolean;
  health(user: Address): Promise<AccountHealth>;
  /// The open cross positions' ids, then every id ever marked cross (closed ones included).
  positions(user: Address): Promise<bigint[]>;
  /// The position that would be liquidated first if the account fell under its requirement.
  worstPosition(user: Address): Promise<bigint>;
  /// Other collateral tokens the deployment counts, with their haircut.
  collateral(): Promise<CollateralAsset[]>;
  /// Opts the wallet's cross account in (or out) of portfolio margin, where the requirement is the
  /// worst loss across price shocks and a hedged book is charged less than the sum of its parts.
  setPortfolioMargin(enabled: boolean, tx?: TxOptions): Promise<Hex>;
  /// Counts one of the wallet's open long option positions in the portfolio-margin requirement.
  addPortfolioOption(optionPositionId: bigint, tx?: TxOptions): Promise<Hex>;
  /// The insurance fund's holdings of `token` (settlement-token by default), which pay a liquidated
  /// position's shortfall.
  insuranceFundBalance(token?: Address): Promise<bigint>;
}

export function createCrossMargin(client: OrionisClient, addresses: ContractAddresses): CrossMarginNamespace {
  function manager(method: string): Address {
    if (!addresses.crossMargin) throw new NotImplementedError(method, "this deployment has no CrossMarginManager (it needs a deployment made after [1.3.0])");
    return addresses.crossMargin;
  }

  return {
    supported: () => Boolean(addresses.crossMargin),

    async health(user) {
      const address = manager("crossMargin.health");
      const [[equity, requirement], liquidatable, hasCrossPositions, portfolioMargin] = await Promise.all([
        client.readContract({ address, abi: crossMarginAbi, functionName: "accountHealth", args: [user] }),
        client.readContract({ address, abi: crossMarginAbi, functionName: "isAccountLiquidatable", args: [user] }),
        client.readContract({ address, abi: crossMarginAbi, functionName: "hasOpenCrossPosition", args: [user] }),
        client.readContract({ address, abi: crossMarginAbi, functionName: "portfolioMargin", args: [user] }),
      ]);
      return { equity, requirement, buffer: equity - requirement, liquidatable, hasCrossPositions, portfolioMargin };
    },

    positions: async (user) => [...(await client.readContract({ address: manager("crossMargin.positions"), abi: crossMarginAbi, functionName: "crossPositionsOf", args: [user] }))],

    worstPosition: async (user) => client.readContract({ address: manager("crossMargin.worstPosition"), abi: crossMarginAbi, functionName: "worstPosition", args: [user] }),

    async collateral() {
      const address = manager("crossMargin.collateral");
      const tokens: Address[] = [];
      // `collateralTokens` is a public array: read it until the index is out of range.
      for (let index = 0n; ; index++) {
        try {
          tokens.push(await client.readContract({ address, abi: crossMarginAbi, functionName: "collateralTokens", args: [index] }));
        } catch {
          break;
        }
      }
      return Promise.all(
        tokens.map(async (token) => {
          const [enabled, factorBps, priceMarketId] = await client.readContract({ address, abi: crossMarginAbi, functionName: "collateralConfig", args: [token] });
          return { token, enabled, factorBps: Number(factorBps), priceMarketId };
        }),
      );
    },

    async setPortfolioMargin(enabled, tx) {
      const address = manager("crossMargin.setPortfolioMargin");
      const { hash } = await executeTx(client, () => client.simulateContract({ address, abi: crossMarginAbi, functionName: "setPortfolioMargin", args: [enabled] }), tx);
      return hash;
    },

    async addPortfolioOption(optionPositionId, tx) {
      const address = manager("crossMargin.addPortfolioOption");
      const { hash } = await executeTx(client, () => client.simulateContract({ address, abi: crossMarginAbi, functionName: "addPortfolioOption", args: [optionPositionId] }), tx);
      return hash;
    },

    async insuranceFundBalance(token = addresses.settlementToken) {
      if (!addresses.insuranceFund) throw new NotImplementedError("crossMargin.insuranceFundBalance", "this deployment has no InsuranceFund (it needs a deployment made after [1.3.0])");
      return client.readContract({ address: addresses.insuranceFund, abi: insuranceFundAbi, functionName: "balance", args: [token] });
    },
  };
}
