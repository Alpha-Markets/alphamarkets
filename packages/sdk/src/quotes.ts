import type { Address, Hex } from "@orionis/types";

/// The EIP-712 shapes `OptionsEngine` verifies (see `packages/contracts/src/options/OptionsEngine.sol`).
/// This is the single definition of them for TypeScript: the pricing service signs with it and
/// tests sign with it, so a drift from the contract fails the Anvil integration test instead of
/// production. The type strings, field order and domain must match the contract exactly.
export const OPTIONS_QUOTE_DOMAIN_NAME = "OrionisOptionsEngine";
export const OPTIONS_QUOTE_DOMAIN_VERSION = "1";

const openQuoteTypes = {
  OpenQuote: [
    { name: "user", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "optionType", type: "uint8" },
    { name: "strike", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "contracts", type: "uint256" },
    { name: "premium", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const closeQuoteTypes = {
  CloseQuote: [
    { name: "user", type: "address" },
    { name: "positionId", type: "uint256" },
    { name: "premium", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface QuoteDomainInput {
  chainId: number;
  /// The `OptionsEngine` address the quote is for. Binding it stops a quote for one deployment
  /// being replayed on another.
  optionsEngine: Address;
}

function domain({ chainId, optionsEngine }: QuoteDomainInput) {
  return {
    name: OPTIONS_QUOTE_DOMAIN_NAME,
    version: OPTIONS_QUOTE_DOMAIN_VERSION,
    chainId,
    verifyingContract: optionsEngine,
  } as const;
}

export interface OpenQuoteInput extends QuoteDomainInput {
  user: Address;
  marketId: Hex;
  /// 0 = CALL, 1 = PUT.
  optionType: number;
  strike: bigint;
  expiry: bigint;
  contracts: bigint;
  premium: bigint;
  validUntil: bigint;
  nonce: bigint;
}

/// Arguments for viem's `signTypedData` (or `verifyTypedData`) for an open-position quote.
export function openQuoteTypedData(input: OpenQuoteInput) {
  return {
    domain: domain(input),
    types: openQuoteTypes,
    primaryType: "OpenQuote" as const,
    message: {
      user: input.user,
      marketId: input.marketId,
      optionType: input.optionType,
      strike: input.strike,
      expiry: input.expiry,
      contracts: input.contracts,
      premium: input.premium,
      validUntil: input.validUntil,
      nonce: input.nonce,
    },
  };
}

export interface CloseQuoteInput extends QuoteDomainInput {
  user: Address;
  positionId: bigint;
  premium: bigint;
  validUntil: bigint;
  nonce: bigint;
}

export function closeQuoteTypedData(input: CloseQuoteInput) {
  return {
    domain: domain(input),
    types: closeQuoteTypes,
    primaryType: "CloseQuote" as const,
    message: {
      user: input.user,
      positionId: input.positionId,
      premium: input.premium,
      validUntil: input.validUntil,
      nonce: input.nonce,
    },
  };
}
