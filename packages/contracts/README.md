# @alphamarkets/contracts

Foundry + Solidity 0.8.26 + OpenZeppelin v5.1.0. Phase 1 (see `DEVELOPMENT_STEPS.md`) is implemented: interfaces, all core/oracle/risk/options/perps contracts, security pass, events, Foundry test suite, and deploy scripts. **Deployed to Robinhood Chain testnet** — see `deployments/robinhood_testnet.json` and the CHANGELOG's `[1.0.0-testnet]` entry for addresses (each confirmed live via `cast code`, not just trusted from script output). No market seeded yet — see CHANGELOG `[Unreleased]` for pending follow-ups.

## Structure

```text
src/
core/       MarketRegistry.sol, AlphaMarketsVault.sol, CollateralManager.sol, FeeManager.sol, BuybackModule.sol
options/    OptionsEngine.sol, OptionMarket.sol, OptionSettlement.sol, OptionPositionManager.sol
perps/      PerpsEngine.sol, PerpPositionManager.sol, PerpOrderManager.sol, FundingManager.sol, LiquidationEngine.sol
oracle/     OracleRouter.sol, PriceValidator.sol, MockPriceFeed.sol
risk/       RiskManager.sol, MarginEngine.sol
interfaces/ IOracle.sol, IMarketRegistry.sol, IAlphaMarketsVault.sol, IOptionsEngine.sol, IPerpsEngine.sol,
            IRiskManager.sol, IFeeManager.sol, IPriceFeed.sol, DataTypes.sol, Errors.sol
test/       unit + fuzz tests mirroring src/, plus test/integration/ and test/utils/BaseTest.sol
script/     DeployAll.s.sol
```

Not a pnpm package — intentionally excluded from the JS workspace graph.

## Setup

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge build
forge test
```

`lib/` is gitignored (vendored dependency, reproducible via the pinned versions above).

## Known MVP limitations (see CHANGELOG for full detail)

- `OracleRouter.getMarkPrice` resolves identically to `getIndexPrice` (no independent onchain mark-price source in Phase 1), so `FundingManager.updateFundingRate`'s `(mark - index)/index` is always 0 — funding is structurally inert until a real mark-price mechanism lands.
- Options are buy-only: the Vault's shared collateral pool is the implicit writer/counterparty for every option position (no explicit writer/seller role).
- Non-upgradeable contracts; no protocol-wide pause switch (per-market pause via `MarketRegistry.setActive` / `OracleRouter.pauseMarket` only).

## Deploying

```bash
export PRIVATE_KEY=0x...
export COLLATERAL_TOKEN=0x...   # deployed stable settlement asset
export NETWORK_NAME=robinhood_testnet

forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast --verify
```

Writes addresses to `deployments/<NETWORK_NAME>.json` (checked into the repo as the canonical record) and prints a summary. Verified end-to-end with a local dry run (no `--rpc-url`, ephemeral in-memory EVM) — all 15 contracts deploy and every AccessControl role wires correctly.

## Handing admin to a multisig or timelock

The deployer key starts with every admin role. Before mainnet, move them (Section 37). Run these in order, each from `packages/contracts`:

1. Grant the roles to the new admin (the deployer keeps its own, so nothing is lost if the address is wrong):

    ```bash
    export PRIVATE_KEY=0x... NETWORK_NAME=robinhood_testnet && NEW_ADMIN=0xMULTISIG forge script script/HandOverAdmin.s.sol --rpc-url robinhood_testnet --broadcast
    ```

2. From the multisig or timelock, send one admin call (for example `MarketRegistry.setActive` with the current value) and confirm it succeeds.
3. Revoke the deployer:

    ```bash
    export PRIVATE_KEY=0x... NETWORK_NAME=robinhood_testnet && NEW_ADMIN=0xMULTISIG RENOUNCE=true forge script script/HandOverAdmin.s.sol --rpc-url robinhood_testnet --broadcast
    ```

The script does not move the service keys: rotate `QUOTER_ROLE` (`OptionsEngine`) and `MAKER_ROLE` (`RFQManager`) from the new admin. `PerpsEngine` has no admin. `OracleRouter.pauseMarket` shares `ORACLE_ADMIN_ROLE` with `setPrimarySource`, so a timelock in front of that role also delays an emergency pause, and a separate fast key holding it could swap the oracle too. A separate pauser role is a contract change: decide it with product before mainnet.
