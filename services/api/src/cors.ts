import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/// Browsers block cross-origin calls to this API unless it says which origins may make them, so
/// `apps/web` cannot reach it without this. Origins are an explicit allow-list from
/// `CORS_ORIGINS` (comma-separated) — never `*`, so an unrelated site cannot read a user's data
/// through their browser. Defaults to the local Next.js dev server.
export const DEFAULT_CORS_ORIGINS = "http://localhost:3000";

export function parseOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/// Call on the root instance, before routes are registered. `@fastify/cors` is not encapsulated,
/// so it applies to every route on the instance it is registered on.
export function registerCors(app: FastifyInstance, originsEnv = process.env.CORS_ORIGINS): void {
  app.register(cors, {
    origin: parseOrigins(originsEnv),
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  });
}
