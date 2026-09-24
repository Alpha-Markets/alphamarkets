# Audit scope: AlphaMarkets contracts

Hand this file, the repository and `docs/SECURITY_REVIEW.md` to the auditor. It states what to review, how to
build and test it, who holds which powers, and what is already known. The audit itself must be done by an
independent firm: this repository's own review (`SECURITY_REVIEW.md`) is not a substitute.

## What to audit

`packages/contracts/src`, Solidity 0.8.26, OpenZeppelin v5.1.0 (upgradeable and non-upgradeable), optimizer on
at 200 runs, `via_ir` off. About 2,700 non-comment lines in 20 protocol contracts, each behind a UUPS proxy.
Commit to audit: the head of `main` once PR #7 and PR #8 are merged (the vault solvency fix is in PR #8).

| Area | Lines | Files | Why it matters |
|---|---|---|---|
| `core/` | 373 | Vault, CollateralManager, FeeManager, BuybackModule, InsuranceFund, MarketRegistry | The only place that holds tokens: custody, ledger, pool solvency, fees |
| `oracle/` | 203 | OracleRouter, PriceValidator (MockPriceFeed is testnet only, out of scope) | Every price read, freshness, deviation, fallback, pause, settlement price |
| `risk/` | 434 | RiskManager, MarginEngine, CrossMarginManager | Leverage and open-interest limits, margin math, cross-margin health and seizure |
| `perps/` | 924 | PerpsEngine, positions and orders, FundingManager, LiquidationEngine, RFQManager | Leverage, liquidation, funding, signed maker quotes |
| `options/` | 450 | OptionsEngine, OptionMarket, OptionSettlement, OptionPositionManager | Signed premium quotes, expiry settlement, payouts |
| `accounts/` | 122 | SubaccountFactory, Subaccount | Delegated execution against an allow-list of targets |
| `proxy/` | 39 | UpgradeableBase, UpgradePlaceholder | Upgrade authorization |

Out of scope: `services/`, `apps/web`, `packages/sdk`, and `MockPriceFeed` / mock tokens.

## Build and test

```bash
cd packages/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 OpenZeppelin/openzeppelin-contracts-upgradeable@v5.1.0 --no-git
forge build
forge test --fuzz-runs 10000                      # 245+ tests, including invariants
python3 script/check-storage-layout.py            # upgrade safety: only appended storage
ROBINHOOD_TESTNET_RPC_URL=... forge test --match-path 'test/fork/*'   # against the live testnet deployment
```

Invariants live in `test/invariant/PerpsInvariant.t.sol`. Options and liquidation invariants are not written yet,
and would be valuable additions from the auditor.

## Trust assumptions and privileged roles

- **`DEFAULT_ADMIN_ROLE`** upgrades every contract. Planned: a multisig behind a timelock. Today: one deployer key.
- **`ORACLE_ADMIN_ROLE`** sets price sources and freshness limits, and also pauses a market's oracle.
- **`QUOTER_ROLE`** (OptionsEngine) signs option premiums. The contract accepts any premium in a valid quote.
- **`MAKER_ROLE`** (RFQManager) signs perp entry prices within a band of the mark.
- **`RISK_ADMIN_ROLE`**, **`MARKET_ADMIN_ROLE`**, **`FEE_ADMIN_ROLE`** set limits, markets and fees.
- Price feeds are trusted to report correct prices. The router only checks freshness and agreement between two
  sources.

## Known issues (please confirm severity and look for more)

1. Emergency pause is slow behind a timelock, and `pauseMarket` shares a role with the oracle setters (no
   protocol-wide pause).
2. A compromised quoter key can set any option premium: no floor or ceiling in `OptionsEngine`.
3. `OptionsEngine.settleExpired` loops over every position in a series (gas).
4. Funding is inert: `getMarkPrice` and `getIndexPrice` return the same value.
5. Options are buy-only: the vault pool is the counterparty. The vault refuses a payout its pool cannot cover
   (`InsufficientPoolReserves`), so a winner's close can revert until losses settle or the pool is funded.
6. Bad debt is emitted (`BadDebt`) and not socialized.
7. Vault solvency was a finding in the first review and is fixed in PR #8. Please review that fix closely: the
   `totalLiabilities` counter, `fundPool`, `bootstrapLiabilities` and `RiskManager.maxNetOpenInterest`.

## Questions we would like answered

- Can any sequence of calls make `totalLiabilities` differ from the sum of ledger balances, or make the vault
  hold fewer tokens than it owes?
- Can a position be made unliquidatable, or a liquidation made to revert, by an attacker?
- Can a signed option or RFQ quote be replayed, front-run or used across chains or upgrades?
- Is the upgrade path safe (storage layout, initializers, `_disableInitializers`)?
- Is settlement-price selection at expiry manipulable (`OracleRouter.ensureSettlementPrice` records the first
  valid price at or after expiry)?
