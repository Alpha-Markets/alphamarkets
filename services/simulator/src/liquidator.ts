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
export function createLiquidator(options: {
  alphaMarkets: AlphaMarkets;
  publicClient: PublicClient;
  walletClient: WalletClient;
  engine: Address;
  /// The wallets whose positions to watch.
  watch: () => Address[];
  log: (message: string) => void;
}): Liquidator {
  const { alphaMarkets, publicClient, walletClient, engine, log } = options;
  const account = walletClient.account;
  if (!account) throw new Error("liquidator: the wallet client needs an account");

  async function tick(): Promise<number> {
    let liquidated = 0;
    for (const owner of options.watch()) {
      let perps;
      try {
        perps = (await alphaMarkets.portfolio.positions(owner)).perps.filter((p) => p.open);
      } catch (error) {
        log(`liquidator: could not read ${owner}: ${describe(error)}`);
        continue;
      }
      for (const position of perps) {
        try {
          const due = await publicClient.readContract({ address: engine, abi: engineAbi, functionName: "isLiquidatable", args: [position.positionId] });
          if (!due) continue;
          const { request } = await publicClient.simulateContract({ address: engine, abi: engineAbi, functionName: "liquidate", args: [position.positionId], account });
          const hash = await walletClient.writeContract(request);
          await publicClient.waitForTransactionReceipt({ hash });
          liquidated++;
          log(`liquidator: LIQUIDATED ${position.isLong ? "LONG" : "SHORT"} ${symbolOf(position.marketId)} #${position.positionId} of ${owner.slice(0, 8)}… (${hash})`);
        } catch (error) {
          log(`liquidator: could not liquidate #${position.positionId}: ${describe(error)}`);
        }
      }
    }
    return liquidated;
  }

  return { address: account.address, tick };
}
