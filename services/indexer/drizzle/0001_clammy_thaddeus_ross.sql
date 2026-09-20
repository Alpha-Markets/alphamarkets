CREATE TABLE IF NOT EXISTS "price_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"price" text NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_ticks_market_sampled_idx" ON "price_ticks" USING btree ("market_id","sampled_at");