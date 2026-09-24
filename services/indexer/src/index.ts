import { loadDotEnv } from "@alphamarkets/config";
loadDotEnv();

import { requireEnv, resolveAddresses, resolveChainId } from "@alphamarkets/config";
import { AlphaMarkets } from "@alphamarkets/sdk";
import { createPublicClient, http, parseEventLogs } from "viem";
import { and, eq, lt, sql as sqlOp } from "drizzle-orm";
import { getDb, getSql } from "./db/client.js";
import { events, indexerState, markets, priceTicks } from "./db/schema.js";
import { allEventsAbi, contractNamesByAddress, watchedAddresses } from "./events.js";
import { blockBeforeFirstIndexed } from "./startBlock.js";
import { serializeArgs } from "./serialize.js";

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);
/// getLogs range width per call. The default of 10 fits the Alchemy free tier, which caps
/// eth_getLogs at 10 blocks. Robinhood's official testnet RPC (https://rpc.testnet.chain.robinhood.com)
/// only rejects a query that matches more than 10000 logs, so set this to about 2000 there.
const MAX_BLOCK_RANGE = BigInt(process.env.INDEXER_MAX_BLOCK_RANGE ?? 10);
if (MAX_BLOCK_RANGE < 1n) {
  throw new Error(`INDEXER_MAX_BLOCK_RANGE must be at least 1, got ${MAX_BLOCK_RANGE}`);
}

/// How often to record each active market's index price for history and 24h change.
const PRICE_SAMPLE_INTERVAL_MS = Number(process.env.PRICE_SAMPLE_INTERVAL_MS ?? 60_000);
const PRICE_TICK_RETENTION_DAYS = Number(process.env.PRICE_TICK_RETENTION_DAYS ?? 8);

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const contractNames = contractNamesByAddress(addresses);
const addressList = watchedAddresses(addresses);

const publicClient = createPublicClient({ transport: http(requireEnv("RPC_URL")) });
const alphaMarkets = new AlphaMarkets({ chainId, transport: http(requireEnv("RPC_URL")) });
const db = getDb();

async function lastIndexedBlock(): Promise<bigint> {
  const [row] = await db.select().from(indexerState).where(eq(indexerState.id, 1));
  if (row) return row.lastIndexedBlock;

  // First run: start at the chain head, or replay from INDEXER_START_BLOCK (the deploy block).
  const currentBlock = await publicClient.getBlockNumber();
  const startBlock = blockBeforeFirstIndexed(currentBlock, process.env.INDEXER_START_BLOCK);
  await db.insert(indexerState).values({ id: 1, lastIndexedBlock: startBlock });
  return startBlock;
}

async function upsertMarket(marketId: `0x${string}`, blockNumber: bigint) {
  const config = await alphaMarkets.markets.get(marketId);
  await db
    .insert(markets)
    .values({
      marketId: config.marketId,
      underlyingToken: config.underlyingToken,
      oracleId: config.oracleId,
      optionsEnabled: config.optionsEnabled,
      perpsEnabled: config.perpsEnabled,
      maxLeverage: config.maxLeverage.toString(),
      openInterestCap: config.openInterestCap.toString(),
      active: config.active,
      blockNumber,
    })
    .onConflictDoUpdate({
      target: markets.marketId,
      set: {
        underlyingToken: config.underlyingToken,
        oracleId: config.oracleId,
        optionsEnabled: config.optionsEnabled,
        perpsEnabled: config.perpsEnabled,
        maxLeverage: config.maxLeverage.toString(),
        openInterestCap: config.openInterestCap.toString(),
        active: config.active,
        blockNumber,
        updatedAt: sqlOp`now()`,
      },
    });
}

/// Fills the `markets` table from the registry, the single source of truth for markets. Events keep
/// it current afterwards, but an indexer that starts after a deployment never sees that
/// deployment's `MarketAdded` events, and would serve an empty market list.
async function syncMarkets() {
  const head = await publicClient.getBlockNumber();
  const listed = await alphaMarkets.markets.list();
  for (const market of listed) await upsertMarket(market.marketId, head);
  console.log(`indexer: ${listed.length} market(s) synced from the registry`);
}

async function indexRange(fromBlock: bigint, toBlock: bigint) {
  const logs = await publicClient.getLogs({ address: addressList, fromBlock, toBlock });
  const decoded = parseEventLogs({ abi: allEventsAbi, logs });

  if (decoded.length > 0) {
    await db
      .insert(events)
      .values(
        decoded.map((log) => ({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          contractName: contractNames.get(log.address.toLowerCase() as typeof log.address) ?? "unknown",
          eventName: log.eventName,
          args: serializeArgs(log.args),
        })),
      )
      .onConflictDoNothing({ target: [events.txHash, events.logIndex] });

    for (const log of decoded) {
      if (log.eventName === "MarketAdded" || log.eventName === "MarketUpdated") {
        await upsertMarket((log.args as { marketId: `0x${string}` }).marketId, log.blockNumber);
      }
    }
  }

  await db
    .update(indexerState)
    .set({ lastIndexedBlock: toBlock })
    .where(eq(indexerState.id, 1));
}

async function tick() {
  const from = (await lastIndexedBlock()) + 1n;
  const head = await publicClient.getBlockNumber();
  if (from > head) return;

  let cursor = from;
  while (cursor <= head) {
    const end = cursor + MAX_BLOCK_RANGE - 1n > head ? head : cursor + MAX_BLOCK_RANGE - 1n;
    await indexRange(cursor, end);
    console.log(`indexer: processed blocks ${cursor}-${end}`);
    cursor = end + 1n;
  }
}

let lastSampleAt = 0;

/// Records the index price of every active market. A market whose oracle is currently stale or
/// paused is skipped for this round rather than failing the whole indexer tick.
async function sampleIndexPrices() {
  if (Date.now() - lastSampleAt < PRICE_SAMPLE_INTERVAL_MS) return;
  lastSampleAt = Date.now();

  const active = await db.select({ marketId: markets.marketId }).from(markets).where(eq(markets.active, true));
  for (const { marketId } of active) {
    try {
      const { price } = await alphaMarkets.oracle.getIndexPrice(marketId);
      await db.insert(priceTicks).values({ marketId, price: price.toString() });
    } catch (error) {
      console.warn(`indexer: could not sample index price for ${marketId}`, error);
    }
  }

  const cutoff = new Date(Date.now() - PRICE_TICK_RETENTION_DAYS * 24 * 3600 * 1000);
  await db.delete(priceTicks).where(and(lt(priceTicks.sampledAt, cutoff)));
}

async function main() {
  console.log(`indexer: watching ${addressList.length} contracts on chain ${chainId}`);
  try {
    await syncMarkets();
  } catch (error) {
    console.error("indexer: could not sync markets from the registry", error);
  }
  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error("indexer: tick failed", error);
    }
    try {
      await sampleIndexPrices();
    } catch (error) {
      console.error("indexer: price sampling failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error("indexer: fatal error", error);
  getSql()
    .end()
    .finally(() => process.exit(1));
});
