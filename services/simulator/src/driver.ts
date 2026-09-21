import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Account, type Address, type PublicClient, type WalletClient } from "viem";
import { readNudges } from "./control.js";
import { describe } from "./format.js";
import { CALM_MARKET, CALM_SIGMA, SYMBOL_VOLATILITY, fromFeedPrice, planNudge, stepMarkets, toFeedPrice, type MarketModel, type ModelOptions, type Nudge } from "./priceModel.js";
import type { Rng } from "./prng.js";

const feedAbi = parseAbi([
  "function owner() view returns (address)",
  "function latestPrice() view returns (uint256 price, uint256 timestamp)",
  "function setPrice(uint256 price)",
]);
const routerAbi = parseAbi(["function primarySource(bytes32 marketId) view returns (address)"]);

export interface PriceDriver {
  /// The current simulated prices.
  markets(): MarketModel[];
  /// One step: read new nudge requests, move every market, push the new prices to the feeds.
  tick(): Promise<void>;
}

interface SavedState {
  anchors: Record<string, number>;
}

function loadAnchors(dir: string): Record<string, number> {
  const path = join(dir, "state.json");
  if (!existsSync(path)) return {};
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as SavedState).anchors ?? {};
  } catch {
    return {};
  }
}

/// Reads each feed's current price to start from it, and the saved anchors so a restart does not
/// re-anchor at a price that has already drifted.
export async function createPriceDriver(options: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  router: Address;
  marketIds: ReadonlyArray<{ symbol: string; marketId: `0x${string}` }>;
  stateDir: string;
  rng: Rng;
  model?: ModelOptions;
  /// Scales every market's volatility: 1 is calm, 2 makes the charts twice as lively.
  volatility?: number;
  /// Time between steps.
  tickMs: number;
  log: (message: string) => void;
}): Promise<PriceDriver> {
  const { publicClient, walletClient, router, stateDir, rng, log } = options;
  if (!walletClient.account) throw new Error("price driver: the wallet client needs an account");
  // Kept in a const so the check above still holds inside the functions below.
  const account: Account = walletClient.account;
  const model = options.model ?? CALM_MARKET;
  const tickSeconds = options.tickMs / 1000;

  const saved = loadAnchors(stateDir);
  const feeds = new Map<string, Address>();
  /// The price each feed holds now, so a step sends only what changed.
  const lastPushed = new Map<string, bigint>();
  let markets: MarketModel[] = [];

  for (const { symbol, marketId } of options.marketIds) {
    const feed = await publicClient.readContract({ address: router, abi: routerAbi, functionName: "primarySource", args: [marketId] });
    const owner = await publicClient.readContract({ address: feed, abi: feedAbi, functionName: "owner" });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`price driver: ${account.address} does not own the ${symbol} feed (${feed}, owned by ${owner}). Use the keeper's key (KEEPER_PRIVATE_KEY).`);
    }
    const [raw] = await publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestPrice" });
    const price = fromFeedPrice(raw);
    feeds.set(symbol, feed);
    lastPushed.set(symbol, raw);
    markets.push({ symbol, price, anchor: saved[symbol] ?? price, sigma: CALM_SIGMA * (SYMBOL_VOLATILITY[symbol] ?? 1) * (options.volatility ?? 1) });
  }
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.json"), JSON.stringify({ anchors: Object.fromEntries(markets.map((m) => [m.symbol, m.anchor])) } satisfies SavedState, null, 2));

  let nudges: Nudge[] = [];
  let consumed = readNudges(stateDir, 0).lines; // requests written before this start are old news

  /// The next transaction number of the price wallet. Kept here, so a step can send every changed price
  /// at once without waiting for the one before; read again from the chain after any failure.
  let nonce: number | undefined;
  /// Pushes the markets whose price changed by a cent or more, all at once. Does not wait for the
  /// receipts: at a one second step that would make every step slower than the next one.
  async function push(): Promise<void> {
    const changed = markets.filter((market) => toFeedPrice(market.price) !== lastPushed.get(market.symbol));
    if (changed.length === 0) return;
    if (nonce === undefined) nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const first = nonce;
    nonce += changed.length;

    const results = await Promise.allSettled(
      changed.map((market, i) =>
        walletClient.writeContract({ address: feeds.get(market.symbol)!, abi: feedAbi, functionName: "setPrice", args: [toFeedPrice(market.price)], account, chain: walletClient.chain, nonce: first + i }),
      ),
    );
    results.forEach((result, i) => {
      const market = changed[i]!;
      if (result.status === "fulfilled") {
        lastPushed.set(market.symbol, toFeedPrice(market.price));
        return;
      }
      nonce = undefined;
      log(`prices: could not push ${market.symbol}: ${describe(result.reason)}`);
    });
  }

  return {
    markets: () => markets,
    async tick() {
      const incoming = readNudges(stateDir, consumed);
      consumed = incoming.lines;
      for (const request of incoming.requests) {
        const symbol = request.symbol.toUpperCase();
        if (!markets.some((m) => m.symbol === symbol)) {
          log(`nudge: no market ${symbol}`);
          continue;
        }
        const nudge = planNudge(symbol, request.pct, request.seconds, tickSeconds);
        nudges.push(nudge);
        log(`nudge: ${symbol} ${request.pct > 0 ? "+" : ""}${request.pct}% over about ${Math.round(nudge.remainingSteps * tickSeconds)} seconds`);
      }

      const next = stepMarkets(markets, nudges, rng, model, tickSeconds);
      markets = next.markets;
      nudges = next.nudges;
      await push();
      log(`prices: ${markets.map((m) => `${m.symbol} ${m.price.toFixed(2)}`).join("  ")}`);
    },
  };
}
