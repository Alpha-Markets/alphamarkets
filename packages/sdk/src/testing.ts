/// Shared fakes for unit tests — not exported from the package.
import { BaseError, encodeErrorResult, stringToHex } from "viem";
import type { ContractAddresses } from "@alphamarkets/config";
import type { MarketConfig } from "@alphamarkets/types";
import { allErrorsAbi } from "./abis.js";
import type { AlphaMarketsClient } from "./client.js";

export const WAD = 10n ** 18n;
export const NVDA = stringToHex("NVDA", { size: 32 });
export const USER = `0x${"01".repeat(20)}` as const;
export const HASH = `0x${"ab".repeat(32)}` as const;

export const addresses = new Proxy({} as ContractAddresses, {
  get: (_target, key) => `0x${String(key).length.toString(16).padStart(40, "0")}`,
});

/// The deployment with the named contracts absent, as a deployment made before they existed has it.
export const addressesWithout = (...keys: string[]): ContractAddresses =>
  new Proxy(addresses, { get: (target, key) => (keys.includes(String(key)) ? undefined : target[key as keyof ContractAddresses]) });

export const activeMarket: MarketConfig = {
  marketId: NVDA,
  underlyingToken: USER,
  oracleId: NVDA,
  optionsEnabled: true,
  perpsEnabled: true,
  maxLeverage: 10n,
  openInterestCap: 5_000_000n * WAD,
  active: true,
};

export function revertError(errorName: string, args?: readonly unknown[]) {
  const data = encodeErrorResult({ abi: allErrorsAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
  return new BaseError("call failed", { cause: Object.assign(new Error("execution reverted"), { data }) });
}

export interface Call {
  method: "readContract" | "simulateContract" | "writeContract";
  functionName?: string;
  args?: readonly unknown[];
}

/// A fake viem client that records every call and answers reads from `reads`, keyed by
/// function name. A read that maps to an `Error` is thrown instead of returned.
export function fakeClient(reads: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const client = {
    async readContract(params: { functionName: string; args?: readonly unknown[] }) {
      calls.push({ method: "readContract", functionName: params.functionName, args: params.args });
      const value = reads[params.functionName];
      if (value instanceof Error) throw value;
      return value;
    },
    async simulateContract(params: { functionName: string; args?: readonly unknown[] }) {
      calls.push({ method: "simulateContract", functionName: params.functionName, args: params.args });
      return { request: { functionName: params.functionName }, result: 42n };
    },
    async writeContract() {
      calls.push({ method: "writeContract" });
      return HASH;
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  } as unknown as AlphaMarketsClient;
  return { client, calls, simulated: () => calls.filter((call) => call.method === "simulateContract") };
}
