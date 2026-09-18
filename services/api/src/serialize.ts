/// Fastify's JSON serializer (like `JSON.stringify`) throws on a raw `bigint`, and every
/// on-chain read in this service returns one somewhere — recursively stringify before a
/// handler returns a value built from SDK reads.
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}
