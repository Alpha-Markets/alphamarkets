import { requireEnv } from "@alphamarkets/config";
import postgres from "postgres";

/// Plain `postgres.js` client, not Drizzle — `services/api` only ever reads rows
/// `services/indexer` wrote (DEVELOPMENT_STEPS.md "Backend services": services share data
/// through the database, not through importing each other's schema/internals). Lazy so
/// `loadDotEnv()` in the entrypoint runs before `DATABASE_URL` is read.
let cached: ReturnType<typeof postgres> | undefined;

export function getSql() {
  if (!cached) {
    cached = postgres(requireEnv("DATABASE_URL"), { transform: postgres.camel });
  }
  return cached;
}
