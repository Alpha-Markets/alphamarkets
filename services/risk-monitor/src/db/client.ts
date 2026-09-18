import { requireEnv } from "@orionis/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

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
