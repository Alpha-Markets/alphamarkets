# Changelog

All notable changes to Orionis Markets smart contracts are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Not deployed. Found by auditing the cross-cutting rules in DEVELOPMENT_STEPS.md against `[1.3.0-testnet]`; these changes reach a chain with the next redeploy.

### Added — events for four admin setters that emitted nothing

- `PriceValidator.setMaxPriceAge` emits `MaxPriceAgeUpdated(marketId, value)` and `setMaxDeviationBps` emits `MaxDeviationUpdated(marketId, valueBps)`. These two set the oracle staleness and deviation limits, so a change to them must be visible to the indexer and to monitoring.
- `FundingManager.setMaxFundingRateBps` emits `MaxFundingRateUpdated(marketId, maxRateBps)`.
- `PerpsEngine.setRfqManager` emits `RfqManagerSet(manager)`.
- All four are in `services/indexer` and the SDK's generated ABIs. Tests: `test/core/AdminEvents.t.sol`.

### Added — admin handover script

- `script/HandOverAdmin.s.sol` moves `DEFAULT_ADMIN_ROLE` and every `*_ADMIN_ROLE` on the 18 AccessControl contracts from the deployer to a multisig or timelock, in two steps (grant, then revoke with `RENOUNCE=true`). It refuses a zero address, the current admin, and an address without code unless `ALLOW_EOA=true`. It leaves the operational roles (`ENGINE_ROLE`, `QUOTER_ROLE`, `MAKER_ROLE` and the like) alone.
- `script/check-admin-roles.sh` runs in the contracts workflow and fails when a contract declares an `*_ADMIN_ROLE` the script does not move.
- Tests: `test/core/AdminHandover.t.sol` (8 cases, on the full stack: both admins after step one, only the new admin after step two, the new admin can change parameters and the old cannot).

### Added — margin math parity vectors

- `test/vectors/margin.json` holds liquidation price, PnL and margin ratio cases. `test/risk/MarginParity.t.sol` runs them against `MarginEngine`, and `packages/sdk/src/math.test.ts` runs the same file against the SDK's bigint mirror that the web app uses for previews. If the two drift, one suite fails. `foundry.toml` allows reading `test/vectors`.

## [1.3.0-testnet] - 2026-09-20

