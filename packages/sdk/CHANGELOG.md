# Changelog

All notable changes to `@alphamarkets/sdk`. It follows semantic versioning; before 1.0 a minor version may include breaking changes.

## [0.1.0] - unreleased

First version prepared for external use. It targets the contracts in `packages/contracts` at `[1.2.0]` or later for limit orders; every other method also works against `[1.1.0-testnet]`.

### Added

- Limit orders: `perps.placeLimitOrder`, `cancelLimitOrder`, `executeLimitOrder`, `getOrder`, `orders`, `scanOrders`, and `previewOpen({ orderType: "LIMIT", limitPrice })`. New typed errors `OrderNotOpenError`, `OrderExpiredError`, `LimitPriceNotReachedError`, `InvalidTriggerPriceError`. `portfolio.orders` now reads the order manager on chain and needs no `apiUrl`.
- Phase 7 (a deployment made after `[1.3.0]` is needed only where a contract is involved; the rest works on any deployment):
  - `strategies` (`buildStrategy`, `analyzeStrategy`, `payoffCurve`): the seven strategies of Section 41 with net premium, max profit and loss, break-evens, Greeks and payoff. Analytics only; short option legs cannot be opened yet.
  - `options.surface` (volatility surface with prices and Greeks per strike and expiry) and higher-order Greeks (`rho`, `vanna`, `vomma`, `charm`, `speed`, `color`) on `options.quote`.
  - `institutional`: `fundingAnalytics`, `report` and `reportCsv`, `risk` (stress test and liquidation distance of a wallet), `protocolExposure`. `stressPortfolio` and friends run the same maths on data you already hold.
  - `trading`: unsigned transactions for every action (`prepareOpenPerp`, `prepareOpenOption`, `prepareExecuteRfq`, ...) and `simulate`, for a bot in any language. `services/api` serves them as `POST /v1/trade/...`.
  - `hedgeBook`, `planHedge`, `hedgeActions`: delta hedging of an options book with perps (`services/hedger` runs them).
  - `subaccounts`, `crossMargin` and `perps.openPosition({ marginMode: "CROSS" })`, `rfq` (typed data for makers, `execute`), `structured` (protected long, straddle and strangle packages opened together through a subaccount).
- Stop-loss and take-profit: `perps.placeTriggerOrder`, `cancelTriggerOrder`, `executeTriggerOrder`, `getTriggerOrder`, `triggerOrders`, `scanTriggerOrders`, `supportsTriggerOrders`, `portfolio.triggerOrders`, the `TriggerOrder` and `TriggerKind` types, `triggerFiresBelow`, and the typed error `TriggerPriceNotReachedError`. They need a deployment made after `[1.3.0]`; on an older one `placeTriggerOrder` throws `NotImplementedError` and `supportsTriggerOrders()` is `false`.
- Option quotes carry `bid`, `ask` and `ivSource`. `previewOpen` computes the total, break-even and max profit from the ask, which is what opening pays.
- `options.stats` (open interest and 24h volume per series), `prices.candles`, `funding.history`, `risk.openInterestHistory`.
- Optional contract addresses: `ContractAddresses.perpOrderManager` is absent on a deployment made before limit orders.

### Changed

- `openPosition({ orderType: "LIMIT" })` now fails with a message that points to `placeLimitOrder`, instead of "not supported yet".
- The option risk checks in `previewOpen` use the notional in settlement-token units, matching `OptionsEngine` `[1.2.0]`.
- The package is publishable: `@alphamarkets/config` and `@alphamarkets/types` are bundled into `dist/`, and only `viem` is a runtime dependency.
