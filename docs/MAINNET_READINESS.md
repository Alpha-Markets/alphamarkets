# Mainnet readiness

The verified chain facts, the exact deployment steps and the rehearsal results are in `docs/MAINNET_DEPLOYMENT.md`.

Status on 2026-09-25: the contracts are **deployed to mainnet (chain 4663) but not open**: 11 markets are listed on Chainlink feeds (21 more are prepared), and there is no pool funding and no backend yet. One wallet still holds every admin role. **Not ready for users.** The contracts have the fixes the first review asked
for and they run on testnet, but the items below are open. Nothing on this list is ticked unless it was checked.

## What is done

| Item | Evidence |
|---|---|
| Vault cannot owe more than it holds (pool, liabilities counter, net open-interest limit) | Invariant passes over 51,200 random calls; deployed to testnet; `docs/SECURITY_REVIEW.md` |
| Fast pause that cannot reconfigure or unpause; protocol-wide pause | Tests; proven live with a throwaway key on testnet |
| Bounded option premiums | Tests; the bound refused a zero premium live |
| Settlement that cannot run out of gas (batches, `settlePosition`) | Tests; proven live |
| Upgrade and admin handover rehearsed with a timelock | Fork rehearsal; `docs/SECURITY_REVIEW.md` |
| Audit package | `docs/AUDIT_SCOPE.md` |
| Runbook and launch-limits check | `docs/RUNBOOK.md`, `script/check-launch-limits.sh` |

## What blocks mainnet

| # | Item | Who | Depends on | Status |
|---|---|---|---|---|
| 1 | **Independent audit**, then fixes and a re-audit of anything that changed | You (book it), auditor | Nothing: start now | Not started. The longest item. |
| 2 | Real price feeds, and the adapter that reads them | Me | Nothing | **Adapter written and tested** (`ChainlinkPriceFeed`, 9 tests, plus a live mainnet fork test); 11 of 16 testnet markets have a Chainlink feed (`deployments/robinhood_mainnet.markets.json`); AVGO, JPM, DIS, UBER, SHOP have none. **Open decision: the age limit per market.** The feeds have a 24 hour heartbeat and on 2026-09-25 were 11 minutes to 16 hours old, so the default 1 hour limit halts most markets; a long limit trades on an old price. Listed on chain: 11 markets (2026-09-25); 21 more prepared. |
| 3 | Real settlement token, tested on a fork (decimals, transfer behaviour) | Me | Nothing | **USDG** (`0x5fc5…d168`, 6 decimals, an upgradeable Paxos token) is the settlement token of the mainnet deployment. Fork test: deposit and withdraw move exact amounts through the deployed vault. Still open: behaviour if Paxos pauses or blacklists (a runbook step). |
| 4 | Mainnet chain in `packages/config` and a mainnet web build on your domain | You (chain ID, RPC, explorer), me | Item 3 | Domain prepared by you; no chain config yet |
| 4 | Mainnet chain in `packages/config` and a mainnet web build on your domain | Me | The deployed addresses | **Done for the web build**: chain 4663 and the deployed addresses are in `packages/config`; the Vercel project `alphamarkets-mainnet` serves `alphamarkets.tech`. Still open: the mainnet API and indexer (item 12), so the site shows no markets yet. |
| 5 | Multisig and timelock chosen and deployed; the fast pauser key named | You | Signers | Not started |
| 6 | Quoter and maker keys behind a multisig or HSM; separate keys for deployer, quoter, keeper, liquidator | You | Item 5 | Keys are plain environment variables today |
| 7 | Production liquidation bot and option-settlement keeper; feed refresh switched off | Me | Item 2 | Neither exists outside the testnet simulator |
| 8 | Monitoring and alerts: oracle staleness, keeper gas, indexer lag, `BadDebt`, admin events | Me and you (pick a service) | A pager or chat destination | None exists |
| 9 | Pool reserve size, net open-interest limits, launch caps | You (product decision) | Nothing | Not decided; `check-launch-limits.sh` enforces them once chosen |
| 10 | Fork tests against mainnet | Me | Items 2 to 4 | **Partly done** (`test/fork/MainnetFork.t.sol`, 7 tests: deployment state, USDG, every feed, listing every market as the deployer). Not yet: a full open-to-settle flow on the real feeds, and a Paxos pause of USDG. |
| 11 | Staging soak of 1 to 2 weeks on a mainnet-shaped deployment | Me and you | Items 2 to 10 | Not started |
| 12 | Paid hosting, a separate Railway environment and database for mainnet | You | Item 4 | Free plan today |
| 13 | Runbook fields filled in and a pause rehearsed by the named people | You | Item 5 | Fields are TBD |

## The critical path

The audit takes the longest and only starts when you book it, so book it first. Items 2 to 10 can run while the
auditor works. The audit needs a frozen contract set, which we have now: further contract changes (for example a
different design for the pool) would restart it.

An honest estimate: **the earliest realistic mainnet date is the audit's length, plus the time to fix its findings,
plus the 1 to 2 week soak.** That is likely several weeks and depends on the auditor's calendar, which I do not
know. Ask the auditors for a start date and a duration; those two numbers set the launch date.

## Launch order once every item above is done

1. `DeployAll` on mainnet with the multisig and timelock wired in.
2. Add the markets, `SetNetOpenInterest`, `FundPool`.
3. `check-launch-limits.sh` must pass.
4. `HandOverAdmin` in two steps, then rehearse a pause with the named key.
5. Verify every contract on the explorer (`verify-full.sh`).
6. Open the site on the mainnet domain with the canary caps.
7. Raise the caps only after a stable period.

## What I can do now, while the audit runs

- Write the production liquidation bot and settlement keeper (item 7) against testnet.
- Write the feed adapter as soon as you give me the mainnet feed addresses (item 2).
- Add monitoring hooks (item 8) once you choose where alerts go.
- Add the mainnet chain to the config and a per-environment web build (item 4) once you give me the chain ID,
  RPC and explorer.
