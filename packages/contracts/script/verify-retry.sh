#!/usr/bin/env bash
# `verify.sh` now retries each contract itself; this remains so old instructions keep working.
exec "$(dirname "$0")/verify.sh" "$@"
