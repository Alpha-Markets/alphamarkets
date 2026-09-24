#!/usr/bin/env bash
# Verifies every implementation on Blockscout as a FULL match, where verify.sh only reaches a partial one.
#
# Why verify.sh stops at partial: solc writes settings.remappings into the contract metadata, and the metadata
# hash sits at the end of the bytecode. Foundry compiled the deployed code with remappings whose context is
# this checkout's absolute path (/abs/path/lib/...:erc4626-tests/=...). `forge verify-contract` sends the same
# remappings with relative contexts, so Blockscout compiles a different metadata hash: the bytecode matches,
# the metadata does not, and Blockscout keeps the contract as "partially verified".
#
# This script takes the standard JSON input from forge, replaces settings.remappings with the exact list solc
# recorded in out/<File>.sol/<Name>.json, and sends it to the Blockscout API. It only works from the same
# checkout path that produced the deployment, after `forge build`, with no source or foundry.toml change since.
# Before it sends anything it compares the local metadata tail with the on-chain one, so a moved checkout or
# a changed source fails here with a clear message instead of "Fail - Unable to verify" on the explorer.
#
# Usage: ./script/verify-full.sh [ContractName ...]   (no argument verifies every contract in the list)
# Requires: ROBINHOOD_TESTNET_RPC_URL, EXPLORER_VERIFY_URL (from .env), jq, curl, cast, forge.
# Sends the input to the Etherscan-compatible /api endpoint (the v2 REST verification route is not served here).
# Safe to re-run. VERIFY_ATTEMPTS (default 3) retries each contract; VERIFY_POLLS (default 12) x 5 s waits
# for the explorer result.
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

network="${NETWORK_NAME:-robinhood_testnet}"
impl_file="deployments/${network}.implementations.json"
attempts="${VERIFY_ATTEMPTS:-3}"
polls="${VERIFY_POLLS:-12}"
compiler="v$(jq -r '.metadata.compiler.version' out/MarketRegistry.sol/MarketRegistry.json)"
base="${EXPLORER_VERIFY_URL%/api}"
base="${base%/}"

# key in the implementations file | source path | contract name (same list as verify.sh)
contracts=(
  "marketRegistry|src/core/MarketRegistry.sol|MarketRegistry"
  "collateralManager|src/core/CollateralManager.sol|CollateralManager"
  "vault|src/core/AlphaMarketsVault.sol|AlphaMarketsVault"
  "feeManager|src/core/FeeManager.sol|FeeManager"
  "buybackModule|src/core/BuybackModule.sol|BuybackModule"
  "priceValidator|src/oracle/PriceValidator.sol|PriceValidator"
  "oracleRouter|src/oracle/OracleRouter.sol|OracleRouter"
  "riskManager|src/risk/RiskManager.sol|RiskManager"
  "optionPositionManager|src/options/OptionPositionManager.sol|OptionPositionManager"
  "optionMarket|src/options/OptionMarket.sol|OptionMarket"
  "optionsEngine|src/options/OptionsEngine.sol|OptionsEngine"
  "perpPositionManager|src/perps/PerpPositionManager.sol|PerpPositionManager"
  "fundingManager|src/perps/FundingManager.sol|FundingManager"
  "perpsEngine|src/perps/PerpsEngine.sol|PerpsEngine"
  "liquidationEngine|src/perps/LiquidationEngine.sol|LiquidationEngine"
  "perpOrderManager|src/perps/PerpOrderManager.sol|PerpOrderManager"
  "insuranceFund|src/core/InsuranceFund.sol|InsuranceFund"
  "crossMargin|src/risk/CrossMarginManager.sol|CrossMarginManager"
  "subaccountFactory|src/accounts/SubaccountFactory.sol|SubaccountFactory"
  "rfqManager|src/perps/RFQManager.sol|RFQManager"
)

fully_verified() {
  curl -s -m 30 "$base/api/v2/smart-contracts/$1" | jq -r '.is_fully_verified // false'
}

# Last 53 bytes of the runtime code: the CBOR block with the IPFS metadata hash and the solc version.
metadata_tail() { tr -d '[:space:]' | sed 's/^0x//' | tail -c 106; }

verify() {
  local address="$1" source="$2" name="$3"
  local artifact="out/$(basename "$source")/${name}.json"
  echo "==> $name at $address"

  if [[ "$(fully_verified "$address")" == "true" ]]; then
    echo "    already fully verified"
    return 0
  fi

  local local_tail chain_tail
  local_tail="$(jq -r '.deployedBytecode.object' "$artifact" | metadata_tail)"
  chain_tail="$(cast code "$address" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" | metadata_tail)"
  if [[ "$local_tail" != "$chain_tail" ]]; then
    echo "!!! FAILED: $name local metadata hash differs from the deployed one."
    echo "    Run from the checkout path that made the deployment, after forge build, with no source change since."
    return 1
  fi

  local input="${TMPDIR:-/tmp}/verify-full-${name}.json"
  forge verify-contract "$address" "$source:$name" --show-standard-json-input 2>/dev/null |
    jq --slurpfile remappings <(jq '.metadata.settings.remappings' "$artifact") \
      '.settings.remappings = $remappings[0]' >"$input"

  for ((try = 1; try <= attempts; try++)); do
    local reply
    reply="$(curl -s -m 60 -X POST "$base/api" \
      --data-urlencode module=contract --data-urlencode action=verifysourcecode \
      --data-urlencode codeformat=solidity-standard-json-input \
      --data-urlencode "contractaddress=$address" --data-urlencode "contractname=$source:$name" \
      --data-urlencode "compilerversion=$compiler" --data-urlencode licenseType=3 \
      --data-urlencode "sourceCode@$input")"
    echo "    submit $try/$attempts: $reply"
    for ((poll = 1; poll <= polls; poll++)); do
      sleep 5
      if [[ "$(fully_verified "$address")" == "true" ]]; then
        echo "    fully verified"
        return 0
      fi
    done
  done
  echo "!!! FAILED: $name at $address"
  return 1
}

failed=0
for entry in "${contracts[@]}"; do
  IFS='|' read -r key source name <<<"$entry"
  if [[ $# -gt 0 ]] && [[ ! " $* " =~ " $name " ]]; then continue; fi
  verify "$(jq -er ".$key" "$impl_file")" "$source" "$name" || failed=1
done

echo "==> Done. Check output above for any '!!! FAILED' lines."
exit "$failed"
