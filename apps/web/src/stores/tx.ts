import { create } from "zustand";
import {
  DeadlineExpiredError,
  InsufficientCollateralError,
  InsufficientMarginError,
  InvalidOraclePriceError,
  InvalidQuoteError,
  MarketPausedError,
  InsufficientPoolReservesError,
  OpenInterestLimitExceededError,
  PositionLimitExceededError,
  QuoteAlreadyUsedError,
  QuoteExpiredError,
  SlippageExceededError,
  StaleOraclePriceError,
  UserRejectedError,
  type TxEvent,
  type TxStatus,
} from "@alphamarkets/sdk";

/// One row per user action (approve, deposit, open position, close position). The store holds
/// what the Section 30 confirmation panel needs: the current state, the hash once there is one,
/// and a plain-language summary of what was submitted.
export interface TxRecord {
  id: string;
  title: string;
  /// Shown once confirmed, e.g. "NVDA-PERP · Long · $5,000 · 5x".
  summary?: string;
  status: TxStatus;
  hash?: `0x${string}`;
  blockNumber?: bigint;
  error?: string;
  positionId?: bigint;
}

interface TxState {
  records: TxRecord[];
  start: (title: string, summary?: string) => string;
  update: (id: string, event: TxEvent) => void;
  patch: (id: string, patch: Partial<TxRecord>) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useTxStore = create<TxState>((set) => ({
  records: [],
  start: (title, summary) => {
    const id = `tx-${Date.now()}-${counter++}`;
    const record: TxRecord = { id, title, summary, status: "preparing" };
    set((state) => ({ records: [record, ...state.records].slice(0, 5) }));
    return id;
  },
  update: (id, event) =>
    set((state) => ({
      records: state.records.map((record) =>
        record.id === id
          ? {
              ...record,
              status: event.status,
              hash: event.hash ?? record.hash,
              blockNumber: event.receipt?.blockNumber ?? record.blockNumber,
              error: event.error ? errorMessage(event.error) : record.error,
            }
          : record,
      ),
    })),
  patch: (id, patch) => set((state) => ({ records: state.records.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  dismiss: (id) => set((state) => ({ records: state.records.filter((record) => record.id !== id) })),
}));

/// What a person needs to read: what went wrong and what to do next, without stack traces.
/// Uses `instanceof`, not class names, because production builds minify class names.
export function errorMessage(error: unknown): string {
  if (error instanceof UserRejectedError) return "You declined the request in your wallet. Nothing was sent.";
  if (error instanceof MarketPausedError) return "This market is paused. Try again once trading resumes.";
  if (error instanceof StaleOraclePriceError) return "The price feed is out of date, so orders are blocked. Try again shortly.";
  if (error instanceof InvalidOraclePriceError) return "The price feed returned an invalid price. Try again shortly.";
  if (error instanceof InsufficientCollateralError) return "Not enough available collateral. Deposit more or reduce the size.";
  if (error instanceof InsufficientMarginError) return "The margin is too low for this size. Add collateral or lower leverage.";
  if (error instanceof PositionLimitExceededError) return "This size is above the position limit for the market.";
  if (error instanceof InsufficientPoolReservesError) return "The pool cannot pay this profit right now. Your position is still open. Try again in a few minutes.";
  if (error instanceof OpenInterestLimitExceededError) return "The market's open interest limit is reached. Try a smaller size.";
  if (error instanceof QuoteExpiredError) return "The option price expired before it confirmed. Request a new price and try again.";
  if (error instanceof QuoteAlreadyUsedError) return "That option price was already used. Request a new price and try again.";
  if (error instanceof InvalidQuoteError) return "The option price could not be verified. Request a new price and try again.";
  if (error instanceof DeadlineExpiredError) return "The order took too long to confirm. Submit it again.";
  if (error instanceof SlippageExceededError) return "The price moved past your slippage limit. Submit it again at the new price.";
  if (error instanceof Error) return error.message.split("\n")[0] ?? "The transaction failed.";
  return "The transaction failed.";
}
