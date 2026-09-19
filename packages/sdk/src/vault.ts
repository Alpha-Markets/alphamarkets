import type { ContractAddresses } from "@orionis/config";
import type { Address, Hex } from "@orionis/types";
import { collateralManagerAbi, vaultAbi } from "./abis.js";
import { toBaseUnits, type Amount } from "./amounts.js";
import type { OrionisClient } from "./client.js";
import { executeTx, type TxOptions } from "./transactions.js";

export interface VaultBalances {
  /// Raw ledger balance, before locked margin is subtracted.
  balance: bigint;
  lockedMargin: bigint;
  available: bigint;
}

export interface VaultNamespace {
  /// Requires prior `erc20.approve(token, vaultAddress, amount)`. `amount` is a raw base-unit
  /// `bigint` or a decimal string scaled by the token's decimals.
  deposit(token: Address, amount: Amount, tx?: TxOptions): Promise<Hex>;
  withdraw(token: Address, amount: Amount, tx?: TxOptions): Promise<Hex>;
  availableBalance(user: Address, token: Address): Promise<bigint>;
  /// Raw ledger balance before locked margin is subtracted (CollateralManager).
  balanceOf(user: Address, token: Address): Promise<bigint>;
  lockedMargin(user: Address, token: Address): Promise<bigint>;
  /// All three balance figures for one user/token in one call.
  balances(user: Address, token: Address): Promise<VaultBalances>;
}

export function createVault(
  client: OrionisClient,
  addresses: ContractAddresses,
  decimals: (token: Address) => Promise<number>,
): VaultNamespace {
  async function deposit(token: Address, amount: Amount, tx?: TxOptions) {
    const value = toBaseUnits(amount, await decimals(token));
    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.vault,
          abi: vaultAbi,
          functionName: "deposit",
          args: [token, value],
        }),
      tx,
    );
    return hash;
  }

  async function withdraw(token: Address, amount: Amount, tx?: TxOptions) {
    const value = toBaseUnits(amount, await decimals(token));
    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.vault,
          abi: vaultAbi,
          functionName: "withdraw",
          args: [token, value],
        }),
      tx,
    );
    return hash;
  }

  async function availableBalance(user: Address, token: Address) {
    return client.readContract({
      address: addresses.vault,
      abi: vaultAbi,
      functionName: "availableBalance",
      args: [user, token],
    });
  }

  async function balanceOf(user: Address, token: Address) {
    return client.readContract({
      address: addresses.collateralManager,
      abi: collateralManagerAbi,
      functionName: "balanceOf",
      args: [user, token],
    });
  }

  async function lockedMargin(user: Address, token: Address) {
    return client.readContract({
      address: addresses.vault,
      abi: vaultAbi,
      functionName: "lockedMargin",
      args: [user, token],
    });
  }

  async function balances(user: Address, token: Address): Promise<VaultBalances> {
    const [balance, locked, available] = await Promise.all([
      balanceOf(user, token),
      lockedMargin(user, token),
      availableBalance(user, token),
    ]);
    return { balance, lockedMargin: locked, available };
  }

  return { deposit, withdraw, availableBalance, balanceOf, lockedMargin, balances };
}