Full redeploy to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol` then `script/ConfigureMarkets.s.sol`, from the deployer `0xC804c6c50CE6F5B5dFB035378A3F84145914697F`. It replaces `[1.2.0-testnet]`, which is abandoned. Phase 7: trigger orders, subaccounts, cross margin, other collateral, portfolio margin, the insurance fund and RFQ. The settlement token `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` is unchanged, and the NVDA mock feed (`0xFB1000c1Bf239D34Af27f54686C9D077F1938Be0`, seeded at $190) is owned by the keeper `0xa22e9da21Ae258f733EE932f767c46CB6508eD69`.

| Contract | Address |
|---|---|
| MarketRegistry | `0xD1019516182cCC5976884b31e39E63247d5bdA3b` |
| CollateralManager | `0x3CF01Ed4C450aec514Ed3cFEBF38fCCC8bb9a360` |
| OrionisVault | `0x2C4751299bf5c3B659da825ce9Ba610D30509d19` |
| FeeManager | `0xF0B42B2d5eBF0f4b8ae195eb230Aee164914F710` |
| BuybackModule | `0x1EDF2A8eb01ae0199A605B23482E3266C5BAdeeC` |
| PriceValidator | `0x3b0Fe50B4FA6A6144F320f34acf7ff29307eFf79` |
| OracleRouter | `0x690b3039266535bEe12ec63247eCB75A056bb453` |
| RiskManager | `0xB0D49b787dABa84b1Bc87EF6735a006Dd90dfca2` |
| OptionPositionManager | `0x544624e7dB172C1b614952eA6D7A51597Ac53677` |
| OptionMarket | `0x72a716E0995324A94723fccf98b315b0421C19c8` |
| OptionsEngine | `0x28CEF869Bc5736C815d3c1304A7b53c064e35D32` |
| PerpPositionManager | `0xB2fa58A93b05b1Cc2773D795976EFc08BF3aF246` |
| PerpOrderManager | `0x3a7E7f9da5758fd9519e13fdeB3A77891b1B51e7` |
| FundingManager | `0x181D8e405560b16F8d42a9Ba941CC3a8513F1676` |
| PerpsEngine | `0x0f47b9CC8de372D02c7664a931CFBFdbbB505446` |
| LiquidationEngine | `0x17c47aB434ef561348eC70A0927703d838Fe8d70` |
| InsuranceFund | `0x8B46113C13ecCd7e1D01c0fEf18d4241740d2212` |
| CrossMarginManager | `0x82e464Da82Ab1447637dE8Fe9faF490A978019c0` |
| SubaccountFactory | `0xA0068d8E945bBD3b23aB029E17e4B1C749E40062` |
| RFQManager | `0xB314f10cA6C71F723c08EAa545688dF9EBe53F94` |

Confirmed live with `cast`: code at every address above; `vault.withdrawGuard`, `perpsEngine.crossMargin` and `perpsEngine.rfqManager` point at the new managers; `crossMargin` holds the engine and liquidator roles; the deployer holds `MAKER_ROLE` on `RFQManager` (no `MAKER_ADDRESS` was set); the keeper owns the feed; the mark price reads $190. `DeployAll` gave `QUOTER_ROLE` on `OptionsEngine` to the deployer (`QUOTER_ADDRESS` was not in the contracts `.env`), so it was granted to the pricing quoter `0xC9FA7B955B9FeffDFC3363e095447B99F8c2D31c` and revoked from the deployer right after. Explorer verification is still pending (the explorer's certificate). Wallet pass on 2026-09-20, by hand with the full stack running (keeper, indexer with a reset database, pricing, API, web): deposit; an isolated and a cross-margin perp; a stop-loss placed, rejected on the wrong side, cancelled, and fired by the keeper after the mock feed moved to $188 (then reset to $190); an option opened from the chain; the strategy builder page; positions closed. Not tried: RFQ against a real market maker, subaccounts and the insurance fund from a wallet, portfolio margin, other collateral, block trades.

**None of this has been audited.** The parts that hold or move money (cross margin, collateral seizure, the insurance fund, RFQ prices) need the third-party audit in DEVELOPMENT_STEPS.md before any mainnet use. The suite is 216 tests (it was 135); coverage is 96.0% of lines and 66.7% of branches.

Constructor changes (redeploy only, nothing upgrades in place): `PerpsEngine` takes a `crossMargin_` address last (zero turns `openPositionCross` off); `LiquidationEngine` takes `crossMargin_` and `insuranceFund_` last (zero means all positions are isolated and a shortfall is not covered). `OrionisVault` gained `setWithdrawGuard` and `withdrawGuard` (default off).

### Added — trigger orders (PROJECT_BRIEF.md Section 39)

- `PerpsEngine.placeTriggerOrder(positionId, kind, triggerPrice, expiry)`, `cancelTriggerOrder(orderId)` (owner only) and `executeTriggerOrder(orderId)`. `kind` is `TriggerKind.STOP_LOSS` or `TAKE_PROFIT` (new enum in `interfaces/DataTypes.sol`).
- A trigger order is attached to an open position and closes the **whole remaining position** at the mark price when the mark reaches the trigger. A long's stop-loss and a short's take-profit fire when the mark falls to the trigger; a long's take-profit and a short's stop-loss fire when it rises to it. At placement the trigger must sit on the not-yet-fired side of the current mark (a long's stop-loss below it, its take-profit above it; a short is the mirror image), otherwise `InvalidTriggerPrice`: a trigger that is already reached would close the position at once.
- `executeTriggerOrder` is permissionless, like `executeLimitOrder`: the price condition is checked onchain, so no keeper is trusted (`services/keeper` runs one for convenience). Margin, PnL and the taker fee settle for the position's owner exactly as in `closePosition`; the caller gets nothing. It works while the market is paused, like `closePosition`.
- **No slippage bound on the exit.** The position closes at the mark price when the order fires, which can be worse than the trigger if the price gapped past it. A stop-loss must get out; a bound would leave the position open exactly when it matters. The UI and SDK say so.
- An order left on a position that closed, was reduced to nothing or was liquidated another way can never fire: `executeTriggerOrder` reverts with `PositionNotOpen` and the order stays `OPEN` until its owner cancels it or it expires. Nothing loops over a position's orders onchain, so a close never costs more gas because of them. After a partial reduce the order closes what is left.
- `PerpOrderManager` also stores trigger orders (`createTriggerOrder`, `markTriggerExecuted`, `markTriggerCancelled`, `getTriggerOrder`, `getUserTriggerOrders`, `nextTriggerOrderId`), with ids separate from limit orders. It stays storage only, written by `PerpsEngine` (`ENGINE_ROLE`).
- Events: `TriggerOrderPlaced`, `TriggerOrderCancelled`, `TriggerOrderExecuted` (also watched by `services/indexer`). New error: `TriggerPriceNotReached`. Reused: `InvalidTriggerPrice`, `OrderNotOpen`, `OrderExpired`, `PositionNotOpen`, `NotPositionOwner`.
- `PerpsEngine._reduce` was split: `_applyReduce` holds the PnL, margin, fee, open-interest and position-record steps, shared by `reducePosition`, `closePosition` and `executeTriggerOrder`. No behavior change for the existing calls.
- Tests: `test/perps/TriggerOrders.t.sol` (23 cases: side rules for both directions, placing, both kinds firing for both directions, a gap through the trigger, partial reduce, expiry, cancel, closed position, paused market, access control on the storage, and a fuzz that an order fires only when the mark has reached it and always exits at the mark), and the SDK's Anvil integration test. The suite is 158 tests; coverage 94.75% of lines and 65.88% of branches.
- Not built: partial-size triggers, trailing stops, a trigger tied to the liquidation price, an incentive for keepers, and a cap on orders per position or owner. Also not built: a stop-loss or take-profit set in the same call that opens a position.

### Added — subaccounts (Section 40)

- `SubaccountFactory.createSubaccount(index)` creates a `Subaccount` at a deterministic CREATE2 address (owner and index); `computeAddress`, `subaccountsOf`. The factory keeps the list of contracts a subaccount may call (`setTargetAllowed`, `TARGET_ADMIN_ROLE`): the engines only. The Vault can never be added.
- `Subaccount` is a small contract wallet. The engines see it as the trader, so its balance, positions, orders and margin are separate from the owner's main account. The owner can `execute` one engine call or `multicall` several all-or-nothing, `deposit` and `withdraw` (owner only; a withdrawal always goes to the owner), and name delegates (`setDelegate`). A delegate can trade and nothing else: it cannot deposit or withdraw and cannot reach the Vault or a token, so it cannot move funds out.
- A target's own revert is bubbled up unchanged (`InsufficientMargin` stays `InsufficientMargin`).
- Tests: `test/accounts/Subaccounts.t.sol` (17).

### Added — clearing: the insurance fund and bad-debt handling (Section 40)

- **Fixed:** `LiquidationEngine.liquidate` reverted when a position had lost more than its owner held (the Vault debit underflowed), which left a deeply underwater position impossible to liquidate. It now settles what the owner has and treats the rest as a shortfall.
- `InsuranceFund` is the last step of the loss waterfall: an ordinary Vault account (anyone can `deposit`; only `FUND_ADMIN_ROLE` can `withdraw`) that pays a shortfall in the settlement token. What it cannot cover is bad debt: the events `ShortfallCovered(positionId, owner, amount)` and `BadDebt(positionId, owner, amount)` say which.
- Nothing pays into the fund automatically yet (no share of fees or liquidation penalties): it is funded by deposits. Sizing and funding it is a product decision.
- Tests: `test/risk/CrossMargin.t.sol` (shortfall covered, partly covered, not covered, and on an isolated position).

### Added — cross margin, other collateral and portfolio margin (Sections 39 and 40)

- `PerpsEngine.openPositionCross(...)` opens a position backed by the whole account instead of only its own margin. The margin is still locked at the position's leverage; what changes is liquidation. `CrossMarginManager.accountHealth(owner)` returns `equity` (free balance, plus margin and unrealised PnL of every open cross position, plus the haircut value of other collateral) and a `requirement` (the sum of each cross position's maintenance margin). `LiquidationEngine.isLiquidatable` for a cross position is `equity < requirement` for the account, and cross positions are liquidated worst margin ratio first (`NotWorstPosition`), so a liquidator cannot close a healthy position while a failing one stays open. At most 10 open cross positions per account, so every health check has a bounded cost.
- **Withdrawals are checked.** The Vault asks `CrossMarginManager.check` before every withdrawal (`IWithdrawGuard`): an account with open cross positions cannot withdraw the balance that backs them, and must stay 10% above its requirement (`WithdrawWouldUndermargin`). An account with no cross position withdraws freely, as before.
- **Other collateral.** `setCollateralConfig(token, factorBps, priceMarketId, enabled)` lets another supported token count towards equity at `factorBps` of its oracle value. When a liquidated cross position leaves a shortfall, that collateral is seized into the insurance fund at the same haircut (`CollateralSeized`) and the fund pays the shortfall in the settlement token, so the fund ends up holding the seized tokens (to be sold or withdrawn by its admin). A token that is not configured, or is disabled, counts for nothing.
- **Portfolio margin (opt-in).** `setPortfolioMargin(true)` and `addPortfolioOption(id)` (up to 20 open long options) replace the requirement with the worst loss across price shocks (default -20%, -10%, +10%, +20%; `setPortfolioParameters`) on the cross perps plus the intrinsic value of the registered options, floored at a share of the standard requirement (default 30%). A hedged book (a long perp and a put) is charged less than the sum of its parts; a naked one is charged more.
- **Limits.** Not modelled: funding accrued and not yet settled, and options' time value and volatility (intrinsic value is a lower bound for a long option, so it errs on the safe side). Oracle reads revert on a stale price, so a health check does too. Isolated positions are untouched by all of this.
- Tests: `test/risk/CrossMargin.t.sol` (23), including cross surviving where isolated is liquidated, worst-first order, withdraw guard, seizure into the fund, a disabled token, and a hedged versus a naked portfolio-margin book.

### Added — RFQ and block trades (Sections 39 and 40)

- `RFQManager.execute(quote, signature)` opens a perp position at a market maker's signed price instead of the mark. The quote is EIP-712 (`RFQQuote`: user, market, side, margin, leverage, price, `validUntil`, nonce), signed by a `MAKER_ROLE` holder for exactly that user, valid for a short time, single use, and its price must be within `maxDeviationBps` (default 1%) of the oracle mark (`PriceOutOfBand`), so a compromised maker key cannot sell the pool a position at a wild price.
- A **block trade** is an RFQ whose notional is at least `blockMinNotional`: it may exceed the ordinary per-position cap, up to `blockMaxNotional` (`BlockTooLarge`). The open-interest cap and the leverage tiers still apply. Off by default (`setParameters`).
- `PerpsEngine.openPositionAtPrice` is the only new entry to the engine, callable only by the RFQ manager, wired once by the deployer (`setRfqManager`). `_openPosition` was split so a market order and an RFQ share `_openAt`.
- **Trust:** the maker sets the price, so its key is as critical as the options quoter's: a dedicated key held by the maker's own service, behind a multisig or HSM before mainnet.
- Tests: `test/perps/RFQ.t.sol` (18) and the SDK's Anvil integration test, which signs with the maker key and opens a position at the quoted price.

## [1.2.0-testnet] - 2026-09-20

Full redeploy to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol` then `script/ConfigureMarkets.s.sol`. It replaces `[1.1.0-testnet]`, which is abandoned: it has the `increasePosition` flaw below. Deployer `0xC804c6c50CE6F5B5dFB035378A3F84145914697F` (a new testnet-only key; the old admin `0xD1bC08B8081F718BE30645A2FeA7E015e04E29E9` holds no role on these contracts). Quoter `0xC9FA7B955B9FeffDFC3363e095447B99F8c2D31c` (unchanged, granted `QUOTER_ROLE` on the new engine). Keeper `0xa22e9da21Ae258f733EE932f767c46CB6508eD69` owns the NVDA mock price feed and holds no other role. The settlement token `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` (mUSDC, 18 decimals) is unchanged. Every contract was confirmed live with `cast code`; the quoter role, the keeper's feed ownership, the order manager's engine role and `optionsEngine.settlementDecimals() == 18` were confirmed with `cast call`.

