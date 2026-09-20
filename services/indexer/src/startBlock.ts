/// The block before the first one to index, for an indexer that has no saved position.
///
/// `configured` is `INDEXER_START_BLOCK`: the block a deployment was made in, so that a new database
/// replays the whole history. Without it the indexer starts at the chain head and sees only what
/// happens after. A value that is not a whole number, or lies past the head, is an error: silently
/// starting at the head would hide history that the operator meant to keep.
export function blockBeforeFirstIndexed(head: bigint, configured: string | undefined): bigint {
  if (configured === undefined || configured.trim() === "") return head > 0n ? head - 1n : 0n;

  if (!/^\d+$/.test(configured.trim())) {
    throw new Error(`INDEXER_START_BLOCK must be a whole block number, got "${configured}"`);
  }
  const start = BigInt(configured.trim());
  if (start > head) throw new Error(`INDEXER_START_BLOCK ${start} is past the chain head ${head}`);
  return start > 0n ? start - 1n : 0n;
}
