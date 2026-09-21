import type { AlphaMarkets } from "@alphamarkets/sdk";
import { parseAbi, type Address, type PublicClient, type WalletClient } from "viem";
import { describe, symbolOf } from "./format.js";

const engineAbi = parseAbi([
  "function isLiquidatable(uint256 positionId) view returns (bool)",
  "function liquidate(uint256 positionId)",
]);

export interface Liquidator {
  address: Address;
  /// Liquidates every watched position that is under its maintenance margin. Never throws.
  tick(): Promise<number>;
}

/// Anyone may call `LiquidationEngine.liquidate` and the caller earns 5% of the position's margin, so
/// this is a plain bot with a wallet. It is the only thing that liquidates on testnet: the keeper does not.
///
/// It checks the positions the bots already know about, one cheap read each. Reading every wallet's
/// whole portfolio every few seconds costs dozens of RPC calls a round, which a rate-limited key does
/// not allow. Wallets outside the bots (yours, for a demo) are read every `walletEvery` rounds.
export function createLiquidator(options: {
  alphaMarkets: AlphaMarkets;
  publicClient: PublicClient;
  walletClient: WalletClient;
  engine: Address;
  /// The open positions the bots know about. The liquidator removes one it has liquidated.
  book: Set<bigint>;
  /// Other wallets to watch, whose positions the bots do not track.
  wallets: () => Address[];
  /// Read those wallets once every this many rounds.
  walletEvery?: number;
  log: (message: string) => void;
}): Liquidator {
  const { alphaMarkets, publicClient, walletClient, engine, book, log } = options;
  if (!walletClient.account) throw new Error("liquidator: the wallet client needs an account");
  // Kept in a const so the check above still holds inside the functions below.
  const account = walletClient.account;
  const walletEvery = options.walletEvery ?? 3;
  let round = 0;

  async function candidates(): Promise<bigint[]> {
    const ids = new Set(book);
    if (round++ % walletEvery === 0) {
      for (const owner of options.wallets()) {
        try {
          for (const position of (await alphaMarkets.portfolio.positions(owner)).perps) if (position.open) ids.add(position.positionId);
        } catch (error) {
          log(`liquidator: could not read ${owner}: ${describe(error)}`);
        }
      }
    }
    return [...ids];
  }

  async function tick(): Promise<number> {
    let liquidated = 0;
    for (const id of await candidates()) {
      try {
        const due = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "isLiquidatable", args: [id] });
        if (!due) continue;
        const position = await alphaMarkets.portfolio.getPerpPosition(id);
        const { request } = await publicClient.simulateContract({ address: engine, abi: engineAbi, functionName: "liquidate", args: [id], account });
        const hash = await walletClient.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        book.delete(id);
        liquidated++;
        log(`liquidator: LIQUIDATED ${position.isLong ? "LONG" : "SHORT"} ${symbolOf(position.marketId)} #${id} of ${position.owner.slice(0, 8)}… (${hash})`);
      } catch (error) {
        log(`liquidator: could not liquidate #${id}: ${describe(error)}`);
      }
    }
    return liquidated;
  }

  return { address: account.address, tick };
}
