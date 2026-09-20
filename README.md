# ORIONIS MARKETS

**Derivatives for tokenized equities.**

Trade options and perpetual derivatives on tokenized equities.

Orionis Markets is an onchain derivatives venue for tokenized equities, built for Robinhood Chain. It is not a tokenized-stock spot exchange — it is the derivatives layer built on top of tokenized equities, covering options (volatility, hedging, defined risk) and perpetuals (direction, leverage, long/short).

## Repository structure

```text
orionis/
apps/
    web/                Trading terminal (Next.js, React, TypeScript, Tailwind, wagmi, viem)
services/
    api/                REST + WebSocket API
    indexer/            Contract event indexer (PostgreSQL)
    pricing/            Offchain options analytics (display-only, never settlement truth)
    risk-monitor/       Margin health read path
    keeper/             Keeps testnet price feeds fresh, fills limit orders and fires stop-loss and take-profit orders
    hedger/             Keeps an options book delta neutral with perps (dry run unless told to trade)
packages/
    contracts/          Solidity contracts (Foundry + OpenZeppelin)
    sdk/                @orionis/sdk — the sanctioned client for contracts/API
    ui/                 Shared brand-styled UI primitives
    config/             Chain/market/fee/risk config — single source of truth, env-driven
    types/              Shared TypeScript shapes (MarketConfig, positions, fee config)
```

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in chain/contract addresses per environment
pnpm dev
```

No chain ID, RPC URL, contract address, leverage cap, fee percentage, or protocol token symbol/address is ever hardcoded — all of it is environment- or registry-driven. See `.env.example` and `PROJECT_BRIEF.md` Section 4 / Section 21.

## Development

Build order, engineering practices, and phase-by-phase steps live in `DEVELOPMENT_STEPS.md`, derived from `PROJECT_BRIEF.md`. Current phase: **Phase 5 — Priority 2 polish** (see the status table in `DEVELOPMENT_STEPS.md`).

## Docs

- `PROJECT_BRIEF.md` — product, architecture, and scope.
- `DEVELOPMENT_STEPS.md` — sequenced build plan (Phase 0 through Phase 7) and cross-cutting engineering rules.
