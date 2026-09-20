import type { Hex, TransactionReceipt } from "viem";
import { sendTransaction, type AlphaMarketsClient } from "./client.js";
import { mapError, AlphaMarketsError } from "./errors.js";

/// PROJECT_BRIEF.md Section 30 transaction states.
export type TxStatus = "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "failed";

export interface TxEvent {
  status: TxStatus;
  hash?: Hex;
  receipt?: TransactionReceipt;
  error?: unknown;
}

export interface TxOptions {
  /// Called on every state change. Never throws into the SDK: a listener error is swallowed so
  /// a UI bug cannot abort a transaction that is already in flight.
  onStatus?: (event: TxEvent) => void;
  /// Also wait for the receipt and emit `confirming` -> `confirmed`/`failed`. Without it the
  /// method resolves as soon as the transaction is `submitted`.
  wait?: boolean;
}

export interface TxResult<T> {
  hash: Hex;
  result: T;
  receipt?: TransactionReceipt;
}

type Simulation<T> = { request: object; result: T };

/// Shared write path for every state-changing SDK method: simulate (revert decoding happens
/// here, before the wallet is ever asked to sign), sign + send, optionally wait for the receipt.
export async function executeTx<T>(
  client: AlphaMarketsClient,
  simulate: () => Promise<Simulation<T>>,
  options: TxOptions = {},
): Promise<TxResult<T>> {
  const emit = (event: TxEvent) => {
    try {
      options.onStatus?.(event);
    } catch {
      // see TxOptions.onStatus
    }
  };
  const fail = (error: unknown): never => {
    const mapped = mapError(error);
    emit({ status: "failed", error: mapped });
    throw mapped;
  };

  emit({ status: "preparing" });
  let simulation: Simulation<T>;
  try {
    simulation = await simulate();
  } catch (error) {
    return fail(error);
  }

  emit({ status: "awaiting_wallet" });
  let hash: Hex;
  try {
    hash = await sendTransaction(client, simulation.request);
  } catch (error) {
    return fail(error);
  }
  emit({ status: "submitted", hash });

  if (!options.wait) return { hash, result: simulation.result };

  emit({ status: "confirming", hash });
  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash });
  } catch (error) {
    return fail(error);
  }
  if (receipt.status === "reverted") {
    return fail(new AlphaMarketsError(`Transaction ${hash} reverted onchain`));
  }
  emit({ status: "confirmed", hash, receipt });
  return { hash, result: simulation.result, receipt };
}
