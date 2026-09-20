---
id: DEVELOPMENT_STEPS
aliases: []
tags: []
---

# ORIONIS MARKETS — DEVELOPMENT STEPS

Derived from PROJECT_BRIEF.md. Sequenced by MVP Priority 0 → 1 → 2, then post-MVP.

> Naming note: "Phase N" in this file is a build-order stage. It is not the same as the brief's "Phase 2" (Section 39) or "Phase 3" (Section 40), which are post-MVP feature sets covered by Phase 7 below.

---

## Current status (2026-09-19)

| Phase | Status |
|---|---|
| 0 Scaffolding | Done |
| 1 Contracts | Deployed as `[1.2.0-testnet]` (2026-09-20): `increasePosition` fix, limit orders, options decimals fix. Explorer verification pending. |
| 2 Backend services | Done and pointed at `1.2.0-testnet`. Nothing is hosted yet: the Railway project has only the Postgres database, and the services run from a developer machine. The indexer database was reset on 2026-09-20 and replays from the new deploy block. New in Phase 5: `services/keeper`, analytics endpoints, bid/ask and realized volatility in `services/pricing`. |
| 3 SDK | Done. Package and docs are ready to publish (`0.1.0`); not published. |
| 4 Frontend | Done. Manually accepted with a real wallet on `1.1.0-testnet`. Phase 5 additions are checked on a local Anvil stack and the new contracts are read by the app's default config. |
| 5 Polish | Built, tested, and deployed as `1.2.0-testnet`. Remaining: run the keeper continuously (the mock NVDA feed goes stale after 1 hour without it), open the pull request into `main`, publish the SDK, and the items marked "not done" below. |
| 6 Rebrand audit | Not started |
| 7 Post-MVP | Not started |

---

## Engineering Practices (apply from Phase 0 onward)

These make the plan scalable (new markets, new contracts, new services added without rewrites) and maintainable (one engineer or a team can safely change one part without breaking others).

**Monorepo tooling**

- Use Turborepo or Nx on top of pnpm workspaces for cached, parallel builds/tests across `apps/`, `services/`, `packages/`.
- `packages/types` and `packages/config` are the single source of truth for shared shapes (MarketConfig, position types, fee config) — contracts, API, indexer, SDK, and frontend all import from there, never redefine locally.

**Contracts**

