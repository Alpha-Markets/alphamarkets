import { loadDotEnv } from "@alphamarkets/config";
loadDotEnv();

const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { getDb, getSql } = await import("./client.js");

await migrate(getDb(), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
console.log("risk-monitor: migrations applied");
await getSql().end();