| Contract | Address |
|---|---|
| MarketRegistry | `0x68C4dfB2261A9CAeaE8508C46257857472052384` |
| CollateralManager | `0x0C959E641B3FFeEA76C5fDbc659311b64C8a1fc3` |
| OrionisVault | `0x6b38EB431823C82E7899047514411225BF95529C` |
| FeeManager | `0x8E29a239E94FF68858a4Bc21ee3c7cB787231cbe` |
| BuybackModule | `0xc729D0a026dc3CfC378Abf1597499511793b2a98` |
| PriceValidator | `0x2F2E20EdA39Bc30537Ad6D13267Ed0784a3C21Dd` |
| OracleRouter | `0x1A9A537E10D695cEeC34FaBC59f34d870e3700Ce` |
| RiskManager | `0x06D339536a40788f18E864CCaeCE0D0B795c41B4` |
| OptionPositionManager | `0x7eC3Ff91bDc72C15dc8762791122C8C91e230166` |
| OptionMarket | `0x607035E17CC6a6945478A5D9371bD69BE1daA9B7` |
| OptionsEngine | `0xAD4841566bE45c03287d01EAaF4a46cDF0d069E9` |
| PerpPositionManager | `0x814A79499E0919aC74334BE7F9e2A1e07d75fBc9` |
| PerpOrderManager | `0x9fb41f7601789486910DBF3A309cb439c91c92BD` |
| FundingManager | `0x9a851D02b16490b03a14C9Df2B0aDa8b00B85B7c` |
| PerpsEngine | `0xAEaE876e34A379Ea5B9B741FA955299029217b33` |
| LiquidationEngine | `0xD18349e34e618bCEEcf886977740E6673c7CbE18` |
| NVDA underlying token (mock) | `0x52aF11f0D22eCd5C7a43C0b87422Cab0f6DC9d6d` |
| NVDA price feed (mock, seeded $190, owned by the keeper) | `0x4e51F60E8a05e370C6588F8d567B2071f0d96AcE` |

