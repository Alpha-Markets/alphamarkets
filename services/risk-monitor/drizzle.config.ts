import { defineConfig } from "drizzle-kit";

// Inlined rather than imported from `@alphamarkets/config` — see services/indexer/drizzle.config.ts
// for why drizzle-kit's own bundler can't resolve that package's `.js` -> `.ts` specifiers.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env file — rely on variables already set in the environment.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
