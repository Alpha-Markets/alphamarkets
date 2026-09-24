/// A `fetch` that starts requests no faster than a set rate, in the order they arrive.
///
/// The simulator sends its calls in bursts: five price transactions at once, ten bots reading in the
/// same second. A free RPC plan measures work per second, and one `eth_sendRawTransaction` costs about
/// ten times as much as a read, so a burst gets HTTP 429 even when the average rate is low. Spacing the
/// starts out removes the burst without changing what the simulator does.
export interface Throttle {
  fetch: typeof fetch;
}

/// `readsPerSecond` is the steady rate for reads. A transaction (`eth_sendRawTransaction`) takes
/// `sendWeight` reads' worth of time. A rate of 0 or less turns the throttle off.
export function createThrottledFetch(options: {
  readsPerSecond: number;
  sendWeight?: number;
  base?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): typeof fetch {
  const base = options.base ?? fetch;
  if (!(options.readsPerSecond > 0)) return base;
  const gap = 1000 / options.readsPerSecond;
  const sendWeight = options.sendWeight ?? 5;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /// The earliest time the next request may start.
  let free = 0;

  return async (input, init) => {
    const weight = isSend(init?.body) ? sendWeight : 1;
    // Reserve the slot before waiting, so concurrent callers queue in order.
    const start = Math.max(now(), free);
    free = start + gap * weight;
    const wait = start - now();
    if (wait > 0) await sleep(wait);
    return base(input, init);
  };
}

function isSend(body: unknown): boolean {
  return typeof body === "string" && body.includes('"eth_sendRawTransaction"');
}
