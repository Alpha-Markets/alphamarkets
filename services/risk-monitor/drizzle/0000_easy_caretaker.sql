CREATE TABLE IF NOT EXISTS "risk_snapshots" (
	"position_id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"owner" text NOT NULL,
	"is_long" boolean NOT NULL,
	"mark_price" text NOT NULL,
	"unrealized_pnl" text NOT NULL,
	"margin_ratio_bps" text NOT NULL,
	"liquidation_price" text NOT NULL,
	"is_liquidation_candidate" boolean NOT NULL,
	"updated_at_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
