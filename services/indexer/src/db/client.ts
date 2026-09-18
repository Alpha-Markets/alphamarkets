import { requireEnv } from "@orionis/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/// Lazy — reads `DATABASE_URL` on first use rather than at module import time, so callers
/// can run `loadDotEnv()` first (ESM static imports evaluate before any of an importing
/// module's own top-level statements, so an eager `postgres(...)` here would read
/// `process.env` before `.env` had been loaded).
let cached: { sql: ReturnType<typeof postgres>; db: ReturnType<typeof drizzle<typeof schema>> } | undefined;

function connection() {
  if (!cached) {
    const sql = postgres(requireEnv("DATABASE_URL"));
    cached = { sql, db: drizzle(sql, { schema }) };
  }
  return cached;
}

export function getSql() {
  return connection().sql;
}

export function getDb() {
  return connection().db;
}
