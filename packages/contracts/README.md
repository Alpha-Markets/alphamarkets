# @orionis/contracts

Foundry + Solidity + OpenZeppelin. Scaffolded in Phase 1 (see `DEVELOPMENT_STEPS.md`) via `forge init`.

Structure to build out in Phase 1:

```text
contracts/
core/       MarketRegistry.sol, OrionisVault.sol, CollateralManager.sol, FeeManager.sol
options/    OptionsEngine.sol, OptionMarket.sol, OptionSettlement.sol, OptionPositionManager.sol
perps/      PerpsEngine.sol, PerpPositionManager.sol, FundingManager.sol, LiquidationEngine.sol
oracle/     OracleRouter.sol, PriceValidator.sol
risk/       RiskManager.sol, MarginEngine.sol
interfaces/ IOracle.sol, IMarketRegistry.sol, IOrionisVault.sol, IOptionsEngine.sol, IPerpsEngine.sol
```

Not a pnpm package — intentionally excluded from the JS workspace graph.
