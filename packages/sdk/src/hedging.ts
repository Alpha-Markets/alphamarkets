/// Automated hedging tools (PROJECT_BRIEF.md Section 40): working out, and planning the perp trades
/// for, a delta hedge of an options book. Pure functions on numbers and bigints, no I/O, so a bot
/// or `services/hedger` can run them on data it already has.
///
/// Delta is measured in UNITS OF THE UNDERLYING. An option position's delta is the model's per-unit
/// delta times contracts times contract size; a perp position's is its size divided by its entry
/// price (long positive, short negative), because a perp's size is a notional fixed at entry.
/// Option deltas come from `options.quote` (display analytics from `services/pricing`), so a hedge
/// planned from them is an estimate: it neutralises the model's delta, not a guaranteed exposure.
import { OrionisError } from "./errors.js";

export interface OptionDeltaInput {
  /// Per-unit delta from the pricing model: about 0 to 1 for a call, -1 to 0 for a put.
  delta: number;
  contracts: bigint;
  /// Underlying units per contract, 18 decimals.
  contractSize: bigint;
}

/// Delta of a set of long option positions, in units of the underlying.
export function optionBookDelta(options: OptionDeltaInput[]): number {
  return options.reduce((sum, option) => sum + option.delta * Number(option.contracts) * (Number(option.contractSize) / 1e18), 0);
}

export interface PerpDeltaInput {
  isLong: boolean;
  /// Notional at entry, settlement-token base units.
  size: bigint;
  /// 18 decimals.
  entryPrice: bigint;
  settlementDecimals: number;
}

/// Units of the underlying a perp position is long (positive) or short (negative).
export function perpUnits(position: PerpDeltaInput): number {
  if (position.entryPrice === 0n) return 0;
  const notional = Number(position.size) / 10 ** position.settlementDecimals;
  const entry = Number(position.entryPrice) / 1e18;
  return (position.isLong ? 1 : -1) * (notional / entry);
}

export interface HedgePlanInput {
  /// Delta of the options book, units of the underlying.
  optionDelta: number;
  /// Delta already held in perps, units of the underlying (`perpUnits` summed).
  perpDelta: number;
  /// Net delta to aim for. Defaults to 0 (delta neutral).
  targetDelta?: number;
  /// Do nothing while the net delta is within this many units of the target, so small drifts do
  /// not cost a fee on every tick. Defaults to 0.
  toleranceUnits?: number;
}

export interface HedgePlan {
  netDelta: number;
  targetDelta: number;
  /// Change in perp exposure that reaches the target: positive means buy, negative means sell.
  /// 0 while inside the tolerance.
  adjustUnits: number;
}

export function planHedge(input: HedgePlanInput): HedgePlan {
  const targetDelta = input.targetDelta ?? 0;
  const tolerance = input.toleranceUnits ?? 0;
  if (![input.optionDelta, input.perpDelta, targetDelta, tolerance].every(Number.isFinite) || tolerance < 0) {
    throw new OrionisError("hedging: deltas, target and tolerance must be finite numbers, and the tolerance not negative");
  }
  const netDelta = input.optionDelta + input.perpDelta;
  const gap = targetDelta - netDelta;
  return { netDelta, targetDelta, adjustUnits: Math.abs(gap) <= tolerance ? 0 : gap };
}

export interface HedgePosition {
  positionId: bigint;
  isLong: boolean;
  /// Notional at entry, settlement-token base units.
  size: bigint;
  entryPrice: bigint;
}

export type HedgeAction =
  | { type: "reduce"; positionId: bigint; size: bigint }
  | { type: "close"; positionId: bigint }
  | { type: "open"; side: "LONG" | "SHORT"; notional: bigint };

/// The perp trades that move exposure by `adjustUnits` at `markPrice`: existing positions on the
/// opposite side are reduced or closed first (oldest first, so the hedge is not left holding
/// offsetting longs and shorts, which would pay the fee twice), and whatever is left opens a new
/// position. Sizes are settlement-token base units, rounded down, and an adjustment smaller than
/// `minNotional` gives no action (an order too small to be worth its fee).
export function hedgeActions(
  positions: HedgePosition[],
  adjustUnits: number,
  markPrice: bigint,
  settlementDecimals: number,
  minNotional: bigint = 0n,
): HedgeAction[] {
  if (!Number.isFinite(adjustUnits)) throw new OrionisError("hedging: adjustUnits must be finite");
  if (adjustUnits === 0 || markPrice <= 0n) return [];

  const buying = adjustUnits > 0;
  const unitsToDollars = (units: number) => units * (Number(markPrice) / 1e18);
  const toBase = (dollars: number) => BigInt(Math.floor(dollars * 10 ** settlementDecimals));
  let remaining = toBase(unitsToDollars(Math.abs(adjustUnits)));
  if (remaining < minNotional || remaining <= 0n) return [];

  const actions: HedgeAction[] = [];
  const offsetting = positions.filter((position) => position.isLong !== buying).sort((a, b) => (a.positionId < b.positionId ? -1 : 1));
  for (const position of offsetting) {
    if (remaining <= 0n) break;
    // A perp's exposure is its entry-price notional in units, worth `size * mark / entry` now.
    const worth = position.entryPrice === 0n ? position.size : (position.size * markPrice) / position.entryPrice;
    if (worth <= remaining) {
      actions.push({ type: "close", positionId: position.positionId });
      remaining -= worth;
    } else {
      // Reduce by the share of the entry notional that is worth `remaining` now.
      const size = (remaining * position.entryPrice) / markPrice;
      if (size > 0n) actions.push({ type: "reduce", positionId: position.positionId, size });
      remaining = 0n;
    }
  }
  if (remaining > 0n && remaining >= minNotional) actions.push({ type: "open", side: buying ? "LONG" : "SHORT", notional: remaining });
  return actions;
}

/// Convenience: the option and perp deltas of a whole book, its net, and the perp trades that
/// reach the target. `options` should be open positions only.
export function hedgeBook(params: {
  options: OptionDeltaInput[];
  perps: Array<HedgePosition & { settlementDecimals?: number }>;
  markPrice: bigint;
  settlementDecimals: number;
  targetDelta?: number;
  toleranceUnits?: number;
  minNotional?: bigint;
}): HedgePlan & { optionDelta: number; perpDelta: number; actions: HedgeAction[] } {
  const optionDelta = optionBookDelta(params.options);
  const perpDelta = params.perps.reduce((sum, perp) => sum + perpUnits({ ...perp, settlementDecimals: params.settlementDecimals }), 0);
  const plan = planHedge({ optionDelta, perpDelta, targetDelta: params.targetDelta, toleranceUnits: params.toleranceUnits });
  return {
    ...plan,
    optionDelta,
    perpDelta,
    actions: hedgeActions(params.perps, plan.adjustUnits, params.markPrice, params.settlementDecimals, params.minNotional),
  };
}
