#!/usr/bin/env bash
# Verifies every contract on the Blockscout explorer, so a redeploy needs no address editing here.
# The protocol contracts are proxies: the code to verify is the implementation behind each proxy, listed in
# deployments/<NETWORK_NAME>.implementations.json (written by DeployAll and UpgradeAll). The proxy addresses
# in deployments/<NETWORK_NAME>.json are the ones users see; Blockscout recognizes an ERC-1967 proxy once
# its implementation is verified. Set NVDA_TOKEN / NVDA_FEED (printed by
# ConfigureMarkets.s.sol) to verify the mock market contracts too.
# Requires: ROBINHOOD_TESTNET_RPC_URL, EXPLORER_VERIFY_URL (from .env), jq.
# Uses --guess-constructor-args so forge reads the real deployment tx from chain and decodes
# constructor args itself — no manual ABI encoding needed.
#
# A failed request with an expired or unrelated TLS certificate usually means the network blocks the
# explorer: some Indonesian ISPs redirect it to a block page ("internetpositif"), even for 1.1.1.1.
# Resolve the real address over DNS-over-HTTPS and pin it in /etc/hosts while this runs, or use a VPN
# (steps in DEVELOPMENT_STEPS.md, Hosting). Each contract is retried (VERIFY_ATTEMPTS, default 3).
# --skip-is-verified-check makes forge submit even when Blockscout lists a look-alike contract as
# already verified (same bytecode from an older deployment), which is not a real verification.
# The script is safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

file="deployments/${NETWORK_NAME:-robinhood_testnet}.json"
impl_file="deployments/${NETWORK_NAME:-robinhood_testnet}.implementations.json"
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
      --skip-is-verified-check \
      --watch; then
      return 0
    fi
    sleep 3
  done
  echo "!!! FAILED: $contract at $address"
}

addr() { jq -er ".$1" "$file"; }
impl() { jq -er ".$1" "$impl_file"; }

verify "$(impl marketRegistry)" src/core/MarketRegistry.sol:MarketRegistry
verify "$(impl collateralManager)" src/core/CollateralManager.sol:CollateralManager
verify "$(impl vault)" src/core/AlphaMarketsVault.sol:AlphaMarketsVault
verify "$(impl feeManager)" src/core/FeeManager.sol:FeeManager
verify "$(impl buybackModule)" src/core/BuybackModule.sol:BuybackModule
verify "$(impl priceValidator)" src/oracle/PriceValidator.sol:PriceValidator
verify "$(impl oracleRouter)" src/oracle/OracleRouter.sol:OracleRouter
verify "$(impl riskManager)" src/risk/RiskManager.sol:RiskManager
verify "$(impl optionPositionManager)" src/options/OptionPositionManager.sol:OptionPositionManager
verify "$(impl optionMarket)" src/options/OptionMarket.sol:OptionMarket
verify "$(impl optionsEngine)" src/options/OptionsEngine.sol:OptionsEngine
verify "$(impl perpPositionManager)" src/perps/PerpPositionManager.sol:PerpPositionManager
verify "$(impl fundingManager)" src/perps/FundingManager.sol:FundingManager
verify "$(impl perpsEngine)" src/perps/PerpsEngine.sol:PerpsEngine
verify "$(impl liquidationEngine)" src/perps/LiquidationEngine.sol:LiquidationEngine
verify "$(impl perpOrderManager)" src/perps/PerpOrderManager.sol:PerpOrderManager
verify "$(impl insuranceFund)" src/core/InsuranceFund.sol:InsuranceFund
verify "$(impl crossMargin)" src/risk/CrossMarginManager.sol:CrossMarginManager
verify "$(impl subaccountFactory)" src/accounts/SubaccountFactory.sol:SubaccountFactory
verify "$(impl rfqManager)" src/perps/RFQManager.sol:RFQManager
verify "$(addr settlementToken)" test/mocks/MockERC20.sol:MockERC20
if [[ -n "${NVDA_TOKEN:-}" ]]; then verify "$NVDA_TOKEN" test/mocks/MockERC20.sol:MockERC20; fi
if [[ -n "${NVDA_FEED:-}" ]]; then verify "$NVDA_FEED" src/oracle/MockPriceFeed.sol:MockPriceFeed; fi

echo "==> Done. Check output above for any '!!! FAILED' lines."
