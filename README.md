# ALPHAMARKETS

**Derivatives for tokenized equities.**

Trade options and perpetual derivatives on tokenized equities.

AlphaMarkets is an onchain derivatives venue for tokenized equities, built for Robinhood Chain. It is not a tokenized-stock spot exchange — it is the derivatives layer built on top of tokenized equities, covering options (volatility, hedging, defined risk) and perpetuals (direction, leverage, long/short).

## Status

AlphaMarkets runs on **Robinhood Chain testnet** (chain ID `46630`). It is not audited and has not been deployed to mainnet. Do not use it with real funds.

- **Contracts:** deployed as `1.5.0-testnet` (2026-09-21). All 20 contracts sit behind UUPS proxies, so a later upgrade keeps every address and all state. Contracts are verified on the testnet explorer. Addresses are in `packages/contracts/deployments/` and `packages/contracts/CHANGELOG.md`.
- **Markets:** NVDA, TSLA, AAPL, META and HOOD, each with perpetuals and options. Testnet prices come from mock feeds, and the risk limits are placeholders.
- **Hosting:** indexer, API, pricing service and keeper run on Railway. The web app runs on Vercel at <https://alphamarkets-ten.vercel.app>.
- **Features:** perpetuals (market and limit orders, stop-loss, take-profit, cross margin), options (option chain with bid/ask and Greeks, strategy builder), RFQ, subaccounts, portfolio and activity views. Nothing that holds or moves money is audited.
- **SDK:** `@alphamarkets/sdk` `0.1.0` is ready to publish and is not published yet.

## Repository structure

```text
alphamarkets/
apps/
    web/                Trading terminal (Next.js, React, TypeScript, Tailwind, wagmi, viem)
services/
    api/                REST + WebSocket API
    indexer/            Contract event indexer (PostgreSQL)
    pricing/            Offchain options analytics and signed option quotes (display and quoting only, never settlement truth)
    risk-monitor/       Margin health read path
    keeper/             Keeps testnet price feeds fresh, fills limit orders and fires stop-loss and take-profit orders
    hedger/             Keeps an options book delta neutral with perps (dry run unless told to trade)
    simulator/          Testnet demo: moves mock prices, runs bot traders and a liquidator (see services/simulator/README.md)
packages/
    contracts/          Solidity contracts (Foundry + OpenZeppelin, not a pnpm package)
    sdk/                @alphamarkets/sdk — the sanctioned client for contracts/API
    ui/                 Shared brand-styled UI primitives
    config/             Chain/market/fee/risk config — single source of truth, env-driven
    types/              Shared TypeScript shapes (MarketConfig, positions, fee config)
scripts/
    check-brand.sh      Naming audit, run in CI
```

## Requirements

- Node.js 20 or later (CI uses 22)
- pnpm 9 or later (`pnpm@9.15.0`)
- [Foundry](https://book.getfoundry.sh/), only for `packages/contracts`
- PostgreSQL, for the indexer, API and risk monitor

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in chain/contract addresses per environment
pnpm dev
```

No chain ID, RPC URL, contract address, leverage cap, fee percentage, or protocol token symbol/address is ever hardcoded — all of it is environment- or registry-driven. See `.env.example` and `docs/PROJECT_BRIEF.md` Section 4 / Section 21.

After a contract deployment, copy the new addresses into the config package:

```bash
pnpm --filter @alphamarkets/config sync:deployments
```

## Commands

Run from the repository root (Turborepo runs them across the workspace):

| Command | What it does |
|---|---|
| `pnpm dev` | Start every package in dev mode |
| `pnpm build` | Build every package (includes `next build`) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint every package |
| `pnpm test` | Run every unit test suite |
| `pnpm check:brand` | Run the naming audit |

For contracts, run `forge build` and `forge test` in `packages/contracts` (see its README). CI (`.github/workflows/`) runs the brand check, lint, typecheck and tests on every PR, plus a separate contracts workflow with formatting, a storage-layout check, tests and a coverage gate.

## Demo simulator

`services/simulator` makes the testnet look like a live market for a recorded demo: it moves the mock prices, trades with ten bot wallets through the SDK, and runs a liquidator. It can also draw simulated chart history. Simulated activity must be presented as simulated. See `services/simulator/README.md`.

```bash
pnpm --filter @alphamarkets/simulator bootstrap 4   # fund the bots (once)
pnpm --filter @alphamarkets/simulator start
```

## Development

Build order, engineering practices, and phase-by-phase steps live in `docs/DEVELOPMENT_STEPS.md`, derived from `docs/PROJECT_BRIEF.md`. Phases 0 to 6 are done, and Phase 7 (post-MVP features) is built and deployed to testnet but not audited. See the status table in `docs/DEVELOPMENT_STEPS.md`.

## Docs

- `docs/PROJECT_BRIEF.md` — product, architecture, and scope.
- `docs/DEVELOPMENT_STEPS.md` — sequenced build plan (Phase 0 through Phase 7), status, hosting notes and cross-cutting engineering rules.
- `packages/contracts/README.md` and `CHANGELOG.md` — contract layout, setup, deployments and upgrade flow.
- `packages/sdk/README.md` — SDK usage.
- `services/simulator/README.md` — demo simulator.

## License

See `LICENSE`.
