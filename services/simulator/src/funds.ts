import type { AlphaMarkets } from "@alphamarkets/sdk";
import { parseAbi, parseUnits, type Address, type PublicClient, type WalletClient } from "viem";
import { dollars } from "./format.js";

const tokenAbi = parseAbi(["function mint(address to, uint256 amount)"]);

/// Tops the wallet's vault balance up to `targetUsd`. The testnet settlement token is a mock with a
/// public `mint`, so the collateral costs nothing but gas. Returns the dollars deposited (0 when the
/// balance was already enough).
export async function ensureCollateral(options: {
  alphaMarkets: AlphaMarkets;
  publicClient: PublicClient;
  walletClient: WalletClient;
  token: Address;
  decimals: number;
  targetUsd: number;
  /// Deposit only when the balance is under this many dollars.
  belowUsd: number;
}): Promise<number> {
  const { alphaMarkets, publicClient, walletClient, token, decimals } = options;
  const account = walletClient.account;
  if (!account) throw new Error("ensureCollateral: the wallet client needs an account");

  const available = dollars(await alphaMarkets.vault.availableBalance(account.address, token), decimals);
  if (available >= options.belowUsd) return 0;

  const needed = parseUnits(String(Math.ceil(options.targetUsd - available)), decimals);
  const inWallet = await alphaMarkets.erc20.balanceOf(token, account.address);
  if (inWallet < needed) {
    const hash = await walletClient.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [account.address, needed - inWallet], account, chain: walletClient.chain });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  await alphaMarkets.erc20.approve(token, alphaMarkets.addresses.vault, needed, { wait: true });
  await alphaMarkets.vault.deposit(token, needed, { wait: true });
  return dollars(needed, decimals);
}
