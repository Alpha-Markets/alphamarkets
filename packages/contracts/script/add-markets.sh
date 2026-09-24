#!/usr/bin/env bash
# Adds the extra testnet markets with script/AddMarket.s.sol, one forge run per symbol.
# Skips a symbol that is already listed, so it is safe to run again after a failure.
#
# Needs, in the environment: PRIVATE_KEY (the deployer, funded with testnet ETH), RPC_URL and
# PRICE_FEED_OWNER (the keeper's address; a feed's owner cannot be changed later, and a feed the
# keeper does not own goes stale after an hour and breaks every price read for that market).
# Run from packages/contracts:  bash script/add-markets.sh
#
# The prices and risk numbers are placeholders, not market data (see CHANGELOG [Unreleased]).
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY to the deployer key}"
: "${RPC_URL:?set RPC_URL, for example https://rpc.testnet.chain.robinhood.com}"
: "${PRICE_FEED_OWNER:?set PRICE_FEED_OWNER to the keeper address}"
export NETWORK_NAME="${NETWORK_NAME:-robinhood_testnet}"

REGISTRY=$(python3 -c "import json;print(json.load(open('deployments/${NETWORK_NAME}.json'))['marketRegistry'])")
LISTED=$(cast call "$REGISTRY" "allMarketIds()(bytes32[])" --rpc-url "$RPC_URL")

# SYMBOL|NAME|PRICE|MAX_LEVERAGE|MAINTENANCE_MARGIN_BPS|MAX_POSITION|OPEN_INTEREST_CAP
MARKETS=(
  "MSFT|Microsoft (tokenized, mock)|480|5|750|250000|3000000"
  "GOOGL|Alphabet (tokenized, mock)|210|5|750|250000|3000000"
  "COIN|Coinbase (tokenized, mock)|320|5|750|250000|3000000"
  "MSTR|Strategy (tokenized, mock)|380|5|750|250000|3000000"
  "SPY|SPDR S&P 500 ETF (tokenized, mock)|650|10|500|500000|5000000"
  "QQQ|Invesco QQQ ETF (tokenized, mock)|580|10|500|500000|5000000"
  "AVGO|Broadcom (tokenized, mock)|340|5|750|250000|3000000"
  "JPM|JPMorgan Chase (tokenized, mock)|300|5|750|250000|3000000"
  "DIS|Walt Disney (tokenized, mock)|120|5|750|250000|3000000"
  "UBER|Uber (tokenized, mock)|90|5|750|250000|3000000"
  "SHOP|Shopify (tokenized, mock)|150|5|750|250000|3000000"
)

for row in "${MARKETS[@]}"; do
  IFS='|' read -r symbol name price leverage maintenance maxpos oicap <<<"$row"
  id=$(cast format-bytes32-string "$symbol")
  if grep -qi "${id#0x}" <<<"$LISTED"; then
    echo "skip $symbol: already listed"
    continue
  fi
  echo "adding $symbol at \$$price"
  SYMBOL="$symbol" NAME="$name" PRICE="$price" MAX_LEVERAGE="$leverage" \
    MAINTENANCE_MARGIN_BPS="$maintenance" MAX_POSITION="$maxpos" OPEN_INTEREST_CAP="$oicap" \
    forge script script/AddMarket.s.sol --rpc-url "$RPC_URL" --broadcast --slow
done
echo "done. Restart nothing: keeper, indexer, API and web read the registry live."
