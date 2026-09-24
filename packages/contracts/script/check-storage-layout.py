#!/usr/bin/env python3
"""Fails when a change breaks the storage layout of an upgradeable contract.

Every protocol contract lives behind a proxy that keeps its state across upgrades, so a new
implementation must keep the layout of the old one: appending a state variable is fine, reordering,
removing or retyping one corrupts the state that is already on chain.

The reference layouts are checked in under `storage-layouts/`. Run `script/check-storage-layout.py` to
compare, and `script/check-storage-layout.py --update` after a deliberate change (for example a new
variable at the end) or after a fresh deployment that resets the state.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = ROOT / "storage-layouts"

CONTRACTS = {
    "MarketRegistry": "src/core/MarketRegistry.sol",
    "CollateralManager": "src/core/CollateralManager.sol",
    "AlphaMarketsVault": "src/core/AlphaMarketsVault.sol",
    "FeeManager": "src/core/FeeManager.sol",
    "BuybackModule": "src/core/BuybackModule.sol",
    "PriceValidator": "src/oracle/PriceValidator.sol",
    "OracleRouter": "src/oracle/OracleRouter.sol",
    "RiskManager": "src/risk/RiskManager.sol",
    "OptionPositionManager": "src/options/OptionPositionManager.sol",
    "OptionMarket": "src/options/OptionMarket.sol",
    "OptionsEngine": "src/options/OptionsEngine.sol",
    "PerpPositionManager": "src/perps/PerpPositionManager.sol",
    "PerpOrderManager": "src/perps/PerpOrderManager.sol",
    "FundingManager": "src/perps/FundingManager.sol",
    "PerpsEngine": "src/perps/PerpsEngine.sol",
    "LiquidationEngine": "src/perps/LiquidationEngine.sol",
    "InsuranceFund": "src/core/InsuranceFund.sol",
    "CrossMarginManager": "src/risk/CrossMarginManager.sol",
    "SubaccountFactory": "src/accounts/SubaccountFactory.sol",
    "RFQManager": "src/perps/RFQManager.sol",
}


def norm(type_id: str) -> str:
    """Drops the AST id that follows a type name: it changes with any unrelated edit."""
    return re.sub(r"\)\d+", ")", type_id)


def layout(name: str, path: str) -> dict:
    out = subprocess.run(
        ["forge", "inspect", f"{path}:{name}", "storage-layout", "--json"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    raw = json.loads(out)
    storage = [
        {"label": s["label"], "slot": s["slot"], "offset": s["offset"], "type": norm(s["type"])}
        for s in raw["storage"]
    ]
    types = {}
    for key, t in raw["types"].items():
        entry = {k: v for k, v in t.items() if k not in ("members", "base", "key", "value")}
        for k in ("base", "key", "value"):
            if k in t:
                entry[k] = norm(t[k])
        if "members" in t:
            entry["members"] = [
                {"label": m["label"], "slot": m["slot"], "offset": m["offset"], "type": norm(m["type"])}
                for m in t["members"]
            ]
        types[norm(key)] = entry
    return {"storage": storage, "types": types}


def problems(name: str, old: dict, new: dict) -> list:
    found = []
    for i, var in enumerate(old["storage"]):
        if i >= len(new["storage"]) or new["storage"][i] != var:
            now = new["storage"][i] if i < len(new["storage"]) else "missing"
            found.append(f"{name}: slot entry {i} `{var['label']}` changed (was {var}, now {now})")
    for key, entry in old["types"].items():
        if key in new["types"] and new["types"][key] != entry:
            found.append(f"{name}: type {key} changed (a struct member was reordered, removed or retyped)")
    return found


def main() -> int:
    update = "--update" in sys.argv
    BASELINE.mkdir(exist_ok=True)
    failed = []
    for name, path in CONTRACTS.items():
        current = layout(name, path)
        file = BASELINE / f"{name}.json"
        if update or not file.exists():
            file.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
            continue
        failed += problems(name, json.loads(file.read_text()), current)
    if update:
        print(f"storage layouts written to {BASELINE.relative_to(ROOT)}/")
        return 0
    if failed:
        print("\n".join(f"!!! {line}" for line in failed))
        print("A proxy keeps its state across an upgrade: only append state variables. If this change")
        print("is meant to reset the state, deploy fresh with DeployAll and rerun with --update.")
        return 1
    print(f"storage layout: all {len(CONTRACTS)} contracts keep their layout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
