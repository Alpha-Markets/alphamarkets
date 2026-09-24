import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/// A request to move a market, written by `pnpm --filter @alphamarkets/simulator nudge` and read by the
/// running simulator. A file, and not a second transaction sender, because the price driver owns the
/// feed owner's nonce.
export interface NudgeRequest {
  symbol: string;
  pct: number;
  /// How long the move takes, in seconds.
  seconds: number;
}

const FILE = "nudges.jsonl";

export function appendNudge(dir: string, request: NudgeRequest): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FILE), `${JSON.stringify(request)}\n`);
}

/// The requests after the first `skip` lines, and the line count to pass as `skip` next time.
export function readNudges(dir: string, skip: number): { requests: NudgeRequest[]; lines: number } {
  const path = join(dir, FILE);
  if (!existsSync(path)) return { requests: [], lines: 0 };
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  const requests: NudgeRequest[] = [];
  for (const line of lines.slice(skip)) {
    try {
      const parsed = JSON.parse(line) as NudgeRequest;
      if (typeof parsed.symbol === "string" && Number.isFinite(parsed.pct) && Number.isFinite(parsed.seconds)) requests.push(parsed);
    } catch {
      // a half-written line: skip it
    }
  }
  return { requests, lines: lines.length };
}
