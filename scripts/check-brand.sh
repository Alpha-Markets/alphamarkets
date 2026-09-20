#!/usr/bin/env bash
# Fails when a tracked file contains the retired brand name (PROJECT_BRIEF.md Section 46).
# PROJECT_BRIEF.md and DEVELOPMENT_STEPS.md are excluded: they state the rebrand rule itself.
set -euo pipefail

cd "$(dirname "$0")/.."

hits=$(git grep -n -I -i -E 'citadel|ctdl' -- . \
  ':!PROJECT_BRIEF.md' ':!DEVELOPMENT_STEPS.md' ':!pnpm-lock.yaml' ':!scripts/check-brand.sh' || true)
names=$(git ls-files | grep -i -E 'citadel|ctdl' || true)

if [ -n "$hits$names" ]; then
  echo "Retired brand name found (Citadelle / CTDL):"
  [ -n "$hits" ] && echo "$hits"
  [ -n "$names" ] && echo "$names"
  exit 1
fi

echo "Brand check passed: no Citadelle or CTDL references."
