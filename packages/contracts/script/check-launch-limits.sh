#!/usr/bin/env bash
# Fails when any ACTIVE market's on-chain risk limits are above the launch (canary) limits.
# Run it after DeployAll and market setup, before opening the site: PROJECT_BRIEF.md Section 19 and the
# "Pre-mainnet checklist" in DEVELOPMENT_STEPS.md ask for open interest and position caps that are set
# conservatively at launch and raised only once mainnet is stable. The limits are read from the chain
# (RiskManager), so this checks what the contracts enforce, not what a config file says.
#
# It also checks the vault can pay what the limits allow. The vault is the counterparty to the difference
# between long and short open interest, so every active market must have a net open interest limit set
# (`RiskManager.maxNetOpenInterest`) at or below MAX_NET_OPEN_INTEREST, and the vault's pool must cover the
# sum of those limits times an assumed worst one-sided price move (MAX_MOVE_BPS, default 5000 = 50%).
#
# Usage:  RPC_URL=... MAX_POSITION=5000 MAX_OPEN_INTEREST=50000 MAX_NET_OPEN_INTEREST=20000 MAX_LEVERAGE=5 \
#           ./script/check-launch-limits.sh [network]        (network defaults to robinhood_testnet)
# MAX_POSITION, MAX_OPEN_INTEREST and MAX_NET_OPEN_INTEREST are whole units of the settlement token,
# MAX_LEVERAGE a whole number, MAX_MOVE_BPS basis points.
# Requires: cast, jq. Exit code 1 if any active market is above a limit or a market cannot be read.
set -uo pipefail
cd "$(dirname "$0")/.."

network="${1:-robinhood_testnet}"
file="deployments/${network}.json"
: "${RPC_URL:?Set RPC_URL}" "${MAX_POSITION:?Set MAX_POSITION}" "${MAX_OPEN_INTEREST:?Set MAX_OPEN_INTEREST}" "${MAX_LEVERAGE:?Set MAX_LEVERAGE}" "${MAX_NET_OPEN_INTEREST:?Set MAX_NET_OPEN_INTEREST}"
move_bps="${MAX_MOVE_BPS:-5000}"

registry=$(jq -er .marketRegistry "$file")
risk=$(jq -er .riskManager "$file")
token=$(jq -er .settlementToken "$file")
decimals=$(cast call "$token" 'decimals()(uint8)' --rpc-url "$RPC_URL")
unit=$(python3 -c "print(10**$decimals)")

fail=0
checked=0
net_sum=0
for id in $(cast call "$registry" 'allMarketIds()(bytes32[])' --rpc-url "$RPC_URL" | tr -d '[],'); do
  active=$(cast call "$registry" 'isActive(bytes32)(bool)' "$id" --rpc-url "$RPC_URL") || { echo "FAIL cannot read $id"; fail=1; continue; }
  [[ "$active" == "true" ]] || continue
  name=$(cast to-ascii "$id" | tr -d '\0')
  cfg=$(cast call "$risk" 'getRiskConfig(bytes32)((uint256,uint256[],uint256,uint256,uint256,uint256))' "$id" --rpc-url "$RPC_URL") || { echo "FAIL cannot read risk config for $name"; fail=1; continue; }
  checked=$((checked + 1))
  problems=""
  # cast prints the struct as: (maxLeverage, [tiers], initialBps, maintenanceBps, maxPosition [1e23], openInterestCap [1e24])
  python3 - "$cfg" "$unit" "$MAX_LEVERAGE" "$MAX_POSITION" "$MAX_OPEN_INTEREST" <<'PY' || problems="1"
import re, sys
cfg, unit, mlev, mpos, moi = sys.argv[1], *[int(x) for x in sys.argv[2:]]
m = re.match(r"\((\d+), \[[^\]]*\], \d+, \d+, (\d+)(?: \[[^\]]*\])?, (\d+)", cfg)
if not m:
    print("  cannot parse risk config: " + cfg); sys.exit(1)
lev, pos, oi = (int(x) for x in m.groups())
bad = []
if lev > mlev: bad.append(f"max leverage {lev}x > {mlev}x")
if pos > mpos * unit: bad.append(f"max position {pos // unit} > {mpos}")
if oi > moi * unit: bad.append(f"open interest cap {oi // unit} > {moi}")
if bad:
    print("  " + "; ".join(bad)); sys.exit(1)
PY
  net=$(cast call "$risk" 'maxNetOpenInterest(bytes32)(uint256)' "$id" --rpc-url "$RPC_URL" | awk '{print $1}')
  if python3 -c "import sys; n=int(sys.argv[1]); u=int(sys.argv[2]); m=int(sys.argv[3]); sys.exit(0 if 0 < n <= m*u else 1)" "$net" "$unit" "$MAX_NET_OPEN_INTEREST"; then
    net_sum=$(python3 -c "print($net_sum + $net)")
  else
    echo "  net open interest limit is $(python3 -c "print($net // $unit)") (must be set, above 0 and at most $MAX_NET_OPEN_INTEREST)"
    problems="1"
  fi
  if [[ -n "$problems" ]]; then echo "FAIL $name"; fail=1; else echo "ok   $name"; fi
done

vault=$(jq -er .vault "$file")
pool=$(cast call "$vault" 'poolBalance(address)(uint256)' "$token" --rpc-url "$RPC_URL" | awk '{print $1}')
need=$(python3 -c "print($net_sum * $move_bps // 10000)")
if python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)" "$pool" "$need"; then
  echo "ok   pool $(python3 -c "print($pool // $unit)") covers $(python3 -c "print($need // $unit)") (net limits x ${move_bps} bps)"
else
  echo "FAIL pool $(python3 -c "print($pool // $unit)") is below $(python3 -c "print($need // $unit)") (sum of net limits x ${move_bps} bps)"
  fail=1
fi

echo "checked $checked active markets against: leverage <= ${MAX_LEVERAGE}x, position <= ${MAX_POSITION}, open interest <= ${MAX_OPEN_INTEREST}"
[[ $checked -gt 0 ]] || { echo "FAIL no active market found"; exit 1; }
exit "$fail"
