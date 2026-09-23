import { between, pick, type Rng } from "./prng.js";

export type Side = "LONG" | "SHORT";

/// How a trader picks the side of a new position.
export type SidePolicy =
  | { kind: "fixed"; side: Side }
  | { kind: "random"; longBias: number }
  /// Trades with the recent move, once it is at least `minMovePct` percent.
  | { kind: "momentum"; minMovePct: number }
  /// Trades against the recent move, once it is at least `minMovePct` percent.
  | { kind: "contrarian"; minMovePct: number };

export interface Persona {
  id: string;
  symbols: readonly string[];
  /// Margin per position, in dollars (min, max).
  collateral: readonly [number, number];
  leverage: readonly number[];
  maxOpen: number;
  /// A position is never closed voluntarily before the first value, and always after the second.
  holdMs: readonly [number, number];
  /// Time between two decisions (min, max).
  everyMs: readonly [number, number];
  side: SidePolicy;
  /// Close when the profit reaches this percent of the margin.
  takeProfitPct?: number;
  /// Close when the loss reaches this percent of the margin. Absent: ride the position to liquidation.
  stopLossPct?: number;
  /// Rough transactions per hour, to size the gas each wallet needs.
  txPerHour: number;
  /// Collateral to keep deposited in the vault, in dollars.
  depositUsd: number;
}

export interface MarketView {
  symbol: string;
  price: number;
  /// Move over the recent window, in percent.
  returnPct: number;
  maxLeverage: number;
  maxNotional: number;
}

export interface PositionView {
  id: bigint;
  symbol: string;
  side: Side;
  /// Profit or loss as a percent of the margin.
  pnlPct: number;
  openedAt: number;
}

export interface DecisionContext {
  now: number;
  markets: readonly MarketView[];
  open: readonly PositionView[];
  /// Vault balance that can back a new position, in dollars.
  available: number;
}

export type Action =
  | { kind: "open"; symbol: string; side: Side; collateral: number; leverage: number }
  | { kind: "close"; id: bigint; reason: string }
  | { kind: "wait" };

/// Margin plus fees must fit in the balance, and a position stays well under the market's cap.
const FEE_ALLOWANCE = 1.02;
const CAP_SHARE = 0.6;

function chooseSide(policy: SidePolicy, market: MarketView, rng: Rng): Side | undefined {
  switch (policy.kind) {
    case "fixed":
      return policy.side;
    case "random":
      return rng() < policy.longBias ? "LONG" : "SHORT";
    case "momentum":
      if (Math.abs(market.returnPct) < policy.minMovePct) return undefined;
      return market.returnPct > 0 ? "LONG" : "SHORT";
    case "contrarian":
      if (Math.abs(market.returnPct) < policy.minMovePct) return undefined;
      return market.returnPct > 0 ? "SHORT" : "LONG";
  }
}

/// One decision for one trader. Pure: the same inputs and generator give the same action.
export function decide(persona: Persona, context: DecisionContext, rng: Rng): Action {
  for (const position of context.open) {
    const age = context.now - position.openedAt;
    if (persona.takeProfitPct !== undefined && position.pnlPct >= persona.takeProfitPct) {
      return { kind: "close", id: position.id, reason: "take profit" };
    }
    if (persona.stopLossPct !== undefined && position.pnlPct <= -persona.stopLossPct) {
      return { kind: "close", id: position.id, reason: "stop loss" };
    }
    if (age >= persona.holdMs[1]) return { kind: "close", id: position.id, reason: "held long enough" };
    if (age >= persona.holdMs[0] && rng() < 0.35) return { kind: "close", id: position.id, reason: "taking it off" };
  }

  if (context.open.length >= persona.maxOpen) return { kind: "wait" };

  const tradable = context.markets.filter((market) => persona.symbols.includes(market.symbol));
  if (tradable.length === 0) return { kind: "wait" };
  const market = pick(rng, tradable);

  const side = chooseSide(persona.side, market, rng);
  if (!side) return { kind: "wait" };

  const leverages = persona.leverage.filter((l) => l <= market.maxLeverage);
  if (leverages.length === 0) return { kind: "wait" };
  const leverage = pick(rng, leverages);

  const [minCollateral, maxCollateral] = persona.collateral;
  const cap = (CAP_SHARE * market.maxNotional) / leverage;
  const affordable = context.available / FEE_ALLOWANCE;
  const collateral = Math.floor(Math.min(between(rng, minCollateral, maxCollateral), cap, affordable) / 50) * 50;
  // Too little balance, or a market cap too small, for a position this trader would open: skip.
  if (collateral < minCollateral) return { kind: "wait" };

  return { kind: "open", symbol: market.symbol, side, collateral, leverage };
}

