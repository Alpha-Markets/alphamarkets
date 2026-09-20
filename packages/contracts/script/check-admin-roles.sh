#!/usr/bin/env bash
# Fails when a contract declares an `*_ADMIN_ROLE` that script/HandOverAdmin.s.sol does not move.
# Without this, a role added later would stay with the deployer key after the handover to a multisig.
set -euo pipefail
cd "$(dirname "$0")/.."

declared=$(grep -rhoE 'bytes32 public constant [A-Z_]+_ADMIN_ROLE = keccak256\("[A-Z_]+"\)' src | grep -oE '"[A-Z_]+"' | sort -u)
missing=0
for role in $declared; do
  if ! grep -q "keccak256($role)" script/HandOverAdmin.s.sol; then
    echo "!!! $role is declared in src/ but not moved by script/HandOverAdmin.s.sol (_adminRoles)"
    missing=1
  fi
done
[ "$missing" -eq 0 ] && echo "admin roles: all $(echo "$declared" | wc -l | tr -d ' ') are covered by the handover script"
exit "$missing"
