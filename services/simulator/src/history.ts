import { SYMBOL_VOLATILITY, toCents, toFeedPrice } from "./priceModel.js";
import { gaussian, type Rng } from "./prng.js";

/// Base volatility of the drawn history, per minute. Higher than the live driver's, so five-minute
/// candles have visible bodies and wicks.
export const HISTORY_SIGMA_PER_MINUTE = 0.0018;

/// One simulated price per minute, oldest first, for the `minutes` before `endPrice`. The path is a
/// random walk with drift that changes every 45 to 120 minutes (a market has moods), pinned to end
/// at `endPrice` so the history joins the real prices without a jump.
export function generateHistory(options: { symbol: string; endPrice: number; minutes: number; rng: Rng; sigmaPerMinute?: number }): number[] {
  const { symbol, endPrice, minutes, rng } = options;
  if (!Number.isInteger(minutes) || minutes < 2) throw new Error("history: ask for at least 2 minutes");
  const sigma = (options.sigmaPerMinute ?? HISTORY_SIGMA_PER_MINUTE) * (SYMBOL_VOLATILITY[symbol] ?? 1);

  // The walk, in log-price, with a drift that changes from time to time.
  const walk: number[] = [0];
  let drift = gaussian(rng) * 0.0004;
  let untilChange = 45 + Math.floor(rng() * 75);
  for (let i = 1; i <= minutes; i++) {
    if (--untilChange <= 0) {
      drift = gaussian(rng) * 0.0004;
      untilChange = 45 + Math.floor(rng() * 75);
    }
    walk.push(walk[i - 1]! + drift + sigma * gaussian(rng));
  }

  // Pin the far end to zero (a bridge), so the last price equals `endPrice`.
  const last = walk[minutes]!;
  return walk.slice(0, minutes).map((value, i) => toCents(endPrice * Math.exp(value - (i / minutes) * last)));
}

export interface TickRow {
  marketId: string;
  price: bigint;
  at: Date;
}

/// The rows for one market: minute `k` (0 is the oldest) of a history that ends at `endsAt`.
export function historyRows(marketId: string, prices: readonly number[], endsAt: Date): TickRow[] {
  return prices.map((price, i) => ({
    marketId,
    price: toFeedPrice(price),
    at: new Date(endsAt.getTime() - (prices.length - i) * 60_000),
  }));
}

const HEX = /^0x[0-9a-fA-F]{64}$/;

/// INSERT statements for the rows, in chunks. Every value is checked and quoted here, and none comes
/// from anything but the database and this generator.
export function insertStatements(rows: readonly TickRow[], chunk = 500): string[] {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += chunk) {
    const values = rows.slice(start, start + chunk).map((row) => {
      if (!HEX.test(row.marketId)) throw new Error(`history: not a market id: ${row.marketId}`);
      if (row.price <= 0n) throw new Error("history: a price must be positive");
      return `('${row.marketId}', '${row.price.toString()}', '${row.at.toISOString()}')`;
    });
    statements.push(`INSERT INTO price_ticks (market_id, price, sampled_at) VALUES ${values.join(", ")};`);
  }
  return statements;
}

/// DELETE statements that clear each market's ticks from `from` onwards, so a redrawn window replaces
/// what the indexer recorded there (a flat line, when nothing moved the mock price).
export function deleteStatements(marketIds: readonly string[], from: Date): string[] {
  if (Number.isNaN(from.getTime())) throw new Error("history: not a date");
  return marketIds.map((marketId) => {
    if (!HEX.test(marketId)) throw new Error(`history: not a market id: ${marketId}`);
    return `DELETE FROM price_ticks WHERE market_id = '${marketId}' AND sampled_at >= '${from.toISOString()}';`;
  });
}
