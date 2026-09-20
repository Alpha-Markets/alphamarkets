# Changelog

All notable changes to `@orionis/sdk`. It follows semantic versioning; before 1.0 a minor version may include breaking changes.

## [0.1.0] - unreleased

First version prepared for external use. It targets the contracts in `packages/contracts` at `[1.2.0]` or later for limit orders; every other method also works against `[1.1.0-testnet]`.

### Added

- Limit orders: `perps.placeLimitOrder`, `cancelLimitOrder`, `executeLimitOrder`, `getOrder`, `orders`, `scanOrders`, and `previewOpen({ orderType: "LIMIT", limitPrice })`. New typed errors `OrderNotOpenError`, `OrderExpiredError`, `LimitPriceNotReachedError`, `InvalidTriggerPriceError`. `portfolio.orders` now reads the order manager on chain and needs no `apiUrl`.
- Option quotes carry `bid`, `ask` and `ivSource`. `previewOpen` computes the total, break-even and max profit from the ask, which is what opening pays.
- `options.stats` (open interest and 24h volume per series), `prices.candles`, `funding.history`, `risk.openInterestHistory`.
- Optional contract addresses: `ContractAddresses.perpOrderManager` is absent on a deployment made before limit orders.

### Changed

- `openPosition({ orderType: "LIMIT" })` now fails with a message that points to `placeLimitOrder`, instead of "not supported yet".
- The option risk checks in `previewOpen` use the notional in settlement-token units, matching `OptionsEngine` `[1.2.0]`.
- The package is publishable: `@orionis/config` and `@orionis/types` are bundled into `dist/`, and only `viem` is a runtime dependency.
