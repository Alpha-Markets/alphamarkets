import { loadDotEnv } from "@alphamarkets/config";
loadDotEnv();

import { requireEnv, resolveChainId } from "@alphamarkets/config";
import { AlphaMarkets } from "@alphamarkets/sdk";
import { createPublicClient, http } from "viem";
import { getDb, getSql } from "./db/client.js";
import { riskSnapshots } from "./db/schema.js";
import { liquidationPrice, marginRatio, unrealizedPnl } from "./marginMath.js";

const POLL_INTERVAL_MS = Number(process.env.RISK_MONITOR_POLL_INTERVAL_MS ?? 10_000);
/// A position is a liquidation candidate once its margin ratio is within this many bps
/// *above* its market's maintenance margin rate — not a single global cutoff. A flat 0
/// default would only ever fire once equity has already hit 0 (past insolvency, per
/// marginMath.ts's floor), which is too late to be a warning. Comparing against each
/// market's actual maintenanceMarginRateBps (read live per position below) plus this buffer
/// gives an early-warning margin instead. Still a display heuristic for this monitor, not
/// the chain's own liquidation check — `LiquidationEngine.sol` is the sole source of truth
/// for whether a position is actually liquidatable.
const CANDIDATE_BUFFER_BPS = BigInt(process.env.RISK_CANDIDATE_BUFFER_BPS ?? 200);

const chainId = resolveChainId(process.env.CHAIN_ID);
const alphaMarkets = new AlphaMarkets({ chainId, transport: http(requireEnv("RPC_URL")) });
const publicClient = createPublicClient({ transport: http(requireEnv("RPC_URL")) });
const db = getDb();
const sql = getSql();

/// Reads `services/indexer`'s `events` table directly (a data contract, not a code import —
/// see `src/db/schema.ts`'s note) to find perp position ids that have been opened but not
/// yet closed or liquidated. Live per-position state (entry price, size, collateral,
/// leverage) still comes from the chain via the SDK, never reconstructed from this log.
async function openPerpPositionIds(): Promise<bigint[]> {
  const rows = await sql<{ position_id: string }[]>`
    select (opened.args ->> 'positionId') as position_id
    from events opened
    where opened.event_name = 'PerpPositionOpened'
      and not exists (
        select 1 from events closed
        where closed.event_name in ('PerpPositionClosed', 'PositionLiquidated')
          and closed.args ->> 'positionId' = opened.args ->> 'positionId'
      )
  `;
  return rows.map((row) => BigInt(row.position_id));
}

async function checkPosition(positionId: bigint) {
  const position = await alphaMarkets.portfolio.getPerpPosition(positionId);
  if (!position.open) return;

  const [{ price: markPrice }, risk, blockNumber] = await Promise.all([
    alphaMarkets.oracle.getMarkPrice(position.marketId),
    alphaMarkets.risk.get(position.marketId),
    publicClient.getBlockNumber(),
  ]);

  const pnl = unrealizedPnl(position.isLong, position.entryPrice, markPrice, position.size);
  const ratio = marginRatio(position.collateral, pnl, position.size);
  const liqPrice = liquidationPrice(
    position.isLong,
    position.entryPrice,
    position.collateral,
    position.size,
    risk.maintenanceMarginRateBps,
  );
  const candidateThresholdBps = risk.maintenanceMarginRateBps + CANDIDATE_BUFFER_BPS;
  const isCandidate = ratio <= candidateThresholdBps;

  await db
    .insert(riskSnapshots)
    .values({
      positionId: positionId.toString(),
      marketId: position.marketId,
      owner: position.owner,
      isLong: position.isLong,
      markPrice: markPrice.toString(),
      unrealizedPnl: pnl.toString(),
      marginRatioBps: ratio.toString(),
      liquidationPrice: liqPrice.toString(),
      isLiquidationCandidate: isCandidate,
      updatedAtBlock: blockNumber,
    })
    .onConflictDoUpdate({
      target: riskSnapshots.positionId,
      set: {
        markPrice: markPrice.toString(),
        unrealizedPnl: pnl.toString(),
        marginRatioBps: ratio.toString(),
        liquidationPrice: liqPrice.toString(),
        isLiquidationCandidate: isCandidate,
        updatedAtBlock: blockNumber,
        updatedAt: new Date(),
      },
    });

  if (isCandidate) {
    console.warn(`risk-monitor: position ${positionId} is a liquidation candidate (margin ratio ${ratio} bps)`);
  }
}

async function main() {
  console.log(`risk-monitor: watching perp positions on chain ${chainId}`);
  for (;;) {
    try {
      const positionIds = await openPerpPositionIds();
      console.log(`risk-monitor: ${positionIds.length} open perp position(s)`);
      for (const positionId of positionIds) {
        await checkPosition(positionId);
      }
    } catch (error) {
      console.error("risk-monitor: tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error("risk-monitor: fatal error", error);
  getSql()
    .end()
    .finally(() => process.exit(1));
});