export function nextDelayMs(persona: Persona, rng: Rng): number {
  return Math.round(between(rng, persona.everyMs[0], persona.everyMs[1]));
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ALL = ["NVDA", "TSLA", "AAPL", "META", "HOOD", "AMZN", "PLTR", "NFLX", "AMD", "MSFT", "GOOGL", "COIN", "MSTR", "SPY", "QQQ", "AVGO", "JPM", "DIS", "UBER", "SHOP"] as const;

/// The crowd. Big, slow whales; fast scalpers; traders who follow or fade the move; and two 10x
/// degens (one long, one short) that never take a stop, so a move against them ends in liquidation.
export const ROSTER: readonly Persona[] = [
  { id: "whale-1", symbols: ALL, collateral: [6_000, 20_000], leverage: [2, 3], maxOpen: 2, holdMs: [20 * MINUTE, 90 * MINUTE], everyMs: [6 * MINUTE, 15 * MINUTE], side: { kind: "random", longBias: 0.65 }, takeProfitPct: 40, stopLossPct: 25, txPerHour: 5, depositUsd: 200_000 },
  { id: "whale-2", symbols: ["NVDA", "AAPL", "META"], collateral: [5_000, 15_000], leverage: [2, 3], maxOpen: 2, holdMs: [15 * MINUTE, 60 * MINUTE], everyMs: [6 * MINUTE, 15 * MINUTE], side: { kind: "random", longBias: 0.5 }, takeProfitPct: 40, stopLossPct: 25, txPerHour: 5, depositUsd: 150_000 },
  { id: "scalper-1", symbols: ALL, collateral: [300, 1_500], leverage: [3, 5], maxOpen: 2, holdMs: [40 * SECOND, 4 * MINUTE], everyMs: [45 * SECOND, 3 * MINUTE], side: { kind: "random", longBias: 0.5 }, takeProfitPct: 12, stopLossPct: 10, txPerHour: 30, depositUsd: 20_000 },
  { id: "scalper-2", symbols: ["NVDA", "TSLA", "HOOD"], collateral: [300, 1_200], leverage: [3, 5], maxOpen: 2, holdMs: [40 * SECOND, 4 * MINUTE], everyMs: [45 * SECOND, 3 * MINUTE], side: { kind: "random", longBias: 0.55 }, takeProfitPct: 12, stopLossPct: 10, txPerHour: 30, depositUsd: 20_000 },
  { id: "scalper-3", symbols: ["AAPL", "META", "TSLA"], collateral: [300, 1_200], leverage: [3, 5], maxOpen: 2, holdMs: [40 * SECOND, 4 * MINUTE], everyMs: [45 * SECOND, 3 * MINUTE], side: { kind: "random", longBias: 0.45 }, takeProfitPct: 12, stopLossPct: 10, txPerHour: 30, depositUsd: 20_000 },
  { id: "trend-1", symbols: ALL, collateral: [1_000, 4_000], leverage: [3, 5], maxOpen: 2, holdMs: [3 * MINUTE, 15 * MINUTE], everyMs: [1 * MINUTE, 4 * MINUTE], side: { kind: "momentum", minMovePct: 0.12 }, takeProfitPct: 30, stopLossPct: 15, txPerHour: 15, depositUsd: 30_000 },
  { id: "trend-2", symbols: ["NVDA", "META", "HOOD"], collateral: [1_000, 3_000], leverage: [3, 5], maxOpen: 2, holdMs: [3 * MINUTE, 15 * MINUTE], everyMs: [1 * MINUTE, 4 * MINUTE], side: { kind: "momentum", minMovePct: 0.1 }, takeProfitPct: 30, stopLossPct: 15, txPerHour: 15, depositUsd: 30_000 },
  { id: "reverter-1", symbols: ALL, collateral: [800, 3_000], leverage: [2, 3, 5], maxOpen: 2, holdMs: [3 * MINUTE, 12 * MINUTE], everyMs: [1 * MINUTE, 4 * MINUTE], side: { kind: "contrarian", minMovePct: 0.15 }, takeProfitPct: 25, stopLossPct: 15, txPerHour: 15, depositUsd: 30_000 },
  { id: "degen-long", symbols: ["NVDA", "AAPL"], collateral: [1_500, 4_000], leverage: [10], maxOpen: 1, holdMs: [12 * HOUR, 24 * HOUR], everyMs: [20 * SECOND, 1 * MINUTE], side: { kind: "fixed", side: "LONG" }, takeProfitPct: 90, txPerHour: 6, depositUsd: 40_000 },
  { id: "degen-short", symbols: ["NVDA", "AAPL"], collateral: [1_500, 4_000], leverage: [10], maxOpen: 1, holdMs: [12 * HOUR, 24 * HOUR], everyMs: [20 * SECOND, 1 * MINUTE], side: { kind: "fixed", side: "SHORT" }, takeProfitPct: 90, txPerHour: 6, depositUsd: 40_000 },
];

/// The liquidator is one more wallet, after the traders.
export const LIQUIDATOR = { id: "liquidator", index: ROSTER.length, txPerHour: 12 } as const;
