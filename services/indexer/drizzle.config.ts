import { defineConfig } from "drizzle-kit";

// Inlined rather than imported from `@orionis/config`: drizzle-kit loads this file with its
// own bundler, which doesn't resolve `@orionis/config`'s internal `./chains.js` -> `chains.ts`
// NodeNext-style specifiers the rest of this monorepo relies on (tsc/tsx both handle it fine).
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
