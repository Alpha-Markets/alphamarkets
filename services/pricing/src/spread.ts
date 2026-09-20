import type { OptionType, QuoteResult } from "./blackScholes.js";

/// A quote split into what a buyer pays and what a seller receives. The protocol is the only
/// counterparty (options are bought from and sold back to the Vault pool), so there is no order
/// book to read a bid or ask from: both come from the model's mark price and a configured spread.
///
/// `premium` stays the mark (the model price) so existing readers keep working. `ask` is what
/// opening pays and `bid` is what closing receives; both are per underlying unit. A spread of 0
/// gives bid = mark = ask, which is today's behaviour.
export interface SpreadQuote extends QuoteResult {
  bid: number;
  ask: number;
}

/// `spreadBps` is the full bid-ask spread as a share of the mark, split evenly around it, and
/// must be in [0, 20000): at 20000 the bid would be 0 and beyond it negative. The bid never goes
/// below 0.
export function applySpread(quote: QuoteResult, spreadBps: number, strike: number, type: OptionType): SpreadQuote {
  if (!Number.isFinite(spreadBps) || spreadBps < 0 || spreadBps >= 20_000) {
    throw new Error(`spread must be in [0, 20000) basis points, received ${spreadBps}`);
  }
  const half = spreadBps / 20_000;
  const ask = quote.premium * (1 + half);
  const bid = Math.max(quote.premium * (1 - half), 0);
  // The buyer pays the ask, so the break-even at expiry moves with it.
  const breakEven = type === "CALL" ? strike + ask : strike - ask;
  return { ...quote, bid, ask, breakEven };
}
