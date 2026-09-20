import { AlphaMarketsError } from "./errors.js";
import { resolveMarketId } from "./utils.js";
import type { Hex } from "@alphamarkets/types";

/// One `tick` message from `services/api`'s `GET /v1/ws` (PROJECT_BRIEF.md Section 33 "WebSocket
/// market data"). Values arrive as decimal strings because JSON cannot carry `bigint`.
export interface MarketTick {
  type: "tick";
  marketId: Hex;
  /// 18-decimal fixed point.
  indexPrice: bigint;
  timestamp: bigint;
  fundingRateBps: bigint;
}

/// Minimal surface of the standard `WebSocket` this module needs, so Node < 22 callers can pass
/// the `ws` package's class through `AlphaMarketsConfig.webSocket`.
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}
export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface SubscribeOptions {
  /// Only deliver ticks for these markets (symbols, "NVDA-PERP" labels, or bytes32 ids). Every
  /// market when omitted.
  markets?: string[];
  onTick: (tick: MarketTick) => void;
  onError?: (error: unknown) => void;
  /// Reconnect after a dropped connection. Defaults to true.
  reconnect?: boolean;
}

export interface StreamNamespace {
  /// Returns an unsubscribe function. Reconnects with capped exponential backoff.
  subscribe(options: SubscribeOptions): () => void;
}

const MAX_BACKOFF_MS = 30_000;

export function createStream(apiUrl?: string, webSocket?: WebSocketConstructor): StreamNamespace {
  function subscribe(options: SubscribeOptions): () => void {
    if (!apiUrl) {
      throw new AlphaMarketsError("stream.subscribe: requires `apiUrl` in the AlphaMarkets constructor config");
    }
    const Impl = webSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!Impl) {
      throw new AlphaMarketsError(
        "stream.subscribe: no global WebSocket in this runtime — pass `webSocket` (e.g. the `ws` package) in the AlphaMarkets config",
      );
    }

    const url = `${apiUrl.replace(/^http/, "ws")}/v1/ws`;
    const wanted = options.markets ? new Set(options.markets.map((market) => resolveMarketId(market))) : undefined;
    let socket: WebSocketLike | undefined;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const current = new Impl!(url);
      socket = current;
      current.onopen = () => {
        attempt = 0;
      };
      current.onmessage = (event) => {
        try {
          const raw = JSON.parse(String(event.data)) as {
            type: string;
            marketId: Hex;
            indexPrice: string;
            timestamp: string;
            fundingRateBps: string;
          };
          if (raw.type !== "tick") return;
          if (wanted && !wanted.has(raw.marketId)) return;
          options.onTick({
            type: "tick",
            marketId: raw.marketId,
            indexPrice: BigInt(raw.indexPrice),
            timestamp: BigInt(raw.timestamp),
            fundingRateBps: BigInt(raw.fundingRateBps),
          });
        } catch (error) {
          options.onError?.(error);
        }
      };
      current.onerror = (event) => options.onError?.(event);
      current.onclose = () => {
        if (stopped || options.reconnect === false) return;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }

  return { subscribe };
}
