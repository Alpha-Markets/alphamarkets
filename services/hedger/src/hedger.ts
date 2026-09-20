import { hedgeBook, OptionPositionStatus, OptionType, type HedgeAction, type AlphaMarkets, type Address } from "@alphamarkets/sdk";

export interface HedgerDeps {
  alphaMarkets: AlphaMarkets;
  /// The wallet whose options book is hedged. Its perp positions on `market` are the hedge: the
  /// hedger treats every open perp on that market as part of it.
  account: Address;
  /// Underlying symbol, e.g. "NVDA".
  market: string;
  /// Net delta to aim for, in units of the underlying. Default 0.
  targetDelta: number;
  /// Do nothing while inside this many units of the target.
  toleranceUnits: number;
  /// Skip an order smaller than this, in settlement-token base units.
  minNotional: bigint;
  /// Leverage for a new hedge position; must be one of the market's tiers.
  leverage: number;
  /// Send the trades. Off, the hedger only reports what it would do.
  execute: boolean;
  now?: () => number;
  log?: (message: string) => void;
}

export interface HedgeTick {
  optionDelta: number;
  perpDelta: number;
  netDelta: number;
  adjustUnits: number;
  actions: HedgeAction[];
  executed: boolean;
}

/// Collateral for a new position of `notional` at `leverage`, rounded up so the position is never
/// smaller than asked.
export const collateralFor = (notional: bigint, leverage: number): bigint => (notional + BigInt(leverage) - 1n) / BigInt(leverage);

export function createHedger(deps: HedgerDeps) {
  const { alphaMarkets, account, market, execute } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message) => console.log(`hedger: ${message}`));

  async function tick(): Promise<HedgeTick> {
    const [positions, decimals, mark, contractSize] = await Promise.all([
      alphaMarkets.portfolio.positions(account),
      alphaMarkets.erc20.decimals(alphaMarkets.addresses.settlementToken),
      alphaMarkets.oracle.getMarkPrice(market),
      alphaMarkets.options.contractSize(market),
    ]);
    const marketId = (await alphaMarkets.markets.get(market)).marketId;
    const nowSeconds = BigInt(Math.floor(now() / 1000));

    const openOptions = positions.options.filter(
      (position) => position.marketId === marketId && position.status === OptionPositionStatus.OPEN && position.expiry > nowSeconds,
    );
    // Each option's delta comes from the pricing model: display analytics, so the hedge is an estimate.
    const options = await Promise.all(
      openOptions.map(async (position) => {
        const quote = await alphaMarkets.options.quote({
          underlying: market,
          type: position.optionType === OptionType.CALL ? "CALL" : "PUT",
          strike: position.strike,
          expiry: position.expiry,
          contracts: 1,
        });
        return { delta: quote.delta, contracts: position.contracts, contractSize };
      }),
    );
    const perps = positions.perps.filter((position) => position.open && position.marketId === marketId);

    const plan = hedgeBook({
      options,
      perps,
      markPrice: mark.price,
      settlementDecimals: decimals,
      targetDelta: deps.targetDelta,
      toleranceUnits: deps.toleranceUnits,
      minNotional: deps.minNotional,
    });

    const summary = `option delta ${plan.optionDelta.toFixed(2)}, perp delta ${plan.perpDelta.toFixed(2)}, net ${plan.netDelta.toFixed(2)} (target ${plan.targetDelta})`;
    if (plan.actions.length === 0) {
      log(`${summary}: no trade`);
      return { ...pick(plan), executed: false };
    }
    log(`${summary}: ${plan.actions.map(describe).join("; ")}${execute ? "" : " (dry run, not sent)"}`);
    if (!execute) return { ...pick(plan), executed: false };

    // In order: each reduce or close frees exposure before a new position adds it.
    for (const action of plan.actions) {
      try {
        if (action.type === "close") await alphaMarkets.perps.closePosition(action.positionId, { tx: { wait: true } });
        else if (action.type === "reduce") await alphaMarkets.perps.reducePosition(action.positionId, { size: action.size, tx: { wait: true } });
        else {
          await alphaMarkets.perps.openPosition({
            market,
            side: action.side,
            collateral: collateralFor(action.notional, deps.leverage),
            leverage: deps.leverage,
            tx: { wait: true },
          });
        }
      } catch (error) {
        // Stop here: the next action assumed this one went through.
        log(`${describe(action)} failed: ${(error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message?.split("\n")[0]}`);
        return { ...pick(plan), executed: false };
      }
    }
    return { ...pick(plan), executed: true };
  }

  return { tick };
}

function pick(plan: ReturnType<typeof hedgeBook>) {
  return { optionDelta: plan.optionDelta, perpDelta: plan.perpDelta, netDelta: plan.netDelta, adjustUnits: plan.adjustUnits, actions: plan.actions };
}

function describe(action: HedgeAction): string {
  if (action.type === "close") return `close position ${action.positionId}`;
  if (action.type === "reduce") return `reduce position ${action.positionId} by ${action.size}`;
  return `open ${action.side.toLowerCase()} of ${action.notional}`;
}
