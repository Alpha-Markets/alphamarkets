/// Rewrites the checked-in `robinhoodTestnetAddresses` literal in `src/deployments.ts` from the
/// JSON that `packages/contracts/script/DeployAll.s.sol` writes, so a redeploy needs no hand
/// copying. Usage: `pnpm --filter @orionis/config sync:deployments [network]` (default
/// `robinhood_testnet`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const network = process.argv[2] ?? "robinhood_testnet";
const jsonPath = resolve(import.meta.dirname, `../../contracts/deployments/${network}.json`);
const sourcePath = resolve(import.meta.dirname, "../src/deployments.ts");

const literal = /(const robinhoodTestnetAddresses: ContractAddresses = \{\n)([\s\S]*?)(\n\};)/;

const source = readFileSync(sourcePath, "utf8");
const match = literal.exec(source);
if (!match) throw new Error("sync-deployments: robinhoodTestnetAddresses literal not found");

// Contracts added after the first deployment. A deployment that predates one omits it, and the
// SDK treats the feature as unavailable; a newer deployment must record it.
const OPTIONAL_KEYS = ["perpOrderManager", "insuranceFund", "crossMargin", "subaccountFactory", "rfqManager"];

const deployed = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
// The existing literal fixes the key order and the required key set the JSON must match; optional
// keys are added in (or dropped) according to what the JSON records.
const keys = [
  ...new Set([
    ...[...match[2]!.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]!).filter((key) => !OPTIONAL_KEYS.includes(key)),
    ...OPTIONAL_KEYS.filter((key) => key in deployed),
  ]),
];

const missing = keys.filter((key) => !(key in deployed));
const extra = Object.keys(deployed).filter((key) => !keys.includes(key));
if (missing.length || extra.length) {
  throw new Error(`sync-deployments: ${jsonPath} keys differ (missing: ${missing}, unexpected: ${extra})`);
}
for (const key of keys) {
  const value = deployed[key];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`sync-deployments: ${key} is not an address in ${jsonPath}`);
  }
}

const body = keys.map((key) => `  ${key}: "${deployed[key] as string}",`).join("\n");
writeFileSync(sourcePath, source.replace(literal, `$1${body}$3`));
console.log(`Updated ${keys.length} addresses in src/deployments.ts from deployments/${network}.json`);
