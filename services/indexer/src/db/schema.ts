import { bigint, boolean, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/// Materialized current-state view of MarketRegistry, kept in sync from `MarketAdded` /
/// `MarketUpdated` events (DEVELOPMENT_STEPS.md Phase 2 item 1) — `services/api` serves
/// `GET /markets` from this instead of an RPC call per request. `MarketRegistry` on-chain
/// remains the actual source of truth (PROJECT_BRIEF.md Section 18); this is a read cache.
/// uint256 fields (`maxLeverage`, `openInterestCap`) are stored as `text`, not `bigint` or
/// `numeric` — token amounts are 18-decimal fixed point and can exceed Postgres bigint's
/// ~9.2e18 ceiling (a $5M open interest cap already does); `text` avoids that overflow the
/// same way `numeric` would, written via `.toString()` in `src/index.ts`. Any future query
/// needing numeric range comparisons on these columns should switch them to `numeric`
/// first — comparing `text` values as `text` sorts/compares lexicographically, not numerically.
export const markets = pgTable("markets", {
  marketId: text("market_id").primaryKey(),
  underlyingToken: text("underlying_token").notNull(),
  oracleId: text("oracle_id").notNull(),
  optionsEnabled: boolean("options_enabled").notNull(),
  perpsEnabled: boolean("perps_enabled").notNull(),
  maxLeverage: text("max_leverage").notNull(),
  openInterestCap: text("open_interest_cap").notNull(),
  active: boolean("active").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/// Generic append-only log of every contract event this indexer watches (PROJECT_BRIEF.md
/// Section 31 / Section 35's event list) — one row per (tx_hash, log_index), the natural
/// idempotency key for a replay-safe indexer (DEVELOPMENT_STEPS.md "Backend services").
/// `args` stores the decoded event arguments as JSON (bigints pre-converted to strings by
/// the caller — see `src/serialize.ts` — since `jsonb` cannot hold a bigint directly).
/// `services/api` derives `/history/:wallet` from this by matching wallet-shaped args
/// fields; per-position live state is read from the chain, not reconstructed here.
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    contractName: text("contract_name").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("events_tx_hash_log_index_key").on(table.txHash, table.logIndex)],
);

/// Single-row table (id is always 1) tracking indexing progress, so a restart resumes from
/// `lastIndexedBlock + 1` instead of re-scanning from genesis or losing track entirely.
export const indexerState = pgTable("indexer_state", {
  id: integer("id").primaryKey(),
  lastIndexedBlock: bigint("last_indexed_block", { mode: "bigint" }).notNull(),
});
