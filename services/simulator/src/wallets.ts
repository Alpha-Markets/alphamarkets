import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/// The bot wallets come from one secret seed, kept in the (gitignored) state directory, so `bootstrap`,
/// `start` and `status` always see the same addresses. They hold testnet tokens only.
export function loadSeed(dir: string): string {
  const path = join(dir, "seed.txt");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const seed = randomBytes(32).toString("hex");
  writeFileSync(path, `${seed}\n`, { mode: 0o600 });
  return seed;
}

export function deriveAccount(seed: string, index: number): PrivateKeyAccount {
  const key: Hex = keccak256(toBytes(`alphamarkets-simulator:${seed}:${index}`));
  return privateKeyToAccount(key);
}
