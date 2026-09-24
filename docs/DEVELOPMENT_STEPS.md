---
id: DEVELOPMENT_STEPS
aliases: []
tags: []
---

# ALPHAMARKETS — DEVELOPMENT STEPS

Derived from PROJECT_BRIEF.md. Sequenced by MVP Priority 0 → 1 → 2, then post-MVP.

> Naming note: "Phase N" in this file is a build-order stage. It is not the same as the brief's "Phase 2" (Section 39) or "Phase 3" (Section 40), which are post-MVP feature sets covered by Phase 7 below.

---

## Current status (2026-09-20)

| Phase | Status |
|---|---|
| 0 Scaffolding | Done |
| 1 Contracts | Deployed as `[1.5.0-testnet]` (2026-09-21): every contract behind an ERC-1967 proxy (UUPS), so a later redeploy keeps every address and all state (`script/UpgradeAll.s.sol`). The 20 implementations, the NVDA token and feed, and the settlement token are verified on the explorer. `[1.4.0-testnet]` (the same code without proxies, under AlphaMarkets names) is abandoned. |
| 2 Backend services | Done. Hosted (2026-09-21): indexer, API, pricing and keeper run on Railway against `1.5.0-testnet` (moved from `1.4.0-testnet` on 2026-09-21); the web app runs on Vercel at `https://alphamarkets-ten.vercel.app`. See "Hosting (testnet)" below. Earlier: running against `1.3.0-testnet`. Nothing is hosted yet: the Railway project has only the Postgres database, and the services run from a developer machine. The indexer database was reset on 2026-09-20. A fresh database now fills `markets` from the registry when the indexer starts, and replays history when `INDEXER_START_BLOCK` (the deploy block, `122013174` for `1.3.0-testnet`) is set; see the readiness check under Testing & Pre-Deployment. New in Phase 5: `services/keeper`, analytics endpoints, bid/ask (spread `OPTION_SPREAD_BPS=200`) and realized volatility in `services/pricing`. |
| 3 SDK | Done. Package and docs are ready to publish (`0.1.0`); not published. |
| 4 Frontend | Done. Accepted with a real wallet on `1.1.0-testnet` (Phase 4) and again on `1.2.0-testnet` (Phase 5: option chain with bid/ask and Greeks, candles, funding and open interest views, limit order placed and cancelled). |
| 5 Polish | **Done** (2026-09-20): built, tested, deployed as `1.2.0-testnet`, merged into `main` (PR #1) and accepted on testnet. Open follow-ups, none blocking Phase 6: run the keeper continuously (the mock NVDA feed goes stale after 1 hour without it), publish the SDK, explorer verification, and the items marked "not done" in Phase 5. |
| 6 Rebrand audit | **Done** (2026-09-20): audit clean, brand check added to CI, social preview added. Open follow-ups, none blocking Phase 7: a real logo (needs product input) and explorer labels (blocked by explorer verification). |
| 7 Post-MVP | **Built, tested, and deployed to testnet as `[1.3.0-testnet]` (2026-09-20); wallet pass done for the perp, cross-margin, stop-loss, option and strategy-builder flows; not audited** (branch `feat/phase-7-trigger-orders`). Every item in the brief's Phase 2 and Phase 3 lists has an implementation, described under "Phase 7 progress" below, with what each one does and does not do. Addresses are in `packages/contracts/CHANGELOG.md` and `packages/config`. Quoter role fixed and indexer database reset. Still open: a wallet pass over RFQ with a real maker, subaccounts, the insurance fund, portfolio margin, other collateral and block trades, and the third-party audit before any mainnet use. |

---

## Engineering Practices (apply from Phase 0 onward)

These make the plan scalable (new markets, new contracts, new services added without rewrites) and maintainable (one engineer or a team can safely change one part without breaking others).

**Monorepo tooling**

- Use Turborepo or Nx on top of pnpm workspaces for cached, parallel builds/tests across `apps/`, `services/`, `packages/`.
- `packages/types` and `packages/config` are the single source of truth for shared shapes (MarketConfig, position types, fee config) — contracts, API, indexer, SDK, and frontend all import from there, never redefine locally.

**Contracts**

- One contract, one responsibility (already the brief's structure) — never fold logic back into a shared "god contract" for convenience.
- If upgradeability is used, isolate Proxy / Implementation / Upgrade authority into separate files and separate deploy steps (Section 6) so an upgrade never risks touching business logic. It is used since `[1.5.0-testnet]`: `src/proxy/UpgradeableBase.sol` holds the upgrade authority (`DEFAULT_ADMIN_ROLE`), each contract holds only its business logic, and `script/DeployAll.s.sol` (first deployment) and `script/UpgradeAll.s.sol` (later changes) are separate steps. See "Upgradeable proxies" below.
- Every new market or parameter change goes through MarketRegistry / RiskManager / FeeManager config, never a new contract deploy or frontend redesign (Section 5, 18) — this is the main scalability guarantee for the whole system.
- Natspec comments on every external/public function; a changelog entry (`packages/contracts/CHANGELOG.md`) per deployed version.

**Backend services**

- Each service in `services/` is independently deployable and independently testable — indexer, pricing, risk-monitor, api must not import each other's internals, only share `packages/types`.
- Database schema changes go through versioned migrations (e.g. Prisma or Drizzle migrate), never manual SQL against prod.
- Indexer is replay-safe: must be able to re-index from a given block without duplicating rows (idempotent writes keyed by tx hash + log index).

**API / SDK**

- API routes versioned from day one (`/v1/...`) so breaking changes don't require a flag day.
- SDK (`@alphamarkets/sdk`) is the only sanctioned way to talk to contracts/API from the frontend — this keeps one integration surface to maintain instead of two (frontend fetches vs external integrator fetches).

**Frontend**

- `packages/ui` holds shared, brand-styled primitives (buttons, tables, tabular-number displays) so Options Terminal, Perps Terminal, and Portfolio don't each reinvent styling — keeps the institutional visual direction (Section 2) consistent as pages grow.
- New market symbols must render correctly with zero component changes, purely from MarketRegistry + config data — this is the concrete test for "config over redesign" (Section 5).

**Testing & CI**

- CI gate on every PR: lint, typecheck, unit tests (`.github/workflows/ci.yml`), contract tests (Foundry, `.github/workflows/contracts.yml`), minimum coverage threshold on contracts (highest risk surface). Status: both workflows exist. The contracts workflow enforces 90% of lines and 55% of branches (`script/check-coverage.py`); coverage is 94.5% and 62.6% as of Phase 5. Raise the gate as branch coverage grows.
- Contract fork tests against testnet state before any mainnet deploy.
- No merge to main without green CI — this is what keeps the codebase maintainable as more contributors touch it.

**Docs as living artifacts**

- This file and `packages/contracts/CHANGELOG.md` are updated in the same PR as the code they describe, not after the fact.
- Documentation sections from Section 44 map 1:1 to `docs/` folders, so docs scale with the same structure as the code.

---

## Phase 0: Repository Scaffolding

1. Initialize git repo.
2. Create monorepo structure (Section 32):
    ```
    alphamarkets/
    apps/web/
    services/api/
    services/indexer/
    services/pricing/
    services/risk-monitor/
    packages/contracts/
    packages/sdk/
    packages/ui/
    packages/config/
    packages/types/
    ```
3. Set up package manager workspaces (pnpm recommended for this stack).
4. Add `.env.example` with all `NEXT_PUBLIC_*` vars from Section 4 and Section 21 — no hardcoded chain ID, RPC URL, contract addresses, or protocol token symbol/address.
5. Add root README stating official brand (ALPHAMARKETS / AlphaMarkets, one brand), tagline, and product statement (Section 47) — Citadelle naming must not appear anywhere (Section 46).

---

## Phase 1: Smart Contracts — Priority 0

Package: `packages/contracts/` (Foundry + Solidity + OpenZeppelin).

1. **Interfaces first** (`interfaces/`): `IOracle`, `IMarketRegistry`, `IAlphaMarketsVault`, `IOptionsEngine`, `IPerpsEngine`.
2. **MarketRegistry.sol** (`core/`) — `MarketConfig` struct (Section 18): marketId, underlyingToken, oracleId, optionsEnabled, perpsEnabled, maxLeverage, openInterestCap, active. Single source of truth for markets; frontend/SDK/protocol all query this — no separate market lists.
3. **OracleRouter.sol + PriceValidator.sol** (`oracle/`) — implements `IOracle`, routes price requests, normalizes decimals, validates timestamp freshness, rejects stale/deviant prices, supports fallback oracle, per-market config, emergency pause (Section 16). Must distinguish 4 price types (Section 17): Index Price (reference price of underlying), Mark Price (used for unrealized PnL/margin/liquidation/risk), Last Price (most recent executed derivatives price), Settlement Price (validated expiry price for options).
4. **AlphaMarketsVault.sol + CollateralManager.sol** (`core/`) — Vault holds collateral deposits/withdrawals, locked margin, available balance, PnL settlement, premium accounting, funding transfers, fee transfers (Section 7); CollateralManager tracks supported collateral tokens and per-user/per-token balances (`supportedTokens` mapping, Section 7's suggested state), keeping token-support rules separate from Vault's settlement logic. MVP: single stable settlement asset only.
5. **RiskManager.sol + MarginEngine.sol** (`risk/`) — per-market max leverage, max position size, open interest caps, margin parameters (Initial/Maintenance Margin, Margin Ratio, Liquidation Price) (Section 13, 19). MVP: isolated margin only.
6. **FeeManager.sol** (`core/`) — `FeeConfig` struct: makerFee, takerFee, optionOpenFee, optionCloseFee, settlementFee, liquidationFee (Section 20). No fee percentages in UI code.
    - **Buyback Module** (Section 21, conditional) — if AlphaMarkets keeps the deflationary tokenomics model: protocol fees → Fee Manager → Buyback Module → protocol token buyback, with configurable buyback percentage. Protocol token symbol/address stay env-driven (`NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL`, `NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS`), never hardcoded `$CTDL`. Confirm with product whether this ships in MVP or is skipped — brief marks it conditional, not required.
7. **OptionsEngine.sol + OptionMarket.sol + OptionPositionManager.sol** (`options/`) — European call/put, cash-settled only. Identifier format `UNDERLYING-EXPIRY-STRIKE-TYPE` (Section 8). Premiums are computed offchain (Section 10), so the engine only accepts a premium carried by an EIP-712 quote signed by a `QUOTER_ROLE` holder for that exact user, series, size and premium; quotes expire and are single-use. The quoter key is critical: a dedicated key, held only by `services/pricing`, moved behind a multisig/HSM before mainnet (Section 37).
8. **OptionSettlement.sol** — intrinsic value formulas (Section 9): call `max(Settlement - Strike, 0)`, put `max(Strike - Settlement, 0)`, payout `Intrinsic × Contract Size × Contracts`. Settlement price from validated oracle data only.
9. **PerpsEngine.sol + PerpPositionManager.sol** (`perps/`) — open/increase/reduce/close long/short. MVP leverage tiers: 1x/2x/3x/5x/10x, configurable per market, never hardcoded in frontend (Section 11). Position state to track (Section 12): market, side, entry price, mark price, index price, position size, collateral, leverage, unrealized PnL, realized PnL, liquidation price, funding accrued, margin ratio.
10. **FundingManager.sol** — funding rate calculation, configurable interval, tracks accrued funding per position (Section 15).
11. **LiquidationEngine.sol** — deterministic flow: oracle update → mark price update → revaluation → margin check → liquidation execution → PnL/fees settled (Section 14). Frontend is never the source of truth for liquidation eligibility.
12. **Security pass** (Section 36): reentrancy guards, access control (role-based to start, Section 37), pausable markets, precision-safe math, slippage/deadline checks, position/open-interest caps, withdrawal validation. Use custom errors (`MarketPaused`, `InvalidOraclePrice`, `StaleOraclePrice`, `InsufficientCollateral`, `InsufficientMargin`, `PositionLimitExceeded`, `OpenInterestLimitExceeded`). Issue found in Phase 4 manual testing: `PerpsEngine.increasePosition` skipped the taker fee and the leverage check. Fixed and tested in Phase 5 and deployed in `[1.2.0-testnet]` (`packages/contracts/CHANGELOG.md`); the abandoned `[1.1.0-testnet]` still has it. Phase 5 also found that options ignored the settlement token's decimals (payout and notional); fixed and tested in the same place.
13. **Events** (Section 35): every state-changing and privileged action emits an event, designed with the indexer's needs in mind (`CollateralDeposited`, `OptionPositionOpened/Closed`, `OptionExercised`, `OptionSettled`, `PerpPositionOpened/Updated/Closed`, `PositionLiquidated`, `FundingPaid`, `MarketAdded/Updated`, `ProtocolFeeCollected`, `BuybackExecuted`).
14. Foundry test suite: unit tests per contract, fuzz tests on margin/liquidation math, integration tests for full open→settle/liquidate flows.
15. Deploy to testnet. Verify contracts, record addresses into `.env`.

**Status:** deployed as `[1.5.0-testnet]` on 2026-09-21 (first block `122444455`): the same code as `[1.4.0-testnet]`, with every contract behind a UUPS proxy (see "Upgradeable proxies" below). It replaces `[1.4.0-testnet]` (the `[1.3.0-testnet]` code under AlphaMarkets names; first block `122118624`), which had replaced `[1.3.0-testnet]`, which had replaced `[1.2.0-testnet]` (which had replaced `1.1.0-testnet` with: signed-quote `OptionsEngine`, dedicated quoter, `increasePosition` fix, limit orders, options decimals fix, NVDA seeded). Addresses (the proxy addresses, the ones every client uses) are in `deployments/robinhood_testnet.json`, the implementation behind each in `deployments/robinhood_testnet.implementations.json`, and synced into `packages/config` with `pnpm --filter @alphamarkets/config sync:deployments`. Explorer verification is done for this deployment (2026-09-21, see Hosting under Testing & Pre-Deployment). The option quoter role sits with `QUOTER_ADDRESS`, not the deployer. The mock NVDA price feed goes stale after 1 hour; `services/keeper` refreshes it, so the keeper must be running (a real feed is needed before mainnet).

---

## Phase 2: Backend Services — Priority 1

1. **services/indexer/** — listens to all contract events (Section 31), writes to PostgreSQL. Covers deposits, withdrawals, option/perp position lifecycle, funding, liquidations, fees, market config changes. No frontend RPC calls for historical data.
2. **services/pricing/** — offchain options analytics (premium, IV, delta, gamma, theta, vega, break-even) — Section 10. Never the source of settlement truth, only display/quoting.
3. **services/risk-monitor/** — watches positions for margin health, surfaces liquidation candidates (read path; actual liquidation execution stays onchain).
4. **services/api/** — REST endpoints (Section 33):
    ```
    GET /markets, /markets/:symbol
    GET /options/:symbol/chain, /options/:symbol/expiries
    POST /options/quote
    GET /perps, /perps/:symbol, /perps/:symbol/funding
    GET /prices/:symbol
    GET /portfolio/:wallet, /positions/:wallet, /orders/:wallet, /history/:wallet
    ```
5. WebSocket feed for live market data (price, funding, order book/chain updates).
6. **Market history and statistics** (for Section 29 and the terminal chart): the indexer samples each active market's index price into `price_ticks` (`PRICE_SAMPLE_INTERVAL_MS`, pruned after `PRICE_TICK_RETENTION_DAYS`); the API serves `GET /v1/prices/:symbol/history`, `GET /v1/markets/stats` (24h change, perp volume, options premium volume) and `GET /v1/funding/:wallet`. These are display data derived from indexed events; they never feed margin, liquidation or settlement.
7. **CORS**: `services/api` allows only the origins in `CORS_ORIGINS` (no wildcard).
8. **Signed option quotes** — `services/pricing` signs each open and close premium (EIP-712, `QUOTER_PRIVATE_KEY`); see Phase 1 step 7.

**Status:** steps 1–8 implemented and tested against `1.3.0-testnet`; pointed at `1.5.0-testnet` by the config sync. Phase 5 added `services/keeper`, candles, funding history, open interest history, option series statistics and open limit orders to the API, and bid/ask plus realized volatility to the pricing service (see Phase 5).

---

## Phase 3: SDK — Priority 2, built alongside API

The brief lists the SDK as Priority 2 but also says "Create an SDK from the beginning" (Section 34), so it is built alongside the API rather than after the frontend.

**Prerequisite — config layer** (`packages/config/`, `packages/types/`): chain config, deployments, market list and shared types, all typed and env-driven. No hardcoded chain ID, leverage or fees anywhere. The SDK and the frontend both import from here. Status: done. After a redeploy, run `pnpm --filter @alphamarkets/config sync:deployments` to copy `packages/contracts/deployments/<network>.json` into `src/deployments.ts`.

1. `packages/sdk/` — `@alphamarkets/sdk`, typed client wrapping API + contract calls (Section 34).
2. Constructor matches the brief: `new AlphaMarkets({ chainId, transport })`. Contract addresses and markets are resolved from `packages/config` and MarketRegistry, never hardcoded in the SDK.
3. Modules and methods:
    - `markets`: `list()`, `get(symbol)`.
    - `options`: `chain()`, `expiries()`, `quote()`, `previewOpen()`, `openPosition()`, `closePosition()`, `settle()`. European cash-settled options have no user "exercise" call: `settle()` settles the whole expired series and the contract emits `OptionExercised` per in-the-money position.
    - `perps`: `list()`, `get()`, `funding()`, `previewOpen()`, `openPosition()`, `increasePosition()`, `reducePosition()`, `closePosition()`.
    - `vault`: `deposit()`, `withdraw()`, `balances()`. Collateral must exist before any trade.
    - `prices`: `get(symbol)` returning Index, Mark and Last price, plus `settlement(symbol, expiry)` (Section 17).
    - `portfolio`: `summary()`, `positions()`, `orders()`, `history()`.
4. Preview methods (`preview*`) for every value Section 45 requires before signing: liquidation price, fees, entry, break-even, max loss, margin. The frontend never recomputes these locally.
5. Live data: `stream.subscribe()` WebSocket helper for index price and funding ticks (Phase 2 step 5). `services/api` does not broadcast option chain updates yet, so the helper does not expose them.
6. Transaction lifecycle: emit the Section 30 states (Preparing → Awaiting Wallet → Submitted → Confirming → Confirmed/Failed) and expose an explorer-link helper based on `NEXT_PUBLIC_EXPLORER_URL` (Section 43).
7. Typed errors mapped from the Section 36 custom errors (`MarketPaused`, `StaleOraclePrice`, `InsufficientMargin`, etc.).
8. Amounts accept decimal strings or `bigint` and normalize token decimals. Plain JS `number` is not used for money values, to avoid float precision bugs.
9. API calls target `/v1/...` (see Engineering Practices).
10. Define an `orderType` parameter (`MARKET` | `LIMIT`) from the start. `LIMIT` was rejected until Phase 5 so the interface would not break later; now `perps.placeLimitOrder` places one and `openPosition` points to it.
11. Framework-agnostic: viem only, no React or browser-only dependencies, ESM + CJS builds. Bots, agents, market makers and institutional users (Section 34) must be able to use it. wagmi/React glue lives in `apps/web`.
12. ABIs are generated from `packages/contracts` build output, not hand-copied.
13. Tests: unit tests per module, plus an integration test against a local Anvil node covering deposit → open → close (`packages/sdk/src/integration.test.ts`, skipped when Foundry is not installed).
14. Frontend consumes its own SDK (dogfooding) rather than calling API/contracts directly.

**Status:** steps 1–14 implemented. The frontend reaches the chain and API only through the SDK; wagmi is used for wallet connection and network state only. Added since the original list: signed option quotes (`previewOpen({ user })`, `quoteClose`, `InvalidQuoteError` and friends), `markets.stats()`, `prices.history()`, `portfolio.funding()`, `risk.openInterest()`, and the `ALPHAMARKETS_ADDRESSES` override. Phase 5 added limit orders, candles, funding and open interest history, option statistics, bid/ask, and the package and docs for `@alphamarkets/sdk` `0.1.0` (not published yet).

---

## Phase 4: Frontend — Priority 1

`apps/web/` — Next.js, React, TypeScript, Tailwind, wagmi, viem, TanStack Query, Zustand.

**Status: done.** Manually accepted on `[1.1.0-testnet]` with a real wallet: deposit, option open and close, perp open / increase / reduce / close, and the Activity, Markets and Portfolio pages, with every figure matching the chain and the indexer. Built: scaffold, shared UI primitives (`packages/ui`), wallet connection, navigation, landing page with "Explore markets", terminal shell, Perpetual Terminal with increase/reduce controls, Options Terminal (`/options`: underlying and expiry selectors, a calls | strike | puts chain with mark, IV and delta, and an order ticket driven by `options.previewOpen`), Markets, Portfolio and Activity pages, and chart history from the indexer. The options contract lists no strikes, so the chain proposes a strike ladder around the index price and a few expiries from `NEXT_PUBLIC_OPTION_*` (see `.env.example`). Known gaps at the end of Phase 4 (bid/ask, open interest, volume and IV were closed in Phase 5; funding is inert until a real mark price exists). Contract finding from the manual test: `PerpsEngine.increasePosition` skipped the taker fee and the leverage check; fixed and redeployed in Phase 5.

1. **Wallet connection** — wagmi setup, connect button, network detection against `NEXT_PUBLIC_CHAIN_ID`.
2. **Landing page** (Section 23) — hero with tagline, "Launch Terminal" / "Explore Markets" CTAs, concise product blocks (Options / Perpetuals / Onchain). Terminal remains primary focus, not landing page.
3. **Navigation** (Section 22): ALPHAMARKETS / Markets / Options / Perpetuals / Portfolio / Activity / Connect Wallet.
4. **Trading Terminal shell** (Section 24) — desktop-first layout: market list, chart, option chain/positions panel, order panel. Institutional visual direction (Section 2): black/off-white, neutral gray, restrained green/red, tabular numerals, no neon, minimal animation.
5. **Options Terminal** (Section 25–26) — underlying selector, expiry selector, option chain (calls left / strike center / puts right) with bid/ask/mark/IV/Greeks/OI/volume, order ticket showing premium, cost, break-even, max loss before signing (Section 45). **Status:** built at `/options`. The chain shows bid, ask, IV, open interest and volume, or the Greeks (a strike ladder proposed around spot, since the contract lists no strikes); added in Phase 5.
6. **Perpetual Terminal** (Section 27) — index/mark price, long/short toggle, market/limit order type, size, leverage selector (1x–10x from registry, not hardcoded), collateral input, estimated entry, liquidation price, fee — all shown before signing. **Status:** built, with increase/reduce controls on open positions. The limit order type shipped in Phase 5 (it needs a deployment that includes `PerpOrderManager`).
7. **Portfolio** (Section 28) — value, available collateral, locked margin, unrealized/realized PnL; tabs: All Positions, Options, Perpetuals, Open Orders, Funding, History.
8. **Markets Page** (Section 29) — asset, index price, 24h, options/perp volume, OI, funding, IV, status; trade actions per row.
9. **Transaction UX** (Section 30) — state machine: Preparing → Awaiting Wallet → Submitted → Confirming → Confirmed/Failed, with confirmation summary and explorer link.
10. **Explorer integration** (Section 43) — surface tx hash, block, contract, wallet, position ID, market ID with "View on Explorer" using `NEXT_PUBLIC_EXPLORER_URL`. **Status:** transaction links appear in the transaction toasts and the Activity and History tables (block shown in History); not every field in the list is shown everywhere yet.

---

## Phase 5: Priority 2 polish

**Status: done (2026-09-20).** Built and tested on 2026-09-19; contracts redeployed to testnet as `[1.2.0-testnet]` on 2026-09-20 and smoke-tested there (perp round trip, fixed `increasePosition`, limit order placed, cancelled and filled by the keeper). The whole stack (keeper, indexer, API, pricing service, web app) then ran against testnet from a developer machine, and a wallet session confirmed each item below: the option chain with bid/ask and Greeks, candles, the funding and open interest views, and placing and cancelling a limit order. The work is merged into `main` (PR #1). Also run end to end on a local Anvil chain with PostgreSQL, plus unit, fuzz and integration tests. **Not yet done:** SDK not published; no keeper runs continuously; nothing is hosted (only the Railway Postgres database).

- **Contract fix first. Done and deployed.** `PerpsEngine.increasePosition` now charges the taker fee on the added size and enforces the leverage ceiling on the resulting position (`RiskManager.checkResultingLeverage`), with 16 unit tests and a fuzz. Limit orders (below) are in the same change, as planned. Contract coverage rose from about 67% of lines and 30% of branches to 94.5% and 62.6% (135 tests), and CI now enforces 90% and 55%. Found and fixed on the way: options ignored the settlement token's decimals, so on a 6-decimal token (mainnet USDC-style; the testnet token has 18 decimals, so it was not live there) a payout was credited a trillion times too high and option notional sat 12 decimals above perp notional in the same limit counter (`OptionsEngine.settlementDecimals`, `test/options/OptionsSixDecimals.t.sol`). **Redeployed 2026-09-20:** addresses in `packages/contracts/CHANGELOG.md` and `packages/config`.
- **Full Greeks wiring. Done.** The chain has a Market view (bid, ask, IV, open interest, volume) and a Greeks view (delta, gamma, theta per day, vega per volatility point); the order ticket shows all four Greeks.
- **Option chain bid/ask, open interest, volume, implied IV. Done, with two caveats.** Open interest and 24h volume per series come from the indexer (`GET /v1/options/:symbol/stats`). Bid and ask are the model's mark less and plus half a configured spread (`OPTION_SPREAD_BPS`); opening pays the ask and closing receives the bid, and the signed quotes follow. **Decision (2026-09-20): `OPTION_SPREAD_BPS=200` (2% in total, 1% each side of the mark) for testnet.** It is a placeholder, not a product decision: the code default is 0 (bid, mark and ask equal), and the mainnet value is still to be set with product, ideally with a market maker. Starting range to review for mainnet: 300 to 500, wider for options that expire within days, because the signed quote is valid for 30 seconds and the oracle accepts a price up to 1 hour old. IV is **not market-implied**: the protocol is the only counterparty, so there is no market to imply it from, and one implied from its own quotes would only echo the assumption. `services/pricing` now measures realized volatility from the indexed price history (`ivSource: "realized"`), and falls back to the flat assumption (`"default"`) when there is not enough history or the price never moved. On testnet the mock feed is flat and history is short, so expect `default` there.
- **Price feed keeper. Done. Explorer verification not done.** `services/keeper` re-pushes a mock feed's price before it goes stale and fills limit orders (below); it refreshed the stale feed and filled a limit order on testnet. It replaces a real NVDA feed only for testnet; a real feed adapter is still needed before mainnet. Explorer verification of `1.2.0-testnet` is still blocked by Robinhood's explorer certificate.
- **Funding history view, open interest analytics. Done.** Under the terminal chart: Positions, Funding (rates the chain applied, per interval) and Open interest (long, short, share, cap used, history). Funding is 0% on every interval until a real mark price exists, and the view says so.
- **Advanced charts. Done.** Candlesticks with perp volume bars (5m, 15m, 1h, 1d) next to the line chart, built from the indexer's price samples, with a hover readout. Candles need the indexer to have been sampling; there are no candles before it started.
- **Limit orders. Done and live on testnet (engine, keeper, SDK, indexer, API and frontend).** `PerpOrderManager`, `placeLimitOrder`, `cancelLimitOrder`, permissionless `executeLimitOrder`; the SDK's `orderType: "LIMIT"` is now `perps.placeLimitOrder`; the perp ticket has a Limit mode; Portfolio lists orders with a Cancel action. Not built in Phase 5: stop-loss and take-profit (started in Phase 7, not deployed) and keeper incentives.
- **SDK docs and package. Done; not published.** `@alphamarkets/sdk` `0.1.0` is publishable (`dist/` with ESM, CJS and types; `@alphamarkets/config` and `@alphamarkets/types` are bundled), with a full README and a changelog. Publishing needs an npm token and a person to start `.github/workflows/release-sdk.yml`.
- **Not done, still open:** fork tests against testnet state; an end-to-end test that runs contract event to indexer to API to frontend in CI (done by hand locally, not automated); the third-party audit; real price feed; moving the quoter role behind a multisig.

## Phase 6: Rebrand / Naming Audit (Section 46)

Run before any public deployment or handoff:

- Grep entire repo for `Citadelle`, `CTDL`, `citadelle` — must return zero hits in new code.
- Confirm package name is `@alphamarkets/sdk`, contract display labels say AlphaMarkets, repo/README/docs/metadata/social preview/logos/favicons all rebranded.
- Do not rename already-deployed immutable contracts unless redeploying; new deployments use AlphaMarkets naming only.

**Status: done (2026-09-20).** Audit results:

- Zero hits for `Citadelle`, `CTDL`, `citadelle` in any tracked file name or content, except this file and `PROJECT_BRIEF.md`, which state the rule. Untracked files (`.env`, `deployments/`, `broadcast/`) are clean too.
- All 11 package names use the `@alphamarkets/` scope (root: `alphamarkets`). The Railway project and the GitHub repository (`rubengitdev/alphamarkets`) are named `alphamarkets`.
- Contract labels: `AlphaMarketsVault`, EIP-712 domain `AlphaMarketsOptionsEngine`. Web title, README and metadata say AlphaMarkets.
- Added `scripts/check-brand.sh` (`pnpm check:brand`) and a CI step, so a retired name cannot return unnoticed.
- Added social preview: Open Graph and Twitter metadata plus a generated `opengraph-image` in the terminal palette. `NEXT_PUBLIC_SITE_URL` sets the absolute URL.
- **Interaction states (2026-09-21).** Every clickable thing on every page is a solid fill with a bold hover and a bolder pressed state; there is no outline-only or text-only (ghost) control, and `Button` no longer has a `ghost` variant. Buttons: hover brightens the fill and adds a soft ring, pressed darkens. Secondary buttons and chips: raised fill, then a teal tint with teal text on hover, then solid teal on press. Selected segments, tabs and nav items are solid teal; unselected ones are raised fills that tint on hover. Long and short keep green and red for their hover and press. Rows and list items (markets, menus, the collateral toggle) fill with the accent tint and a bar on the left edge. Option chain ask prices are pills that fill when hovered and stay solid teal when picked. Inputs and selects light up their border on hover and focus. The shared class strings live in `packages/ui/src/interaction.ts` (`chip`, `pill`, `menuItem`, `rowLink`, `textLink`, `listLink`, `fieldBorder`), so a new control should reuse them. Tailwind applies `hover:` only where the pointer can hover, so touch screens keep the pressed state only. Checked in headless Chrome with a fine pointer on the perpetuals, options, markets and landing pages; the wallet menu, the position adjust panels and the portfolio and activity tables use the same classes but were not hovered by hand.
- **Logo colours in the UI (2026-09-21).** The theme tokens in `apps/web/src/app/globals.css` follow the logo: neutrals tinted to its deep teal-black (ground `#0b1211`), off-white text, and one teal accent `#3adbd0` with ink `#031a18`, hover `#66e8df`, soft fill `#17403c`. The accent marks what you can act on (primary button, selected segment and tab, active nav underline, selected market, focus ring, text selection, price line, loading bar, hero backdrop strands). Green (`#72d977`, moved to a yellower hue than before so it cannot be mistaken for the accent) and red (`#ee7069`) still mean market direction only. Contrast checked: muted 8.9:1, faint 7.3:1, accent 11:1 on ground; ink on accent 10.5:1. Favicons, social preview and theme colour use the new ground. The brief's Section 2 has a dated note about the change. To retune the whole UI, change the tokens, not the components.
- **Logo (2026-09-21):** the ribbon mark supplied by the product owner. The master is `apps/web/src/assets/alpha-market-logo.svg` (a 2000 px raster and its alpha mask wrapped in an SVG, so 985 KB: too heavy to serve, and not scalable), from which `alphamarkets-mark.png` (480 px wide, trimmed, transparent) is cut. To change the mark, replace the SVG and regenerate the PNG and the favicons from it. The landing hero shows the mark large in the upper right with the wordmark under it (`HeroMark.tsx`, a 1200 px `alphamarkets-mark-hero.webp`): a GSAP timeline of about 2 s (the ribbon unfolds along a sliding alpha mask, one light pass clipped to the ribbon, the letters rise in) followed by a slow float and a light pass every 10 s. GSAP is a lazy chunk (about 20 KB gzip) that loads after first paint and not at all with reduced motion, when the final state shows at once; if the chunk fails, a CSS fade shows the lockup after 3 s. The page does not render its content without JavaScript at all (streamed Suspense output), so there is no no-script design. The header shows the mark without the wordmark below 1280 px, where the navigation and wallet button need the room. The mark also appears in the header and footer (`Logo.tsx`), the favicon and Apple icon (`icon.png`, `apple-icon.png`) and the social preview. Its teal is the source of the UI accent and of the tech stack pyramid's ramp; direction colours stay green and red. **Open follow-up, not blocking:** explorer labels cannot be set from this repo (they depend on explorer verification, which is blocked).
- **X link and mobile header (2026-09-21).** The header has an X icon button beside the wallet button and the footer has a "Follow on X" link; the URL is `X_URL` in `apps/web/src/lib/social.ts`. Below 1024 px the header holds only the logo, the X button and a hamburger button (three bars, a cross while open); the wallet button moves to the bottom of the menu, full width, and its lists open upward. A green dot on the hamburger shows a connected wallet. On the landing page the header is transparent over the hero and takes a solid fill once the page scrolls (the page scrolls inside `main`, so `Header.tsx` listens there); before that, text scrolled up under the buttons. The hero grid uses `grid-cols-[minmax(0,1fr)]` so the terminal preview's tab row cannot widen the column past the viewport at 320 px.
- **Terminal chart (2026-09-21).** The Line and Candles views use TradingView's open-source `lightweight-charts` (Apache-2.0) through `components/TradingChart.tsx`: drag to pan, wheel or pinch to zoom, drag an axis to scale, double-click an axis or press "Reset view" to return. On a phone only a sideways drag pans, so a vertical drag still scrolls the page. Candles ask the API for 500 candles (its maximum) and open on the newest 120. The TradingView logo on the chart is the attribution link the licence requires; do not turn it off. A refetch sends only the rows since the last one drawn, so it does not move the view. The chart is a lazy chunk (`next/dynamic`), loaded only on the perpetuals page. TradingView's hosted widget cannot chart AlphaMarkets prices (testnet mock feeds), which is why the library is used and fed our data.
- **Landing page layout (2026-09-21).** Everything below the ticker sits on the same `PAGE_FRAME` container as the header, hero and footer, so each section starts on the same left edge; rules and row hover fills run edge to edge. Section titles use `SectionHeader.tsx` (a 2 px ink rule, then a regular-weight serif title, `SECTION_TITLE` in `lib/frame.ts`). Stats figures, the Markets table, the Products rows and the statement band were widened to match; the statement band is centred.
- **Tech stack pyramid (2026-09-21).** A section before the statement band shows the stack as a five-layer pyramid (`components/StackPyramid.tsx`). Picking a layer lifts the layers above it and shows what it does, what it is made of and a link. The layer copy and the pyramid geometry are in `lib/stack.ts` (both unit-tested); the chain name and ID come from the environment. **When the stack changes (a new service, a different chain, a new framework), update `stackLayers` so the page stays true.** Layer names appear on the pyramid from 640 px up; below that the list carries them. The pyramid is drawn in code; the stock illustration it was modelled on is not in the repo.
- **Open item: lint.** `lint` is a no-op (`echo scaffold ... exit 0`) in every package and there is no ESLint config, so the six `eslint-disable` comments in `apps/web` (`StrategyBuilder`, `OptionChain`, `TradingChart` twice, `PriceChart`, `opengraph-image`) do nothing until ESLint is added.

---

## Phase 6b: Rebrand from Orionis to AlphaMarkets (2026-09-21)

Product name changed to AlphaMarkets. Done in this repo: every package is `@alphamarkets/*`, env vars use the `ALPHAMARKETS_` prefix (`ALPHAMARKETS_ADDRESSES`, `NEXT_PUBLIC_ALPHAMARKETS_VAULT`), the SDK class is `AlphaMarkets`, and the vault contract is `AlphaMarketsVault`. `pnpm check:brand` now also rejects `orionis`. Earlier sections of this file keep their history under the new name.

- **On chain since 2026-09-21.** `[1.3.0-testnet]` was deployed under the old names, and its EIP-712 domains (`OrionisOptionsEngine`, `OrionisRFQ`) differed from the ones the SDK signs with. `[1.4.0-testnet]` redeployed the same code under the new names; `OptionsEngine.eip712Domain()` reports `AlphaMarketsOptionsEngine` (`packages/contracts/CHANGELOG.md`).
- **Outside the repo.** GitHub repository, Railway project, and the local project folder are renamed separately; see the rebrand pull request.

---

## Phase 7 (post-MVP): Phase 2 / Phase 3 features

Not built until MVP (Priority 0–2) is live and stable. (Work started before that: the MVP is not hosted yet, and the first slice was chosen because it extends the Phase 5 limit orders directly.)

**Phase 7 progress** (2026-09-20). Contracts: 231 tests pass (216 before the cross-cutting audit), coverage 96.0% of lines and 66.7% of branches as of the last measure. SDK: 158 tests including the Anvil deployment test, which opens a stop-loss, a cross-margin position, an RFQ position and a subaccount trade on the real deployed contracts. All new contracts are wired by `DeployAll.s.sol` and deployed as `[1.3.0-testnet]`; the admin events and handover script from the cross-cutting audit reach a chain with the next redeploy. **Nothing that holds or moves money is audited.**

Phase 2 list (Section 39):

- **Limit orders.** Delivered in Phase 5.
- **Stop-loss and take-profit.** Contracts (`placeTriggerOrder` / `cancelTriggerOrder` / `executeTriggerOrder`), indexer, API, SDK, keeper and web (a TP/SL panel per position, orders in the Portfolio tab). It closes the whole remaining position at the mark price when the trigger is reached. **Decision: no slippage bound on the exit**, because a stop-loss must get out; a price gap can close it worse than the trigger. Revisit with product if a bound is wanted. Not built: partial-size triggers, trailing stops, keeper incentives, a stop-loss set in the same call that opens a position.
- **Cross margin.** `CrossMarginManager` and `PerpsEngine.openPositionCross`: a position is backed by the whole account and liquidated on the account's equity against its requirement, worst position first; a Vault withdrawal guard stops a cross account withdrawing the balance that backs it. Web: a Cross toggle in the perp ticket and a "Cross" tag in the positions table. Limits: funding accrued and not yet settled is not counted; at most 10 open cross positions per account; limit orders are isolated only.
- **Multiple collateral assets.** Other tokens count towards a cross account's equity at a haircut of their oracle value, and are seized into the insurance fund to cover a shortfall. Left to decide with product: which assets, which haircuts, and a real price source for each (a token needs an oracle market and a supported-token entry). The web deposit form takes the settlement token only.
- **Advanced options Greeks.** `rho`, `vanna`, `vomma`, `charm`, `speed`, `color` on every quote (`services/pricing`, checked against finite differences), through the API and SDK. Not shown in the web option chain yet.
- **Volatility surface.** `GET /v1/options/:symbol/surface` and `options.surface`: the model's volatility, prices and Greeks per strike and expiry, and the at-the-money volatility and skew per expiry. It is the pricing model's surface, not market-implied (no order book), and flat until `VOL_SKEW_SLOPE`, `VOL_SMILE_CURVE` and `VOL_TERM_SLOPE` are set, which is a product decision. Quotes follow the surface. Not shown in the web app yet.
- **Options strategy builder.** `strategies` in the SDK (the seven strategies of Section 41: net premium, max profit and loss, break-evens, Greeks, payoff) and a `/strategies` page with a payoff chart. `OptionsEngine` only lets a user buy options, so a strategy with a short leg is analysis only (the page says so); the page does not open legs itself.
- **Advanced funding analytics.** `GET /v1/perps/:symbol/funding/analytics` (rate statistics, annualised rate, payments by side) and `institutional.fundingAnalytics`. No web view yet.
- **Trading API.** `alphaMarkets.trading.prepare*` and `POST /v1/trade/...`: every action as an unsigned transaction, with an optional simulation from the sender that turns a revert into the contract's error name. No keys or auth are involved, so it cannot move money.
- **Market maker API.** Request-for-quote broker in `services/api` (`/v1/rfq/...`), and `/v1/mm/...` plus `/v1/mm/ws` for makers, with API keys bound to a signing address (`MM_API_KEYS`), rate limiting and pre-checks of a quote's terms and price band. In memory (a request lives seconds). Needs the RFQ contract deployed.

Phase 3 list (Section 40):

- **Portfolio margin.** Opt-in per account in `CrossMarginManager`: the requirement is the worst loss across price shocks on the cross perps plus the intrinsic value of registered long options, with a floor; a hedged book is charged less than the sum of its parts, a naked one more. A simple scenario model, not a full risk engine: shocks and floor are parameters to be set with product.
- **Subaccounts.** `SubaccountFactory` / `Subaccount`: a separate trading account per index, with delegates that can trade but never withdraw and an all-or-nothing `multicall`. SDK only, no web UI.
- **RFQ and block trades.** `RFQManager`: a position opens at a market maker's EIP-712 signed price, within a band of the mark; a block trade may exceed the ordinary position cap up to a set limit (off until configured). The maker key is critical (dedicated key, multisig or HSM before mainnet).
- **Structured products.** `structured.build`: a protected long, a straddle or a strangle, priced, quoted for a subaccount and opened together through its `multicall`. There is no separate pooled product contract, and only strategies whose legs the contracts can open are offered.
- **Market maker connectivity.** REST and WebSocket with API keys and rate limits (see the market maker API above). No FIX gateway.
- **Advanced risk API.** `GET /v1/risk/:wallet` (stress test at price shocks, liquidation distance per position, net exposure) and `GET /v1/risk/protocol/exposure`, plus `stressPortfolio` in the SDK. Options are valued at intrinsic value at the shocked price (no time value).
- **Institutional reporting.** `GET /v1/reports/:wallet` (JSON or CSV, date range, totals: deposits, fees, funding, realised PnL, premiums, liquidations, RFQ fills), capped at 5,000 rows; CSV fields that look like formulas are defused.
- **Clearing infrastructure.** `InsuranceFund` and bad-debt handling in `LiquidationEngine` (a shortfall is paid by the fund, and only what it cannot cover is bad debt), which also fixes a liquidation that reverted when a position had lost more than its owner held. Not built: automatic funding of the fund from fees, margin-call notifications, netting or end-of-day settlement statements.
- **Automated hedging tools.** `hedgeBook` / `planHedge` in the SDK and `services/hedger`: keeps an options book delta neutral with perps. It only reports what it would do unless `HEDGER_EXECUTE=true`.

**What is not verified.** The new API routes that query PostgreSQL (`/v1/perps/:symbol/funding/analytics`, `/v1/reports/:wallet`, `/v1/trigger-orders/:wallet`) were first tested against a fake database client only. Since 2026-09-20 they also run against a real PostgreSQL (`services/api/src/analytics.integration.test.ts`, with `TEST_DATABASE_URL`). The new web pages and panels typecheck and build but were not clicked through in a browser. The keeper, hedger and market maker flows were tested with fakes and, for the contracts, on a local Anvil node, not on testnet.

**Left to do:** try RFQ with a real maker, subaccounts, the insurance fund, portfolio margin, other collateral and block trades with a wallet (the perp, cross-margin, stop-loss, option and strategy-builder flows are done); fund the insurance fund (it holds 0 today); set the parameters product owns (surface skew, collateral assets and haircuts, RFQ band and block limits, portfolio-margin shocks), and commission the audit.

**Feature lists**

- **Phase 2** (Section 39): limit orders, stop loss, take profit, cross margin, multi-collateral, advanced Greeks, volatility surface, options strategy builder, advanced funding analytics, trading API, market maker API.
- **Phase 3** (Section 40): portfolio margin, subaccounts, RFQ, block trades, structured products, market maker connectivity, advanced risk API, institutional reporting, clearing infrastructure, automated hedging.

---

## Cross-cutting rules (apply throughout, not one-time steps)

- Never hardcode: chain config, market lists, leverage caps, fee percentages, protocol token symbol/address.
- Frontend/SDK/protocol all read markets from MarketRegistry — no divergent lists.
- Liquidation and settlement logic always onchain and deterministic; offchain analytics (pricing service) is display-only, never source of truth.
- Every privileged contract action emits an event.
- Every admin action path should be built assuming eventual migration to multisig/timelock/governance (Section 37).

**Audit of these rules (2026-09-20, against `[1.3.0-testnet]`).** Each rule was checked across `packages/contracts`, `services/`, `packages/sdk` and `apps/web`.

- *Never hardcode.* No contract address, market symbol, fee or leverage value is baked into the SDK, services or web app; markets, risk limits and fees come from the registry, the chain and `packages/config`. Found and fixed: every service imported the testnet chain id as a constant, and `verify.sh` hardcoded `46630`. A service now reads `CHAIN_ID` and the web app `NEXT_PUBLIC_CHAIN_ID` through `resolveChainId` in `packages/config`, which rejects a chain with no recorded deployment instead of falling back. The frontend's strike ladder and expiries (`NEXT_PUBLIC_OPTION_*`) stay env-driven by design: they are proposals, since the options contract lists no strikes.
- *One market list.* The indexer fills its `markets` table from `MarketAdded` / `MarketUpdated`, and the API, SDK and web app read that. No second list exists.
- *Onchain truth, offchain display.* Liquidation, funding and settlement run in the contracts; the trigger and limit-order conditions and the quote signature are re-checked onchain; the risk monitor and hedger only report unless told to act. The web app previews liquidation price, PnL and margin ratio with the SDK's bigint mirror of `MarginEngine`, and a cross position shows "Account" rather than a price. New: `packages/contracts/test/vectors/margin.json` is run by both `MarginParityTest` and the SDK's `math.test.ts`, so the mirror cannot drift silently. The mirror ignores funding accrued and not yet settled, like the contract's isolated formula.
- *Events for privileged actions.* Four admin setters emitted nothing: `PriceValidator.setMaxPriceAge` and `setMaxDeviationBps` (the oracle staleness and deviation limits), `FundingManager.setMaxFundingRateBps` and `PerpsEngine.setRfqManager`. They emit now (`test/core/AdminEvents.t.sol`), and the indexer and SDK ABIs include them. This reaches a chain with the next redeploy: `[1.3.0-testnet]` still has the gaps. `MockPriceFeed.setPrice` has no event either; it is a testnet mock replaced before mainnet.
- *Ready for a multisig or timelock.* Every admin path is behind an AccessControl role, but the deployer key held all of them and there was no way to move them. `script/HandOverAdmin.s.sol` now moves the default admin and every `*_ADMIN_ROLE` in two steps (grant, then revoke), and `script/check-admin-roles.sh` in CI fails when a new admin role is not covered. Steps are in `packages/contracts/README.md`. **Still open, needs product:** `OracleRouter.pauseMarket` shares `ORACLE_ADMIN_ROLE` with the oracle source setters, so a timelocked admin also delays an emergency pause, and a fast pause key could swap the oracle. A separate pauser role is a contract change. Also: no timelock contract is deployed or chosen, and the handover has not been run on testnet.

## Testing & Pre-Deployment

Covers what Phase 1 step 14 and the CI gate don't: full-stack integration, staging environment, and mainnet go/no-go criteria.

**Readiness check (2026-09-20, before this section starts).** Every check below was run, not assumed.

*Passing.*

- Contracts: 231 tests with 10,000 fuzz runs, `forge fmt`, build. Coverage 96.3% of lines and 67.9% of branches (gates 90% and 55%).
- Monorepo: `pnpm lint`, `typecheck`, `build` (including `next build`), `test` and `check:brand` all pass. API: 70 tests, of which 10 run against a real PostgreSQL 18 and cover every analytics route added in Phase 5 and Phase 7.
- Config: `packages/config` matches `deployments/robinhood_testnet.json`. All 21 addresses have code on chain 46630; `vault.withdrawGuard` is `crossMargin`; `perpsEngine.rfqManager` is set; the registry lists NVDA; the quoter holds `QUOTER_ROLE` and the deployer does not.
- Boot: the indexer, risk monitor, keeper and hedger start with the new `CHAIN_ID` handling, and an unknown `CHAIN_ID` is refused. The API and pricing service were already running.
- Forking works: `anvil --fork-url` against the testnet RPC serves the deployed contracts, so fork tests (below) need no new infrastructure.

*Found and fixed.*

- The live indexer database had `markets = 0`, so `GET /v1/markets` returned `[]` and the terminal had no market list, and price sampling had stopped (it samples the active markets in that table). Cause: a database that starts empty at the chain head never sees the deployment's `MarketAdded` events. The indexer now reads the registry at start (the registry stays the one market list), and `INDEXER_START_BLOCK` replays history from a chosen block (`services/indexer/src/startBlock.ts`, tested; checked on fresh databases against the real testnet).
- This file said `1.2.0-testnet` in four places and that Phase 7 was not deployed. Corrected above.

*Blocking or to do before testing starts.*

- **Restart the indexer** so it runs the fix, then replay history (steps in the reply that accompanied this change). The running API, pricing, indexer and keeper were started before the fix.
- **Open a pull request**: the three cross-cutting commits pushed to `feat/phase-7-trigger-orders` have no CI run, because the earlier pull request (#4) is closed and the workflows run on pull requests and on `main`. The `gh` login on this machine has an invalid token.
- **Keep the keeper running** during any test: the mock NVDA feed goes stale after 1 hour and every price read then reverts. It runs from a developer machine today. The feed sits at $188, not the $190 recorded in the changelog.
- **No hosting configuration exists** (no Dockerfile, Railway service file or process file). Every service starts with `pnpm start` (`tsx`, a root dev dependency), so a hosted install must include dev dependencies or `tsx` must move to `dependencies`. The staging item below needs this first.
- The insurance fund holds 0 of the settlement token, so a liquidation shortfall test needs it funded first.
- The handover to a multisig or timelock has not been run on testnet, and no timelock is chosen.
- Explorer verification: done for `1.5.0-testnet` (see Hosting).

**Hosting (testnet, 2026-09-21)**

- **Railway** project `alphamarkets`, environment `production`, Free plan. Services: `Postgres`, `indexer`, `api`, `pricing`, `keeper`, each built from GitHub `rubengitdev/alphamarkets`, branch `main`. The Free plan allows 5 services per project, so `web` cannot live there; deploy it on Vercel.
- **Service settings** are set in Railway, not read from `railway.json`: the API refused a config-file path ("Config as Code is deprecated"). Start commands are `pnpm --filter @alphamarkets/<service> start`, build command `true`, and the indexer runs `pnpm --filter @alphamarkets/indexer db:migrate` before each deploy. The `railway.json` files in the repo document the same values.
- **Variables.** All services: `CHAIN_ID=46630`, `RPC_URL` (Alchemy key, secret). `indexer`: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `INDEXER_START_BLOCK=122444455` (the `1.5.0-testnet` deploy block), `INDEXER_MAX_BLOCK_RANGE=10`. `api`: `DATABASE_URL`, `PORT=4000`, `PRICING_SERVICE_URL=http://pricing.railway.internal:4100`, `CORS_ORIGINS` (the web URL). `pricing`: `PORT=4100`, `API_URL=http://api.railway.internal:4000`, `OPTION_SPREAD_BPS=200`, `QUOTER_PRIVATE_KEY` (secret). `keeper`: `KEEPER_PRIVATE_KEY` (secret).
- **Public API:** `https://api-production-ee4e.up.railway.app`. Checked live after deploy: `/v1/prices/NVDA` returns $190, `/v1/options/quote` with a `user` returns a signed authorization (so the API reaches the pricing service over the private network), and the keeper refreshed the mock feed.
- **Web app on Vercel:** live at `https://alphamarkets-ten.vercel.app`; `api` allows that origin through `CORS_ORIGINS`, and `apps/web/vercel.json` pins the framework to Next.js. Settings: the project root is `apps/web` and these variables: `NEXT_PUBLIC_API_URL` (the API above), `NEXT_PUBLIC_CHAIN_ID=46630`, `NEXT_PUBLIC_EXPLORER_URL`, `NEXT_PUBLIC_RPC_URL`. Robinhood's public RPC still has an expired certificate, so `NEXT_PUBLIC_RPC_URL` must be a private provider URL, which then sits in the browser bundle: use a rate-limited key.
- **Markets (2026-09-21, extended 2026-09-23).** Testnet lists nine markets: NVDA, TSLA, AAPL, META, HOOD, AMZN, PLTR, NFLX and AMD. NVDA is seeded by `ConfigureMarkets.s.sol`; the other eight by `AddMarket.s.sol` (parameters and addresses in `packages/contracts/CHANGELOG.md`). Each has a mock token and a mock price feed the keeper keeps fresh, with placeholder prices, risk limits and fees. Adding them changed no service or frontend code, which is the "config over redesign" test from Engineering Practices — `apps/web`'s `usePerpMarkets`/`useAllMarkets` and `services/simulator`'s `ALL` symbol list (`services/simulator/src/personas.ts`) are the only places that ever needed touching, and only the simulator needed it (the frontend reads the registry live). MSFT, GOOGL, COIN, MSTR, SPY and QQQ from Section 5 are still not listed: add one with `AddMarket.s.sol` when product wants it.
- **Live trade test (2026-09-21).** `pnpm --filter @alphamarkets/sdk smoke:testnet` (`packages/sdk/scripts/testnet-smoke.ts`) ran against `1.4.0-testnet` and the hosted API: mint test collateral, deposit, open and close a perp, buy an option on a quote signed by the hosted pricing service and sell it back, withdraw. The contract accepted both signed quotes, so the renamed EIP-712 domain works end to end. It needs `PRIVATE_KEY`, `RPC_URL` and `API_URL`, spends gas only, and works only where the settlement token has a public `mint` (the testnet mock).
- **Explorer verification (2026-09-21): done.** All 23 contracts of `1.4.0-testnet` (the 20 protocol contracts, the settlement token, the NVDA token and the NVDA mock feed) show as verified on `explorer.testnet.chain.robinhood.com`. The earlier failures were not the explorer's certificate: an Indonesian ISP redirects the explorer name to a block page (the certificate error came from that page, even with `1.1.1.1`). The fix was to look up the real address over DNS-over-HTTPS (`104.20.46.209`) and pin it in `/etc/hosts` while verifying, then remove the line. A VPN works too. Run `CHAIN_ID=46630 NVDA_TOKEN=<token> NVDA_FEED=<feed> bash script/verify.sh` from `packages/contracts`; the script now also covers the five Phase 7 contracts and forces submission (`--skip-is-verified-check`), because Blockscout counts a look-alike contract with identical bytecode from an older deployment as already verified when it is not.
- **Indexer reset (2026-09-21).** The database still held `1.3.0-testnet` test events, so it was emptied (`TRUNCATE markets, events, indexer_state, price_ticks;`, run over the Postgres TCP proxy, because `railway connect` needs an SSH key) and the indexer replayed from block `122118624`. Afterwards the API shows the new NVDA token and only the live trade test's volume ($10,000 perp, $5.31 options premium). To repeat: run the same `TRUNCATE`, and the indexer refills the tables from `INDEXER_START_BLOCK`.
- **Move to `1.5.0-testnet` (2026-09-21).** Contracts: `DeployAll.s.sol` (94 transactions, first block `122444455`), the quoter role moved from the deployer to `QUOTER_ADDRESS`, then `ConfigureMarkets.s.sol` (NVDA) and `AddMarket.s.sol` (TSLA, AAPL, META, HOOD). Then the hosted side, in this order: set `INDEXER_START_BLOCK=122444455` on the indexer; stop the old indexer (`railway down --service indexer -y`) so it cannot rewrite its cursor; empty the four tables as above; deploy the new code to `indexer`, `api`, `pricing` and `keeper` (`railway up --service <name> -d`); check the API and the keeper logs. The new indexer filled 5 markets and caught up to the chain head, and the keeper refreshed all five new mock feeds. The database URL for the TRUNCATE is the TCP proxy one (`DATABASE_PUBLIC_URL`, which exists once **Settings → Networking → TCP Proxy** is on); the private `postgres.railway.internal` host only resolves inside Railway. Turn the proxy off when done.
- **Railway did not auto-deploy the merges of PR #22 and #23** (its last deployments were from 2026-09-20, commit `88ba065`), so the four services kept running the old code and the old addresses until `railway up`. The MCP `redeploy` only reruns the last build, so it cannot fix that. After a merge that changes `packages/config`, check the Deployments tab of each service, and run `railway up --service <name>` if needed. Check **Settings → Source** (branch `main`, auto-deploy on).
- **Live trade test on `1.5.0-testnet` (2026-09-21): passed.** Perp open and close, an option bought on a signed quote and sold back (the EIP-712 domain works through the proxy), and a withdraw. On a fresh indexer database the API lists no option expiry, so the script now falls back to seven days out at 20:00 UTC.
- **Explorer verification of `1.5.0-testnet` (2026-09-21): done.** `script/verify.sh` now verifies the 20 implementations from `deployments/<network>.implementations.json` (Blockscout shows each proxy through its implementation), plus the NVDA token and feed through `NVDA_TOKEN` and `NVDA_FEED`. The TSLA, AAPL, META and HOOD mock tokens and feeds are not verified. Re-verifying the old settlement token now fails with `Local bytecode doesn't match on-chain bytecode`, because the local `MockERC20` source changed after it was deployed; the explorer still lists it as verified from before.
- **Demo simulator.** `services/simulator` moves the testnet mock prices like a calm market, trades with ten bot wallets and liquidates positions, so a recorded demo shows a live market. Run it from a developer machine (not hosted); see its README for the runbook. Start it two to three hours before recording so the charts have history, and say in the video that the activity is simulated.
- **Free plan credit.** Railway Free has a small usage allowance. If it runs out, Railway pauses the services and the site stops. Check the Usage page in the first days.

**Upgradeable proxies (since `[1.5.0-testnet]`)**

- **What.** Each of the 20 protocol contracts is an ERC-1967 proxy with a UUPS implementation. The proxy address never changes and keeps all state; a code change is a new implementation the proxy points at. Only `DEFAULT_ADMIN_ROLE` can upgrade (`UpgradeableBase._authorizeUpgrade`), so `HandOverAdmin.s.sol` moves the upgrade power together with the other admin roles. `PerpsEngine` and `LiquidationEngine` gained that role because they had no admin.
- **Shipping a change to a deployed network.** `python3 script/check-storage-layout.py`, then `forge script script/UpgradeAll.s.sol --rpc-url robinhood_testnet --broadcast --slow`, then `./script/verify.sh`. Addresses, `packages/config` and every client stay as they are. Use `--slow` on a live chain so forge sends one transaction at a time. The first proxy deployment is the last one that changes addresses.
- **Rules for contract changes.** Only append state variables; never reorder, remove or retype one (CI runs `check-storage-layout.py` against `storage-layouts/`; run it with `--update` after a deliberate append). The constructor only sets `immutable` fields and calls `_disableInitializers()`; storage writes go in `initialize`; a state variable needs no inline default (it would never run behind a proxy). A change that cannot keep the layout needs `DeployAll.s.sol`, new addresses and empty state.
- **Why the first deployment goes through a placeholder.** The implementations read the other contracts' addresses as immutables, so the proxies must exist first. `DeployAll` creates 20 proxies on an empty `UpgradePlaceholder`, deploys the implementations, then upgrades and initializes each proxy in one call.
- **A dry run overwrites `deployments/<network>.json`.** `forge script script/DeployAll.s.sol` without `--broadcast` still writes the file with simulated addresses. Restore it with `git checkout` if you do not broadcast.
- **Testnet upgrade authority is the deployer key.** Move it with `HandOverAdmin.s.sol` (with a timelock) before mainnet; the handover has not been run on testnet.

**Testing pyramid**

1. Unit tests — per contract, per service function. Fast, run on every commit.
2. Fuzz tests — margin math, liquidation price math, funding calc (Foundry fuzzing). Catch edge cases unit tests miss.
3. Integration tests — full flow within one layer: open position → accrue funding → liquidate, run against a local Anvil/Hardhat node.
4. Fork tests — run contract suite against a forked testnet state before every deploy, catch integration issues with real oracle/chain behavior.
5. End-to-end tests — full stack: contract event → indexer → API → frontend render. Confirms the indexer and API actually surface what the contract emitted, not just that each piece passes alone.

**Staging environment**

- Deploy full stack (contracts + indexer + API + frontend) to Robinhood Chain testnet, not just contracts alone.
- Staging must use production-shaped config (`.env` sourced the same way, real MarketRegistry entries, not stub data) so config-driven bugs surface before mainnet.
- Point external testers/team at staging terminal to trade real testnet flows: open option, open perp, get liquidated, claim settlement.

**Security**

- Third-party audit of `packages/contracts` before mainnet deploy — required given Vault custody + leverage (Section 36 lists reentrancy, oracle, precision, cap safeguards that need independent review, not just self-testing).
- Fix all audit findings, re-audit changed contracts if findings required logic changes.
- Optional: bug bounty window on staging/testnet before mainnet open.

**Pre-mainnet checklist**

- All Priority 0 contracts: unit + fuzz + integration + fork tests passing, audit complete, findings resolved.
- Staging e2e run completed for both options and perps full lifecycle (open, close, settle/liquidate).
- Oracle safeguards verified live on testnet: stale price rejection, deviation rejection, fallback source, emergency pause — each manually triggered once and confirmed working, not just unit-tested.
- Admin keys deployment-ready (Section 37): confirm multisig/timelock wiring if used for mainnet, not left on a single EOA.
- Open interest caps and position caps set conservatively for initial launch (canary limits), raised only after mainnet is stable.
- Rollback/pause plan documented: who can pause which contract, how fast, communicated to team before launch — not improvised during an incident.

---