Smoke test on testnet after deploy (SDK, deployer wallet): deposit; open a long; `increasePosition` charged exactly the margin plus the taker fee; a size-only increase far past 10x was rejected with `PositionLimitExceeded`; a limit order was placed and one placed and cancelled; `services/keeper` then filled the reachable order as a position at the mark price; positions closed and open interest returned to 0. The explorer verification of these contracts is still pending (Robinhood's explorer certificate).

### Security — option premiums are now signed (redeploy required)

`OptionsEngine` previously took the premium from the caller. `openPosition` only checked it against a caller-supplied `maxPremium`, so a buyer could open any option for a premium of 0; `closePosition` only checked a caller-supplied lower bound `minPremium`, so a seller could claim any amount as the close premium and draw it from the shared collateral pool. Both are fixed:

- Every open and close now needs an EIP-712 `Quote` (`validUntil`, `nonce`, `signature`) signed by a holder of the new `QUOTER_ROLE` over that exact user, series, size and premium (`OpenQuote` / `CloseQuote`). The signature binds the caller and the engine address, expires, and can be used once.
- `OpenPositionParams.maxPremium` and the `minPremium` argument are gone: the signed premium is the price.
- New errors: `InvalidQuote`, `QuoteExpired`, `QuoteAlreadyUsed`. `openQuoteDigest` / `closeQuoteDigest` expose the digests for signers and tests.
- `OptionsEngine` now takes an `admin_` constructor argument (first) and is an `AccessControl` contract. `DeployAll.s.sol` grants `QUOTER_ROLE` to `QUOTER_ADDRESS` (default: the deployer, for local runs).
- Tests: `test/options/OptionQuotes.t.sol` covers a missing, forged, tampered, expired, replayed and borrowed quote, an inflated close premium, revoked quoters, and a fuzz over unsigned premiums.

Shipped in `[1.1.0-testnet]` below. The `[1.0.0-testnet]` contracts still have the old, exploitable `OptionsEngine` and are abandoned.

Trust model: the quoter key sets option prices, so it is a critical secret. Use a dedicated key (not the deployer), keep it only in `services/pricing`, and move the role behind a multisig or HSM before mainnet (PROJECT_BRIEF.md Section 37). Settlement does not depend on it: expiry payouts still come from the oracle's settlement price. Not yet enforced onchain, and worth adding before mainnet: a floor at intrinsic value for opens and a ceiling for closes, so a compromised quoter cannot sell deep in-the-money options for nothing or pay out more than they are worth.

### Fixed — `PerpsEngine.increasePosition` skipped the taker fee and the leverage check (found in manual testing of 1.1.0-testnet)

`[1.1.0-testnet]` had the flaw: increasing a $200 position by $50 emitted `PerpPositionUpdated` and no `ProtocolFeeCollected`, and a $100-margin position could be grown to the position cap (about 5,000x at $500K) with no added margin. Fixed in this version:

- The taker fee is charged on the added size, and the owner's available balance must cover the added margin plus that fee (`InsufficientCollateral`).
- The resulting position must satisfy `size <= collateral * maxLeverage` (new `RiskManager.checkResultingLeverage`, `PositionLimitExceeded`). Adding size rarely lands on one of the discrete tiers, so the ceiling (the highest tier) applies, as it does to a position that shrinks its margin.
- Adding nothing (`addCollateral == 0 && addSize == 0`) reverts with `ZeroAmount`; margin-only increases charge no fee; the position and open-interest caps and the limit price only apply to added size; the last price is recorded for added size, as `openPosition` does.
- Tests: `test/perps/PerpsIncrease.t.sol` (16 cases, including a fuzz over margin and size that checks the leverage ceiling and the exact fee), and the SDK's Anvil integration test.

### Fixed — options ignored the settlement token's decimals (critical on any token that is not 18 decimals; not live on testnet)

Option maths runs in 18-decimal fixed point (price, strike, contract size), but two results were handed to the Vault and RiskManager without being converted to the settlement token's base units:

- **Settlement payout.** `OptionsEngine.settleExpired` credited the intrinsic value in 18 decimals. On a 6-decimal token, a $200 payout was credited as `200e18` base units, a trillion times too much, and the difference is drawn from the shared collateral pool. The testnet settlement token has 18 decimals (checked onchain), so `[1.1.0-testnet]` is not affected; a mainnet USDC-style 6-decimal token would have been, for any option that expires in the money.
- **Notional.** Option notional went into RiskManager's position-size and open-interest counters in 18 decimals while perp notional (`collateral * leverage`) is in token units, so one counter mixed two scales, and limits written as `500_000e18` did not bind perp notional on a 6-decimal token at all.

`OptionsEngine` now reads `settlementDecimals` from the token at construction and converts both. Every amount RiskManager sees is in settlement-token base units. Consequences for deployment: `RiskManager` position and open-interest limits, and `MarketRegistry.openInterestCap`, are in token base units (`script/ConfigureMarkets.s.sol` now scales them by the token's decimals). Tests: `test/options/OptionsSixDecimals.t.sol` runs the stack on a 6-decimal token (`BaseTest._settlementDecimals`), covering payout, a fuzz over settlement prices, open interest on open, close and settle, one shared unit for perp and option notional, and the position cap. Premiums and the signed quote path were already in token units and are unchanged.

### Added — limit orders (PROJECT_BRIEF.md Section 39)

- `PerpOrderManager` (`perps/`): order storage only, written by `PerpsEngine` (`ENGINE_ROLE`), like `PerpPositionManager`. Statuses `OPEN`, `EXECUTED`, `CANCELLED`.
- `PerpsEngine.placeLimitOrder(marketId, isLong, collateral, leverage, triggerPrice, expiry)`, `cancelLimitOrder(orderId)` (owner only) and `executeLimitOrder(orderId)`. A long fills when the mark price is at or below the trigger, a short at or above it, at the mark price. `executeLimitOrder` is permissionless: the price condition is checked onchain, so no keeper is trusted (`services/keeper` runs one for convenience).
- Nothing is reserved in the Vault while an order rests. Margin, the taker fee, the leverage tier, the position cap and the open-interest cap are all checked and taken at fill time, exactly as for `openPosition`, so an order whose owner withdrew the margin, or whose market hit a cap, simply cannot fill and stays open until it fills, expires or is cancelled.
- Events: `LimitOrderPlaced`, `LimitOrderCancelled`, `LimitOrderExecuted`. Errors: `InvalidTriggerPrice`, `OrderNotOpen`, `OrderExpired`, `LimitPriceNotReached`.
- `PerpsEngine`'s constructor takes the order manager (after the position manager); `DeployAll.s.sol` deploys `PerpOrderManager`, grants it the engine role and records `perpOrderManager` in `deployments/<network>.json`.
- Tests: `test/perps/LimitOrders.t.sol` (19 cases, including a fuzz that a fill is never worse than the trigger) and the SDK's Anvil integration test.
- Not built: stop-loss and take-profit orders, and any incentive for keepers. There is no cap on orders per owner, so anyone can leave many open orders; they cost a keeper only a view call each.

### Changed

- `script/ConfigureMarkets.s.sol`: `PRICE_FEED_OWNER` sets the mock price feed's owner (default: the deployer), so a dedicated keeper key can refresh it without holding any other role. Position and open-interest limits scale with the settlement token's decimals.
- CI: `.github/workflows/contracts.yml` now fails below 90% of lines and 55% of branches (`script/check-coverage.py`).

### Tests and coverage

The suite grew from 70 to 135 tests. Coverage of `src/` went from about 67% of lines and 30% of branches to 94.5% and 62.6%. New suites: `test/oracle/OracleSafeguards.t.sol` (stale price, deviation, fallback source, decimals normalisation, pause, settlement price reads; `PriceValidator` 37% to 100% of lines) and `test/core/AdminPaths.t.sol` (MarketRegistry, BuybackModule, PerpPositionManager and FundingManager admin and error paths). Fork tests against testnet state and a third-party audit are still to do (see "Testing & Pre-Deployment" in DEVELOPMENT_STEPS.md).

### Redeploy checklist

1. Generate a dedicated quoter key and set `QUOTER_PRIVATE_KEY` / `QUOTER_ADDRESS` in the root `.env`, and a dedicated keeper key for `services/keeper` (`KEEPER_PRIVATE_KEY`, funded with a little gas). Set `PRICE_FEED_OWNER` to the keeper's address before running `ConfigureMarkets`.
2. `forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast` with `NETWORK_NAME=robinhood_testnet` (a dry run costs about 0.0005 ETH of gas).
3. `pnpm --filter @orionis/config sync:deployments` (it now records `perpOrderManager`), clear any `NEXT_PUBLIC_*` address overrides in `.env`, regenerate the SDK ABIs (`pnpm --filter @orionis/sdk generate:abis`) if a contract changed, and add the new addresses to this changelog.
4. Run `script/ConfigureMarkets.s.sol` to seed NVDA on the new registry, then `script/verify.sh`.
5. Reset or re-index the indexer database so rows from the old contracts do not mix with the new ones.

### Pending

- Explorer verification of the `[1.1.0-testnet]` contracts. `script/verify.sh` (now reads `deployments/<network>.json`, retries each contract, and takes `NVDA_TOKEN` / `NVDA_FEED` for the mock market contracts) failed on every request with `client error (Connect)`: `explorer.testnet.chain.robinhood.com` currently fails TLS certificate validation. Re-run it once Robinhood fixes the certificate; do not disable TLS checks.

- Root `.env`'s `NEXT_PUBLIC_RPC_URL` currently holds a personal Alchemy API key — replace with a public/rate-limited endpoint before this is ever exposed to a real frontend build, since `NEXT_PUBLIC_*` vars ship to the browser.

### Explorer verification of `[1.0.0-testnet]` — complete (all 18/18)

`script/verify.sh` hit Robinhood's Blockscout explorer serving an intermittently expired, and sometimes completely unrelated (`internetsehatku.com`), TLS certificate on `explorer.testnet.chain.robinhood.com` — Robinhood's own infra issue, not fixable from this repo. Failures were per-request bad luck, not permanent: repeated runs of `script/verify-retry.sh` eventually got every one of the 18 deployed contracts (all 15 core contracts, the settlement token, the NVDA mock underlying token, and the NVDA mock price feed) verified.

## [1.1.0-testnet] - 2026-09-19

Full redeploy to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol`, followed by `script/ConfigureMarkets.s.sol`. It replaces `[1.0.0-testnet]` and ships the signed-premium `OptionsEngine` (see Unreleased "Security"). Every contract was confirmed live with `cast code`, and `QUOTER_ROLE` on `OptionsEngine` was confirmed granted to the dedicated quoter `0xC9FA7B955B9FeffDFC3363e095447B99F8c2D31c` (not the deployer). The settlement token `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` is unchanged.

| Contract | Address |
|---|---|
| MarketRegistry | `0x15F599aFBCE042922716ae2C169e5dB9Be6eA855` |
| CollateralManager | `0x3bd150A6c70aa668cB6052DD6c4cb44938B1557D` |
| OrionisVault | `0x5c809C4872c603fBF74f48Fdc8348EaDEC5dFF66` |
| FeeManager | `0x15C6b95c289bd093b05B7578257aDfE4CADe8EDF` |
| BuybackModule | `0x829447D77f25578706d7C84c2756bc793094fCda` |
| PriceValidator | `0xe4b6E3e7e92F4877F725283D5D3a719f99B0392B` |
| OracleRouter | `0xCB9AD3D302C49696FBc322742355a84f49D618cd` |
| RiskManager | `0x7cBE5EcFC9a57022e6Ee397627D6b4B354c9Eb2D` |
| OptionPositionManager | `0x0f612910002A6dc4A2087A2dD3f851d4D850C017` |
| OptionMarket | `0xcf418529fA0B64ce8359E1C3abb33c8c216C5954` |
| OptionsEngine | `0x8c7F0f7e196d9C841b3BE2CDf0Ad52D4F2a00cd5` |
| PerpPositionManager | `0xC3D98bACc4c6Ba46D16229fb8AD117e0dFC643d6` |
| FundingManager | `0x850F32d7c7F29F913C26556d46820f0D2108428d` |
| PerpsEngine | `0x901bA7223B4298ddB0CF4528200792d4F679580F` |
| LiquidationEngine | `0xd03C8E323c63B13213c78408D3f55c4A1b2e6C9B` |
| NVDA underlying token (mock) | `0x68bc85c9f800eA0776838079125b648b7f107b1A` |
| NVDA price feed (mock, seeded $190) | `0xF812D671dF93D97f11415D7A91472F98eBd4E31E` |

The NVDA market was seeded with the same risk and placeholder fee configuration as `[1.0.1-testnet]`. The mock price feed only holds its seeded price until the oracle's staleness window passes; a stale feed makes `getIndexPrice` revert with `StaleOraclePrice()`, so refresh it before testing.

## [1.0.1-testnet] - 2026-09-18

`script/ConfigureMarkets.s.sol` run for real against `[1.0.0-testnet]` below — seeded the NVDA market. Confirmed live via `cast code` on the underlying token before recording.

| Item | Address |
|---|---|
| NVDA underlying token (mock) | `0xCb73eA96c319846E4d15B2920c0FD2223D5796Ee` |
| NVDA price feed (mock, seeded $190) | `0xE7970f8eCD2917813E6B242d8f5796A6c0049e13` |

Wired: `OracleRouter.setPrimarySource(NVDA, ...)`, `MarketRegistry.addMarket` (10x max leverage, options+perps enabled, $5M OI cap), `RiskManager.setRiskConfig` (leverage tiers 1/2/3/5/10x, 10%/5% initial/maintenance margin, $500K max position — PROJECT_BRIEF.md Section 13/19 NVDA example), `FeeManager.setFeeConfig` (placeholder fees, see `ConfigureMarkets.s.sol` comments — confirm real numbers with product).

## [1.0.0-testnet] - 2026-09-18

Deployed to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol`, routed through an Alchemy RPC endpoint (Robinhood's own default RPC had an expired TLS certificate at deploy time). All roles wired automatically by the script.

**Note on verification history:** a first `DeployAll.s.sol --broadcast` attempt looked successful in its trace output but never actually broadcast anything — its simulation reverted at the final `vm.writeJson` step (the `deployments/` folder didn't exist yet), and `forge script` only sends real transactions once the *entire* simulation completes without reverting. This was caught by checking `cast code` on the resulting `oracleRouter` address, which returned `0x` (empty). After creating the `deployments/` folder, the script was re-run and every address below was confirmed live via `cast code` before being recorded here.

| Contract | Address |
|---|---|
| MarketRegistry | `0x027D56C99D9E486F8911F0bd58EE508a817E9c0e` |
| CollateralManager | `0x760E82300F3E2095Ae2E04318a0ef03cb693d52c` |
| OrionisVault | `0x9F05fd9F0fE15fEbBd6EDcd7D63f4D0bCe7d3c1b` |
| FeeManager | `0xa8fF53Fb41Bbf90B79f8c45B1576BB6F93Dc45c3` |
| BuybackModule | `0x9Ae0Ebf31ee39F74bB412f80c4F7dcA953abBCFf` |
| PriceValidator | `0x413f505814A0175bb7551EFb966c0580345EbF9F` |
| OracleRouter | `0x1203d1d05ae5DA1DE18752680B525F7CB0b5aFb0` |
| RiskManager | `0x2aFdFE61A5222609865Ca46BFAC90c0a35Bf5870` |
| OptionPositionManager | `0x566A18Be08fB6Df937F461741985503cE3f8486F` |
| OptionMarket | `0x5341E0C1bb61D4f776B99afE332912A4502112b4` |
| OptionsEngine | `0x1cC0612e39c1977daA7CFA4F031807b66D26a632` |
| PerpPositionManager | `0x1d8A3f6b8E720dE6cF7Bf8cDa8A7aEc32fb9Cac6` |
| FundingManager | `0xF7E00Bbe120a88137536C69e3ad01aC96807B51C` |
| PerpsEngine | `0x563b532ee62FbC2C8344626934959B132Bf95786` |
| LiquidationEngine | `0x13ed3961E2C518a5db9dFc29e895CAbAe6DE09A4` |
| Settlement token (mock USDC) | `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` |

Full record: `packages/contracts/deployments/robinhood_testnet.json`.

### Added

- Foundry project scaffold (`forge init`), `forge-std` and `@openzeppelin/contracts@v5.1.0` dependencies, `foundry.toml` (solc 0.8.26, optimizer 200 runs, fuzz profiles), `remappings.txt`, domain `src/`/`test/` layout (`core/`, `oracle/`, `risk/`, `options/`, `perps/`, `interfaces/`).
- Interfaces: `IOracle`, `IMarketRegistry`, `IOrionisVault`, `IOptionsEngine`, `IPerpsEngine`, plus `IRiskManager`/`IFeeManager`/`IPriceFeed` (necessary additions beyond PROJECT_BRIEF.md Section 6's literal list, so engines depend on interfaces rather than concrete contracts), and shared `DataTypes.sol`/`Errors.sol`.
- `MarketRegistry` — single source of truth for market config, per-market pause.
- Oracle layer: `PriceValidator` (staleness/deviation checks), `OracleRouter` (routes to primary/fallback `IPriceFeed`, normalizes to 18 decimals, records immutable settlement prices), `MockPriceFeed` (testnet/local stub).
- `CollateralManager`, `OrionisVault` (deposits/withdrawals/locked margin/PnL settlement/funding transfers/fee transfers), `FeeManager` (per-market fee config + buyback routing), `BuybackModule` (fee-routing stub; real swap deferred to Phase 2/3).
- `MarginEngine` (pure isolated-margin math library) and `RiskManager` (per-market leverage tiers, position/OI caps).
- Options: `OptionPositionManager`, `OptionMarket` (series identifier + OI), `OptionSettlement` (pure intrinsic-value/payout math), `OptionsEngine` (open/close/settleExpired; users only buy, the Vault's shared pool is the implicit writer).
- Perps: `PerpPositionManager`, `FundingManager`, `PerpsEngine` (open/increase/reduce/close), `LiquidationEngine` (deterministic `isLiquidatable`/`liquidate`, keeper-incentivized, fee+reward capped to the owner's actual available balance so liquidation itself can never revert on a deeply underwater position).
- Security pass: `ReentrancyGuard` on every fund-moving entrypoint, `AccessControl` roles throughout, slippage (`SlippageExceeded`) and deadline (`DeadlineExpired`) checks on every price-sensitive engine action including `increasePosition`, custom errors per PROJECT_BRIEF.md Section 36 plus documented necessary additions (`PositionNotLiquidatable`, `DeadlineExpired`, `SlippageExceeded`, `UnsupportedToken`).
- Full event catalogue per PROJECT_BRIEF.md Section 35 plus documented additions (`OracleSourceUpdated`, `OracleMarketPaused`, `RiskConfigUpdated`).
- Foundry test suite: 58 tests across unit, fuzz (`MarginEngine`, `OptionSettlement`, `FundingManager` zero-sum), and integration (options open→close/settle, perps open→close/liquidate) — all passing.
- `script/DeployAll.s.sol` — deploys the full stack, wires every role, writes `deployments/<network>.json`.
- `script/ConfigureMarkets.s.sol` — seeds one market (NVDA) on an already-deployed stack: mock underlying token + price feed, `MarketRegistry.addMarket`, `RiskManager.setRiskConfig` (numbers match PROJECT_BRIEF.md Section 13/19's NVDA example), `FeeManager.setFeeConfig` (placeholder fees, not specified in the brief), `OracleRouter.setPrimarySource`.
- `.github/workflows/contracts.yml` — CI job: `forge fmt --check`, `forge build`, `forge test`, `forge coverage`.

### Known limitations (tracked for Phase 2+)

- `OracleRouter.getMarkPrice` == `getIndexPrice` (no independent onchain mark price source), so perp funding never accrues in practice until a real mark-price mechanism is built.
- Options are buy-only; the Vault's shared collateral pool implicitly writes every option (no explicit seller/writer role or per-writer margin).
- Non-upgradeable; no protocol-wide pause switch (per-market pause only) — both explicit MVP decisions, not oversights.
