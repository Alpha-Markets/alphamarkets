#!/usr/bin/env bash
# Retries only the 9 contracts that never even got submitted for verification in the
# first pass — Robinhood's explorer serves an expired (and sometimes completely wrong,
# non-Robinhood) TLS cert intermittently, so failures here are per-request bad luck, not
# a real problem with the contract or command. Safe to re-run multiple times.
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

verify() {
  local address="$1"
  local contract="$2"
  echo "==> Verifying $contract at $address"
  forge verify-contract "$address" "$contract" \
    --chain-id 46630 \
    --verifier blockscout \
    --verifier-url "$EXPLORER_VERIFY_URL" \
    --guess-constructor-args \
    --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
    --watch || echo "!!! STILL FAILED: $contract at $address"
}

verify 0x027D56C99D9E486F8911F0bd58EE508a817E9c0e src/core/MarketRegistry.sol:MarketRegistry
verify 0x9F05fd9F0fE15fEbBd6EDcd7D63f4D0bCe7d3c1b src/core/OrionisVault.sol:OrionisVault
verify 0x9Ae0Ebf31ee39F74bB412f80c4F7dcA953abBCFf src/core/BuybackModule.sol:BuybackModule
verify 0x413f505814A0175bb7551EFb966c0580345EbF9F src/oracle/PriceValidator.sol:PriceValidator
verify 0x1203d1d05ae5DA1DE18752680B525F7CB0b5aFb0 src/oracle/OracleRouter.sol:OracleRouter
verify 0x566A18Be08fB6Df937F461741985503cE3f8486F src/options/OptionPositionManager.sol:OptionPositionManager
verify 0x1cC0612e39c1977daA7CFA4F031807b66D26a632 src/options/OptionsEngine.sol:OptionsEngine
verify 0x563b532ee62FbC2C8344626934959B132Bf95786 src/perps/PerpsEngine.sol:PerpsEngine
verify 0xE7970f8eCD2917813E6B242d8f5796A6c0049e13 src/oracle/MockPriceFeed.sol:MockPriceFeed

echo "==> Done."
