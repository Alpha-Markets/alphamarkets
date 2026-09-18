---
id: DEVELOPMENT_STEPS
aliases: []
tags: []
---

# ORIONIS MARKETS — DEVELOPMENT STEPS

Derived from PROJECT_BRIEF.md. Sequenced by MVP Priority 0 → 1 → 2, then Phase 2/3.

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

- CI gate on every PR: lint, typecheck, unit tests, contract tests (Foundry), minimum coverage threshold on contracts (highest risk surface).
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
7. **OptionsEngine.sol + OptionMarket.sol + OptionPositionManager.sol** (`options/`) — European call/put, cash-settled only. Identifier format `UNDERLYING-EXPIRY-STRIKE-TYPE` (Section 8).
8. **OptionSettlement.sol** — intrinsic value formulas (Section 9): call `max(Settlement - Strike, 0)`, put `max(Strike - Settlement, 0)`, payout `Intrinsic × Contract Size × Contracts`. Settlement price from validated oracle data only.
9. **PerpsEngine.sol + PerpPositionManager.sol** (`perps/`) — open/increase/reduce/close long/short. MVP leverage tiers: 1x/2x/3x/5x/10x, configurable per market, never hardcoded in frontend (Section 11). Position state to track (Section 12): market, side, entry price, mark price, index price, position size, collateral, leverage, unrealized PnL, realized PnL, liquidation price, funding accrued, margin ratio.
10. **FundingManager.sol** — funding rate calculation, configurable interval, tracks accrued funding per position (Section 15).
11. **LiquidationEngine.sol** — deterministic flow: oracle update → mark price update → revaluation → margin check → liquidation execution → PnL/fees settled (Section 14). Frontend is never the source of truth for liquidation eligibility.
12. **Security pass** (Section 36): reentrancy guards, access control (role-based to start, Section 37), pausable markets, precision-safe math, slippage/deadline checks, position/open-interest caps, withdrawal validation. Use custom errors (`MarketPaused`, `InvalidOraclePrice`, `StaleOraclePrice`, `InsufficientCollateral`, `InsufficientMargin`, `PositionLimitExceeded`, `OpenInterestLimitExceeded`).
13. **Events** (Section 35): every state-changing and privileged action emits an event, designed with the indexer's needs in mind (`CollateralDeposited`, `OptionPositionOpened/Closed`, `OptionExercised`, `OptionSettled`, `PerpPositionOpened/Updated/Closed`, `PositionLiquidated`, `FundingPaid`, `MarketAdded/Updated`, `ProtocolFeeCollected`, `BuybackExecuted`).
14. Foundry test suite: unit tests per contract, fuzz tests on margin/liquidation math, integration tests for full open→settle/liquidate flows.
15. Deploy to testnet. Verify contracts, record addresses into `.env`.

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

---

## Phase 3: SDK — start early, Priority 2 (build alongside API)

1. `packages/sdk/` — `@orionis/sdk`, typed client wrapping API + contract calls (Section 34).
2. Core methods: `markets.list()`, `options.quote()`, `perps.openPosition()`, and equivalents for close/increase/reduce, portfolio/positions/history reads.
3. Frontend consumes its own SDK (dogfooding) rather than calling API/contracts directly.

---

## Phase 4: Frontend — Priority 1

`apps/web/` — Next.js, React, TypeScript, Tailwind, wagmi, viem, TanStack Query, Zustand.

1. **Config layer** (`packages/config/`, `packages/types/`) — chain config, market list, all typed, all env-driven. No hardcoded chain ID/leverage/fees anywhere in components.
2. **Wallet connection** — wagmi setup, connect button, network detection against `NEXT_PUBLIC_CHAIN_ID`.
3. **Landing page** (Section 23) — hero with tagline, "Launch Terminal" / "Explore Markets" CTAs, concise product blocks (Options / Perpetuals / Onchain). Terminal remains primary focus, not landing page.
4. **Navigation** (Section 22): ORIONIS / Markets / Options / Perpetuals / Portfolio / Activity / Connect Wallet.
5. **Trading Terminal shell** (Section 24) — desktop-first layout: market list, chart, option chain/positions panel, order panel. Institutional visual direction (Section 2): black/off-white, neutral gray, restrained green/red, tabular numerals, no neon, minimal animation.
6. **Options Terminal** (Section 25–26) — underlying selector, expiry selector, option chain (calls left / strike center / puts right) with bid/ask/mark/IV/Greeks/OI/volume, order ticket showing premium, cost, break-even, max loss before signing (Section 45).
7. **Perpetual Terminal** (Section 27) — index/mark price, long/short toggle, market/limit order type, size, leverage selector (1x–10x from registry, not hardcoded), collateral input, estimated entry, liquidation price, fee — all shown before signing.
8. **Portfolio** (Section 28) — value, available collateral, locked margin, unrealized/realized PnL; tabs: All Positions, Options, Perpetuals, Open Orders, Funding, History.
9. **Markets Page** (Section 29) — asset, index price, 24h, options/perp volume, OI, funding, IV, status; trade actions per row.
10. **Transaction UX** (Section 30) — state machine: Preparing → Awaiting Wallet → Submitted → Confirming → Confirmed/Failed, with confirmation summary and explorer link.
11. **Explorer integration** (Section 43) — surface tx hash, block, contract, wallet, position ID, market ID with "View on Explorer" using `NEXT_PUBLIC_EXPLORER_URL`.

---

## Phase 5: Priority 2 polish

- Full Greeks display wiring (already quoted via API, wire into option chain/order ticket UI).
- Funding history view, open interest analytics.
- Advanced charts (candlesticks, volume overlays).
- Limit orders (frontend + engine support).
- Finish/publish SDK docs and package for external consumption.

---

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
