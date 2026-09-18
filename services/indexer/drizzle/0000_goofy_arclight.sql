CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"contract_name" text NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tx_hash_log_index_key" UNIQUE("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_indexed_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markets" (
	"market_id" text PRIMARY KEY NOT NULL,
	"underlying_token" text NOT NULL,
	"oracle_id" text NOT NULL,
	"options_enabled" boolean NOT NULL,
	"perps_enabled" boolean NOT NULL,
	"max_leverage" text NOT NULL,
	"open_interest_cap" text NOT NULL,
	"active" boolean NOT NULL,
	"block_number" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
