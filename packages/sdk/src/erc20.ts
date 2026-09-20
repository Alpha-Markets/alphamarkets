import type { Address, Hex } from "@alphamarkets/types";
import { erc20Abi } from "./abis.js";
import type { AlphaMarketsClient } from "./client.js";
import { toBaseUnits, type Amount } from "./amounts.js";
import { executeTx, type TxOptions } from "./transactions.js";

/// Not scoped to one address — collateral/underlying tokens vary per market
/// (`MarketConfig.underlyingToken`, `settlementToken`), so every method takes `token`.
export interface Erc20Namespace {
  /// `amount` is a raw base-unit `bigint` or a decimal string scaled by the token's decimals.
  approve(token: Address, spender: Address, amount: Amount, tx?: TxOptions): Promise<Hex>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  balanceOf(token: Address, account: Address): Promise<bigint>;
  decimals(token: Address): Promise<number>;
}

/// Token decimals never change after deployment, so they are read once per token per client.
export function createDecimalsReader(client: AlphaMarketsClient) {
  const cache = new Map<Address, Promise<number>>();
  return (token: Address): Promise<number> => {
    let decimals = cache.get(token);
    if (!decimals) {
      decimals = client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
      cache.set(token, decimals);
      // Do not cache a failed read.
      decimals.catch(() => cache.delete(token));
    }
    return decimals;
  };
}

export function createErc20(client: AlphaMarketsClient, decimals: (token: Address) => Promise<number>): Erc20Namespace {
  async function approve(token: Address, spender: Address, amount: Amount, tx?: TxOptions) {
    const value = toBaseUnits(amount, await decimals(token));
    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, value],
        }),
      tx,
    );
    return hash;
  }

  async function allowance(token: Address, owner: Address, spender: Address) {
    return client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
  }

  async function balanceOf(token: Address, account: Address) {
    return client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    });
  }

  return { approve, allowance, balanceOf, decimals };
}
