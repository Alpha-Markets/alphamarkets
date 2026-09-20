/// ABIs are generated from `packages/contracts/out` by `scripts/generate-abis.mjs` — never
/// hand-copied (DEVELOPMENT_STEPS.md Phase 3). Re-run `pnpm --filter @alphamarkets/sdk generate:abis`
/// after any contract signature change.
export * from "./generated/abis.js";
export { erc20Abi } from "viem";

import { vaultAbi } from "./generated/abis.js";

/// Kept for callers written before ABIs were generated; the full vault ABI already contains
/// `lockedMargin`.
export const vaultReadsAbi = vaultAbi;
