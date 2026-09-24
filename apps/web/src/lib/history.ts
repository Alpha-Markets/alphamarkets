import type { HistoryEvent } from "@alphamarkets/sdk";
import { alphaMarketsRead } from "./alphamarkets";

/// The most rows `GET /v1/history/:wallet` returns per call.
const PAGE = 200;

/// Every history event for `address` after event id `after`, oldest first. The API serves oldest first
/// and stops at `PAGE` rows, so a single call misses the newest events of a busy wallet. This keeps
/// asking from the last id it saw until a page comes back short.
export async function readHistoryAfter(address: `0x${string}`, after = 0): Promise<HistoryEvent[]> {
  const events: HistoryEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = await alphaMarketsRead.portfolio.history(address, { limit: PAGE, cursor });
    events.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE || !last) return events;
    cursor = last.id;
  }
}
