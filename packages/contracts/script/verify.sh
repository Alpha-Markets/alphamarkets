#!/usr/bin/env bash
# Verifies every deployed Phase 1 contract on the Blockscout explorer.
# Requires: ROBINHOOD_TESTNET_RPC_URL, EXPLORER_VERIFY_URL (from .env).
# Uses --guess-constructor-args so forge reads the real deployment tx from chain
# and decodes constructor args itself — no manual ABI encoding needed.
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
    --watch || echo "!!! FAILED: $contract at $address"
}

verify 0x027D56C99D9E486F8911F0bd58EE508a817E9c0e src/core/MarketRegistry.sol:MarketRegistry
verify 0x760E82300F3E2095Ae2E04318a0ef03cb693d52c src/core/CollateralManager.sol:CollateralManager
verify 0x9F05fd9F0fE15fEbBd6EDcd7D63f4D0bCe7d3c1b src/core/OrionisVault.sol:OrionisVault
verify 0xa8fF53Fb41Bbf90B79f8c45B1576BB6F93Dc45c3 src/core/FeeManager.sol:FeeManager
verify 0x9Ae0Ebf31ee39F74bB412f80c4F7dcA953abBCFf src/core/BuybackModule.sol:BuybackModule
verify 0x413f505814A0175bb7551EFb966c0580345EbF9F src/oracle/PriceValidator.sol:PriceValidator
verify 0x1203d1d05ae5DA1DE18752680B525F7CB0b5aFb0 src/oracle/OracleRouter.sol:OracleRouter
verify 0x2aFdFE61A5222609865Ca46BFAC90c0a35Bf5870 src/risk/RiskManager.sol:RiskManager
verify 0x566A18Be08fB6Df937F461741985503cE3f8486F src/options/OptionPositionManager.sol:OptionPositionManager
verify 0x5341E0C1bb61D4f776B99afE332912A4502112b4 src/options/OptionMarket.sol:OptionMarket
verify 0x1cC0612e39c1977daA7CFA4F031807b66D26a632 src/options/OptionsEngine.sol:OptionsEngine
verify 0x1d8A3f6b8E720dE6cF7Bf8cDa8A7aEc32fb9Cac6 src/perps/PerpPositionManager.sol:PerpPositionManager
verify 0xF7E00Bbe120a88137536C69e3ad01aC96807B51C src/perps/FundingManager.sol:FundingManager
verify 0x563b532ee62FbC2C8344626934959B132Bf95786 src/perps/PerpsEngine.sol:PerpsEngine
verify 0x13ed3961E2C518a5db9dFc29e895CAbAe6DE09A4 src/perps/LiquidationEngine.sol:LiquidationEngine
verify 0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112 test/mocks/MockERC20.sol:MockERC20
verify 0xCb73eA96c319846E4d15B2920c0FD2223D5796Ee test/mocks/MockERC20.sol:MockERC20
verify 0xE7970f8eCD2917813E6B242d8f5796A6c0049e13 src/oracle/MockPriceFeed.sol:MockPriceFeed

echo "==> Done. Check output above for any '!!! FAILED' lines."
