import type { AlphaMarkets } from "@alphamarkets/sdk";
import type { Address, PublicClient, WalletClient } from "viem";
import { decide, nextDelayMs, type MarketView, type Persona, type PositionView } from "./personas.js";
import { fromFeedPrice } from "./priceModel.js";
import { between, type Rng } from "./prng.js";
import { describe, dollars, symbolOf, usd } from "./format.js";
import { ensureCollateral } from "./funds.js";

export interface BotDeps {
  persona: Persona;
  alphaMarkets: AlphaMarkets;
  publicClient: PublicClient;
  walletClient: WalletClient;
  token: Address;
  decimals: number;
  rng: Rng;
  markets: () => MarketView[];
  log: (message: string) => void;
}

export interface Bot {
  id: string;
  address: Address;
  /// Runs one decision if it is due. Never throws: a failed trade is logged and the bot moves on.
  tick(now: number): Promise<void>;
}

export function createBot(deps: BotDeps): Bot {
  const { persona, alphaMarkets, publicClient, walletClient, token, decimals, rng, log } = deps;
  const account = walletClient.account;
  if (!account) throw new Error(`${persona.id}: the wallet client needs an account`);
  const address = account.address;
  const say = (message: string) => log(`${persona.id}: ${message}`);

  let nextAt = 0;
  /// When each position was first seen. A restart forgets the real time, which only shifts a hold.
  const seen = new Map<bigint, number>();

  async function positions(now: number, markets: readonly MarketView[]): Promise<PositionView[]> {
    const { perps } = await alphaMarkets.portfolio.positions(address);
    const open = perps.filter((position) => position.open);
    const ids = new Set(open.map((position) => position.positionId));
    for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);

    return open.flatMap((position) => {
      const symbol = symbolOf(position.marketId);
      const market = markets.find((m) => m.symbol === symbol);
      if (!market) return [];
      if (!seen.has(position.positionId)) seen.set(position.positionId, now);
      const entry = fromFeedPrice(position.entryPrice);
      const size = dollars(position.size, decimals);
      const margin = dollars(position.collateral, decimals);
      const move = position.isLong ? market.price - entry : entry - market.price;
      const pnl = entry === 0 ? 0 : (size * move) / entry;
      return [{ id: position.positionId, symbol, side: position.isLong ? ("LONG" as const) : ("SHORT" as const), pnlPct: margin === 0 ? 0 : (pnl / margin) * 100, openedAt: seen.get(position.positionId)! }];
    });
  }

  async function tick(now: number): Promise<void> {
    if (now < nextAt) return;
    nextAt = now + nextDelayMs(persona, rng);
    try {
      const markets = deps.markets();
      if (markets.length === 0) return;

      await ensureCollateral({ alphaMarkets, publicClient, walletClient, token, decimals, targetUsd: persona.depositUsd, belowUsd: persona.depositUsd * 0.25 }).then((added) => {
        if (added > 0) say(`topped up the vault with ${usd(added)}`);
      });

      const open = await positions(now, markets);
      const available = dollars(await alphaMarkets.vault.availableBalance(address, token), decimals);
      const action = decide(persona, { now, markets, open, available }, rng);

      if (action.kind === "open") {
        const { positionId } = await alphaMarkets.perps.openPosition({
          market: action.symbol,
          side: action.side,
          collateral: String(action.collateral),
          leverage: action.leverage,
          tx: { wait: true },
        });
        seen.set(positionId, now);
        say(`opened ${action.side} ${action.symbol} ${usd(action.collateral * action.leverage)} at ${action.leverage}x (#${positionId})`);
      } else if (action.kind === "close") {
        const position = open.find((p) => p.id === action.id);
        await alphaMarkets.perps.closePosition(action.id, { tx: { wait: true } });
        seen.delete(action.id);
        say(`closed ${position?.side ?? ""} ${position?.symbol ?? ""} #${action.id} (${action.reason}, ${position ? position.pnlPct.toFixed(1) : "?"}% on margin)`.replace(/\s+/g, " "));
      }
    } catch (error) {
      say(`could not trade: ${describe(error)}`);
      // Try again soon, not after a whole delay.
      nextAt = now + between(rng, 10_000, 30_000);
    }
  }

  return { id: persona.id, address, tick };
}