- One contract, one responsibility (already the brief's structure) — never fold logic back into a shared "god contract" for convenience.
- If upgradeability is used, isolate Proxy / Implementation / Upgrade authority into separate files and separate deploy steps (Section 6) so an upgrade never risks touching business logic.
- Every new market or parameter change goes through MarketRegistry / RiskManager / FeeManager config, never a new contract deploy or frontend redesign (Section 5, 18) — this is the main scalability guarantee for the whole system.
- Natspec comments on every external/public function; a changelog entry (`packages/contracts/CHANGELOG.md`) per deployed version.

**Backend services**

- Each service in `services/` is independently deployable and independently testable — indexer, pricing, risk-monitor, api must not import each other's internals, only share `packages/types`.
- Database schema changes go through versioned migrations (e.g. Prisma or Drizzle migrate), never manual SQL against prod.
- Indexer is replay-safe: must be able to re-index from a given block without duplicating rows (idempotent writes keyed by tx hash + log index).

**API / SDK**

- API routes versioned from day one (`/v1/...`) so breaking changes don't require a flag day.
- SDK (`@orionis/sdk`) is the only sanctioned way to talk to contracts/API from the frontend — this keeps one integration surface to maintain instead of two (frontend fetches vs external integrator fetches).

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
    orionis/
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
5. Add root README stating official brand (ORIONIS / Orionis Markets), tagline, and product statement (Section 47) — Citadelle naming must not appear anywhere (Section 46).

---

## Phase 1: Smart Contracts — Priority 0

Package: `packages/contracts/` (Foundry + Solidity + OpenZeppelin).

1. **Interfaces first** (`interfaces/`): `IOracle`, `IMarketRegistry`, `IOrionisVault`, `IOptionsEngine`, `IPerpsEngine`.
2. **MarketRegistry.sol** (`core/`) — `MarketConfig` struct (Section 18): marketId, underlyingToken, oracleId, optionsEnabled, perpsEnabled, maxLeverage, openInterestCap, active. Single source of truth for markets; frontend/SDK/protocol all query this — no separate market lists.
3. **OracleRouter.sol + PriceValidator.sol** (`oracle/`) — implements `IOracle`, routes price requests, normalizes decimals, validates timestamp freshness, rejects stale/deviant prices, supports fallback oracle, per-market config, emergency pause (Section 16). Must distinguish 4 price types (Section 17): Index Price (reference price of underlying), Mark Price (used for unrealized PnL/margin/liquidation/risk), Last Price (most recent executed derivatives price), Settlement Price (validated expiry price for options).
4. **OrionisVault.sol + CollateralManager.sol** (`core/`) — Vault holds collateral deposits/withdrawals, locked margin, available balance, PnL settlement, premium accounting, funding transfers, fee transfers (Section 7); CollateralManager tracks supported collateral tokens and per-user/per-token balances (`supportedTokens` mapping, Section 7's suggested state), keeping token-support rules separate from Vault's settlement logic. MVP: single stable settlement asset only.
5. **RiskManager.sol + MarginEngine.sol** (`risk/`) — per-market max leverage, max position size, open interest caps, margin parameters (Initial/Maintenance Margin, Margin Ratio, Liquidation Price) (Section 13, 19). MVP: isolated margin only.
6. **FeeManager.sol** (`core/`) — `FeeConfig` struct: makerFee, takerFee, optionOpenFee, optionCloseFee, settlementFee, liquidationFee (Section 20). No fee percentages in UI code.
    - **Buyback Module** (Section 21, conditional) — if Orionis keeps the deflationary tokenomics model: protocol fees → Fee Manager → Buyback Module → protocol token buyback, with configurable buyback percentage. Protocol token symbol/address stay env-driven (`NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL`, `NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS`), never hardcoded `$CTDL`. Confirm with product whether this ships in MVP or is skipped — brief marks it conditional, not required.
7. **OptionsEngine.sol + OptionMarket.sol + OptionPositionManager.sol** (`options/`) — European call/put, cash-settled only. Identifier format `UNDERLYING-EXPIRY-STRIKE-TYPE` (Section 8). Premiums are computed offchain (Section 10), so the engine only accepts a premium carried by an EIP-712 quote signed by a `QUOTER_ROLE` holder for that exact user, series, size and premium; quotes expire and are single-use. The quoter key is critical: a dedicated key, held only by `services/pricing`, moved behind a multisig/HSM before mainnet (Section 37).
8. **OptionSettlement.sol** — intrinsic value formulas (Section 9): call `max(Settlement - Strike, 0)`, put `max(Strike - Settlement, 0)`, payout `Intrinsic × Contract Size × Contracts`. Settlement price from validated oracle data only.
9. **PerpsEngine.sol + PerpPositionManager.sol** (`perps/`) — open/increase/reduce/close long/short. MVP leverage tiers: 1x/2x/3x/5x/10x, configurable per market, never hardcoded in frontend (Section 11). Position state to track (Section 12): market, side, entry price, mark price, index price, position size, collateral, leverage, unrealized PnL, realized PnL, liquidation price, funding accrued, margin ratio.
10. **FundingManager.sol** — funding rate calculation, configurable interval, tracks accrued funding per position (Section 15).
11. **LiquidationEngine.sol** — deterministic flow: oracle update → mark price update → revaluation → margin check → liquidation execution → PnL/fees settled (Section 14). Frontend is never the source of truth for liquidation eligibility.
12. **Security pass** (Section 36): reentrancy guards, access control (role-based to start, Section 37), pausable markets, precision-safe math, slippage/deadline checks, position/open-interest caps, withdrawal validation. Use custom errors (`MarketPaused`, `InvalidOraclePrice`, `StaleOraclePrice`, `InsufficientCollateral`, `InsufficientMargin`, `PositionLimitExceeded`, `OpenInterestLimitExceeded`). Issue found in Phase 4 manual testing: `PerpsEngine.increasePosition` skipped the taker fee and the leverage check. Fixed and tested in Phase 5 (`packages/contracts/CHANGELOG.md`, `[Unreleased]`); the deployed `[1.1.0-testnet]` still has it, so redeploy before an audit or mainnet. Phase 5 also found that options ignored the settlement token's decimals (payout and notional); fixed and tested in the same place.
13. **Events** (Section 35): every state-changing and privileged action emits an event, designed with the indexer's needs in mind (`CollateralDeposited`, `OptionPositionOpened/Closed`, `OptionExercised`, `OptionSettled`, `PerpPositionOpened/Updated/Closed`, `PositionLiquidated`, `FundingPaid`, `MarketAdded/Updated`, `ProtocolFeeCollected`, `BuybackExecuted`).
14. Foundry test suite: unit tests per contract, fuzz tests on margin/liquidation math, integration tests for full open→settle/liquidate flows.
15. Deploy to testnet. Verify contracts, record addresses into `.env`.

**Status:** deployed as `[1.1.0-testnet]` on Robinhood Chain testnet (signed-quote `OptionsEngine`, dedicated quoter, NVDA seeded). Addresses are in `deployments/robinhood_testnet.json` and synced into `packages/config` with `pnpm --filter @orionis/config sync:deployments`. Explorer verification of `1.1.0-testnet` is pending: Robinhood's explorer certificate fails validation, so re-run `script/verify.sh` later. The mock NVDA price feed goes stale after 1 hour; a real feed or a keeper is needed before anyone else uses the testnet.

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

**Status:** steps 1–8 implemented and running against `1.1.0-testnet`. Phase 5 added `services/keeper`, candles, funding history, open interest history, option series statistics and open limit orders to the API, and bid/ask plus realized volatility to the pricing service (see Phase 5).

---

## Phase 3: SDK — Priority 2, built alongside API

The brief lists the SDK as Priority 2 but also says "Create an SDK from the beginning" (Section 34), so it is built alongside the API rather than after the frontend.

**Prerequisite — config layer** (`packages/config/`, `packages/types/`): chain config, deployments, market list and shared types, all typed and env-driven. No hardcoded chain ID, leverage or fees anywhere. The SDK and the frontend both import from here. Status: done. After a redeploy, run `pnpm --filter @orionis/config sync:deployments` to copy `packages/contracts/deployments/<network>.json` into `src/deployments.ts`.

1. `packages/sdk/` — `@orionis/sdk`, typed client wrapping API + contract calls (Section 34).
2. Constructor matches the brief: `new Orionis({ chainId, transport })`. Contract addresses and markets are resolved from `packages/config` and MarketRegistry, never hardcoded in the SDK.
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

**Status:** steps 1–14 implemented. The frontend reaches the chain and API only through the SDK; wagmi is used for wallet connection and network state only. Added since the original list: signed option quotes (`previewOpen({ user })`, `quoteClose`, `InvalidQuoteError` and friends), `markets.stats()`, `prices.history()`, `portfolio.funding()`, `risk.openInterest()`, and the `ORIONIS_ADDRESSES` override. Phase 5 added limit orders, candles, funding and open interest history, option statistics, bid/ask, and the package and docs for `@orionis/sdk` `0.1.0` (not published yet).

---

## Phase 4: Frontend — Priority 1

`apps/web/` — Next.js, React, TypeScript, Tailwind, wagmi, viem, TanStack Query, Zustand.

**Status: done.** Manually accepted on `[1.1.0-testnet]` with a real wallet: deposit, option open and close, perp open / increase / reduce / close, and the Activity, Markets and Portfolio pages, with every figure matching the chain and the indexer. Built: scaffold, shared UI primitives (`packages/ui`), wallet connection, navigation, landing page with "Explore markets", terminal shell, Perpetual Terminal with increase/reduce controls, Options Terminal (`/options`: underlying and expiry selectors, a calls | strike | puts chain with mark, IV and delta, and an order ticket driven by `options.previewOpen`), Markets, Portfolio and Activity pages, and chart history from the indexer. The options contract lists no strikes, so the chain proposes a strike ladder around the index price and a few expiries from `NEXT_PUBLIC_OPTION_*` (see `.env.example`). Known gaps at the end of Phase 4 (bid/ask, open interest, volume and IV were closed in Phase 5; funding is inert until a real mark price exists). Contract finding from the manual test: `PerpsEngine.increasePosition` skipped the taker fee and the leverage check; fixed in Phase 5, redeploy pending.

1. **Wallet connection** — wagmi setup, connect button, network detection against `NEXT_PUBLIC_CHAIN_ID`.
2. **Landing page** (Section 23) — hero with tagline, "Launch Terminal" / "Explore Markets" CTAs, concise product blocks (Options / Perpetuals / Onchain). Terminal remains primary focus, not landing page.
3. **Navigation** (Section 22): ORIONIS / Markets / Options / Perpetuals / Portfolio / Activity / Connect Wallet.
4. **Trading Terminal shell** (Section 24) — desktop-first layout: market list, chart, option chain/positions panel, order panel. Institutional visual direction (Section 2): black/off-white, neutral gray, restrained green/red, tabular numerals, no neon, minimal animation.
5. **Options Terminal** (Section 25–26) — underlying selector, expiry selector, option chain (calls left / strike center / puts right) with bid/ask/mark/IV/Greeks/OI/volume, order ticket showing premium, cost, break-even, max loss before signing (Section 45). **Status:** built at `/options`. The chain shows bid, ask, IV, open interest and volume, or the Greeks (a strike ladder proposed around spot, since the contract lists no strikes); added in Phase 5.
6. **Perpetual Terminal** (Section 27) — index/mark price, long/short toggle, market/limit order type, size, leverage selector (1x–10x from registry, not hardcoded), collateral input, estimated entry, liquidation price, fee — all shown before signing. **Status:** built, with increase/reduce controls on open positions. The limit order type shipped in Phase 5 (it needs a deployment that includes `PerpOrderManager`).
7. **Portfolio** (Section 28) — value, available collateral, locked margin, unrealized/realized PnL; tabs: All Positions, Options, Perpetuals, Open Orders, Funding, History.
8. **Markets Page** (Section 29) — asset, index price, 24h, options/perp volume, OI, funding, IV, status; trade actions per row.
9. **Transaction UX** (Section 30) — state machine: Preparing → Awaiting Wallet → Submitted → Confirming → Confirmed/Failed, with confirmation summary and explorer link.
10. **Explorer integration** (Section 43) — surface tx hash, block, contract, wallet, position ID, market ID with "View on Explorer" using `NEXT_PUBLIC_EXPLORER_URL`. **Status:** transaction links appear in the transaction toasts and the Activity and History tables (block shown in History); not every field in the list is shown everywhere yet.

---

## Phase 5: Priority 2 polish

**Status:** built and tested on 2026-09-19; contracts redeployed to testnet as `[1.2.0-testnet]` on 2026-09-20 and smoke-tested there (perp round trip, fixed `increasePosition`, limit order placed, cancelled and filled by the keeper); **SDK not published; no keeper is running continuously yet**. Everything below was also run end to end on a local Anvil chain with PostgreSQL, the indexer, pricing, API and keeper services and the web app (including a wallet-connected session that placed and cancelled a limit order), plus unit, fuzz and integration tests. The contracts, SDK, keeper and indexer have run on testnet (the indexer replayed the smoke-test events into the Railway database); the API, pricing and web app have not been run against it yet.

- **Contract fix first. Done and deployed.** `PerpsEngine.increasePosition` now charges the taker fee on the added size and enforces the leverage ceiling on the resulting position (`RiskManager.checkResultingLeverage`), with 16 unit tests and a fuzz. Limit orders (below) are in the same change, as planned. Contract coverage rose from about 67% of lines and 30% of branches to 94.5% and 62.6% (135 tests), and CI now enforces 90% and 55%. Found and fixed on the way: options ignored the settlement token's decimals, so on a 6-decimal token (mainnet USDC-style; the testnet token has 18 decimals, so it was not live there) a payout was credited a trillion times too high and option notional sat 12 decimals above perp notional in the same limit counter (`OptionsEngine.settlementDecimals`, `test/options/OptionsSixDecimals.t.sol`). **Redeployed 2026-09-20:** addresses in `packages/contracts/CHANGELOG.md` and `packages/config`.
- **Full Greeks wiring. Done.** The chain has a Market view (bid, ask, IV, open interest, volume) and a Greeks view (delta, gamma, theta per day, vega per volatility point); the order ticket shows all four Greeks.
- **Option chain bid/ask, open interest, volume, implied IV. Done, with two caveats.** Open interest and 24h volume per series come from the indexer (`GET /v1/options/:symbol/stats`). Bid and ask are the model's mark less and plus half a configured spread (`OPTION_SPREAD_BPS`, **0 by default**, so bid, mark and ask are equal until product sets one); opening pays the ask and closing receives the bid, and the signed quotes follow. IV is **not market-implied**: the protocol is the only counterparty, so there is no market to imply it from, and one implied from its own quotes would only echo the assumption. `services/pricing` now measures realized volatility from the indexed price history (`ivSource: "realized"`), and falls back to the flat assumption (`"default"`) when there is not enough history or the price never moved. On testnet the mock feed is flat, so expect `default` there.
- **Price feed keeper. Done. Explorer verification not done.** `services/keeper` re-pushes a mock feed's price before it goes stale and fills limit orders (below). It replaces a real NVDA feed only for testnet; a real feed adapter is still needed before mainnet. Explorer verification of `1.1.0-testnet` (and of the next deployment) is still blocked by Robinhood's explorer certificate.
- **Funding history view, open interest analytics. Done.** Under the terminal chart: Positions, Funding (rates the chain applied, per interval) and Open interest (long, short, share, cap used, history). Funding is 0% on every interval until a real mark price exists, and the view says so.
- **Advanced charts. Done.** Candlesticks with perp volume bars (5m, 15m, 1h, 1d) next to the line chart, built from the indexer's price samples, with a hover readout. Candles need the indexer to have been sampling; there are no candles before it started.
- **Limit orders. Done and live on testnet (engine, keeper, SDK, indexer); the API and frontend have not been run against it yet.** `PerpOrderManager`, `placeLimitOrder`, `cancelLimitOrder`, permissionless `executeLimitOrder`; the SDK's `orderType: "LIMIT"` is now `perps.placeLimitOrder`; the perp ticket has a Limit mode; Portfolio lists orders with a Cancel action. Not built: stop-loss, take-profit, and keeper incentives.
- **SDK docs and package. Done; not published.** `@orionis/sdk` `0.1.0` is publishable (`dist/` with ESM, CJS and types; `@orionis/config` and `@orionis/types` are bundled), with a full README and a changelog. Publishing needs an npm token and a person to start `.github/workflows/release-sdk.yml`.
- **Not done, still open:** fork tests against testnet state; an end-to-end test that runs contract event to indexer to API to frontend in CI (done by hand locally, not automated); the third-party audit; real price feed; moving the quoter role behind a multisig.

## Phase 6: Rebrand / Naming Audit (Section 46)

Run before any public deployment or handoff:

- Grep entire repo for `Citadelle`, `CTDL`, `citadelle` — must return zero hits in new code.
- Confirm package name is `@orionis/sdk`, contract display labels say Orionis, repo/README/docs/metadata/social preview/logos/favicons all rebranded.
- Do not rename already-deployed immutable contracts unless redeploying; new deployments use Orionis naming only.

---

## Phase 7 (post-MVP): Phase 2 / Phase 3 features

Not built until MVP (Priority 0–2) is live and stable:

- **Phase 2** (Section 39): limit orders, stop loss, take profit, cross margin, multi-collateral, advanced Greeks, volatility surface, options strategy builder, advanced funding analytics, trading API, market maker API.
- **Phase 3** (Section 40): portfolio margin, subaccounts, RFQ, block trades, structured products, market maker connectivity, advanced risk API, institutional reporting, clearing infrastructure, automated hedging.

---

## Cross-cutting rules (apply throughout, not one-time steps)

- Never hardcode: chain config, market lists, leverage caps, fee percentages, protocol token symbol/address.
- Frontend/SDK/protocol all read markets from MarketRegistry — no divergent lists.
- Liquidation and settlement logic always onchain and deterministic; offchain analytics (pricing service) is display-only, never source of truth.
- Every privileged contract action emits an event.
- Every admin action path should be built assuming eventual migration to multisig/timelock/governance (Section 37).

## Testing & Pre-Deployment

Covers what Phase 1 step 14 and the CI gate don't: full-stack integration, staging environment, and mainnet go/no-go criteria.

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
