import { bigint, boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/// Owned by this service (not `services/indexer`'s schema — DEVELOPMENT_STEPS.md's
/// "Engineering Practices" rule that services only share `packages/types`, not each other's
/// internals). Latest snapshot per position, overwritten each poll; not a history table.
/// `services/api` may read this table directly later (a data contract, not a code import) —
/// no such endpoint is wired yet (not in PROJECT_BRIEF.md Section 33's list).
export const riskSnapshots = pgTable("risk_snapshots", {
  positionId: text("position_id").primaryKey(),
  marketId: text("market_id").notNull(),
  owner: text("owner").notNull(),
  isLong: boolean("is_long").notNull(),
  markPrice: text("mark_price").notNull(),
  unrealizedPnl: text("unrealized_pnl").notNull(),
  marginRatioBps: text("margin_ratio_bps").notNull(),
  liquidationPrice: text("liquidation_price").notNull(),
  isLiquidationCandidate: boolean("is_liquidation_candidate").notNull(),
  updatedAtBlock: bigint("updated_at_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
