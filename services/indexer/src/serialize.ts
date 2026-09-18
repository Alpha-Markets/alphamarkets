/// `jsonb` columns can't hold a `bigint` directly, and viem decodes every `uint256`/`int256`
/// event argument as one — this recursively stringifies them before a row is inserted.
export function serializeArgs(args: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(args, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}
