# AlphaMarkets: Final Pre-Mainnet Testing Plan

## Context
The stack is testnet-only today (Robinhood Chain testnet, id 46630). It is unaudited, and the README says not to use it with real funds. Testnet uses mock price feeds, a public-mint settlement token, a deployer EOA holding every admin role, and no production liquidation or option-settlement keeper. This plan lists what must be tested and closed before mainnet. Gates are ordered; do not start a later gate until the earlier one passes.

## Gate 0: Blockers to fix before testing is meaningful
1. Real oracle adapter replacing `MockPriceFeed` (`oracle/MockPriceFeed.sol`); set `KEEPER_REFRESH_FEEDS=false`.
2. Real settlement token (no `MockERC20` with open `mint`). Decide on fee-on-transfer/rebasing exclusion in `CollateralManager`.
3. Add mainnet chain to `packages/config/src/chains.ts` and `deployments.ts`; web app reads addresses at build time, so needs a per-environment build.
4. Production liquidation bot and option-settlement keeper (neither exists; only `services/simulator/src/liquidator.ts` and the manual web button).
5. Split `pauseMarket` from `ORACLE_ADMIN_ROLE` (OracleRouter) into a pauser role.
6. Enforce option quote floor/ceiling (CHANGELOG notes it is missing).
7. Choose multisig + timelock; run `HandOverAdmin.s.sol` (also move `QUOTER_ROLE`/`MAKER_ROLE`, which the script does not cover).

## Gate 1: Smart contract testing (`packages/contracts`)
- Existing: ~270 unit tests, ~15 fuzz, 8 integration; coverage gate 90% lines / 55% branches. Confirm all pass at `--fuzz-runs 10000` and re-measure coverage (docs figures may be stale).
- **Add invariant tests (none exist)** with a handler contract:
  - Vault: sum of user ledger balances + insurance + fees <= token balance held; `settlePnl` net zero-sum across users plus pool.
  - Perps: open interest equals sum of positions; margin locked <= collateral; funding net zero.
  - Options: OI per series equals sum of open positions; payout <= pool capacity.
  - Liquidation: no position leaves liquidation with negative user balance without `BadDebt` event.
- **Add fork tests (none exist)** against Robinhood mainnet RPC: real feed decimals, real token decimals/behaviour, deploy and full open-to-settle flow.
- Targeted adversarial tests:
  - `OracleRouter.ensureSettlementPrice`: staleness/manipulation at first block after expiry.
  - `OptionsEngine.settleExpired`: gas at large series size (loop DoS); cap or batch.
  - `PerpsEngine.setRfqManager`: confirm set once, deployer immutable state.
  - Liquidation: reward bound, front-running, bad debt when insurance fund is 0.
  - Cross-margin `seizeForShortfall` and withdraw-guard buffer math; 6-decimal token rounding.
  - RFQ/quote signature replay across chains (EIP-712 domain includes chain id) and after upgrade.
  - Upgrade: UUPS upgrade on a fork with `check-storage-layout.py`, `_disableInitializers`, unauthorized upgrade reverts.
- Static analysis: Slither, plus Aderyn or Mythril; triage all findings.
- **Independent audit** by a third party; fix and re-test all High/Medium findings. Consider a bug bounty at launch.

## Gate 2: Services and integration
- Run existing Anvil-based `packages/sdk/src/integration.test.ts` and `analytics.integration.test.ts` (needs `TEST_DATABASE_URL`) in CI; today CI silently skips them (no Foundry/Postgres installed).
- Add tests: indexer event decode and DB path (only `startBlock.test.ts` exists), reorg handling (add confirmation depth), risk-monitor, keeper retry/backoff and gas-low handling, keeper cursor persistence.
- Liquidation bot and settlement keeper: test on Anvil fork with price moves, congestion, failed tx, and duplicate runs.
- Pricing service: quote size/exposure limits, TTL, signer key isolation; test that a wrong-chain quote is rejected.
- API: rate limiting, CORS allow-list, RPC proxy write blocking, WS load.
- Load test the API and indexer at expected mainnet event rate.

## Gate 3: Web app
- Add Playwright e2e (none exist) with a mock wallet on a local Anvil: connect, wrong-network switch (and `wallet_addEthereumChain` fallback, not currently implemented), approve/deposit/withdraw, open/close perp, limit, TP/SL, buy/sell/settle option, rejected tx, stale oracle error.
- Test alerts: TP/SL/liquidation (`useTriggerFills`, cursor in localStorage, catch-up summary), option expiry alert (`OptionExpiryAlerts.tsx`, no tests today). Note alerts only fire with the tab open; decide if server-side notifications are required for launch.
- Add real lint and a `next build` step in CI. Verify mainnet build points at mainnet addresses and no testnet strings (FAQ claim about switching "without a rebuild" is incorrect).
- Use a proxied/rate-limited RPC in `NEXT_PUBLIC_*`; the Alchemy key must not ship in the bundle.
- Add missing WalletConnect/Coinbase connectors or accept injected-only; test with mobile wallets.
- Cross-browser and responsive pass; verify alignment/layout of new screens against the existing grid.

## Gate 4: Staging (mainnet-like rehearsal)
1. Deploy full stack to a fresh testnet with real-format feeds and multisig/timelock admin.
2. Run `verify-full.sh` for every implementation; confirm full (not partial) explorer verification.
3. Rehearse: upgrade via timelock, emergency pause and unpause of a market, oracle failure (stale/deviating feed), keeper outage, quoter key rotation, admin key handover.
4. Soak test 1 to 2 weeks with continuous automated traffic; watch reverts, gas, indexer lag.
5. Confirm oracle safeguards trigger live at least once.

## Gate 5: Ops readiness
- Monitoring and alerts (none exist): oracle staleness, keeper/liquidator gas balance, indexer lag, API and pricing errors, uptime, large position or OI spikes, admin-role events, `BadDebt` events. Route to a pager.
- Key management: separate keys for deployer, quoter, keeper, liquidator, maker; quoter/maker behind multisig or HSM; no shared keys; rotate the local dev keys.
- Hosting: move off Railway Free plan; add healthchecks for keeper/risk-monitor; build step replacing runtime `tsx`; CD or documented manual deploy; DB backups and restore test.
- Runbooks: pause plan, incident response, upgrade procedure, key compromise.
- Launch limits: canary OI and per-position caps, allow-list or small TVL cap first, raise gradually.
- Legal/labeling: remove or label simulator activity; the simulator backfill must never write to the production DB.

## Go / No-go criteria
- All Gate 0 items done; audit High/Medium findings closed; invariant and fork tests passing; e2e green in CI; staging soak clean; monitoring live; admin on multisig+timelock; pause rehearsed.

## Verification (how to execute)
- Contracts: `cd packages/contracts && forge test --fuzz-runs 10000`, `forge coverage`, `python script/check-storage-layout.py`, `script/check-admin-roles.sh`.
- JS: `pnpm test`, `pnpm typecheck`, `pnpm --filter web build`, with Foundry and Postgres available.
- Deploy dry run: `DeployAll.s.sol` without `--broadcast` on a mainnet fork.
