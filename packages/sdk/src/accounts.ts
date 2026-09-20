import type { ContractAddresses } from "@alphamarkets/config";
import type { Address, Hex } from "@alphamarkets/types";
import { subaccountAbi, subaccountFactoryAbi } from "./abis.js";
import { toBaseUnits, type Amount } from "./amounts.js";
import type { AlphaMarketsClient } from "./client.js";
import type { Erc20Namespace } from "./erc20.js";
import { NotImplementedError, AlphaMarketsError } from "./errors.js";
import { executeTx, type TxOptions } from "./transactions.js";
import type { PreparedTx } from "./trading.js";
import type { VaultBalances, VaultNamespace } from "./vault.js";

/// Subaccounts (PROJECT_BRIEF.md Section 40). A subaccount is a small contract wallet owned by one
/// address: the engines see it as the trader, so its Vault balance, positions, orders and margin are
/// separate from the owner's main account and from every other subaccount. The owner (or a delegate
/// it names, such as a bot or a desk trader) trades through `execute` / `multicall`; only the owner
/// can `deposit` and `withdraw`, and a withdrawal always goes to the owner.
///
/// To trade from a subaccount, build the transaction with `alphaMarkets.trading.prepare*` and send it with
/// `execute`, or send several as one all-or-nothing `multicall` (how a multi-leg package opens
/// without one leg filling and the other failing).
export interface Subaccount {
  address: Address;
  index: bigint;
}

export interface SubaccountsNamespace {
  /// Whether the deployment has a `SubaccountFactory`.
  supported(): boolean;
  /// Where the owner's subaccount number `index` is, or will be once created.
  computeAddress(owner: Address, index: bigint): Promise<Address>;
  list(owner: Address): Promise<Subaccount[]>;
  /// Creates the wallet's subaccount number `index` and returns its address.
  create(index: bigint, tx?: TxOptions): Promise<{ hash: Hex; address: Address }>;
  /// Approves the subaccount for `amount` of the token, then deposits it into the subaccount's Vault
  /// balance. The wallet must be the owner.
  deposit(subaccount: Address, amount: Amount, options?: { token?: Address; tx?: TxOptions }): Promise<Hex>;
  /// Withdraws from the subaccount's Vault balance to the owner's wallet. The wallet must be the owner.
  withdraw(subaccount: Address, amount: Amount, options?: { token?: Address; tx?: TxOptions }): Promise<Hex>;
  setDelegate(subaccount: Address, delegate: Address, allowed: boolean, tx?: TxOptions): Promise<Hex>;
  isDelegate(subaccount: Address, delegate: Address): Promise<boolean>;
  balances(subaccount: Address, token?: Address): Promise<VaultBalances>;
  /// Sends one prepared engine call as the subaccount. The wallet must be the owner or a delegate.
  execute(subaccount: Address, call: PreparedTx, tx?: TxOptions): Promise<Hex>;
  /// Sends several prepared engine calls as the subaccount in one transaction, all or nothing.
  multicall(subaccount: Address, calls: PreparedTx[], tx?: TxOptions): Promise<Hex>;
}

export interface SubaccountsDeps {
  client: AlphaMarketsClient;
  addresses: ContractAddresses;
  vault: VaultNamespace;
  erc20: Erc20Namespace;
  decimals: (token: Address) => Promise<number>;
}

export function createSubaccounts(deps: SubaccountsDeps): SubaccountsNamespace {
  const { client, addresses, vault, erc20, decimals } = deps;

  function factory(method: string): Address {
    if (!addresses.subaccountFactory) throw new NotImplementedError(method, "this deployment has no SubaccountFactory (it needs a deployment made after [1.3.0])");
    return addresses.subaccountFactory;
  }

  return {
    supported: () => Boolean(addresses.subaccountFactory),

    computeAddress: async (owner, index) =>
      client.readContract({ address: factory("subaccounts.computeAddress"), abi: subaccountFactoryAbi, functionName: "computeAddress", args: [owner, index] }),

    async list(owner) {
      const found = await client.readContract({ address: factory("subaccounts.list"), abi: subaccountFactoryAbi, functionName: "subaccountsOf", args: [owner] });
      return Promise.all(found.map(async (address) => ({ address, index: await client.readContract({ address, abi: subaccountAbi, functionName: "index" }) })));
    },

    async create(index, tx) {
      const address = factory("subaccounts.create");
      const { hash } = await executeTx(client, () => client.simulateContract({ address, abi: subaccountFactoryAbi, functionName: "createSubaccount", args: [index] }), tx);
      const created = await client.readContract({ address, abi: subaccountFactoryAbi, functionName: "computeAddress", args: [client.account!.address, index] });
      return { hash, address: created };
    },

    async deposit(subaccount, amount, options = {}) {
      const token = options.token ?? addresses.settlementToken;
      const value = toBaseUnits(amount, await decimals(token));
      await erc20.approve(token, subaccount, value, options.tx);
      const { hash } = await executeTx(client, () => client.simulateContract({ address: subaccount, abi: subaccountAbi, functionName: "deposit", args: [token, value] }), options.tx);
      return hash;
    },

    async withdraw(subaccount, amount, options = {}) {
      const token = options.token ?? addresses.settlementToken;
      const value = toBaseUnits(amount, await decimals(token));
      const { hash } = await executeTx(client, () => client.simulateContract({ address: subaccount, abi: subaccountAbi, functionName: "withdraw", args: [token, value] }), options.tx);
      return hash;
    },

    async setDelegate(subaccount, delegate, allowed, tx) {
      const { hash } = await executeTx(client, () => client.simulateContract({ address: subaccount, abi: subaccountAbi, functionName: "setDelegate", args: [delegate, allowed] }), tx);
      return hash;
    },

    isDelegate: (subaccount, delegate) => client.readContract({ address: subaccount, abi: subaccountAbi, functionName: "isDelegate", args: [delegate] }),

    balances: (subaccount, token = addresses.settlementToken) => vault.balances(subaccount, token),

    async execute(subaccount, call, tx) {
      const { hash } = await executeTx(client, () => client.simulateContract({ address: subaccount, abi: subaccountAbi, functionName: "execute", args: [call.to, call.data] }), tx);
      return hash;
    },

    async multicall(subaccount, calls, tx) {
      if (calls.length === 0) throw new AlphaMarketsError("subaccounts.multicall: at least one call is needed");
      const { hash } = await executeTx(
        client,
        () => client.simulateContract({ address: subaccount, abi: subaccountAbi, functionName: "multicall", args: [calls.map((call) => call.to), calls.map((call) => call.data)] }),
        tx,
      );
      return hash;
    },
  };
}
