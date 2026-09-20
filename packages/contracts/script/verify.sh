#!/usr/bin/env bash
# Verifies every contract listed in deployments/<NETWORK_NAME>.json on the Blockscout explorer, so
# a redeploy needs no address editing here. Set NVDA_TOKEN / NVDA_FEED (printed by
# ConfigureMarkets.s.sol) to verify the mock market contracts too.
# Requires: ROBINHOOD_TESTNET_RPC_URL, EXPLORER_VERIFY_URL (from .env), jq.
# Uses --guess-constructor-args so forge reads the real deployment tx from chain and decodes
# constructor args itself — no manual ABI encoding needed.
#
# Robinhood's explorer intermittently serves an expired (or unrelated) TLS certificate, so a failed
# request is usually bad luck, not a problem with the contract. Each contract is retried
# (VERIFY_ATTEMPTS, default 3); the script is safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

file="deployments/${NETWORK_NAME:-robinhood_testnet}.json"
attempts="${VERIFY_ATTEMPTS:-3}"

verify() {
  local address="$1"
  local contract="$2"
  echo "==> Verifying $contract at $address"
  for ((try = 1; try <= attempts; try++)); do
    if forge verify-contract "$address" "$contract" \
      --chain-id "${CHAIN_ID:-${NEXT_PUBLIC_CHAIN_ID:?set CHAIN_ID in .env}}" \
      --verifier blockscout \
      --verifier-url "$EXPLORER_VERIFY_URL" \
      --guess-constructor-args \
      --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
      --watch; then
      return 0
    fi
    sleep 3
  done
  echo "!!! FAILED: $contract at $address"
}

addr() { jq -er ".$1" "$file"; }

verify "$(addr marketRegistry)" src/core/MarketRegistry.sol:MarketRegistry
verify "$(addr collateralManager)" src/core/CollateralManager.sol:CollateralManager
verify "$(addr vault)" src/core/OrionisVault.sol:OrionisVault
verify "$(addr feeManager)" src/core/FeeManager.sol:FeeManager
verify "$(addr buybackModule)" src/core/BuybackModule.sol:BuybackModule
verify "$(addr priceValidator)" src/oracle/PriceValidator.sol:PriceValidator
verify "$(addr oracleRouter)" src/oracle/OracleRouter.sol:OracleRouter
verify "$(addr riskManager)" src/risk/RiskManager.sol:RiskManager
verify "$(addr optionPositionManager)" src/options/OptionPositionManager.sol:OptionPositionManager
verify "$(addr optionMarket)" src/options/OptionMarket.sol:OptionMarket
verify "$(addr optionsEngine)" src/options/OptionsEngine.sol:OptionsEngine
verify "$(addr perpPositionManager)" src/perps/PerpPositionManager.sol:PerpPositionManager
verify "$(addr fundingManager)" src/perps/FundingManager.sol:FundingManager
verify "$(addr perpsEngine)" src/perps/PerpsEngine.sol:PerpsEngine
verify "$(addr liquidationEngine)" src/perps/LiquidationEngine.sol:LiquidationEngine
verify "$(addr settlementToken)" test/mocks/MockERC20.sol:MockERC20
if [[ -n "${NVDA_TOKEN:-}" ]]; then verify "$NVDA_TOKEN" test/mocks/MockERC20.sol:MockERC20; fi
if [[ -n "${NVDA_FEED:-}" ]]; then verify "$NVDA_FEED" src/oracle/MockPriceFeed.sol:MockPriceFeed; fi

echo "==> Done. Check output above for any '!!! FAILED' lines."
